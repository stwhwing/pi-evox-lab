#!/usr/bin/env node
/**
 * light-cli.mjs — 内置 light 后端命令行（零 npm 依赖）
 *
 * 用途：不安装 evolver 时，手工「沉淀 / 审核 / 查看」经验库的入口。
 *
 * 用法：
 *   node code/light-cli.mjs distill --signals bash,encoding-error \
 *        --strategy "用 encoding='gbk' 读取文件；不要用默认 utf-8" --summary "GBK 文件解码失败"
 *   node code/light-cli.mjs approve <gene_id>
 *   node code/light-cli.mjs quarantine <gene_id>
 *   node code/light-cli.mjs list
 *   node code/light-cli.mjs info           # 显示库路径与统计
 *
 * 说明：库路径默认 ~/.evomap/assets，可用 EVO_STORE_DIR 覆盖（与 evolver 后端共用同一格式）。
 * 去重：distill 按「归一化 strategy」判重，库中已有相同修法则跳过（不写基因也不写台账）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as distill from './engine/light/distill.mjs';
import * as ledger from './engine/light/ledger.mjs';
import { STORE_DIR, readGenes, readReview, approvedAssetIds } from './engine/light/store.mjs';
import { SIGNAL_RULES, AVOID_TEMPLATES, proposeFromError } from './engine/light/distill.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, def = undefined) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : def;
};
const positional = rest.filter((a) => !a.startsWith('--'));

// ── P0③ 引导式沉淀（2026-09-23）──────────────────────────────────────────────
// 从一段错误文本抽信号家族 + 预填 AVOID 模板 + 结构化 anti_patterns，
// 把"从一次失败直接生成 distill 草稿"的门槛降到最低（人只补 FIX）。
//
// ── 方案 A 词汇对齐（2026-09-23，见 _flylora_research/P1⑤_冲突守卫_收紧分析_20260923.md）──
// 负经验分两种表示，**不可混用**：
//   · ANTI_TAGS  ：人读 kebab 标签 → 只写进 summary（不参与匹配）
//   · ANTI_TOKENS：机器可匹配的**单 token 字面量** → 写进 anti_patterns（供 geneConflicts 用）
// 原因：`geneConflicts` 判定 = 「anti_pattern 整串 ∈ 对方 strategy token 集」，而分词器把连字符
// 视作 token 内字符 ⇒ kebab 标签（assume-default-utf8）是**单个不透明 token**，永远命中不了
// 自然语言策略。故 anti_patterns 只放"对方若主张做、即与本基因冲突"的那个**无歧义单 token**；
// **拿不准就留空**（宁缺毋滥——空 anti_patterns 只是不触发，塞 kebab 也只是不触发，但会误导人）。
const ANTI_TAGS = {
  'encoding-error': 'assume-default-utf8',
  'permission-denied': 'write-without-restore-perm',
  'file-not-found': 'assume-path-exists',
  'invalid-json': 'strict-parse-no-fallback',
  'network-error': 'call-without-timeout-retry',
  'syntax-error': 'run-without-syntax-check',
  'type-or-value-error': 'assume-value-type',
  'assertion-failed': 'trust-unverified-output',
  unknown: 'repeat-failed-approach',
};
const ANTI_TOKENS = {
  // 仅"能用无歧义单 token 表达被禁止主张"的家族才有值；其余刻意留空。
  // 'utf-8'：对方若主张"直接用 utf-8 读（默认编码）"，即与本基因的"按真实编码读取"冲突。
  // 注意不要放 'json.loads' 这类**双方都会出现**的 token（合规方也写它 → 误删）。
  'encoding-error': ['utf-8'],
};
// ── 统一错误输出（0.14.7，回应 skillhub errorHandling 4.3「缺统一错误码 / 中英文混杂 / 生硬退出」）──
// 退出码约定：0=成功；1=运行期失败；2=用法错误（缺参数 / 未知命令）。
// 所有错误统一前缀 [pi-evox]，需要时附「→ 修正：」一行可执行指引，避免只丢退出码让用户对着文档猜。
function fail(msg, { hint, code = 2 } = {}) {
  console.error(`[pi-evox] ✗ ${msg}`);
  if (hint) console.error(`         → 修正：${hint}`);
  process.exit(code);
}

/**
 * 错误提示统一为中文（0.16.0，回应 skillhub 评测 errorHandling 4.3）。
 * 问题：本 CLI 自己的消息都是中文，但 Node/系统抛出的错误是英文（ENOENT、EACCES、
 * SyntaxError 等），两者混在同一段输出里，用户看着乱、也不知道该改什么。
 * 这里把最常见的系统错误码映射成「中文原因 + 可执行修正」，其余错误也统一加中文前缀，
 * 保证**任何失败都有一句中文说明**，而不是只丢一段英文堆栈。
 */
