#!/usr/bin/env node
/**
 * evolver-recall.mjs — 智能体经验库「召回 + 命中登记」（Pi × EvoX Lab 运行时）
 *
 * 任务开始时调用（无参数）：
 *   输出已审核（approved）且通过修法守卫的编号经验列表，供智能体读入上下文。
 * 任务结束调用（登记命中）：
 *   node evolver-recall.mjs --register-hit <N> --note "<任务一句话>"
 *   （N = 召回输出中的编号；内部解析为 gene_id 落 experiments/hits.jsonl）
 *
 * 设计纪律：
 *   - 只输出 approved 且命中修法信号词（REPAIR_SIGNAL_RE）的 strategy——宁缺毋滥（报告 §21）
 *   - 审核状态以台账「最后一条」为准（last-write-wins）——quarantine 必须能撤销 approved
 *   - 首段若是会话旁白（NARRATION_RE）→ 跳过（不可执行，且 P0 自动召回会放大噪声）
 *   - 命中登记落在 EVOX_HITS_DIR（默认 <cwd>/experiments/hits.jsonl），用于月度命中率盘点
 *   - 纯 Node 标准库，无第三方依赖
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EVO_STORE = process.env.EVO_STORE_DIR || path.join(os.homedir(), '.evomap', 'assets');
const EVO_GENES = path.join(EVO_STORE, 'genes.jsonl');
const EVO_REVIEW = path.join(EVO_STORE, 'review.jsonl');
const HITS_DIR = process.env.EVOX_HITS_DIR || path.join(process.cwd(), 'experiments');
const HITS_FILE = path.join(HITS_DIR, 'hits.jsonl');
const RECALL_CALLS_FILE = path.join(HITS_DIR, 'recall_calls.jsonl');

/**
 * 埋点：记录一次 recall 调用（仅 recall 模式，不含 register-hit）。
 * P3（2026-09-23）扩为**按调用方**记录：agent + 是否对靶 + 实际注入条数 + 查询摘要。
 * 动机：旧埋点只有 {ts,mode}，无法回答"哪个宿主注入了几条、是否多为空注入"——
 * 多个智能体宿主共享本实现，需按 agent 分离观测。
 * 向后兼容：未传 --agent 时记为 'unknown'；写失败不影响 recall 主流程。
 */
function recordRecallCall(extra = {}) {
	try {
		fs.mkdirSync(HITS_DIR, { recursive: true });
		fs.appendFileSync(RECALL_CALLS_FILE, JSON.stringify({
			ts: new Date().toISOString(), mode: 'recall', agent: AGENT,
			targeted: !!extra.targeted, injected: Number.isFinite(extra.injected) ? extra.injected : 0,
			query: String(extra.query ?? '').slice(0, 200),
		}) + '\n');
	} catch { /* 写失败不影响 recall 主流程 */ }
}

const REPAIR_SIGNAL_RE =
	/error|exception|traceback|failed|invalid|cannot|unable|missing|not found|wrong|instead|avoid|fix|encoding\s*[=:]|errors\s*=|utf-?8|gbk|gb18030|latin-1|\brb\b|except|skip/i;

/**
 * 叙述检测（2026-09-17 新增，P0 自动召回的必要配套）。
 *
 * 背景：auto-distill 的 strategy 摘录常是「会话旁白 / 推理流水」而非可执行修法
 * （实测样例："Now I understand the context… let me…"，且句中被截断）。
 * 这类文本因为含 gbk/error/encoding 等词，能通过 REPAIR_SIGNAL_RE，但对下游没有
 * 执行价值；在 P0 之下它会被**每个会话稳定注入**，把噪声放大成常态。
 *
 * 规则：只检查**首段**——旁白开场必然出现在 strategy[0] 开头；不检查全文，
 * 以免误伤正文里正常出现的 "done/first" 等词。命中即跳过（宁缺毋滥）。
 */
const NARRATION_RE =
	/^\s*(now i (understand|see|have|know|remember|need|can)|let me\b|i'?(ll|ve|m)\b|i will\b|here'?s\b|done[.!\u2026]|confirmed[:.]|the output matches|to summarize|summarize\b|first,? i\b|next,? i\b|alright\b|okay\b)/i;

function readJsonl(p) {
	const out = [];
	try {
		for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
			const s = line.trim();
			if (!s) continue;
			try { out.push(JSON.parse(s)); } catch { /* 跳过坏行 */ }
		}
	} catch { /* 文件不存在 → 空 */ }
	return out;
}

/**
 * 聚合 experiments/hits.jsonl 得 per-gene 命中计数（按 gene_id）。
 * P1④ 负载均衡偏置的数据基础（FlyLoRA / Switch Transformer 的 c_i）。
 */
