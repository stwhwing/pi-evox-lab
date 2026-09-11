#!/usr/bin/env node
// v0.6.0 — 安全修复：编排器侧 fail-closed 审批 + 有作用域 cleanup
/**
 * pi_evolve.mjs — Pi × EvoX 闭环编排器
 * 默认本地运行（无外发）、人工审核门默认开启；唯一外发路径 --llm-refine 为显式 opt-in
 * （端点未配置时自动禁用），且与 --auto-approve 组合默认拒绝（需 --allow-unreviewed-refine）。
 *
 * 一条命令跑通：Pi 执行 R1 → 适配器转换 session → evolver ingest --distill（自动起草基因）
 *   → [人工审核门：evolver review --approve] → evolver inject → Pi 执行 R2（注入基因）
 * 并输出跨轮 token / 错误数对比。
 *
 * 用法：
 *   node bin/pi_evolve.mjs <repo模板目录> <任务文本文件> \
 *       --provider agnes-cn --model agnes-2.5-flash \
 *       --api-key "$AGNES_CN_API_KEY" \
 *       --rounds 2 --fresh --auto-approve
 *
 * 关键：
 *   --fresh           运行前备份并清空 ~/.evomap/assets（保证单变量、隔离历史资产）
 *   --auto-approve    跳过人工审核门，自动 review --approve（全自动化演示用）
 *                      默认（不带此 flag）= 在蒸馏出基因后暂停，打印审核命令交人工确认
 *   --root <dir>      工作根目录（默认 exp/loop-<时间戳>）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const LAB = path.resolve(fileURLToPath(import.meta.url), '..', '..'); // repo root (code/ 的上级)
// 可选：指定 node 所在目录（多版本共存时用，如受管 node）。未设置则用 PATH 中的 node。
const MANAGED_NODE = process.env.PI_NODE_HOME || '';
// 辅助脚本布局自适应：仓库布局为 code/，evolver-lab 本机布局为 adapter/ + exp/
const ADAPTER = fs.existsSync(path.join(LAB, 'code', 'pi_session_adapter.js'))
  ? 'code/pi_session_adapter.js' : 'adapter/pi_session_adapter.js';
const SUMTOK = fs.existsSync(path.join(LAB, 'code', 'sum_tokens.js'))
  ? 'code/sum_tokens.js' : 'exp/sum_tokens.js';
const EVO_STORE = path.join(os.homedir(), '.evomap', 'assets');
// --llm-refine 使用的 OpenAI 兼容端点与模型（实验环境实测用 agnes-cn，可替换为任意兼容服务）
const REFINE_URL = process.env.EVOLVER_REFINE_URL || '';  // 必须显式配置（外发端点，防默认数据外发）
const REFINE_MODEL = process.env.EVOLVER_REFINE_MODEL || '';  // 必须显式配置
const EVO_GENES = path.join(EVO_STORE, 'genes.jsonl');
const EVO_REVIEW = path.join(EVO_STORE, 'review.jsonl');

// ---------- 参数解析 ----------
const positional = [];
const opts = { rounds: 2, fresh: false, autoApprove: false };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--fresh') opts.fresh = true;
  else if (a === '--auto-approve') opts.autoApprove = true;
  else if (a === '--provider') opts.provider = process.argv[++i];
  else if (a === '--model') opts.model = process.argv[++i];
  else if (a === '--api-key') opts.apiKey = process.argv[++i];
  else if (a === '--rounds') opts.rounds = parseInt(process.argv[++i], 10);
  else if (a === '--root') opts.root = process.argv[++i];
  else if (a === '--task') opts.taskText = process.argv[++i];
  else if (a === '--ext-inject') opts.extInject = true;
  else if (a === '--allow-unreviewed-refine') opts.allowUnreviewedRefine = true;
  else if (a === '--llm-refine') opts.llmRefine = true;
  else positional.push(a);
}
const templateDir = positional[0];
const taskFile = positional[1];
if (!templateDir || (!taskFile && !opts.taskText)) {
  console.error('用法: node bin/pi_evolve.mjs <repo模板目录> <任务文本文件> --provider X --model Y --api-key $K [--rounds 2] [--fresh] [--auto-approve]');
  process.exit(2);
}
const taskText = opts.taskText ?? fs.readFileSync(taskFile, 'utf8').trim();
const apiKey = opts.apiKey ?? process.env.AGNES_CN_API_KEY;
if (opts.autoApprove && opts.llmRefine && !opts.allowUnreviewedRefine) {
  console.error('[安全门] --auto-approve 与 --llm-refine 组合会形成「LLM 重写 → 自动审核 → 注入后续轮次」的未经人工复核链路，默认拒绝执行。');
  console.error('  如确需（研究演示），显式追加 --allow-unreviewed-refine 表示已知悉风险；');
  console.error('  或去掉 --auto-approve，保留人工审核门（默认、推荐）。');
  process.exit(2);
}
if (opts.autoApprove && opts.llmRefine && opts.allowUnreviewedRefine) {
  log('⚠️  [组合放行] --allow-unreviewed-refine 已显式指定：LLM 重写的修法将自动审核并注入后续轮次（研究演示模式，请勿用于生产）。');
}
// provider/model 白名单（防注入：仅允许安全字符集）
for (const [name, v] of [['provider', opts.provider], ['model', opts.model]]) {
  if (v && !/^[A-Za-z0-9._\-]+$/.test(v)) {
    console.error(`[安全门] ${name} 含非法字符：${v}（仅允许字母/数字/点/下划线/连字符）`);
    process.exit(2);
  }
}
if (!opts.provider || !opts.model || !apiKey) {
  console.error('缺少 --provider / --model / --api-key（或环境变量 AGNES_CN_API_KEY）');
  process.exit(2);
}

const log = (...x) => console.log(...x);

/**
 * CLI 执行 —— argv 化（0.6.0 安全加固，彻底消除 shell 字符串拼接）：
 * 全部以 argv 数组调用 `node <JS 入口>`，不经过 bash/shell，参数不参与任何解析，
 * 从根上消除命令注入面（响应 ClawHub static-analysis: unsafe shell construction）。
 *   PI_ENTRY       → pi 的 CLI 入口（package.json bin 指向 dist/cli.js）
 *   EVOLVER_ENTRY  → evolver 的 CLI 入口
 * 选项语义与旧 shell 版对齐：silent ≈ `2>/dev/null`；mergeStderr ≈ `2>&1`；allowFail ≈ 非零退出不抛。
 */
