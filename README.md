# Pi × EvoX Lab — 给编码智能体装上「经验继承」闭环

> Turn one agent's failures into the next run's head start — measured, not vibes.
>
> 一个把 **Pi（极简编码智能体）的任务执行轨迹**接入 **Evolver（GEP 自进化引擎）**、并通过受控实验量化「经验继承收益」的完整 Harness 与实证报告。

**一句话结论**：在确定性陷阱任务上，把「已验证修法」注入下一轮 system prompt，可复现地带来 **token -55.3%（扣除重复执行基线后净收益约 -30pp）**、**陷阱特异错误 11→4**；该结论跨陷阱类别（编码/数据格式）与跨模型（agnes-2.5-flash / deepseek-v4-flash）复现。

---

## 为什么值得看

Agent 自进化（self-evolving agents）领域概念多、实证少。本项目不做概念堆叠，而是用**受控实验**回答三个问题：

1. **继承真的有效吗？** —— 有效，但前提苛刻（见结论 3）。
2. **瓶颈在哪？** —— 不在链路，在两处隐蔽缺口（见结论 1、2）。
3. **怎么把它变成机制保证而非运气？** —— 守卫 + LLM 重写（见结论 5）。

## 五条实证方法论结论（均 [A] 级实证，非推断）

| # | 结论 | 出处 |
|---|---|---|
| 1 | **注入通道可能"只传标签不传修法"**：`evolver inject session-start` 只输出基因的 summary 标签，丢弃可执行 strategy——修法从未抵达下一轮。自建策略注入层是闭环生效的前提。 | 报告 §16.1 |
| 2 | **可靠陷阱必须是「环境必然失败」**（无效 UTF-8 字节、非法 JSON——任何实现都必然撞上），而非「模型可能犯错」（BOM、`int("120.0")`——对 capable model 命中率 0/3 且随模型升级漂移）。 | 报告 §15/§17.2 |
| 3 | **注入内容质量是决定变量**：只注入标签 = +36pp（比不注入更差）；注入成功总结型叙述 = 同样无效；只有含具体修法的 strategy 才有净收益。 | 报告 §17.3/§20 |
| 4 | **token 指标必须配对解读**：重复执行同一任务本身就有 ≈ -22% 的学习效应基线；无对照的 R1→R2 token 降幅不能归因于继承。错误指标应使用陷阱特异信号（如 `UnicodeDecodeError` 计数）。 | 报告 §17.3 |
| 5 | **守卫把继承从"运气"变"机制"**：蒸馏摘录质量随 session 错误密度随机波动（0/3 ↔ 2/2）；用修法信号词守卫过滤 + LLM 重写兜底，噪声绝不注入。 | 报告 §21 |

## 关键实验数据

同一 GBK 陷阱（无效 UTF-8 字节）、同一模型（agnes-2.5-flash）、同任务，注入通道为唯一变量：

| 注入通道 | N | 陷阱错误 R1→R2 | token Δ 均值 |
|---|---|---|---|
| 只注入标签（官方默认行为） | 5 | 4→6（无收益） | +13.8% |
| **策略注入（本项目）** | 5 | **11→4** | **-55.3%** |
| 策略注入（Pi 原生扩展钩子） | 3 | 受蒸馏质量方差影响 | 守卫后与 CLI 等价 |

跨陷阱与跨模型复现见报告 §17/§18：非法 JSON 陷阱 14→3（3/3 避坑）、deepseek-v4-flash 9→5（3/3 方向性避坑）。

## 仓库结构

```
├── SKILL.md                 # Agent Skill 封装（一句话跑闭环实验）
├── code/
│   ├── pi_evolve.mjs        # 一站式闭环编排器（Pi R1 → 适配 → 蒸馏 → 审核 → 策略注入 → Pi R2）
│   ├── pi_session_adapter.js# Pi session v3 → generic-chat transcript 适配器（含 is_error 契约修复）
│   ├── evolver-bridge.ts    # Pi 原生扩展：before_agent_start 动态注入已审核修法（含质量守卫）
│   └── sum_tokens.js        # session token/工具调用/错误数聚合
├── traps/                   # 确定性陷阱生成器（含一个「失败陷阱」样本作反面教材）
├── examples/                # 任务文本样例
└── docs/
    ├── experiment-report.md # 21 节完整实测报告（含每一步的失败与排查）
    └── adapter-design.md    # 适配器设计草案 + Pi Extensions API 预研
```