function aggregateHits() {
	const counts = new Map();
	let total = 0;
	for (const h of readJsonl(HITS_FILE)) {
		const id = h && h.gene_id;
		if (!id) continue;
		counts.set(id, (counts.get(id) || 0) + 1);
		total++;
	}
	const mean = counts.size ? total / counts.size : 0;
	return { counts, mean };
}

function approvedAssetIds() {
	// 追加式台账 ⇒ 以「每个 assetId 的最后一条状态」为准（last-write-wins）。
	// 修复（2026-09-17 实测）：旧实现只要历史上出现过 approved 就计入，
	// 导致 quarantine 无法撤销已批准 —— 被隔离的基因仍会被召回并注入。
	const latestState = new Map();
	for (const r of readJsonl(EVO_REVIEW)) {
		if (r && typeof r.assetId === 'string' && r.assetId) latestState.set(r.assetId, r.state);
	}
	const set = new Set();
	for (const [assetId, state] of latestState) {
		if (typeof state === 'string' && state.toLowerCase().includes('approv')) set.add(assetId);
	}
	return set;
}

/** 与 evolver-bridge 同源：approved + 修法守卫，输出 [{id, assetId, category, text, signals}] */
function recallList() {
	const approved = approvedAssetIds();
	const out = [];
	for (const g of readJsonl(EVO_GENES)) {
		const st = g && Array.isArray(g.strategy) ? g.strategy : null;
		if (!st || st.length === 0) continue;
		const aid = g.asset_id;
		// fail-closed（安全修复，2026-09-10）：台账不可用或未 approved → 跳过（旧逻辑在台账缺失时 fail-open）
		if (!aid || !approved.has(aid)) continue;
		const text = st.join(' ').replace(/\s+/g, ' ').trim();
		if (!REPAIR_SIGNAL_RE.test(text)) continue; // 修法守卫：宁缺毋滥
		if (NARRATION_RE.test(String(st[0] ?? '').trim())) continue; // 叙述守卫：旁白开场 → 不可执行，跳过
		out.push({
			id: g.id,
			assetId: aid || '',
			category: g.category || 'repair',
			text: text.slice(0, 600),
			signals: Array.isArray(g.signals_match) ? g.signals_match : [],
			antiPatterns: Array.isArray(g.anti_patterns) ? g.anti_patterns : [],
			scope: g.scope || null,
		});
	}
	return out;
}

// ──────────────────────── P2 对靶匹配 + top-N（2026-09-17）────────────────────────
// 动机（实测）：approved 涨到 20 条后，全量注入 7,128 字符 > 注入上限 3,000 ⇒
// 只注入前 9 条且顺序=文件顺序（等于随机）。对靶 + top-N 才是正解。
//   · 有 --query / EVOX_QUERY：按「signals_match 命中 + 与查询词的 token 交集」打分，
//     **只保留 score>0**（不对靶就不注入——避免不对靶注入的净开销），按分排序取前 N。
//   · 无 query：退化为按入库顺序（追加式 → 靠后更新）取前 N，仅做**数量封顶**，不再任意截断。
const QUERY = (() => {
	const i = process.argv.indexOf('--query');
	return i >= 0 ? (process.argv[i + 1] ?? '') : (process.env.EVOX_QUERY ?? '');
})();
const TOPN = (() => {
	const i = process.argv.indexOf('--top');
	const n = i >= 0 ? Number(process.argv[i + 1]) : Number(process.env.EVOX_TOPN ?? 5);
	return Number.isFinite(n) && n > 0 ? n : 5;
})();
const SELECTION_FILE = path.join(HITS_DIR, '.evox-last-selection.json');
/** P3 溯源（2026-09-23）：调用方身份（宿主）——由钩子以 `--agent <name>` 或 EVOX_AGENT 传入。
 *  仅允许安全字符集；未传/非法 → 'unknown'（向后兼容，不影响既有调用方）。 */
const AGENT = (() => {
	const i = process.argv.indexOf('--agent');
	const v = i >= 0 ? process.argv[i + 1] : process.env.EVOX_AGENT;
	return /^[a-z0-9_.-]{1,32}$/i.test(String(v || '')) ? String(v) : 'unknown';
})();

/**
 * 停用词表：常见英文虚词/泛化词不应制造「假对靶」。
 * 实测教训（2026-09-17）：查询 "what is the capital of France?" 曾误命中 3 条——
 * 因为 "the/what" 这类词与长句 strategy 里的同词重叠而计分。故须过滤 + 设最低分。
 */