const PI_ENTRY = 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js';
const EVOLVER_ENTRY = 'node_modules/@evomap/evolver/bin/evolver.js';
/**
 * 失败分类（0.9.0，响应 skillhub「错误分类粗粒度」4.3 分项）：
 * 从子进程输出识别错误家族，给出**可执行的下一步**，而不是只丢退出码。
 */
const ERROR_HINTS = [
  [/ENOENT|Cannot find module|no such file or directory/i, '依赖/路径类：确认已在仓库根目录执行且 `npm install` 完整（缺件可试 `npm rebuild`）；检查传入的路径是否存在'],
  [/EACCES|EPERM|Permission denied|operation not permitted/i, '权限类：目标文件/目录权限不足（Linux 用 chmod，Windows 检查只读属性）'],
  [/ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|socket hang up|timeout/i, '网络类：检查连通性与代理设置（HTTP_PROXY/HTTPS_PROXY 可能干扰直连，可 no_proxy 排除）'],
  [/401|403|Unauthorized|invalid api key|无效的令牌|authentication/i, '凭据类：API key 无效或未正确传递（用 --api-key 显式传，或确认环境变量已导出）'],
  [/429|rate limit|too many requests/i, '限流类：稍后重试，或更换模型/端点'],
];
function classifyError(text) {
  for (const [re, hint] of ERROR_HINTS) if (re.test(text)) return hint;
  return null;
}
function runCli(entry, args, { cwd = LAB, silent = false, mergeStderr = false, allowFail = false, extraEnv = null } = {}) {
  const env = { ...process.env, ...(extraEnv ?? {}) };
  if (MANAGED_NODE) env.PATH = `${MANAGED_NODE}${path.delimiter}${env.PATH ?? ''}`;
  const r = spawnSync(process.execPath, [entry, ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 26, env });
  const out = (r.stdout ?? '') + (mergeStderr ? (r.stderr ?? '') : '');
  if (!allowFail && r.status !== 0) {
    const detail = String(r.stderr ?? '').trim().slice(0, 200);
    const hint = classifyError(`${detail} ${out}`);
    const err = new Error(`exit ${r.status}: ${detail}${hint ? `\n  ↳ 诊断：${hint}` : ''}`);
    err.status = r.status;
    err.hint = hint;
    throw err;
  }
  return out;
}
function globJsonl(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
}

