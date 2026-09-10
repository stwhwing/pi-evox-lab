/**
 * evolver-bridge.ts — Pi × EvoX 经验继承扩展（本文件即随 skill 分发的激活版）
 *
 * 作用：把 Evolver 资产库（~/.evomap/assets）中「已审核基因的 strategy」
 * 通过 Pi 原生钩子动态工作：
 *   - before_agent_start：链式注入修法（透明标注，无隐蔽指令）
 *   - tool_result：失败点教学（isError 时对靶附加修法提示，不隐瞒失败）
 *
 * 部署：放入 ~/.pi/agent/extensions/（全局）或 .pi/extensions/（项目本地）即自动发现；
 *   pi -e ./evolver-bridge.ts 仅快速测试。留痕：~/.evomap/assets/bridge-last-inject.txt（时间戳+内容，无路径）。
 *
 * 对应 API（pi 0.74.2 包内 docs/extensions.md）：
 *   pi.on("before_agent_start") → return { systemPrompt } 链式修改 / { message } 注入持久化消息
 *   pi.on("tool_call") 可拦截、pi.on("tool_result") 可改写 —— 硬约束通道（本次未启用）
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const EVO_STORE = path.join(os.homedir(), ".evomap", "assets");
const EVO_GENES = path.join(EVO_STORE, "genes.jsonl");
const EVO_REVIEW = path.join(EVO_STORE, "review.jsonl");

/** 读取 review.jsonl 中 state=approved 的 asset_id 集合（尊重审核门） */
function approvedAssetIds(): Set<string> {
	const approved = new Set<string>();
	try {
		for (const line of fs.readFileSync(EVO_REVIEW, "utf8").split("\n")) {
			const s = line.trim();
			if (!s) continue;
			try {
				const r = JSON.parse(s);
				if (r && typeof r.state === "string" && r.state.toLowerCase().includes("approv") && r.assetId) {
					approved.add(r.assetId);
				}
			} catch {
				/* 跳过坏行 */
			}
		}
	} catch {
		/* review.jsonl 不存在 → 空集合 */
	}
	return approved;
}

/**
 * 注入质量守卫：strategy 必须命中「修法信号词」才注入——宁缺毋滥。
 * 规则已在 4 个真实历史样本上验证（§16 gbk修法✓ / §17 容错修法✓ / §20 成功总结✗ / §18 gb18030叙述✓）。
 * 背景：auto-distill 摘录质量随 R1 错误密度波动（§20），无修法的"成功总结"注入=§11 净开销。
 */
const REPAIR_SIGNAL_RE =
	/error|exception|traceback|failed|invalid|cannot|unable|missing|not found|wrong|instead|avoid|fix|encoding\s*[=:]|errors\s*=|utf-?8|gbk|gb18030|latin-1|\brb\b|except|skip/i;

function isRepairLike(text: string): boolean {
	return REPAIR_SIGNAL_RE.test(text);
}

/**
 * 读取已审核基因的 strategy 文本。
 * TODO(Route A.2 对靶匹配)：按 gene.signals_match 与当前 prompt/cwd 的信号交集过滤，
 * 只注入对靶基因——避免 §11 实证的「基因不对靶时注入是净开销（+33%）」。
 */
function loadApprovedStrategies(): string[] {
	const out: string[] = [];
	const approved = approvedAssetIds();
	try {
		for (const line of fs.readFileSync(EVO_GENES, "utf8").split("\n")) {
			const s = line.trim();
			if (!s) continue;
			let g: any;
			try {
				g = JSON.parse(s);
			} catch {
				continue;
			}
			const strategy = g && Array.isArray(g.strategy) ? g.strategy : null;
			if (!strategy || strategy.length === 0) continue;
			const aid = g.asset_id;
			// fail-closed（安全修复，2026-09-10）：审核台账不可用或基因未 approved → 一律跳过。
			// 旧逻辑 "approved.size > 0 &&" 在台账缺失时会退化为全量采纳（fail-open），
			// 把未审核基因注入 system prompt；与 evolver 官方 fail-closed 治理语义不符。
			if (!aid || !approved.has(aid)) continue;
			const text = strategy.join(" ").slice(0, 1200);
			if (!isRepairLike(text)) continue; // 守卫：无修法信号词 → 不注入
			out.push(`- [${g.category || "repair"}] ${text}`);
		}
	} catch {
		/* genes.jsonl 不存在 → 无注入 */
	}
	return out;
}

export default function evolverBridge(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, _ctx) => {
		const strategies = loadApprovedStrategies();
		if (strategies.length === 0) return; // 空资产库 → 零注入（fail-open 优雅降级）

		const block =
			"\n\n---\n[Evolver inherited fixes] The following validated fixes were injected from your experience store (evolver). Apply them when relevant. ---\n" +
			strategies.join("\n");

		// 注入留痕（[A] 证据）：-p 模式下 TUI 不可见，落 sidecar 文件供实验核验
		try {
			fs.writeFileSync(
				path.join(EVO_STORE, "bridge-last-inject.txt"),
				// 隐私：仅时间戳 + 注入内容，不含 cwd / 项目路径（SkillSpector finding 修复）
				`[${new Date().toISOString()}]\n${block}`,
			);
		} catch {
			/* 留痕失败不影响注入 */
		}

		// 链式修改 system prompt（软提示通道；与 --append-system-prompt 等价但每轮动态、无需编排器）
		return { systemPrompt: event.systemPrompt + block };

		// TODO(Route A.3 硬约束通道，设计决策待定)：
		//   pi.on("tool_call") 拦截 + 改写（如对 data/*.jsonl 的读自动加 encoding）
		//   —— 能力上可 100% 避坑，但偏离 GEP「prompt governance 而非行为劫持」哲学，需先定原则
	});
}