const STOP_WORDS = new Set([
	"the", "and", "for", "with", "that", "this", "from", "not", "are", "was", "were", "has", "have", "had", "been",
	"you", "your", "yours", "can", "could", "will", "would", "should", "shall", "may", "might", "must", "its", "our",
	"about", "when", "what", "which", "where", "why", "who", "whom", "how", "there", "here", "then", "than", "them",
	"they", "their", "into", "onto", "out", "over", "under", "again", "once", "only", "just", "also", "very", "more",
	"most", "much", "many", "please", "help", "need", "want", "make", "makes", "made", "get", "gets", "got", "give",
	"take", "takes", "use", "used", "uses", "using", "run", "runs", "ran", "running", "see", "say", "said", "tell",
	"new", "old", "first", "last", "next", "one", "two", "three", "file", "files", "data", "error", "errors", "issue",
	"issues", "problem", "problems", "command", "commands", "fix", "fixes", "failed", "fails", "failure", "true",
	"false", "null", "none", "thing", "things", "way", "ways", "time", "does", "did", "doing", "why", "let", "lets",
]);
/** 最低匹配分：低于此分视为「不对靶」（宁可少注入，避免 §11 的不对靶净开销） */
const MIN_MATCH_SCORE = 2;

function queryTokens(s) {
	const raw = String(s || '').toLowerCase().match(/[a-z0-9_\-./]{3,}|[\u4e00-\u9fa5]{2,}/g) || [];
	return new Set(raw.filter((t) => !STOP_WORDS.has(t)));
}

function scoreGene(item, qTokens, hitInfo) {
	let score = 0;
	for (const sig of item.signals) {
		if (sig && qTokens.has(String(sig).toLowerCase())) score += 3;
	}
	const st = queryTokens(item.text);
	for (const t of qTokens) if (st.has(t)) score += 1;
	// P1④ 负载均衡偏置（FlyLoRA / Switch Transformer 转移）：d_i = -u·sign(c_i − c̄)，
	// 冷门基因（c_i < c̄）上抬、热门（c_i > c̄）下压，缓解"高信号重叠热门基因恒霸榜"；
	// 温和封顶（u=0.4，最大 ±2.0），规模未到（命中全 0 → c_i=c̄=0）时无作用。
	if (hitInfo) {
		const c = hitInfo.counts.get(item.id) || 0;
		const d = c - hitInfo.mean;
		score += -0.4 * Math.sign(d) * Math.min(Math.abs(d), 5);
	}
	return score;
}

/**
 * P1⑤ 注入冲突守卫（FlyLoRA「免训练合并不干扰」在提示层的落地）：
 * 选中的 top-N 中，若两条基因相互矛盾，剔除低分者（保高分的）。
 * 判定极保守——仅在「一方 anti_patterns 字面命中另一方 strategy 文本」时冲突，
 * 即一方明令禁止的动作被另一方倡导。不引入编码重叠等脆弱启发式（易误删正确基因，违背宁缺毋滥）。
 * 预埋无害：基因普遍无 anti_patterns 或策略不重叠时，守卫不触发。
 */
function tokenSet(str) {
	return new Set(String(str || '').toLowerCase().match(/[a-z0-9_.-]+/g) || []);
}
function geneConflicts(a, b) {
	const aAnti = new Set((a.antiPatterns || []).map((s) => String(s).toLowerCase()));
	const bAnti = new Set((b.antiPatterns || []).map((s) => String(s).toLowerCase()));
	const aTok = tokenSet(a.text), bTok = tokenSet(b.text);
	for (const ap of aAnti) if (bTok.has(ap)) return true;
	for (const bp of bAnti) if (aTok.has(bp)) return true;
	return false;
}
/** 贪心冲突消解：保留高分项，剔除与已保留项冲突的低分项（若新项更强则替换旧项） */
function resolveConflicts(items, scored) {
	const kept = [];
	for (const it of items) {
		const conflict = kept.find((k) => geneConflicts(k, it));
		if (!conflict) { kept.push(it); continue; }
		if ((scored.get(it.id) || 0) > (scored.get(conflict.id) || 0)) {
			kept.splice(kept.indexOf(conflict), 1);
			kept.push(it);
		}
	}
	return kept;
}