/**
 * 注入质量守卫：strategy 须命中「修法信号词」。
 * 规则已在 4 个真实历史样本上验证（§16 gbk修法✓ / §17 容错修法✓ / §20 成功总结✗ / §18 gb18030叙述✓）。
 */
const REPAIR_SIGNAL_RE = /error|exception|traceback|failed|invalid|cannot|unable|missing|not found|wrong|instead|avoid|fix|encoding\s*[=:]|errors\s*=|utf-?8|gbk|gb18030|latin-1|\brb\b|except|skip/i;
const isRepairLike = (t) => REPAIR_SIGNAL_RE.test(t);

/**
 * 从 ~/.evomap/assets/genes.jsonl 抽取已审核（approved）基因的 strategy 文本。
 * evolver inject session-start 只输出 summary 标签，不携带可执行修法；
 * 这里直接读基因库把 strategy 拼回注入块，让下一轮真正继承"怎么做"而非仅"出过什么错"。
 * 审核态以 review.jsonl 中 asset_id 对应的 approved 记录为准（尊重人工/自动审核门）。
 */
function loadApprovedStrategy() {
  try {
    // 1) 收集已 approved 的 asset_id 集合
    const approved = new Set();
    try {
      for (const line of fs.readFileSync(EVO_REVIEW, 'utf8').split('\n')) {
        const s = line.trim();
        if (!s) continue;
        try {
          const r = JSON.parse(s);
          if (r && (r.state === 'approved' || (r.state || '').toLowerCase().includes('approv'))) {
            approved.add(r.assetId);
          }
        } catch {}
      }
    } catch {}
    // 2) 抽取这些基因的 strategy
    const out = [];
    for (const line of fs.readFileSync(EVO_GENES, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      let g;
      try { g = JSON.parse(s); } catch { continue; }
      const st = g && g.strategy;
      if (!Array.isArray(st) || !st.length) continue;
      const aid = g.asset_id;
      // fail-closed（安全修复 0.6.0，ClawHub clawscan 二次点名）：台账缺失/为空或未 approved → 一律跳过。
      // 旧逻辑 "approved.size &&" 在台账不可用时退化为全采纳（fail-open），违背审核门语义。
      if (!aid || !approved.has(aid)) continue;
      const text = st.join(' ').slice(0, 1200);
      if (!isRepairLike(text)) continue; // 守卫：无修法信号的叙述（如成功总结）不注入，宁缺毋滥（§20）
      out.push(`- [${g.category || 'repair'}] ${text}`);
    }
    return out.join('\n\n').slice(0, 4000);
  } catch { return ''; }
}

// ---------- 工作区 ----------
const root = opts.root ?? path.join(LAB, 'exp', `loop-${Date.now()}`);
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'task.txt'), taskText);
const sessBase = path.join(root, 'sessions');

// ---------- 可选：清空资产库（单变量控制）----------
if (opts.fresh) {
  const bk = path.join(EVO_STORE, `backup-${Date.now()}`);
  fs.mkdirSync(bk, { recursive: true });
  // 全新环境兼容：~/.evomap/assets 尚未初始化（文件不存在）时以空库起步，不报 ENOENT
  for (const [src, name] of [[EVO_GENES, 'genes.jsonl'], [EVO_REVIEW, 'review.jsonl']]) {
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(bk, name));
    fs.writeFileSync(src, '');
  }
  log(`[fresh] 已备份旧资产库到 ${bk} 并清空（${fs.existsSync(path.join(bk, 'genes.jsonl')) ? '含旧资产' : '原为空库'}）`);
}