## 快速开始

依赖：Node ≥ 22、Git Bash（Windows 下）、一个 OpenAI 兼容 LLM key、Python 3（仅陷阱生成器需要）。

```bash
# 1. 安装上游依赖（Pi + Evolver，版本为实测版本）
npm install   # 即 @earendil-works/pi-coding-agent@0.74.2 + @evomap/evolver@2.0.30

# 2. 生成确定性陷阱 fixture（无效 UTF-8 字节）
python traps/make_encoding_trap.py

# 2. 一条命令跑完整闭环（R1 踩坑 → 自动蒸馏 → 审核 → 修法注入 → R2 避坑 → 跨轮对比）
export AGNES_CN_API_KEY=sk-...   # 你的 OpenAI 兼容 key
node code/pi_evolve.mjs <含陷阱data的模板目录> <任务文本文件> \
    --provider agnes-cn --model agnes-2.5-flash \
    --api-key "$AGNES_CN_API_KEY" --rounds 2 --fresh --auto-approve --llm-refine
```

关键开关：`--fresh`（备份并清空资产库，保证单变量）、`--auto-approve`（跳过人工审核门，默认**保留人工审核**）、`--llm-refine`（蒸馏摘录无修法信号时自动 LLM 重写）、`--ext-inject`（改用 Pi 原生扩展钩子注入）。

## 引用与文档

- 完整实验过程（包括踩过的坑：注入缺口、BOM 陷阱失效、蒸馏质量方差、官方 cycle 路线 fail-closed）：[`docs/experiment-report.md`](docs/experiment-report.md)
- Pi Extensions API 预研与适配器设计：[`docs/adapter-design.md`](docs/adapter-design.md)

## 立足于两个上游项目（Acknowledgements）

本项目**不是** Pi 或 Evolver 的一部分，也不代表其官方观点——它是一个独立的研究 Harness，站在两个优秀开源项目的肩膀上：

| 上游项目 | 在本研究中的角色 |
|---|---|
| **[pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)**（Pi, 0.74.2） | 被测的极简编码智能体。任务执行、session v3 格式、`before_agent_start` 扩展钩子均来自 Pi；其包内 `docs/extensions.md` 是本机权威资料。 |
| **[@evomap/evolver](https://www.npmjs.com/package/@evomap/evolver)**（Evolver, 2.0.30） | GEP（Genome Evolution Protocol）自进化引擎：Gene/Capsule/EvolutionEvent 资产模型、`ingest --distill → review → inject` 链路、fail-closed 审核治理。感谢其严格的治理设计，使"发现缺口"成为可能。 |

**本研究回馈给上游的缺口清单**（详见报告，欢迎引用为 issue 素材）：
1. `evolver inject session-start` 只输出基因 summary 标签，不携带可执行的 `strategy` 字段——修法无法抵达下一轮（§16.1）。
2. auto-distill 的 strategy 摘录偏向 session 末尾成功叙述，且在关键信息处截断，质量随错误密度波动（§20.3）。
3. `evolver cycle` 的 execute/verify 对全部 runtime fail-closed（设计内），Pi 不在 runner 白名单（§19）。
4. 适配器契约缺口：generic-chat transcript 需显式 `is_error` 标志才能产生 strong 信号（§13，已在本仓库 adapter 中修复）。

如果本研究对你的工作有帮助，也请给上面两个上游项目点 star——它们是真正的主角。

## License

MIT — 见 [LICENSE](LICENSE)。实验基于 pi-coding-agent 与 @evomap/evolver，其各自许可适用于对应组件；本仓库代码与文档仅覆盖本研究原创部分。
