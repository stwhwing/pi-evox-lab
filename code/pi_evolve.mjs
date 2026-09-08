#!/usr/bin/env node
/**
 * pi_evolve.mjs — Pi × EvoX 闭环编排器（离线、人工审核门默认开启）
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
import { execFileSync } from 'node:child_process';
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
if (!opts.provider || !opts.model || !apiKey) {
  console.error('缺少 --provider / --model / --api-key（或环境变量 AGNES_CN_API_KEY）');
  process.exit(2);
}

const log = (...x) => console.log(...x);

/** bash -lc 执行（复用已验证的 .bin 调用方式，PATH 注入受管 node） */
function run(cmd, cwd = LAB, silent = false) {
  const pre = MANAGED_NODE ? `export PATH="${MANAGED_NODE}:$PATH"; ` : '';
  return execFileSync('bash', ['-lc', `${pre}${cmd}`], {
    cwd, encoding: 'utf8', maxBuffer: 1 << 26,
  }).toString();
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
      if (approved.size && aid && !approved.has(aid)) continue; // 无 approved 集合时退化为全采纳
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

// ---------- 预置陷阱数据到 LAB 根（消除 R1 一次性 file-not-found 探索噪声，使基线干净）----------
try {
  const srcData = path.join(templateDir, 'data', 'events.jsonl');
  if (fs.existsSync(srcData)) {
    const dstData = path.join(LAB, 'data', 'events.jsonl');
    fs.mkdirSync(path.dirname(dstData), { recursive: true });
    fs.copyFileSync(srcData, dstData);
    log(`[stage] 已预置陷阱数据 ${dstData}`);
  }
} catch (e) { log(`[stage] 预置 data 失败: ${String(e).slice(0, 120)}`); }

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
  let injectArg = '';
  if (r > 1 && (opts.extInject || extBridgeActive)) {
    // Route A 模式：不传 CLI 注入参数，由 Pi 扩展（.pi/extensions/evolver-bridge.ts）
    // 在 before_agent_start 钩子自动注入已审核基因 strategy；留痕见 ~/.evomap/assets/bridge-last-inject.txt
    log(`[inject] R${r} 使用 Pi 扩展注入（${opts.extInject ? '--ext-inject' : '自动检测：扩展桥已激活'}），跳过 CLI append-system-prompt 以避免双通道重复注入`);
  } else if (r > 1) {
    const block = run('node_modules/.bin/evolver inject session-start 2>/dev/null', LAB);
    // 关键修复：evolver inject 只吐基因的 summary 标签（如 "bash, exception"），
    // 不携带真正可执行的 strategy（例如 "用 encoding='gbk' 读取"）。这里从 genes.jsonl
    // 抽取已审核基因的 strategy 文本，追加进注入块，使下一轮真正继承"修法"而非仅一个标签。
    const strat = loadApprovedStrategy();
    const full = strat
      ? `${block}\n\n[上一轮已验证的修法（请优先采用，避免重复踩坑）]\n${strat}`
      : block;
    const f = path.join(root, `inject-r${r}.txt`);
    fs.writeFileSync(f, full);
    const fPosix = f.replace(/\\/g, '/');
    injectArg = ` --append-system-prompt "$(cat "${fPosix}")"`;
  }

  log(`\n========== ROUND ${r} ${r > 1 ? '(injected)' : '(baseline)'} ==========`);
  const taskF = path.join(root, `task-r${r}.txt`);
  fs.writeFileSync(taskF, taskText);
  const taskFPosix = taskF.replace(/\\/g, '/');
  const piCmd = `node_modules/.bin/pi -p --provider ${opts.provider} --model ${opts.model} --api-key "$AGNES_CN_API_KEY" --session-dir "${sessDir}"${injectArg} "$(cat "${taskFPosix}")"`;
  let piOut = '';
  try {
    piOut = run(piCmd, LAB);
    log(piOut.trim().split('\n').slice(-8).join('\n')); // 仅尾部摘要，避免刷屏
  } catch (e) {
    log(`[round ${r}] pi 运行异常: ${String(e).slice(0, 300)}`);
  }

  // 聚合 token
  let stats = null;
  try {
    const out = run(`node ${SUMTOK} "${sessDir}" 2>/dev/null`, LAB);
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
        run(`node ${ADAPTER} "${sf}" --out "${outDir}" --active-only 2>/dev/null`, LAB);
      } catch (e) {
        log(`[adapter] 转换失败，跳过本轮蒸馏: ${String(e).slice(0, 150)}`);
      }
      const tr = globJsonl(outDir).find((f) => f.endsWith('.transcript.jsonl'));
      if (tr) {
        const ingestOut = run(`node_modules/.bin/evolver ingest --distill "${path.join(outDir, tr)}" 2>&1`, LAB);
        log(`[distill] ${ingestOut.trim().split('\n').slice(-4).join('\n')}`);
        const m = ingestOut.match(/drafted UNPROVEN gene (gene_distilled_\w+)/);
        if (m) {
          const gene = m[1];
          if (opts.autoApprove) {
            run(`node_modules/.bin/evolver review --approve ${gene} 2>/dev/null`, LAB);
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
              run(
                `curl -s --max-time 180 ${REFINE_URL} ` +
                `-H "Authorization: Bearer $AGNES_CN_API_KEY" -H "Content-Type: application/json" ` +
                `-d "$(node -e "const fs=require('fs');console.log(JSON.stringify({model:'${REFINE_MODEL}',messages:[{role:'user',content:fs.readFileSync(process.argv[1],'utf8')}],max_tokens:300}))" "${pfP}")" ` +
                `| node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).choices[0].message.content)}catch(e){console.log('')}})" ` +
                `> "${rfP}"`,
                LAB
              );
              const refined = fs.readFileSync(rf, 'utf8').trim();
              if (refined && isRepairLike(refined)) {
                const oneLine = refined.replace(/\r?\n+/g, ' ').replace(/"/g, "'");
                const dOut = run(
                  `node_modules/.bin/evolver distill --category repair --signals read,bash,exception ` +
                  `--strategy ${JSON.stringify(oneLine)} --summary "LLM-refined repair (guard-triggered)" 2>&1`,
                  LAB
                );
                log(`[llm-refine] LLM 精修 strategy 已蒸馏: ${dOut.trim().split('\n').slice(-2).join(' | ').slice(0, 200)}`);
                const gm = dOut.match(/gene_[a-z0-9_]+/);
                if (gm && opts.autoApprove) {
                  run(`node_modules/.bin/evolver review --approve ${gm[0]} 2>/dev/null`, LAB);
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

// ---------- 清理 LAB 临时产物（陷阱数据/生成的脚本，避免污染 evolver-lab 仓库）----------
for (const p of [path.join(LAB, 'data'), path.join(LAB, 'analyze.py')]) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
}
log('[cleanup] 已清理 LAB 临时产物');