// ---------- 预置陷阱内容到 LAB 根（泛化：模板目录的全部顶层条目）----------
// 0.8.0：不再写死 data/events.jsonl——支持多种陷阱形态（脚本行尾 / 只读文件 / NFD 文件名等）。
// 安全（ClawHub environment_proportionality concern）：记录运行前既有条目，cleanup 只删本轮预置的；
// 若 LAB 根已存在同名条目则跳过预置（绝不覆盖既有文件）。
const preExistingLabArtifacts = {};
const stagedEntries = [];
try {
  for (const entry of fs.readdirSync(templateDir)) {
    preExistingLabArtifacts[entry] = fs.existsSync(path.join(LAB, entry));
    if (preExistingLabArtifacts[entry]) {
      log(`[stage] 跳过 ${entry}（LAB 根已存在同名条目，不覆盖）`);
      continue;
    }
    fs.cpSync(path.join(templateDir, entry), path.join(LAB, entry), { recursive: true });
    stagedEntries.push(entry);
  }
  if (stagedEntries.length) log(`[stage] 已预置模板内容到 LAB 根: ${stagedEntries.join(', ')}`);
} catch (e) { log(`[stage] 预置失败: ${String(e).slice(0, 120)}`); }

// ---------- 主循环 ----------
const results = [];
const labRootRel = LAB;

