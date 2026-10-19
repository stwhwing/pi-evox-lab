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
const SKILL_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'package.json'), 'utf8')).version; } catch { return 'unknown'; } })();
import { signGene, verifyGene, loadIdentity, privateKeyPath } from './engine/light/identity.mjs';
import { SIGNAL_RULES, AVOID_TEMPLATES, proposeFromError } from './engine/light/distill.mjs';
import { depositionGate } from './engine/light/guards.mjs';

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
// ── 词汇对齐（anti_tags → summary / anti_patterns → 互斥 token，见 docs/advanced.md）──
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
 * 操作规程文本（T1–T5）——`snippet` 输出 / `install-snippet` 写入共用的唯一来源。
 * T4 是自动沉淀的关键绑定：**修好坑后立刻沉淀**（写进项目指令文件后，agent 每个会话可见）。
 */
/** 0.22：审核取证报告（evidence 命令 + approve 前自动执行共用）。
 *  在本地四台账（工具错误/召回/注入/回填）检索基因声称失败/修法的对应事件，
 *  三级输出：强证据（直接 gene_id/工具错误）> 弱上下文（召回）> 无证据（台账外来源）。 */
const WARNED = new Set();
function printEvidence(g) {
  const hitsDir = process.env.EVOX_HITS_DIR || path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'experiments');
  const STOP = new Set(['unknown', '失败', 'error', 'null', 'true', 'false', 'undefined', 'pending', 'approved', 'quarantined']);
  const sigFromSummary = String(g.summary || '').split(/[\s，。、（）()\[\]:：|]+/).filter((w) => w.length >= 4 && !STOP.has(w)).slice(0, 8);
  const signals = [...new Set([...(g.signals_match || []).filter((x) => !STOP.has(String(x))), ...sigFromSummary])].slice(0, 12);
  console.log(`[gene-share] 审核取证：${g.id}`);
  console.log(`  账本来源: ${hitsDir}${hitsDir.includes('publish_clean') || hitsDir.includes('_rel') ? '  ←⚠️ 这是构建/发布目录，不是生产账本！生产环境应指向已安装技能的 experiments/（可用 EVOX_HITS_DIR 指定）' : ''}`);
  console.log(`  信号词: ${signals.join(', ') || '(无)'}`);
  let found = 0;
  const files = [['工具错误', 'error_candidates.jsonl'], ['召回', 'recall_calls.jsonl'], ['注入', 'pending_injections.jsonl'], ['回填', 'hits.jsonl']];
  for (const [kind, f] of files) {
    try {
      if (!fs.existsSync(path.join(hitsDir, f)) && !WARNED.has(f)) { WARNED.add(f); console.log(`  （账本 ${f} 不存在——按空处理）`); }
      for (const l of fs.readFileSync(path.join(hitsDir, f), 'utf8').split('\n')) {
        const t = l.trim(); if (!t) continue;
        let r; try { r = JSON.parse(t); } catch { continue; }
        const text = JSON.stringify(r);
        const direct = (f === 'pending_injections.jsonl' || f === 'hits.jsonl') && text.includes(g.id);
        if (direct || signals.some((sg) => text.includes(sg))) {
          found++;
          const ts = r.ts || r.at || '?';
          const detail = String(r.snippet || r.query || r.note || r.gene_id || '').slice(0, 90);
          const tag = direct || kind === '工具错误' ? '' : '（上下文，弱证据）';
          console.log(`  [${kind}] ${ts} | ${detail}${tag}`);
        }
      }
    } catch { /* 缺文件跳过 */ }
  }
  if (!found) {
    const anyLedger = files.some(([, f]) => { try { return fs.statSync(path.join(hitsDir, f)).size > 0; } catch { return false; } });
    if (!anyLedger) console.log(`  （该目录四账本全空——**取证依据不足**：请确认 EVOX_HITS_DIR 指向生产账本（已安装技能的 experiments/）后重跑 evidence，再决定 approve）`);
    else console.log('  （无本地台账证据——可能来自共享池/其他机器/起步包：按内容与来源审核，approve 时注明来源）');
  }
  else console.log(`  → 共 ${found} 条相关事件。核对基因声称的失败/修法与上述事件一致后再批准；结论被后续事件推翻的应保持隔离并留痕。`);
}

