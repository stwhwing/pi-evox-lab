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
import * as distill from './engine/light/distill.mjs';
import * as ledger from './engine/light/ledger.mjs';
import { STORE_DIR, readGenes, readReview, approvedAssetIds } from './engine/light/store.mjs';
import { SIGNAL_RULES, AVOID_TEMPLATES } from './engine/light/distill.mjs';

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
function proposeFromError(error, { tool = '', context = '' } = {}) {
  const text = String(error || '');
  const families = new Set();
  for (const [re, name] of SIGNAL_RULES) if (re.test(text)) families.add(name);
  const signals = [...new Set([...(tool ? [tool] : []), ...families])];
  const fam = signals.find((s) => AVOID_TEMPLATES[s]) ?? 'unknown';
  const object = (text.match(/([\w.-]+\.(?:py|json|jsonl|txt|md|cfg|ini|yaml|yml|toml|sh|js|ts))/) || [])[1] || '';
  const objStr = object ? ` (${object})` : '';
  const avoid = `AVOID: ${AVOID_TEMPLATES[fam]}${objStr}.`;
  const strategy = `${avoid} FIX: <在此填写可执行修法，例如 use encoding='gbk' / 先 chmod u+w 再写 / 先 ls 确认路径>`;
  const head = text.replace(/\s+/g, ' ').trim().slice(0, 80);
  const antiTag = ANTI_TAGS[fam] || ANTI_TAGS.unknown;
  const summary = `${fam} 失败${context ? `（${context}）` : ''} [AVOID ${antiTag}]: ${head}`;
  return {
    signals: signals.length ? signals : ['manual'],
    strategy,
    summary,
    antiTag,                                              // 人读标签（进 summary）
    antiPatterns: [...(ANTI_TOKENS[fam] || [])],          // 机器可匹配单 token（进 anti_patterns）
    family: fam,
  };
}

function usage() {
  console.log(`light-cli — 内置经验库运维命令（零依赖）

用法：
  node code/light-cli.mjs distill --signals <a,b> --strategy "<可执行修法>" [--summary "<坑>"] [--category repair]
  node code/light-cli.mjs distill --error "<错误文本>" [--context "<在做什么>"] [--tool <工具名>]   # 引导式：自动抽信号
  node code/light-cli.mjs draft  --error "<错误文本>" [--context "<在做什么>"] [--tool <工具名>] [--commit]   # 生成可编辑草稿
  node code/light-cli.mjs approve <gene_id>
  node code/light-cli.mjs quarantine <gene_id> [--reason "<原因>"]
  node code/light-cli.mjs list
  node code/light-cli.mjs info

库路径：${STORE_DIR}（可用 EVO_STORE_DIR 覆盖）`);
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
    if (!strategy) { console.error('缺少 --strategy（写可执行修法：具体参数/命令/编码）'); process.exit(2); }
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
      console.log('[light-distill] 跳过：库中已存在相同 strategy 的基因（内容去重）');
      break;
    }
    const { gene, raw } = distill.distillManual({
      category: flag('category', 'repair'),
      signals,
      strategy,
      summary: flag('summary') || (proposed ? proposed.summary : undefined),
      antiPatterns: proposed ? proposed.antiPatterns : [],
      source: proposed ? 'light-manual-guided' : 'light-manual',
    });
    if (!gene) { console.log(raw); break; }
    // 只在真正写入时登记 quarantined（等待审核）
    const written = appendGene(gene);
    if (written) {
      appendReview({ assetId: gene.asset_id, state: 'quarantined', reason: 'manually distilled — review before use' });
    }
    console.log(raw + (written ? '' : '\n（asset 已存在，跳过重复写入）'));
    if (written) console.log(`\n下一步审核：node code/light-cli.mjs approve ${gene.id}`);
    break;
  }
  case 'draft': {
    // 引导式草稿：从错误直接生成可编辑的 distill 草稿（预填 AVOID + anti_patterns），人只补 FIX。
    const errorText = flag('error');
    if (!errorText) { console.error('用法：light-cli.mjs draft --error "<错误文本>" [--context "<在做什么>"] [--tool <工具名>] [--commit]'); process.exit(2); }
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
        console.log('\n[light-draft] 跳过：库中已存在相同 strategy 的基因（内容去重）');
        break;
      }
      const { gene, raw } = distill.distillManual({
        category: 'repair', signals: proposed.signals, strategy,
        summary: proposed.summary, antiPatterns: proposed.antiPatterns, source: 'light-manual-guided',
      });
      if (!gene) { console.log(raw); break; }
      const written = appendGene(gene);
      if (written) appendReview({ assetId: gene.asset_id, state: 'quarantined', reason: 'guided draft — review before use' });
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
    if (!id) { console.error('用法：light-cli.mjs approve <gene_id>'); process.exit(2); }
    const r = ledger.approve(id);
    console.log(r.ok ? `✓ 已审核通过${r.alreadyApproved ? '（此前已通过）' : ''}：${r.assetId}` : `✗ ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
    break;
  }
  case 'quarantine': {
    const id = positional[0];
    if (!id) { console.error('用法：light-cli.mjs quarantine <gene_id> [--reason ...]'); process.exit(2); }
    const r = ledger.quarantine(id, flag('reason', 'manually quarantined'));
    console.log(r.ok ? `✓ 已隔离：${r.assetId}` : `✗ ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
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
    break;
  }
  default:
    usage();
    process.exit(cmd ? 2 : 0);
}