for (let r = 1; r <= opts.rounds; r++) {
  const work = path.join(root, `r${r}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.cpSync(templateDir, work, { recursive: true });
  const sessDir = path.join(sessBase, `r${r}`);
  fs.mkdirSync(sessDir, { recursive: true });

  // 注入块（R>1 时读取已审核基因）
  // 单通道原则：若 Pi 扩展桥已激活（.pi/extensions/evolver-bridge.ts 存在），
  // 自动走扩展注入并跳过 CLI 策略注入——双通道会把同一修法注入两遍（token 膨胀 + 行为扰动）。
  const extBridgeActive = fs.existsSync(path.join(LAB, '.pi', 'extensions', 'evolver-bridge.ts'));
  let injectArgs = [];
  if (r > 1 && (opts.extInject || extBridgeActive)) {
    // Route A 模式：不传 CLI 注入参数，由 Pi 扩展（.pi/extensions/evolver-bridge.ts）
    // 在 before_agent_start 钩子自动注入已审核基因 strategy；留痕见 ~/.evomap/assets/bridge-last-inject.txt
    log(`[inject] R${r} 使用 Pi 扩展注入（${opts.extInject ? '--ext-inject' : '自动检测：扩展桥已激活'}），跳过 CLI append-system-prompt 以避免双通道重复注入`);
  } else if (r > 1) {
    const block = runCli(EVOLVER_ENTRY, ['inject', 'session-start'], { silent: true });
    // 关键修复：evolver inject 只吐基因的 summary 标签（如 "bash, exception"），
    // 不携带真正可执行的 strategy（例如 "用 encoding='gbk' 读取"）。这里从 genes.jsonl
    // 抽取已审核基因的 strategy 文本，追加进注入块，使下一轮真正继承"修法"而非仅一个标签。
    const strat = loadApprovedStrategy();
    const full = strat
      ? `${block}\n\n[上一轮已验证的修法（请优先采用，避免重复踩坑）]\n${strat}`
      : block;
    const f = path.join(root, `inject-r${r}.txt`);
    fs.writeFileSync(f, full);
    injectArgs = ['--append-system-prompt', full]; // argv 直传内容，无需 shell 命令替换
  }

  log(`\n========== ROUND ${r} ${r > 1 ? '(injected)' : '(baseline)'} ==========`);
  const taskF = path.join(root, `task-r${r}.txt`);
  fs.writeFileSync(taskF, taskText);
  const piArgs = ['-p', '--provider', opts.provider, '--model', opts.model,
    '--api-key', apiKey, '--session-dir', sessDir, ...injectArgs, taskText];
  let piOut = '';
  try {
    piOut = runCli(PI_ENTRY, piArgs, { mergeStderr: true, extraEnv: { AGNES_CN_API_KEY: apiKey } });
    log(piOut.trim().split('\n').slice(-8).join('\n')); // 仅尾部摘要，避免刷屏
  } catch (e) {
    log(`[round ${r}] pi 运行异常: ${String(e).slice(0, 300)}`);
  }

  // 聚合 token
  let stats = null;
  try {
    const out = runCli(SUMTOK, [sessDir], { silent: true });
    stats = JSON.parse(out);
  } catch (e) { log(`[round ${r}] sum_tokens 失败: ${String(e).slice(0, 200)}`); }
  results.push({ round: r, injected: r > 1, stats });

  // R1 之后：转换 + 蒸馏
  if (r === 1 && opts.rounds > 1) {
    const sessFiles = globJsonl(sessDir);
    if (sessFiles.length) {
      const sf = path.join(sessDir, sessFiles[0]);
      const outDir = path.join(root, 'transcript');
      fs.mkdirSync(outDir, { recursive: true });
      try {
        runCli(ADAPTER, [sf, '--out', outDir, '--active-only'], { silent: true });
      } catch (e) {
        log(`[adapter] 转换失败，跳过本轮蒸馏: ${String(e).slice(0, 150)}`);
      }
      const tr = globJsonl(outDir).find((f) => f.endsWith('.transcript.jsonl'));
      if (tr) {
        const ingestOut = runCli(EVOLVER_ENTRY, ['ingest', '--distill', path.join(outDir, tr)], { mergeStderr: true });
        log(`[distill] ${ingestOut.trim().split('\n').slice(-4).join('\n')}`);
        const m = ingestOut.match(/drafted UNPROVEN gene (gene_distilled_\w+)/);
        if (m) {
          const gene = m[1];
          if (opts.autoApprove) {
            runCli(EVOLVER_ENTRY, ['review', '--approve', gene], { silent: true, allowFail: true });
            log(`[gate] 自动审核通过 ${gene}（--auto-approve）`);
          } else {
            log(`\n🔒 人工审核门：请审阅后执行\n  node_modules/.bin/evolver review --approve ${gene}\n（通过后将注入下一轮）`);
            // 默认不自动 approve：这里仍继续跑 R2，但 R2 不会注入（store 无已审核基因）
          }
        } else {
          log('[distill] 本轮未自动起草基因（无 strong 信号或去重拦截）；R2 将作为无注入基线重复。');
        }

        // ---------- --llm-refine：守卫判 strategy 无修法 → LLM 重写 → manual distill ----------
        if (opts.llmRefine) {
          const stratRaw = loadApprovedStrategy();
          if (!stratRaw) {
            log('[llm-refine] store 无已审核 strategy，跳过重写');
          } else if (isRepairLike(stratRaw)) {
            log('[llm-refine] strategy 已含修法信号词，无需重写');
          } else if (!REFINE_URL || !REFINE_MODEL) {
            // 数据外发端点必须显式配置（SkillSpector finding 修复：不做默认外发）
            log('[llm-refine] strategy 无修法信号，但未配置 EVOLVER_REFINE_URL / EVOLVER_REFINE_MODEL（外发端点必须显式指定），跳过重写');
          } else {
            log('[llm-refine] strategy 无修法信号（成功总结型叙述）→ LLM 重写');
            const trTxt = fs.readFileSync(path.join(outDir, tr), 'utf8').replace(/\s+/g, ' ').slice(0, 9000);
            const prompt =
              'Below is an agent coding-session transcript. The agent hit errors and recovered. ' +
              'Extract the CONCRETE FIX as ONE single-line strategy (steps separated by "; "). ' +
              'Focus on what caused the error and the exact code/config change that resolved it. ' +
              'Output ONLY the strategy sentence, no preamble, no markdown.\n\nTRANSCRIPT:\n' + trTxt;
            const pf = path.join(root, 'llm-prompt.txt');
            const rf = path.join(root, 'llm-response.txt');
            fs.writeFileSync(pf, prompt);
            const pfP = pf.replace(/\\/g, '/'), rfP = rf.replace(/\\/g, '/');
            try {
              // 0.6.0：curl → Node 原生 fetch（消除 shell/curl 依赖，外发目标与载荷在代码中显式可见）
              const resp = await fetch(REFINE_URL, {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: REFINE_MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 300 }),
                signal: AbortSignal.timeout(180000),
              });
              const respJson = await resp.json().catch(() => null);
              const refined = String(respJson?.choices?.[0]?.message?.content ?? '').trim();
              fs.writeFileSync(rf, refined);

              if (refined && isRepairLike(refined)) {
                const oneLine = refined.replace(/\r?\n+/g, ' ').replace(/"/g, "'");
                const dOut = runCli(EVOLVER_ENTRY,
                  ['distill', '--category', 'repair', '--signals', 'read,bash,exception',
                   '--strategy', oneLine, '--summary', 'LLM-refined repair (guard-triggered)'],
                  { mergeStderr: true });
                log(`[llm-refine] LLM 精修 strategy 已蒸馏: ${dOut.trim().split('\n').slice(-2).join(' | ').slice(0, 200)}`);
                const gm = dOut.match(/gene_[a-z0-9_]+/);
                if (gm && opts.autoApprove) {
                  runCli(EVOLVER_ENTRY, ['review', '--approve', gm[0]], { silent: true, allowFail: true });
                  log(`[llm-refine] 已自动审核通过 ${gm[0]}（--auto-approve）`);
                } else if (gm) {
                  log(`[llm-refine] 人工审核门：node_modules/.bin/evolver review --approve ${gm[0]}`);
                }
              } else {
                log('[llm-refine] LLM 输出为空或仍无修法信号，保留原状（守卫兜底：不注入噪声）');
              }
            } catch (e) {
              log(`[llm-refine] 失败: ${String(e).slice(0, 200)}`);
            }
          }
        }
      }
    }
  }
}

// ---------- 对比表 ----------
log('\n================ 跨轮对比 ================');
log('round | injected | totalTokens | input | output | toolCalls | errors');
for (const res of results) {
  const u = res.stats?.usage ?? {};
  log(`${String(res.round).padEnd(5)} | ${String(res.injected).padEnd(8)} | ${String(u.totalTokens ?? '-').padEnd(12)} | ${String(u.input ?? '-').padEnd(5)} | ${String(u.output ?? '-').padEnd(6)} | ${String(res.stats?.toolCalls ?? '-').padEnd(9)} | ${res.stats?.toolErrors ?? '-'}`);
}
if (results.length >= 2) {
  const b = results[0].stats?.usage?.totalTokens, a = results[results.length - 1].stats?.usage?.totalTokens;
  if (b && a) log(`\n基线首轮 ${b} → 末轮 ${a}（Δ ${(((a - b) / b) * 100).toFixed(1)}%）`);
}
log(`\n工作区: ${root}`);

// ---------- 清理 LAB 临时产物（仅删本轮预置的、且运行前不存在的条目）----------
let cleaned = 0, kept = 0;
for (const entry of stagedEntries) {
  const p = path.join(LAB, entry);
  if (preExistingLabArtifacts[entry]) { kept++; log(`[cleanup] 保留 ${p}（运行前已存在）`); continue; }
  try { fs.rmSync(p, { recursive: true, force: true }); cleaned++; } catch {}
}
// Pi 在 LAB 根新建的常见产物（仅当运行前不存在时清理）
for (const extra of ['analyze.py']) {
  const p = path.join(LAB, extra);
  if (!fs.existsSync(p) || preExistingLabArtifacts[extra]) continue;
  try { fs.rmSync(p, { force: true }); cleaned++; } catch {}
}
log(`[cleanup] 已清理 LAB 临时产物（删除 ${cleaned} 项，保留 ${kept} 项）`);