/** 0.23 U2：install-snippet 写入管线（install / install-snippet 两命令共用） */
function runInstallSnippet(args) {
  const fi = args.indexOf('--file');
  const target = fi >= 0 ? args[fi + 1] : null;
  if (!target) fail('用法: light-cli.mjs install-snippet --file <AGENTS.md 或 CLAUDE.md 路径> [--yes]');
  const yes = args.includes('--yes');
  const out = ['── install-snippet ' + (yes ? '（写入模式）' : '（演练模式，未落盘）') + ' ──'];
  const abs = path.resolve(target);
  out.push(`  目标文件: ${abs}`);
  const exists = fs.existsSync(abs);
  out.push(`  文件存在: ${exists ? '是' : '否（--yes 时会创建）'}`);
  const cur = exists ? fs.readFileSync(abs, 'utf8') : '';
  const has = cur.includes('evox-procedure:v1');
  out.push(`  已含规程: ${has ? '是（将原位更新）' : '否（将追加到文件末尾）'}`);
  if (yes) {
    try {
      const block = procedureText();
      let next;
      if (has) {
        next = cur.replace(/<!-- evox-procedure:v1 -->[\s\S]*?<!-- \/evox-procedure -->/, '<!-- evox-procedure:v1 -->\n' + block + '\n<!-- /evox-procedure -->');
      } else {
        next = cur + (cur.endsWith('\n') || !cur ? '' : '\n') + '\n<!-- evox-procedure:v1 -->\n' + block + '\n<!-- /evox-procedure -->\n';
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, next, 'utf8');
      out.push('  ✓ 已写入。该项目的 agent 每个会话都会看到此规程（T1–T5）。');
    } catch (e) { out.push('  ✗ 写入失败: ' + String(e.message || e)); }
  } else {
    out.push('  （演练未落盘；确认无误加 --yes）');
  }
  console.log(out.join('\n'));
}

function procedureText() {
  const skillDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  return [
    '## 经验库操作规程（pi-evox-loop，五个触发点）',
    '',
    `技能目录: ${skillDir}`,
    '',
    '1. **任务开始**（拿到非平凡任务时，先于规划执行）：',
    `   node ${skillDir}/code/evolver-recall.mjs --query "<任务一句话>" --agent <你的名字>`,
    '2. **遇到报错**（工具返回错误、且你准备重试之前——这一刻价值最直观）：',
    `   node ${skillDir}/code/evolver-recall.mjs --error "<报错原文>"`,
    '3. **修好坑后立刻沉淀**（修了一个不显而易见的坑，趁记忆新鲜，这是 T4 自动沉淀的绑定点）：',
    `   node ${skillDir}/code/light-cli.mjs draft --error "<报错>" --context "<在做什么>" --commit`,
    '4. **任务结束回填**（用了召回给出的修法就登记，让「注入→有效」可度量）：',
    `   node ${skillDir}/code/evolver-recall.mjs --register-hit --gene <asset_id或gene_id> --note "<任务一句话>"`,
    `   node ${skillDir}/code/evolver-recall.mjs --negate --gene <asset_id或gene_id> --note "<为什么没起作用>"`,
    '',
    '原则：没命中就继续干活（零注入是对的，别为命中硬凑）；修法只在确实相关时采用；',
    '修完坑**必须立刻执行第 3 步**——这四件事做完，同一个坑才真正只踩一次。',
  ].join('\n');
}

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
  const explicit = Array.isArray(args) ? args : [];
  if (explicit.includes('--no-auto-approve') || explicit.includes('--manual-review')) return 'quarantined';
  // 0.17.0：**非交互沉淀（脚本/cron/宿主自动管道，无 TTY）默认隔离**——实测 autoApprove
  // 会把 retry-log 噪音直接放进可注入池（隔离库复现：守卫全放行）。自动管道想自动通过
  // 必须显式传 --auto-approve（有意识的决定）。交互式人工沉淀不受影响，保持 0.16.0 便利。
  if (!process.stdout.isTTY && !explicit.includes('--auto-approve')) return 'quarantined';
  if (explicit.includes('--auto-approve')) return 'approved';
  const config = readConfig();
  const def = typeof config.autoApprove === 'boolean' ? config.autoApprove : true; // 默认开
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
  // 0.17.0：默认落点改为**技能根/experiments**（脱离 cwd——此前在别的目录跑 info 会误报「从未召回」）
  const hitsDir = process.env.EVOX_HITS_DIR || path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'experiments');
  const countLines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).length; } catch { return 0; } };
  const recallCalls = countLines(path.join(hitsDir, 'recall_calls.jsonl'));
  const hits = countLines(path.join(hitsDir, 'hits.jsonl'));
  // 0.17.0 三分类（修复：此前把「已审查隔离」也误报成待审并引导 approve——对噪音基因是错误引导）
  const lww = {};
  const reviewPath = path.join(STORE_DIR, 'review.jsonl');
  try {
    for (const l of fs.readFileSync(reviewPath, 'utf8').split('\n')) {
      const t = l.trim(); if (!t) continue;
      try { const r = JSON.parse(t); lww[r.assetId] = r.state; } catch { /* 坏行跳过 */ }
    }
  } catch { /* 无台账 */ }
  const isAppr = (g) => g && g.asset_id && approved.has(g.asset_id);
  const isQuar = (g) => g && g.asset_id && String(lww[g.asset_id] || '').toLowerCase().includes('quarantin');
  const undecided = genes.filter((g) => !isAppr(g) && !isQuar(g));
  const quarantined = genes.filter(isQuar);

  const lines = ['── 闭环健康度 ──'];
  lines.push(`  召回次数    : ${recallCalls}${recallCalls === 0 ? '  ← 从未召回，经验不会生效' : ''}`);
  lines.push(`  命中登记    : ${hits}`);
  lines.push(`  待审(未决定): ${undecided.length}${undecided.length ? '  ← 这些不会注入！' : ''}`);
  lines.push(`  已隔离      : ${quarantined.length}${quarantined.length ? '（噪音/探针，属正常状态，无需处理）' : ''}`);
  const alive = recallCalls > 0 && undecided.length === 0;
  lines.push(`  状态        : ${alive ? '闭环运行中' : '未闭合（按下面做一步即可）'}`);
  lines.push('');

  if (recallCalls === 0) {
    lines.push('  ⚠ 还没跑过召回：经验库的价值取决于**召回是否发生**，沉淀不等于生效。');
    lines.push('    → 立刻试一次：node code/evolver-recall.mjs --query "读取中文日志报 UnicodeDecodeError"');
    lines.push('    → 想让 agent 自动召回：node code/light-cli.mjs install-hooks（先看它会做什么，加 --yes 才写入）');
  }
  if (undecided.length > 0) {
    const sample = undecided.slice(0, 3).map((g) => g.id);
    lines.push(`  ⚠ 有 ${undecided.length} 条基因待审（未做任何决定），不会注入。`);
    lines.push(`    → 逐条看内容后：有可执行修法 → approve ${sample[0]}；是日志复述/测试残留 → quarantine ${sample[0]} --reason "..."`);
    if (sample.length > 1) lines.push(`    （其余：${sample.slice(1).join(', ')}${undecided.length > 3 ? ' …' : ''}）`);
  }
  if (quarantined.length > 0) {
    lines.push(`  ℹ 已隔离 ${quarantined.length} 条（噪音/测试残留）——这是**正确状态**，不需要处理；误隔离的可 approve 恢复。`);
  }
  return lines.join('\n');
}