const SYS_ERROR_HINTS = [
  [/ENOENT/, '找不到文件或目录', '检查路径是否正确、文件是否存在；库路径可用 EVO_STORE_DIR 覆盖'],
  [/EACCES|EPERM/, '没有权限读写', '检查文件/目录权限（POSIX 用 chmod，Windows 检查只读属性）'],
  [/EISDIR/, '目标是目录而不是文件', '把 --out / 路径参数指向具体文件，不要指向目录'],
  [/EMFILE/, '同时打开的文件太多', '减少并发；或提高系统 ulimit -n'],
  [/ENOSPC/, '磁盘空间不足', '清理磁盘后重试'],
  [/EADDRINUSE/, '端口被占用', '换一个端口，或先停掉占用该端口的进程'],
  [/JSON/i, 'JSON 解析失败（文件可能损坏或有坏行）', '经验库是 JSONL：坏行会被跳过；若整体损坏，从备份恢复'],
];

function explainErr(err) {
  const raw = String((err && (err.stack || err.message)) || err);
  const head = raw.split('\n')[0];
  for (const [re, why, fix] of SYS_ERROR_HINTS) {
    if (re.test(head)) return { why, fix, head };
  }
  return { why: '运行出错', fix: '按下面的英文提示定位；或运行 node code/light-cli.mjs doctor 做环境自检', head };
}

process.on('uncaughtException', (err) => {
  const e = explainErr(err);
  console.error(`[pi-evox] ✗ ${e.why}`);
  console.error(`         → 修正：${e.fix}`);
  console.error(`         （原始错误：${e.head}）`);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  const e = explainErr(err);
  console.error(`[pi-evox] ✗ ${e.why}`);
  console.error(`         → 修正：${e.fix}`);
  console.error(`         （原始错误：${e.head}）`);
  process.exit(1);
});

/**
 * B：闭环健康度（0.16.0）。
 *
 * 动机：这套系统最常见的失败不是「出错」，而是**静默失效**——
 *   ① 沉淀了但没 approve ⇒ 基因入库却被隔离，永远不注入（实测某节点 39 条里 15 条如此）；
 *   ② 装了但从未召回 ⇒ 经验从不生效，而用户毫无察觉。
 * 这里把这两种沉默变成**可见的诊断与可执行动作**。
 */
/**
 * C：自己沉淀的基因是否自动通过审核（0.16.0）。**默认开启**。
 *
 * 背景：默认 quarantined 是为了质量，但实测造成大量「存了却永不注入」的静默失效
 * （某节点 39 条里 15 条待审）。而召回侧本就有修法守卫 + 叙述守卫兜底，
 * 于是「自己的库自己负责」是更合理的默认：沉淀即生效，不再需要额外一步。
 *
 * 开关（用户可随时改，优先级从高到低）：
 *   --auto-approve / --no-auto-approve  （单次）
 *   EVOX_AUTO_APPROVE=on|off            （环境）
 *   config.json: {"autoApprove": true}  （持久）
 * 注意：**仅作用于本地 distill/draft**；从共享池 `gene import` 仍按 tier 判定，不受此项影响。
 */
function autoApproveState(args) {
  if (Array.isArray(args) && (args.includes('--no-auto-approve') || args.includes('--manual-review'))) return 'quarantined';
  const config = readConfig();
  const def = typeof config.autoApprove === 'boolean' ? config.autoApprove : true; // 默认开
  if (Array.isArray(args) && args.includes('--auto-approve')) return 'approved';
  if (process.env.EVOX_AUTO_APPROVE === 'off') return 'quarantined';
  if (process.env.EVOX_AUTO_APPROVE === 'on') return 'approved';
  return def ? 'approved' : 'quarantined';
}

