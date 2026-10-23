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

/**
 * 审核态判定（0.31 新增，本文件自带一份 —— 桥是**单文件拷贝部署**到 ~/.pi/agent/extensions/，
 * 不能 import 兄弟模块）。语义必须与 `engine/light/store.mjs` 的 isApprovedState 一致：
 * 仅 `approved` 为真，未知/畸形 false（fail-closed）。
 *
 * 为什么不能用子串匹配：旧写法 `state.toLowerCase().includes("approv")` 会把
 * "unapproved" / "disapproved" 也判为已批准 ⇒ 被明确撤销/拒绝的基因仍被注入 system prompt
 * （ClawHub clawscan 在 0.30.0 上点名，我方实测确认）。
 */
function isApprovedState(state: unknown): boolean {
	return typeof state === "string" && state.trim().toLowerCase() === "approved";
}

/** 读取 review.jsonl 台账「每个 assetId 的最后一条状态」，返回 state=approved 的集合（尊重审核门）。
 *  修复（2026-09-17，与 evolver-recall.mjs 同步）：旧实现只要台账历史上出现过 approved 就计入，
 *  导致 quarantine 无法撤销已批准 —— 被隔离的基因仍会被注入。追加式台账必须 last-write-wins。
 *  修复（0.31）：子串匹配改为 isApprovedState 精确比对。 */
function approvedAssetIds(): Set<string> {
	const latestState = new Map<string, string>();
	try {
		for (const [idx, line] of fs.readFileSync(EVO_REVIEW, "utf8").split("\n").entries()) {
			const s = line.trim();
			if (!s) continue;
			try {
				const r = JSON.parse(s);
				if (r && typeof r.assetId === "string" && r.assetId && typeof r.state === "string") {
					latestState.set(r.assetId, r.state);
				}
			} catch (err) {
				console.error(
					`[pi-evox] 警告：review.jsonl 第 ${idx + 1} 行不是合法 JSON，已跳过（原因：${(err as Error).message}）`,
				);
			}
		}
	} catch {
		/* review.jsonl 不存在 → 空集合 */
	}
	const approved = new Set<string>();
	for (const [assetId, state] of latestState) {
		if (isApprovedState(state)) approved.add(assetId);
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
 * 叙述检测（2026-09-17 新增，与 evolver-recall.mjs 同步）：auto-distill 摘录常是
 * 「会话旁白/推理流水」而非可执行修法（实测："Now I understand the context… let me…" 且被截断）。
 * 这类文本含 gbk/error 等词能通过 REPAIR_SIGNAL_RE，但对下游无执行价值；自动召回下会被
 * 每个会话稳定注入 ⇒ 放大噪声。只检查首段（旁白开场必在 strategy[0] 开头），命中即不注入。
 */
const NARRATION_RE =
	/^\s*(now i (understand|see|have|know|remember|need|can)|let me\b|i'?(ll|ve|m)\b|i will\b|here'?s\b|done[.!\u2026]|confirmed[:.]|the output matches|to summarize|summarize\b|first,? i\b|next,? i\b|alright\b|okay\b)/i;

function isNarrationLike(text: string): boolean {
	return NARRATION_RE.test(text);
}

/**
 * 注入守卫（0.31 新增，桥自带的**精简版**）。
 *
 * 背景：完整扫描器在 `code/injection_scan.mjs`，但桥是单文件拷贝部署，无法 import 它；
 * 而文档（SKILL.md / advanced.md）声称注入守卫覆盖「召回」——桥正是召回通道之一，此前缺位，
 * 被 ClawHub clawscan 点名（"appends accepted strategies without the advertised injection guard"）。
 *
 * 取舍：这里只保留**语境无关**的高危特征（指令覆盖 / 角色劫持 / 伪造角色标记 / 诱导泄漏提示 /
 * 隐匿行为 / 零宽字符 / base64 大块）。需区分 AVOID「警告」语境的动作类模式（rm -rf 等）
 * **不在此列** —— 单文件版无法可靠切分 AVOID/FIX 语境，纳入会误杀正常基因；
 * 那部分仍由 recall / import / export 路径上的完整扫描器负责。
 */
const BRIDGE_INJECTION_RE: RegExp[] = [
	// 指令覆盖（中英；中文用白名单式放宽，覆盖插入常见程度副词的变体）
	/忽略((之前|上面|以上|先前|前述)?(的)?(所有|一切|全部)?(的)?|(系统|原有|初始)(的)?)(指令|指示|规则|要求|约束)|ignore (all )?(previous|prior|above|earlier) (instructions|prompts|rules)/i,
	/disregard (all )?(previous|prior|earlier)|forget (everything|all) (above|before)/i,
	// 角色劫持 / 伪造标记
	/你现在是|从现在起你是|you are now|act as (a )?(different|new) (ai|assistant|model)/i,
	/^\s*(system|assistant|user)\s*:/im,
	// 诱导泄漏 system prompt
	/(输出|显示|告诉我|reveal|print|show).{0,10}(你的)?(系统提示|system prompt|指令|instructions)/i,
	// 隐匿行为
	/不要(告诉|告知|让).{0,10}(用户|对方)|(don'?t|do not) tell (the )?user|silently|隐蔽地|静默(执行|上传)/i,
	// 混淆
	/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/,
	/\b[A-Za-z0-9+/]{40,}={0,2}\b/,
];

function isInjectionLike(text: string): boolean {
	return BRIDGE_INJECTION_RE.some((re) => re.test(text));
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
		for (const [idx, line] of fs.readFileSync(EVO_GENES, "utf8").split("\n").entries()) {
			const s = line.trim();
			if (!s) continue;
			let g: any;
			try {
				g = JSON.parse(s);
			} catch (err) {
				console.error(
					`[pi-evox] 警告：genes.jsonl 第 ${idx + 1} 行不是合法 JSON，已跳过（原因：${(err as Error).message}）`,
				);
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
			if (isNarrationLike(String(strategy[0] ?? "").trim())) continue; // 叙述守卫：旁白开场 → 不注入
			if (isInjectionLike(text)) continue; // 注入守卫（0.31）：命中注入特征 → 不注入
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