const argOf = (a, name) => { const i = a.indexOf(name); return i >= 0 ? a[i + 1] : undefined; };

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
  node code/light-cli.mjs timeline [--last 50]                     # 四账本时间线（召回/注入/回填/工具错误）——0.18，方法致谢 numbat
  node code/light-cli.mjs harvest [--last 10]                      # error_candidates → 沉淀建议清单（Layer2 消费端）
  node code/light-cli.mjs harvest --done|--dismiss <N>             # 已处理/驳回某条候选（移入 .done.jsonl 留痕）——0.19
  node code/light-cli.mjs install <host> [--yes]                  # 一键宿主接入（claude-code/cursor/codex/agents-md）——0.23
  node code/light-cli.mjs demo                                     # 90 秒自演示（只读，不改状态）——0.23
  node code/light-cli.mjs export-evidence [--out <dir>]            # 本地证据自审查包（门禁/签名/台账）——0.23
  node code/light-cli.mjs stats                                    # 本地使用统计（召回/命中/回填率）——0.23
  node code/light-cli.mjs feedback "<文本>"                        # 反馈入口（本地留痕 + Discussions 引导）——0.22
  node code/light-cli.mjs gene pull --pool <路径|URL> [--tier t] [--scene s]  # 拉取基因池（可按场景过滤）——0.24
  node code/light-cli.mjs gene submit --bundle <file>              # 产出单文件提交包（发给维护者/提 PR）——0.23
  node code/light-cli.mjs snippet                                  # 输出可粘进 AGENTS.md 的操作规程（无钩子宿主用）
  node code/light-cli.mjs install-snippet --file <AGENTS.md> [--yes]  # 把规程写进项目指令文件（默认演练）——自动沉淀的绑定点

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
  checks.push({ name: '命中登记目录可达', ok: true, detail: hitsEnv ? hitsEnv : `默认 ${path.dirname(path.dirname(fileURLToPath(import.meta.url)))}/experiments（技能根，脱离 cwd）`, fix: '如需固定落点，设 EVOX_HITS_DIR 环境变量指向可写目录' });
  // 0.18：埋点散落检测——其他目录的 experiments/ 里有 evox 埋点时提示迁移（GameRemake 会话实测散落）
  try {
    const cwdExp = path.join(process.cwd(), 'experiments');
    const skillExp = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'experiments');
    if (path.resolve(cwdExp) !== path.resolve(skillExp) && fs.existsSync(cwdExp)) {
      const strays = ['recall_calls.jsonl', 'pending_injections.jsonl', 'hits.jsonl', 'error_candidates.jsonl'].filter((f) => fs.existsSync(path.join(cwdExp, f)));
      if (strays.length) {
        checks.push({ name: '埋点散落', ok: false, detail: `发现 ${cwdExp} 含 ${strays.length} 个埋点文件（时间线/统计读的是技能根目录，散落部分不可见）`, fix: `迁移: mv ${cwdExp}/{${strays.join(',')}} ${skillExp}/ 或统一设 EVOX_HITS_DIR` });
      }
    }
  } catch { /* 探测失败不影响 doctor */ }
  const failed = checks.filter((c) => !c.ok);
  console.log('light-cli 自检（doctor）结果：');
  for (const c of checks) {
    console.log(`  [${c.ok ? '✓' : '✗'}] ${c.name} —— ${c.detail}`);
    if (!c.ok) console.log(`      → 修正：${c.fix}`);
  }
  console.log(`  IO 重试: 瞬态错误 ${parseInt(process.env.EVOX_IO_RETRY || '3', 10) || 3} 次 / 截止 ${parseInt(process.env.EVOX_IO_DEADLINE_MS || '3000', 10) || 3000}ms（EVOX_IO_RETRY / EVOX_IO_DEADLINE_MS 可调）`);
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
    const dgate = depositionGate((gene.strategy || []).join('\n'));
    if (!dgate.ok) fail('沉淀质检未通过：' + dgate.reason, { code: 1, hint: 'gate=' + dgate.kind + '；沉淀要写 AVOID(什么坑)+FIX(怎么避开)，不是日志复述' });
    signGene(gene); // 0.21 provenance：落库即签（Ed25519，本机身份）
    const written = appendGene(gene);
    if (written) {
      const st = autoApproveState(rest);
      appendReview({ assetId: gene.asset_id, state: st, reason: st === 'approved' ? (process.stdout.isTTY ? 'auto-approved (own library)' : 'auto-approved (explicit --auto-approve)') : (process.stdout.isTTY ? 'manually distilled — review before use' : 'non-interactive deposit — review before use') });
    }
    console.log(raw + (written ? '' : '\n（asset 已存在，跳过重复写入）'));
    if (written) {
      const st = autoApproveState(rest);
      console.log(st === 'approved'
        ? `\n✓ 已入库并自动通过（立即可注入）：${gene.id}${process.stdout.isTTY ? '' : '（显式 --auto-approve）'}`
        : `\n已入库【待审/隔离，不会注入】：${gene.id}\n   审核：node code/light-cli.mjs approve ${gene.id}`);
    }
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
      // 0.17.0 沉淀质检：占位符未填 / retry 日志复述 / 旁白开场 → **拒绝入库**（fail-closed），
      // 把召回侧的守卫前移到生产侧——autoApprove 的安全性由此成立。
      const gate = depositionGate((gene.strategy || []).join('\n'));
      if (!gate.ok) fail('沉淀质检未通过：' + gate.reason, { code: 1, hint: 'gate=' + gate.kind + '；修正后重新 distill/draft --commit' });
      signGene(gene); // 0.21 provenance：落库即签（Ed25519，本机身份）
      const written = appendGene(gene);
      if (written) appendReview({ assetId: gene.asset_id, state: autoApproveState(rest), reason: autoApproveState(rest) === 'approved' ? 'auto-approved (own library)' : 'guided draft — review before use' });
      console.log(`\n${raw}${written ? '' : '\n（asset 已存在，跳过）'}`);
      if (written) {
        const st2 = autoApproveState(rest);
        console.log(st2 === 'approved'
          ? `✓ 已入库并自动通过（立即可注入）：${gene.id}${process.stdout.isTTY ? '' : '（显式 --auto-approve）'}`
          : `已入库【待审/隔离，不会注入】：${gene.id}\n   审核：node code/light-cli.mjs approve ${gene.id}`);
      }
    } else {
      console.log('\n未加 --commit：补全 strategy 里的 FIX 后，运行上面等价的 distill 命令（或加 --strategy 与 --commit 直接落库为待审草稿）。');
      console.log(`  node code/light-cli.mjs distill --signals "${proposed.signals.join(',')}" --strategy "${strategy}" --summary "${proposed.summary}"`);
    }
    break;
  }
  case 'approve': {
    const id = positional[0];
    if (!id) fail('approve 需传入 <gene_id>', { hint: '先运行 node code/light-cli.mjs list 查看可用 gene_id' });
    // 0.22 触发点绑死：approve 前自动跑 evidence（0.20.3 建了取证机制却没人用——
    // 用户 2026-10-17 问「有没有 timeline 回溯」才发现审 6 条基因全部没跑）。
    // 机制必须绑在动作节点上，而不是依赖"记得"（本项目的核心设计哲学）。
    // --skip-evidence 显式跳过（理由写入台账备注），用于已知无证据的共享池/起步包来源。
    const skipEvidence = rest.includes('--skip-evidence');
    const gForEv = readGenes().find((x) => x.id === id || x.asset_id === id);
    if (gForEv && !skipEvidence) {
      console.log('[gene-share] 审核取证（approve 前自动执行，0.22）：');
      printEvidence(gForEv);
      console.log('');
    }
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
  case 'timeline': {
    // 0.18：四账本按时间合并 → 单任务时间线 Markdown。
    // 方法论致谢：灵感来自 Perplexity 开源的 numbat（endpoint 行为审计器的 timeline 取证重建，
    // github.com/perplexityai/numbat，Apache-2.0）——「把账本变成监控录像」；实现为本机账本自有格式。
    const hitsDir = process.env.EVOX_HITS_DIR || path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'experiments');
    const lastN = parseInt(argOf(rest, '--last') || '50', 10) || 50;
    const files = [
      ['召回', path.join(hitsDir, 'recall_calls.jsonl')],
      ['注入', path.join(hitsDir, 'pending_injections.jsonl')],
      ['回填', path.join(hitsDir, 'hits.jsonl')],
      ['工具错误', path.join(hitsDir, 'error_candidates.jsonl')],
    ];
    const events = [];
    for (const [kind, f] of files) {
      try {
        for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
          const t = l.trim(); if (!t) continue;
          let r; try { r = JSON.parse(t); } catch { continue; }
          const ts = r.ts || r.at || '';
          if (!ts) continue;
          const gid = r.gene_id || (r.assetId ? (readGenes().find((x) => x.asset_id === r.assetId) || {}).id || r.assetId : '') || '';
          const detail = r.note || r.query || r.snippet || r.error || r.reason || '';
          events.push({ ts, kind, gid: String(gid).slice(0, 28), detail: String(detail).slice(0, 90) });
        }
      } catch { /* 缺文件跳过 */ }
    }
    events.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    const shown = events.slice(-lastN);
    console.log(`## 经验库时间线（最近 ${shown.length}/${events.length} 条，来源: ${hitsDir}）`);
    console.log('');
    console.log('| 时间 | 类型 | 基因 | 详情 |');
    console.log('|---|---|---|---|');
    for (const e of shown) console.log(`| ${e.ts} | ${e.kind} | ${e.gid || '-'} | ${e.detail || '-'} |`);
    if (!shown.length) console.log('（无事件——先跑一次 recall 产生埋点）');
    break;
  }
  case 'shareable': {
    // 0.22：设置 shareable 并【重新签名】——0.21 签名链要求基因 deposit 后不可变，
    // 但工作流天然会在 approve 后补标 shareable（变更即签名失效，自家闸门会拦）。
    // 因此：持钥人的授权变更（shareable 标记）必须走本命令重签，而不是直接改文件。
    const id = positional[0];
    if (!id) fail('shareable 需传入 <gene_id>', { hint: 'node code/light-cli.mjs shareable <gene_id>' });
    const { withLock } = await import('./engine/light/store.mjs');
    const genes = readGenes();
    const g = genes.find((x) => x.id === id || x.asset_id === id);
    if (!g) fail(`找不到基因: ${id}`, { code: 1 });
    withLock(STORE_DIR, () => {
      g.shareable = true;
      signGene(g); // 变更后重签（签名域含 shareable）
      const lines = genes.map((x) => JSON.stringify(x)).join('\n') + '\n';
      fs.writeFileSync(path.join(STORE_DIR, 'genes.jsonl'), lines);
    });
    // 回读验证
    const back = readGenes().find((x) => x.id === id);
    const v = verifyGene(back);
    console.log(`[gene-share] ${id}: shareable=true 已重签 — ${v.status}（${v.why}）`);
    if (v.status !== 'verified') process.exitCode = 1;
    break;
  }
  case 'feedback': {
    // 0.22 外部实例版：外部用户反馈入口（本地留痕 + 引导到 GitHub Discussions）。
    // 隐私纪律：只写用户主动输入的文本；无任何自动遥测；默认不出网。
    const text = rest.join(' ').trim();
    if (!text) fail('feedback 需传入反馈文本', { hint: 'node code/light-cli.mjs feedback "<你的反馈>"' });
    const hitsDir = process.env.EVOX_HITS_DIR || path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'experiments');
    const { withLock } = await import('./engine/light/store.mjs');
    withLock(hitsDir, () => {
      fs.mkdirSync(hitsDir, { recursive: true });
      fs.appendFileSync(path.join(hitsDir, 'feedback.jsonl'), JSON.stringify({
        ts: new Date().toISOString(), version: SKILL_VERSION, agent: 'light-cli',
        text: String(text).slice(0, 1000),
      }) + '\n');
    });
    console.log('[gene-share] 感谢反馈！已本地留痕（experiments/feedback.jsonl）。');
    console.log('  想让作者和其他用户看到？欢迎提交到 GitHub Discussions（Q&A / Show and tell）：');
    console.log('  https://github.com/stwhwing/pi-evox-lab/discussions');
    console.log('  或用起来后报告你的实例（帮我们达成 1.0 的外部实例判据）：');
    console.log('  https://github.com/stwhwing/pi-evox-lab/issues/new?template=adoption-report.yml');
    break;
  }
  case 'identity': {
    // 0.21：本机签名身份（Ed25519 keypair，~/.evomap/identity/，私钥 0600 不出本机）
    const id = loadIdentity();
    console.log(`[gene-share] 本机身份 keyid=${id.keyId}`);
    console.log(`  私钥: ${privateKeyPath()}（0600，绝不出本机）`);
    console.log(`  公钥: 随基因 {pubkey} 字段出入池，供他机验签`);
    break;
  }
  case 'verify': {
    // 0.21：验签（本地库基因；入池导入时的验签在 gene import 内自动执行）
    const id = positional[0];
    if (!id) fail('verify 需传入 <gene_id>', { hint: 'node code/light-cli.mjs verify <gene_id>' });
    const g = readGenes().find((x) => x.id === id || x.asset_id === id);
    if (!g) fail(`找不到基因: ${id}`, { code: 1 });
    const v = verifyGene(g);
    console.log(`[gene-share] ${g.id}: ${v.status} — ${v.why}`);
    if (!v.ok) process.exitCode = 1;
    break;
  }
  case 'evidence': {
    const id = positional[0];
    if (!id) fail('evidence 需传入 <gene_id>', { hint: 'node code/light-cli.mjs evidence <gene_id>' });
    const g = readGenes().find((x) => x.id === id || x.asset_id === id);
    if (!g) fail(`找不到基因: ${id}`, { code: 1, hint: '先 list 查看可用 gene_id' });
    printEvidence(g);
    break;
  }
  case 'harvest': {
    // 0.18：error_candidates → 沉淀建议清单（半自动沉淀的消费端；Layer 2 hook 负责捕获，本命令负责盘点）。
    // 0.19：--done/--dismiss <N> 把第 N 条移入 error_candidates.done.jsonl（保留审计痕迹），
    //   未处理列表只减不增——否则候选只累积不消费（41 条实证），nudge 也永远提醒。
    const hitsDir = process.env.EVOX_HITS_DIR || path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'experiments');
    const f = path.join(hitsDir, 'error_candidates.jsonl');
    const doneF = path.join(hitsDir, 'error_candidates.done.jsonl');
    let rows = [];
    try {
      rows = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { /* 无候选 */ }
    rows = rows.filter((r) => r.kind !== 'beat');
    const doneIdx = rest.indexOf('--done') >= 0 ? rest.indexOf('--done') : rest.indexOf('--dismiss');
    if (doneIdx >= 0) {
      const isDismiss = rest[doneIdx] === '--dismiss';
      const num = parseInt(rest[doneIdx + 1], 10);
      const shown = rows.slice(-(parseInt(argOf(rest, '--last') || '10', 10) || 10));
      const target = shown[num - 1];
      if (!target) fail(`harvest ${isDismiss ? '--dismiss' : '--done'} 编号 #${num} 不存在（当前未处理 ${rows.length} 条，--last 窗口 ${shown.length} 条）`, { code: 1 });
      const { withLock } = await import('./engine/light/store.mjs');
      withLock(hitsDir, () => {
        fs.mkdirSync(hitsDir, { recursive: true });
        fs.appendFileSync(doneF, JSON.stringify({ ...target, done_at: new Date().toISOString(), done_action: isDismiss ? 'dismissed' : 'harvested' }) + '\n');
        fs.writeFileSync(f, rows.filter((r) => r !== target).map((r) => JSON.stringify(r)).join('\n') + (rows.length > 1 ? '\n' : ''));
      });
      console.log(`[gene-share] #${num} 已${isDismiss ? '驳回（不留基因）' : '标记已收获'} → ${doneF}；未处理剩 ${rows.length - 1} 条`);
      break;
    }
    console.log(`[gene-share] 沉淀候选 ${rows.length} 条（来源 ${f}）`);
    if (!rows.length) { console.log('  无候选——Layer 2 hook 捕获的工具错误会出现在这里。'); break; }
    const shown = rows.slice(-(parseInt(argOf(rest, '--last') || '10', 10) || 10));
    shown.forEach((r, i) => {
      const fam = proposeFromError(r.snippet || '', {});
      console.log(`${i + 1}. [${r.ts || '?'}] ${r.tool || '?'} | 家族: ${fam.family} | ${String(r.snippet || '').slice(0, 80)}`);
      console.log(`   → node code/light-cli.mjs draft --error ${JSON.stringify(String(r.snippet || '').slice(0, 120))} --tool ${JSON.stringify(r.tool || '')} --context "来自 error_candidates" --commit`);
    });
    console.log('  原则：候选只是线索；FIX 必须由你补全成可执行修法（占位符会被 depositionGate 拒绝）。');
    console.log(`  处理完毕：harvest --done <N>（已沉淀）或 harvest --dismiss <N>（无价值驳回，留痕）`);
    break;
  }
  case 'doctor': {
    doctor();
    break;
  }
  case 'list': {
    // 0.24 场景过滤：list --scene <名> 只看该场景（category 受控词表）
    const sceneFilter = argOf(rest, '--scene') || null;
    const rows = ledger.list().filter((r) => !sceneFilter || r.category === sceneFilter);
    if (sceneFilter && !rows.length) { console.log(`（场景 ${sceneFilter} 下无基因；可用场景见 docs/overview.md 或池镜像）`); break; }
    if (!rows.length) { console.log('（台账为空）'); break; }
    console.log('state       | id                        | category | strategy（截断）' + (sceneFilter ? `  [场景: ${sceneFilter}]` : ''));
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
    console.log(procedureText());
    break;
  }
  case 'export-evidence': {
    // 0.23：本地证据自审查包——把门禁/签名/时间线/审核台账导出为可审查集合（任何团队审计自己的库用）。
    const dest = argOf(rest, '--out') || path.join(os.homedir(), '.evomap', `evidence-export-${Date.now()}`);
    fs.mkdirSync(dest, { recursive: true });
    const hitsDir = process.env.EVOX_HITS_DIR || path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'experiments');
    let copied = 0;
    for (const f of ['error_candidates.jsonl', 'recall_calls.jsonl', 'pending_injections.jsonl', 'hits.jsonl', 'review.jsonl', 'genes.jsonl']) {
      try { fs.copyFileSync(path.join(hitsDir, f), path.join(dest, f)); copied++; } catch {}
      try { fs.copyFileSync(path.join(STORE_DIR, f), path.join(dest, f)); copied++; } catch {}
    }
    // 签名验证摘要
    const genes = readGenes();
    const signed = genes.filter((g) => g.sig);
    const bad = signed.filter((g) => verifyGene(g).status !== 'verified');
    fs.writeFileSync(path.join(dest, 'signature-summary.json'), JSON.stringify({
      exported_at: new Date().toISOString(), genes_total: genes.length,
      signed: signed.length, signature_failures: bad.length, failure_ids: bad.map((g) => g.id),
    }, null, 2));
    console.log(`[gene-share] 证据包已导出 → ${dest}（文件 ${copied} | 基因 ${genes.length} | 签名失败 ${bad.length}）`);
    break;
  }
  case 'stats': {
    // 0.23：本地使用统计——recall/命中/回填率（从本地台账读，无外发）
    const hitsDir = process.env.EVOX_HITS_DIR || path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'experiments');
    const count = (f) => { try { return fs.readFileSync(path.join(hitsDir, f), 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
    const rc = count('recall_calls.jsonl'), pi = count('pending_injections.jsonl'), hf = count('hits.jsonl');
    const genes = readGenes();
    const lww = {}; for (const r of readReview()) lww[r.assetId] = r.state;
    const approved = genes.filter((g) => String(lww[g.asset_id] || '').toLowerCase().includes('approv')).length;
    console.log(`[gene-share] 本地使用统计（${hitsDir}）：`);
    console.log(`  召回调用 ${rc} | 注入待回填 ${pi} | 回填 ${hf} | 回填率 ${pi ? Math.round((hf / pi) * 100) : '—'}%`);
    console.log(`  库: ${genes.length} 条（已审核 ${approved}）`);
    console.log('  注：回填=调用方确认注入有效；不回填的注入不计入效果统计。');
    break;
  }
  case 'demo': {
    // 0.23 U2：90 秒自演示——新用户零文档成本看到「经验继承」的完整瞬间。
    // 只读设计（不加 --yes 不改任何用户状态；库空时提示先跑 starter）。
    const { spawnSync: ss } = await import('node:child_process');
    const self = process.argv[1];
    console.log('── Pi EvoX demo：90 秒看懂经验继承 ──');
    console.log('[1/3] 环境自检');
    let r = ss(process.argv[0], [self, 'doctor'], { encoding: 'utf8' });
    if (r.status !== 0) { console.log(r.stdout || 'doctor 未通过——先解决环境问题'); process.exit(r.status || 1); }
    console.log('[2/3] 模拟一个编码报错（对靶召回）');
    r = ss(process.argv[0], [path.join(path.dirname(self), 'evolver-recall.mjs'), '--error', "UnicodeDecodeError: 'utf-8' codec can't decode byte 0xc4"], { encoding: 'utf8' });
    const recallOut = (r.stdout || '');
    console.log(recallOut.trim().split('\n').slice(0, 6).join('\n'));
    const hit = /\[#\d+\|/.test(recallOut);
    console.log(hit
      ? '  ↑ 上面的编号修法就是本机经验库对靶命中的结果——**下次同类报错，agent 会直接看到它**。'
      : '  ↑ 本次无命中（库空或未对靶）——先跑 `starter` 装起步包，或沉淀一条自己的修法（`draft --error`）。');
    console.log('[3/3] 下一步');
    console.log('  - 看全库：light-cli.mjs info / timeline');
    console.log('  - 接入宿主：light-cli.mjs install <claude-code|cursor|codex|agents-md>');
    console.log('  - 沉淀你的第一条：light-cli.mjs draft --error "<真实报错>"');
    break;
  }
  case 'install': {
    // 0.23 U2：一键宿主接入——自动定位各宿主的指令文件并写入五触发点规程。
    // 纪律同 install-snippet：默认演练，--yes 才写入；幂等（evox-procedure:v1 标记）。
    const host = (positional[0] || argOf(rest, '--host') || '').toLowerCase();
    const HOSTS = {
      'claude-code': () => path.join(os.homedir(), '.claude', 'CLAUDE.md'),
      'claude': () => path.join(os.homedir(), '.claude', 'CLAUDE.md'),
      'cursor': () => path.join(process.cwd(), '.cursor', 'rules', 'pievox.md'),
      'codex': () => path.join(os.homedir(), '.codex', 'AGENTS.md'),
      'agents-md': () => path.join(process.cwd(), 'AGENTS.md'),
      'windsurf': () => path.join(process.cwd(), '.windsurf', 'rules', 'pievox.md'),
    };
    if (!host || !HOSTS[host]) {
      console.log('[gene-share] 用法: light-cli.mjs install <host> [--yes] [--file <覆盖路径>]');
      console.log('  支持: ' + Object.keys(HOSTS).join(' | '));
      console.log('  注: openclaw/hermes 走钩子，请用 install-hooks；其余宿主为规程文件接入。');
      process.exit(1);
    }
    const auto = HOSTS[host]();
    const fi = rest.indexOf('--file');
    const target = fi >= 0 ? rest[fi + 1] : auto;
    if (!target) { console.log(`[gene-share] ${host} 宿主走钩子接入：light-cli.mjs install-hooks`); process.exit(1); }
    console.log(`[gene-share] 宿主 ${host} → ${target}`);
    // 复用 install-snippet 的写入管线（直接落进同名 case 的共享函数）
    runInstallSnippet(['--file', target, ...(rest.includes('--yes') ? ['--yes'] : [])]);
    break;
  }
  case 'install-snippet': {
    // 0.17.0：把操作规程写进指定项目的 AGENTS.md/CLAUDE.md（0.23 起管线抽为 runInstallSnippet，install --host 共用）。
    runInstallSnippet(rest);
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
    const __rg = runGene(rest);
    if (__rg && typeof __rg.then === 'function') __rg.then((c) => process.exit(typeof c === 'number' ? c : 0));
    else process.exit(typeof __rg === 'number' ? __rg : 0);
    break;
  }
  default:
    if (cmd) fail(`未知命令：${cmd}`, { hint: '运行不带参数查看完整用法' });
    usage();
    process.exit(0);
}
