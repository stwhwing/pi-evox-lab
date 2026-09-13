/**
 * engine/light/distill.mjs — 轻量后端的蒸馏器
 *
 * 从 evolver generic-chat 格式的 transcript 起草 Gene（schema 1.13.0 对齐）。
 * 与 evolver `ingest --distill` 的关键差异（本项目方法论）：
 *   **信号提取只用 `is_error === true` 的 tool 消息内容**（精确口径），
 *   而非全文关键词匹配——避免把正文中"提及"的错误计为真实错误。
 *
 * 产出与 evolver 后端可互操作（同 schema、同 id 命名、同 asset_id 约定）。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

/** transcript 读取（role: system/user/assistant/tool；坏行跳过） */
export function readTranscript(p) {
  const msgs = [];
  let raw = '';
  try { raw = fs.readFileSync(p, 'utf8'); } catch { return msgs; }
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { msgs.push(JSON.parse(s)); } catch { /* 跳过 */ }
  }
  return msgs;
}

const textOf = (m) => {
  const c = m?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x?.text ?? x?.content ?? '')).join(' ');
  return c == null ? '' : JSON.stringify(c);
};

const SIGNAL_RULES = [
  [/\bUnicodeDecodeError|invalid start byte|codec can't decode|invalid continuation byte/i, 'encoding-error'],
  [/\bPermissionError|EPERM|EACCES|Permission denied|operation not permitted/i, 'permission-denied'],
  [/\bFileNotFoundError|ENOENT|No such file or directory/i, 'file-not-found'],
  [/\bJSONDecodeError|Expecting value|Expecting property name|malformed JSON/i, 'invalid-json'],
  [/\bECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up/i, 'network-error'],
  [/\bAssertionError|assertion failed/i, 'assertion-failed'],
  [/\bSyntaxError|IndentationError/i, 'syntax-error'],
  [/\bTypeError|ValueError|KeyError|IndexError/i, 'type-or-value-error'],
];

/**
 * 信号提取（精确口径）：
 * - 错误家族：仅从 is_error=true 的 tool 消息提取；
 * - 工具名：从 assistant.tool_calls[].function.name 提取（仅统计实际出错的调用）。
 */
export function extractSignals(msgs) {
  const errTexts = [];
  const callNameById = new Map();
  for (const m of msgs) {
    if (m?.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) if (tc?.id && tc?.function?.name) callNameById.set(tc.id, tc.function.name);
    }
  }
  const tools = new Set();
  for (const m of msgs) {
    if (m?.role !== 'tool' || m?.is_error !== true) continue;
    errTexts.push(textOf(m));
    const name = callNameById.get(m.tool_call_id);
    if (name) tools.add(name);
  }
  const families = new Set();
  for (const [re, name] of SIGNAL_RULES) if (errTexts.some((t) => re.test(t))) families.add(name);
  const signals = [...tools, ...families];
  return { signals: signals.length ? signals : ['unknown'], hadErrors: errTexts.length > 0, errorCount: errTexts.length };
}

/** 修法抽取：从 assistant 的"修复叙述"中取最具体的一句（含技术手段者优先、靠后者优先） */
export function extractStrategy(msgs, limit = 3) {
  const FIX_CUE = /\b(let me|i'll|i will|fixed|fix|use|using|instead|switch|set|convert|change|handle|read with|open with|specify|rerun|verify|should)\b/i;
  const TECH = /encoding\s*=|utf-?8|gbk|chmod|re-?read|bytes|open\(|json\.loads|loads\(|--|retry|normalize|decode/i;
  const cands = [];
  for (const m of msgs) {
    if (m?.role !== 'assistant') continue;
    for (const sentence of textOf(m).split(/(?<=[.!?])\s+|\n+/)) {
      const s = sentence.trim().replace(/\s+/g, ' ');
      if (s.length < 25 || s.length > 300) continue;
      if (FIX_CUE.test(s)) cands.push(s);
    }
  }
  return cands
    .map((s, i) => ({ s, score: (TECH.test(s) ? 2 : 0) + i / Math.max(cands.length, 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s.replace(/["'`]/g, "'"));
}

/** 组装 Gene（schema 1.13.0） */
export function buildGene({ msgs, category = 'repair', strategy, summary, source }) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(msgs)).digest('hex');
  const { signals } = extractSignals(msgs);
  const strat = (strategy ?? extractStrategy(msgs)).slice(0, 3);
  return {
    type: 'Gene',
    schema_version: '1.13.0',
    id: `gene_distilled_${digest.slice(0, 8)}`,
    category,
    signals_match: signals,
    strategy: strat.length ? strat : ['(no concrete fix sentence extracted — needs curation)'],
    constraints: { max_files: 12, forbidden_paths: ['.git', 'node_modules'] },
    validation: [],
    summary: summary ?? `Light-distilled from session (UNPROVEN — curate via review): ${signals.join(', ')}`,
    generation_meta: { source: source ?? 'light-distill' },
    claims: [{ predicate: 'output_contract', kind: 'behavioral' }],
    scope: { signals: signals.map((s) => `capability:${s}`) },
    asset_id: `sha256:${digest}`,
  };
}

/** 主入口：transcript 路径 → { gene, raw } */
export function distillFromTranscript(transcriptPath, opts = {}) {
  const msgs = readTranscript(transcriptPath);
  if (!msgs.length) throw new Error(`transcript 为空或不可读: ${transcriptPath}`);
  const st = extractSignals(msgs);
  // 行为对齐 evolver：无真实错误（is_error 计数为 0）时不起草 —— "not enough to distill, Nothing stored"
  if (st.errorCount === 0) {
    return { gene: null, raw: '[light-distill] no error signals in session (is_error count = 0) — Nothing stored' };
  }
  const gene = buildGene({ msgs, category: opts.category ?? 'repair', source: 'light-distill' });
  const raw = `[light-distill] drafted UNPROVEN gene ${gene.id} (${gene.asset_id.slice(0, 14)}…) — quarantined\n            signals_match: ${gene.signals_match.join(', ')}\n            errors seen: ${st.errorCount}`;
  return { gene, raw };
}

/** manual 蒸馏（LLM 精修路径使用）：直接给 strategy/summary 入库 */
export function distillManual({ category = 'repair', signals = [], strategy, summary }) {
  const payload = { strategy, signals, at: Date.now() };
  const digest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const sig = signals.length ? signals : ['manual'];
  const gene = {
    type: 'Gene',
    schema_version: '1.13.0',
    id: `gene_manual_${digest.slice(0, 8)}`,
    category,
    signals_match: sig,
    strategy: [strategy],
    constraints: { max_files: 12, forbidden_paths: ['.git', 'node_modules'] },
    validation: [],
    summary: summary ?? `Manually distilled: ${sig.join(', ')}`,
    generation_meta: { source: 'light-manual' },
    claims: [{ predicate: 'output_contract', kind: 'behavioral' }],
    scope: { signals: sig.map((s) => `capability:${s}`) },
    asset_id: `sha256:${digest}`,
  };
  return { gene, raw: `[light-distill] drafted UNPROVEN gene ${gene.id} (${gene.asset_id.slice(0, 14)}…) — quarantined` };
}