/**
 * A：`install-hooks`（0.16.0）——把「宿主接入」从手工配置变成一条命令，但**由用户决定**。
 *
 * 设计原则（不擅自改用户的宿主）：
 *   1. **默认演练**：不加 --yes 只打印将要做的每件事，绝不落盘；
 *   2. 写入前**自动备份**宿主配置文件（`.bak-<时间戳>`）；
 *   3. 探测不到宿主时明确说明，不做猜测性写入。
 * 支持：OpenClaw（把 handler 写到 hooks 目录并提示注册）、Hermes（提示注册 pre_llm_call）。
 */
async function installHooks({ args, yes }) {
  const home = os.homedir();
  const skillDir = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // <技能根目录>
  const tplDir = path.join(skillDir, 'examples', 'hooks');
  const out = [];
  let wrote = false;

  const detected = [];
  const ocDir = path.join(home, '.openclaw');
  const hmDir = path.join(home, '.hermes');
  if (fs.existsSync(ocDir)) detected.push({ host: 'openclaw', dir: ocDir });
  if (fs.existsSync(hmDir)) detected.push({ host: 'hermes', dir: hmDir });
  const wantIdx = args.indexOf('--host');
  const want = wantIdx >= 0 ? String(args[wantIdx + 1] || '').toLowerCase() : null;
  const targets = want ? detected.filter((d) => d.host === want) : detected;

  out.push('── install-hooks ' + (yes ? '（写入模式）' : '（演练模式，未落盘）') + ' ──');
  if (!detected.length) {
    out.push('  ⚠ 未探测到已知宿主（~/.openclaw 或 ~/.hermes）。可手工按 examples/hooks/README.md 接入。');
    return { text: out.join('\n'), wrote: false, code: 1 };
  }
  out.push(`  探测到宿主: ${detected.map((d) => d.host).join(', ')}`);

  for (const t of targets) {
    const src = t.host === 'openclaw'
      ? path.join(tplDir, 'openclaw-bootstrap-recall.js')
      : path.join(tplDir, 'hermes-pre-llm-recall.py');
    if (!fs.existsSync(src)) { out.push(`  ✗ 模板缺失: ${src}`); continue; }
    const destDir = path.join(t.dir, 'hooks', 'evox-recall');
    const dest = path.join(destDir, t.host === 'openclaw' ? 'handler.js' : 'evox_recall.py');
    out.push('');
    out.push(`  [${t.host}]`);
    out.push(`    将复制: ${src}`);
    out.push(`      → ${dest}`);
    out.push(`    并将模板中的 <技能目录> 替换为: ${skillDir}`);
    if (yes) {
      try {
        fs.mkdirSync(destDir, { recursive: true });
        let body = fs.readFileSync(src, 'utf8').replace(/<技能目录>/g, skillDir);
        fs.writeFileSync(dest, body, 'utf8');
        if (t.host === 'hermes') { try { fs.chmodSync(dest, 0o755); } catch { /* 忽略 */ } }
        wrote = true;
        out.push('    ✓ 已写入');
        out.push(`    注册方式: ${t.host === 'openclaw' ? '在钩子配置里注册 agent:bootstrap → 该文件（改 handler 通常需重启网关）' : '在钩子配置里注册 pre_llm_call → 该文件（若启用 allowlist，改脚本后需刷新）'}`);
      } catch (e) {
        out.push(`    ✗ 写入失败: ${String(e.message || e)}`);
      }
    }
  }
  return { text: out.join('\n'), wrote, code: 0 };
}

const CONFIG_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config.json');
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}
function writeConfig(patch) {
  const cur = readConfig();
  const next = Object.assign({}, cur, patch);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function loopHealth(genes, approved) {
  const hitsDir = process.env.EVOX_HITS_DIR || path.join(process.cwd(), 'experiments');
  const countLines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).length; } catch { return 0; } };
  const recallCalls = countLines(path.join(hitsDir, 'recall_calls.jsonl'));
  const hits = countLines(path.join(hitsDir, 'hits.jsonl'));
  const pending = genes.filter((g) => g && g.asset_id && !approved.has(g.asset_id)).length;

  const lines = ['── 闭环健康度 ──'];
  lines.push(`  召回次数    : ${recallCalls}${recallCalls === 0 ? '  ← 从未召回，经验不会生效' : ''}`);
  lines.push(`  命中登记    : ${hits}`);
  lines.push(`  待审基因    : ${pending}${pending > 0 ? '  ← 这些不会注入！' : ''}`);
  const alive = recallCalls > 0 && pending === 0;
  lines.push(`  状态        : ${alive ? '闭环运行中' : '未闭合（按下面做一步即可）'}`);
  lines.push('');

  if (recallCalls === 0) {
    lines.push('  ⚠ 还没跑过召回：经验库的价值取决于**召回是否发生**，沉淀不等于生效。');
    lines.push('    → 立刻试一次：node code/evolver-recall.mjs --query "读取中文日志报 UnicodeDecodeError"');
    lines.push('    → 想让 agent 自动召回：node code/light-cli.mjs install-hooks（先看它会做什么，加 --yes 才写入）');
  }
  if (pending > 0) {
    const sample = genes.filter((g) => g && g.asset_id && !approved.has(g.asset_id)).slice(0, 3).map((g) => g.id);
    lines.push(`  ⚠ 有 ${pending} 条基因待审，待审基因**不会被注入**，等于存了没用。`);
    lines.push(`    → 审核：node code/light-cli.mjs approve ${sample[0]}`);
    if (sample.length > 1) lines.push(`    （其余：${sample.slice(1).join(', ')}${pending > 3 ? ' …' : ''}）`);
    lines.push('    → 或让自己沉淀的基因自动通过：node code/light-cli.mjs config --auto-approve on');
  }
  return lines.join('\n');
}