/** 对靶 + top-N 选取；并落一份「本次选中」sidecar，供 --register-hit 正确解析编号 */
function selectList(all) {
	const qTokens = queryTokens(QUERY);
	const hitInfo = aggregateHits();
	let picked;
	if (qTokens.size > 0) {
		const scoredArr = all
			.map((it) => ({ it, s: scoreGene(it, qTokens, hitInfo) }))
			.filter((x) => x.s >= MIN_MATCH_SCORE)
			.sort((a, b) => b.s - a.s)
			.slice(0, TOPN);
		const scored = new Map(scoredArr.map((x) => [x.it.id, x.s]));
		picked = resolveConflicts(scoredArr.map((x) => x.it), scored);
	} else {
		// 无查询：按入库顺序取「最近」的 N 条（追加式台账，靠后=更新）
		picked = all.slice(-TOPN);
	}
	try {
		fs.mkdirSync(HITS_DIR, { recursive: true });
		fs.writeFileSync(SELECTION_FILE, JSON.stringify({ ts: new Date().toISOString(), query: QUERY, ids: picked.map((p) => p.id) }));
	} catch { /* 留痕失败不影响召回 */ }
	return { picked, total: all.length, targeted: qTokens.size > 0 };
}

function registerHit(n, note) {
	// 优先按「上次召回真正展示过的选中集」解析编号（对靶后编号 ≠ 全量顺序）
	let list = null;
	try {
		const sel = JSON.parse(fs.readFileSync(SELECTION_FILE, 'utf8'));
		if (sel && Array.isArray(sel.ids) && sel.ids.length) {
			const byId = new Map(recallList().map((x) => [x.id, x]));
			list = sel.ids.map((id) => byId.get(id)).filter(Boolean);
		}
	} catch { /* 无留痕 → 退化为全量列表 */ }
	if (!list) list = recallList();
	const item = list[n - 1];
	if (!item) {
		console.error(`登记失败：编号 #${n} 不存在（当前召回共 ${list.length} 条）`);
		process.exit(1);
	}
	fs.mkdirSync(HITS_DIR, { recursive: true });
	const rec = {
		ts: new Date().toISOString(),
		gene_id: item.id,
		asset_id: item.assetId,
		category: item.category,
		note: String(note).slice(0, 300),
	};
	fs.appendFileSync(HITS_FILE, JSON.stringify(rec) + '\n');
	console.log(`[Evolver] 命中已登记 #${n} (${item.id}) → ${HITS_FILE}`);
	console.log(`[Evolver] 当前命中总数: ${readJsonl(HITS_FILE).length}`);
}

function recall() {
	const all = readJsonl(EVO_GENES);
	const approved = approvedAssetIds();
	const full = recallList();
	const { picked, total, targeted } = selectList(full);
	recordRecallCall({ targeted, injected: picked.length, query: QUERY });
	console.log(
		`[Evolver 经验库] 基因总数=${all.length} | 已审核=${approved.size} | 守卫通过=${full.length} | ` +
		`${targeted ? '对靶' : '未对靶'}选中=${picked.length}/${total}${targeted ? '' : ` (top${TOPN})`}`,
	);
	if (picked.length === 0) {
		if (targeted) {
			console.log('本任务与经验库无对靶项 → 不注入（宁缺毋滥，避免不对靶注入的净开销）。');
			return;
		}
		console.log('经验库当前无可召回修法（首次运行属正常——价值随使用复利增长）。点亮方法：');
		console.log('  1) 完成一个非平凡任务，遇到并修复了不显而易见的坑（见 SKILL.md 流程 B 判定标准）；');
		console.log('  2) 沉淀（内置后端）：node code/light-cli.mjs distill --signals <信号> \\');
		console.log('             --strategy "<可执行修法：参数/命令/编码>" --summary "<坑的一句话>"');
		console.log('  3) 审核（内置后端）：node code/light-cli.mjs approve <gene_id>');
		console.log('   （如已安装可选集成 evolver，也可用：evolver distill / evolver review --approve）');
		console.log('  之后本命令即可召回。完整说明见 SKILL.md 流程 B。');
		return;
	}
	console.log('以下为已验证修法，与本任务相关时优先采用；任务结束时若实际采用，请执行：');
	console.log(`  node ${path.basename(process.argv[1])} --register-hit <N> --note "<任务一句话>"`);
	console.log('');
	picked.forEach((it, i) => {
		console.log(`[#${i + 1}|${it.id}] [${it.category}] ${it.text}`);
	});
}

const argv = process.argv.slice(2);
if (argv[0] === '--register-hit') {
	const n = parseInt(argv[1], 10);
	if (!Number.isInteger(n) || n < 1) {
		console.error('用法: evolver-recall.mjs --register-hit <N> --note "<任务一句话>"');
		process.exit(2);
	}
	const ni = argv.indexOf('--note');
	registerHit(n, ni >= 0 ? argv[ni + 1] ?? '' : '');
} else {
	recall();
}
