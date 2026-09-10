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

const REPAIR_SIGNAL_RE =
	/error|exception|traceback|failed|invalid|cannot|unable|missing|not found|wrong|instead|avoid|fix|encoding\s*[=:]|errors\s*=|utf-?8|gbk|gb18030|latin-1|\brb\b|except|skip/i;

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

function approvedAssetIds() {
	const set = new Set();
	for (const r of readJsonl(EVO_REVIEW)) {
		if (r && typeof r.state === 'string' && r.state.toLowerCase().includes('approv') && r.assetId) {
			set.add(r.assetId);
		}
	}
	return set;
}

/** 与 evolver-bridge 同源：approved + 修法守卫，输出 [{id, assetId, category, text}] */
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
		out.push({ id: g.id, assetId: aid || '', category: g.category || 'repair', text: text.slice(0, 600) });
	}
	return out;
}

function registerHit(n, note) {
	const list = recallList();
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
	const list = recallList();
	console.log(`[Evolver 经验库] 基因总数=${all.length} | 已审核=${approved.size} | 守卫通过=${list.length}`);
	if (list.length === 0) {
		console.log('经验库当前无可召回修法。首次运行属正常；失败修复后会自动入库（distill + approve）。');
		return;
	}
	console.log('以下为已验证修法，与本任务相关时优先采用；任务结束时若实际采用，请执行：');
	console.log(`  node ${path.basename(process.argv[1])} --register-hit <N> --note "<任务一句话>"`);
	console.log('');
	list.forEach((it, i) => {
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