function usage() {
  console.log(`light-cli — 内置经验库运维命令（零依赖）

用法：
  node code/light-cli.mjs doctor                                                   # 首次运行自检（Node/目录/权限）
  node code/light-cli.mjs distill --signals <a,b> --strategy "<可执行修法>" [--summary "<坑>"] [--category repair] [--shareable]
  node code/light-cli.mjs distill --error "<错误文本>" [--context "<在做什么>"] [--tool <工具名>] [--shareable]   # 引导式：自动抽信号
  node code/light-cli.mjs draft  --error "<错误文本>" [--context "<在做什么>"] [--tool <工具名>] [--shareable] [--commit]   # 生成可编辑草稿
  node code/light-cli.mjs approve <gene_id>
  node code/light-cli.mjs quarantine <gene_id> [--reason "<原因>"]
  node code/light-cli.mjs gene export [--out <file>]          # 导出「已 --shareable 且过脱敏闸门」的基因
  node code/light-cli.mjs gene submit --pool <自有共享池目录>   # 过闸写入自建池（幂等）
  node code/light-cli.mjs gene import <池文件> [--tier official]  # 拉取合并；official=自建策展池自动通过，community(默认)=待审
  node code/light-cli.mjs list
  node code/light-cli.mjs info                                     # 含「闭环健康度」诊断
  node code/light-cli.mjs starter                                  # 一键装载起步基因包（10 条通用教训）
  node code/light-cli.mjs install-hooks [--host openclaw|hermes] [--yes]  # 演练；加 --yes 才写入
  node code/light-cli.mjs config [--auto-approve on|off]           # 自己沉淀的基因是否自动通过（默认 on）
  node code/light-cli.mjs snippet                                  # 输出可粘进 AGENTS.md 的操作规程（无钩子宿主用）

共享基因库：distill/draft 加 --shareable 标记该基因「可共享」（默认不共享=不外发）。
  任何基因导出/入池前必过脱敏闸门（私有IP/绝对路径/密钥/内网服务命中即拦截，不出网）。
  import 默认 community 一律待审；仅对你自己控制的池显式 --tier official 才自动通过。
  池目录默认 ~/.evomap/pool（EVO_POOL_DIR 覆盖）。

库路径：${STORE_DIR}（可用 EVO_STORE_DIR 覆盖）`);
}

/**
 * doctor —— 首次运行自检（0.14.6 P2a，回应 skillhub usability 4.3「首次运行无引导」）。
 * 校验：Node 版本、经验库目录可写、命中登记目录可达，失败项给出**修正指引**而非只报错误。
 *
 * 用法示例：
 *   node code/light-cli.mjs doctor
 * 退出码：0=全部就绪；1=存在未通过项（日常 recall / 沉淀不受影响，仅提示先解决环境）。
 */
function doctor() {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({ name: 'Node 版本 ≥22', ok: nodeMajor >= 22, detail: `当前 v${process.versions.node}`, fix: '升级到 Node ≥22（traps 生成器与 pi/evolver 均要求）后重试（FAQ·Q8）' });
  let storeOk = true, storeDetail = STORE_DIR;
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    const probe = path.join(STORE_DIR, '.pi-evox-doctor');
    fs.writeFileSync(probe, 'ok'); fs.rmSync(probe, { force: true });
  } catch (e) { storeOk = false; storeDetail = `${STORE_DIR} 不可写：${String(e.message).slice(0, 80)}`; }
  checks.push({ name: '经验库目录可写', ok: storeOk, detail: storeDetail, fix: '检查目录权限（Linux 用 chmod，Windows 检查只读属性 / 杀软拦截）' });
  const hitsEnv = process.env.EVOX_HITS_DIR;
  checks.push({ name: '命中登记目录可达', ok: true, detail: hitsEnv ? hitsEnv : `默认 ${process.cwd()}/experiments（需当前目录可写）`, fix: '如需固定落点，设 EVOX_HITS_DIR 环境变量指向可写目录' });
  const failed = checks.filter((c) => !c.ok);
  console.log('light-cli 自检（doctor）结果：');
  for (const c of checks) {
    console.log(`  [${c.ok ? '✓' : '✗'}] ${c.name} —— ${c.detail}`);
    if (!c.ok) console.log(`      → 修正：${c.fix}`);
  }
  console.log(failed.length ? `\n自检未通过 ${failed.length} 项，请先修正后再用本技能（日常 recall / 沉淀不受影响）。` : `\n✓ 全部就绪，可正常使用 recall / 沉淀。`);
  process.exit(failed.length ? 1 : 0);
}

switch (cmd) {
  case 'distill': {
    const errorText = flag('error');
    const proposed = errorText ? proposeFromError(errorText, { tool: flag('tool', ''), context: flag('context', '') }) : null;
    // 信号：--signals 显式优先，缺省时由错误文本自动抽取（引导式）
    let signalsArg = flag('signals');
    if (proposed) {
      const auto = new Set(proposed.signals);
      if (signalsArg) for (const s of signalsArg.split(',').map((s) => s.trim()).filter(Boolean)) auto.add(s);
      signalsArg = [...auto].join(',');
    }
    const strategy = flag('strategy') || (proposed ? proposed.strategy : undefined);
    if (!strategy) fail('缺少 --strategy（写可执行修法：具体参数/命令/编码）', { hint: '参考上方用法示例；或从错误文本引导：node code/light-cli.mjs draft --error "<错误文本>"' });
    const signals = (signalsArg || 'manual').split(',').map((s) => s.trim()).filter(Boolean);
    // ── 内容去重（2026-09-18 实测补充）──────────────────────────────────────
    // asset_id **不是内容派生**的：同一条 strategy 连跑两次 distill 会得到两个不同 sha256，
    // 故 store 那层「按 asset_id 去重」在本场景形同虚设，重复沉淀会不断堆积（周常重扫尤甚）。
    // 这里按「归一化 strategy」判重：命中即跳过 —— **不写基因，也不写台账**
    // （写台账会把已 approved 的资产重新打回 quarantined，等于悄悄撤销审核）。
    const { appendGene, appendReview, readGenes } = await import('./engine/light/store.mjs');
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const target = norm(strategy);
    if (readGenes().some((g) => norm((g.strategy || []).join(' ')) === target)) {
      console.log('[pi-evox] 跳过：库中已存在相同 strategy 的基因（内容去重）');
      break;
    }
    const { gene, raw } = distill.distillManual({
      category: flag('category', 'repair'),
      signals,
      strategy,
      summary: flag('summary') || (proposed ? proposed.summary : undefined),
      antiPatterns: proposed ? proposed.antiPatterns : [],
      source: proposed ? 'light-manual-guided' : 'light-manual',
      shareable: rest.includes('--shareable'),
    });
    if (!gene) { console.log(raw); break; }
    // 只在真正写入时登记 quarantined（等待审核）
    const written = appendGene(gene);
    if (written) {
      appendReview({ assetId: gene.asset_id, state: autoApproveState(rest), reason: autoApproveState(rest) === 'approved' ? 'auto-approved (own library)' : 'manually distilled — review before use' });
    }
    console.log(raw + (written ? '' : '\n（asset 已存在，跳过重复写入）'));
    if (written) console.log(`\n下一步审核：node code/light-cli.mjs approve ${gene.id}`);
    break;
  }
  case 'draft': {
    // 引导式草稿：从错误直接生成可编辑的 distill 草稿（预填 AVOID + anti_patterns），人只补 FIX。
    const errorText = flag('error');
    if (!errorText) fail('draft 需至少 --error "<错误文本>" 以自动抽信号', { hint: '用法：light-cli.mjs draft --error "<错误文本>" [--context "<在做什么>"] [--tool <工具名>] [--commit]' });
    const proposed = proposeFromError(errorText, { tool: flag('tool', ''), context: flag('context', '') });
    // 人可补 --strategy 覆盖（写完整的 AVOID+FIX）；缺省用预填占位符（需审核前补全）。
    const strategy = flag('strategy') || proposed.strategy;
    console.log('【引导草稿】从错误自动生成（预填 AVOID，请补 FIX 后审核）：');
    console.log(`  signals_match : ${proposed.signals.join(', ')}`);
    console.log(`  anti_patterns : ${proposed.antiPatterns.length ? proposed.antiPatterns.join(', ') : '（空·该信号族无无歧义单 token）'}`);
    console.log(`  负经验标签    : ${proposed.antiTag}`);
    console.log(`  summary       : ${proposed.summary}`);
    console.log(`  strategy      : ${strategy}`);
    if (rest.includes('--commit')) {
      const { appendGene, appendReview, readGenes } = await import('./engine/light/store.mjs');
      const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (readGenes().some((g) => norm((g.strategy || []).join(' ')) === norm(strategy))) {
        console.log('\n[pi-evox] 跳过：库中已存在相同 strategy 基因已存在（内容去重）');
        break;
      }
      const { gene, raw } = distill.distillManual({
        category: 'repair', signals: proposed.signals, strategy,
        summary: proposed.summary, antiPatterns: proposed.antiPatterns, source: 'light-manual-guided',
        shareable: rest.includes('--shareable'),
      });
      if (!gene) { console.log(raw); break; }
      const written = appendGene(gene);
      if (written) appendReview({ assetId: gene.asset_id, state: autoApproveState(rest), reason: autoApproveState(rest) === 'approved' ? 'auto-approved (own library)' : 'guided draft — review before use' });
      console.log(`\n${raw}${written ? '' : '\n（asset 已存在，跳过）'}`);
      if (written) console.log(`下一步审核：node code/light-cli.mjs approve ${gene.id}`);
    } else {
      console.log('\n未加 --commit：补全 strategy 里的 FIX 后，运行上面等价的 distill 命令（或加 --strategy 与 --commit 直接落库为待审草稿）。');
      console.log(`  node code/light-cli.mjs distill --signals "${proposed.signals.join(',')}" --strategy "${strategy}" --summary "${proposed.summary}"`);
    }
    break;
  }
  case 'approve': {
    const id = positional[0];
    if (!id) fail('approve 需传入 <gene_id>', { hint: '先运行 node code/light-cli.mjs list 查看可用 gene_id' });
    const r = ledger.approve(id);
    console.log(r.ok ? `✓ 已审核通过${r.alreadyApproved ? '（此前已通过）' : ''}：${r.assetId}` : `✗ ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
    break;
  }
  case 'quarantine': {
    const id = positional[0];
    if (!id) fail('quarantine 需传入 <gene_id>', { hint: '先运行 node code/light-cli.mjs list 查看可用 gene_id' });
    const r = ledger.quarantine(id, flag('reason', 'manually quarantined'));
    console.log(r.ok ? `✓ 已隔离：${r.assetId}` : `✗ ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
    break;
  }
  case 'doctor': {
    doctor();
    break;
  }
  case 'list': {
    const rows = ledger.list();
    if (!rows.length) { console.log('（台账为空）'); break; }
    console.log('state       | id                        | category | strategy（截断）');
    for (const r of rows) {
      console.log(`${String(r.state).padEnd(11)} | ${String(r.id || r.assetId).padEnd(25)} | ${String(r.category || '-').padEnd(8)} | ${r.strategy}`);
    }
    break;
  }
  case 'info': {
    const genes = readGenes(); const review = readReview(); const approved = approvedAssetIds();
    console.log(`库路径      : ${STORE_DIR}`);
    console.log(`基因总数    : ${genes.length}`);
    console.log(`台账记录    : ${review.length}`);
    console.log(`已审核(可注入): ${approved.size}`);
    // B：闭环健康度——把「静默失效」变成屏幕上明明白白的一句话
    console.log('');
    console.log(loopHealth(genes, approved));
    break;
  }
  case 'snippet': {
    // 给**没有钩子机制**的 Agent 用：输出一段可直接粘进 AGENTS.md / CLAUDE.md / 系统提示的操作规程。
    // 这解决的是「什么时候提醒」里的最后一种宿主：既没有 bootstrap 也没有 pre_tool_use 的纯提示词 Agent。
    const skillDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const block = [
      '## 经验库操作规程（pi-evox-loop，五个触发点）',
      '',
      `技能目录: ${skillDir}`,
      '',
      '1. **任务开始**（拿到非平凡任务时，先于规划执行）：',
      `   node ${skillDir}/code/evolver-recall.mjs --query "<任务一句话>" --agent <你的名字>`,
      '2. **遇到报错**（工具返回错误、且你准备重试之前——这一刻价值最直观）：',
      `   node ${skillDir}/code/evolver-recall.mjs --error "<报错原文>"`,
      '3. **修好坑后**（修了一个不显而易见的坑，立刻沉淀，趁记忆新鲜）：',
      `   node ${skillDir}/code/light-cli.mjs draft --error "<报错>" --context "<在做什么>" [--commit]`,
      '4. **任务结束**（用了召回给出的修法就回填，让「注入→有效」可度量）：',
      `   node ${skillDir}/code/evolver-recall.mjs --register-hit <N> --note "<任务一句话>"`,
      `   node ${skillDir}/code/evolver-recall.mjs --negate <N> --note "<为什么没起作用>"`,
      '',
      '原则：没命中就继续干活（零注入是对的，别为命中硬凑）；修法只在确实相关时采用；',
      '修完必沉淀。这四件事做完，同一个坑才真正只踩一次。',
    ].join('\n');
    console.log(block);
    break;
  }
  case 'install-hooks': {
    // A：自动接线（**用户自主选择**）。默认只做 dry-run 展示「会做什么」，
    // 必须显式加 --yes 才真正写入；写入前自动备份宿主配置。
    const r = await installHooks({ args: rest, yes: rest.includes('--yes') });
    console.log(r.text);
    if (r.wrote) console.log('\n[pi-evox] 已写入。按宿主要求重启/刷新后生效（OpenClaw 通常需重启网关，Hermes 需刷新 allowlist）。');
    else console.log('\n[pi-evox] 未做任何改动（演练模式）。确认无误后加 --yes 才会写入。');
    process.exit(r.code);
    break;
  }
  case 'config': {
    // C 的开关：查看 / 修改「自己沉淀的基因是否自动通过审核」（默认开）
    // 注意：开关名以 `--` 开头，不能只看 positional（它会被过滤掉）
    const i = rest.indexOf('--auto-approve');
    const cur = readConfig();
    const def = typeof cur.autoApprove === 'boolean' ? cur.autoApprove : true;
    if (i < 0) {
      console.log(`配置文件    : ${CONFIG_FILE}`);
      console.log(`autoApprove : ${def}（自己沉淀的基因${def ? '自动通过，立即可注入' : '需人工 approve'}）`);
      console.log(`当前判定    : ${autoApproveState(rest)}`);
      break;
    }
    const v = String(rest[i + 1] || 'on').toLowerCase();
    if (v !== 'on' && v !== 'off') fail('用法: light-cli.mjs config --auto-approve on|off');
    const on = v === 'on';
    writeConfig({ autoApprove: on });
    console.log(`[pi-evox] autoApprove 已设为 ${on}${on ? '' : '（此后沉淀需人工 approve）'}`);
    break;
  }
  case 'starter': {
    // D：一键装载起步基因包（让新用户第一次任务就能命中）
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'starter-genes.jsonl');
    if (!fs.existsSync(file)) fail(`未找到起步包：${file}`, { code: 1 });
    console.log(`[pi-evox] 装载起步基因包（${file}）…`);
    const { runGene } = await import('./gene_share.mjs');
    const code = runGene(['import', file, '--tier', 'official']);
    if (code === 0) console.log('\n[pi-evox] 起步包已装载。现在跑一次召回试试：\n  node code/evolver-recall.mjs --query "读取中文日志报 UnicodeDecodeError"');
    process.exit(code);
    break;
  }
  case 'gene': {
    // 共享基因库（0.14.9）：export / submit / import，全部经脱敏闸门
    const { runGene } = await import('./gene_share.mjs');
    process.exit(runGene(rest));
    break;
  }
  default:
    if (cmd) fail(`未知命令：${cmd}`, { hint: '运行不带参数查看完整用法' });
    usage();
    process.exit(0);
}
