# Pi × EvoX Lab — 给编码智能体装上「经验继承」闭环

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg) ![Node](https://img.shields.io/badge/node-%E2%89%A5%2022-brightgreen) ![Pi 0.74.2 / Evolver 2.0.30](https://img.shields.io/badge/tested-pi%200.74.2%20%C2%B7%20evolver%202.0.30-blue) ![Upstream issues](https://img.shields.io/badge/upstream%20issues%20filed-5-orange)

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

## 五条实证方法论结论（摘要）

1. **注入通道可能只传标签不传修法**——自建策略注入层是闭环生效的前提；
2. **可靠陷阱必须是「环境必然失败」**（而非「模型可能犯错」）；
3. **注入内容质量是决定变量**——只注入标签比不注入更差（+36pp）；
4. **token 指标必须配对解读**（重复执行基线 ≈ -22%）；
5. **守卫把继承从「运气」变「机制」**。

> 完整论证、数据与逐条出处见 [`SKILL.md`](SKILL.md) 与 [`docs/experiment-report.md`](docs/experiment-report.md)（避免两处维护重复内容）。

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
├── SKILL.md                     # Agent Skill 封装（一句话跑闭环实验）
├── code/
│   ├── pi_evolve.mjs            # 一站式闭环编排器（R1 陷阱 → 适配 → 蒸馏 → 审核 → 注入 → R2 对比）
│   ├── evolver-recall.mjs       # 召回 + 命中登记（唯一实现：审核门控 + 修法/叙述守卫 + 对靶 top-N）
│   ├── light-cli.mjs            # 内置零依赖后端 CLI：distill / approve / quarantine / list / info（含内容去重）
│   ├── evolver-bridge.ts        # 宿主原生扩展样例：启动钩子动态注入已审核修法（含质量守卫）
│   ├── pi_session_adapter.js    # 会话轨迹 → generic-chat transcript 适配器（含 is_error 契约修复）
│   ├── engine/                  # 内置引擎（light）：distill / ledger / store（基因与台账的零依赖实现）
│   ├── metrics_collect.mjs      # 运维度量：基因数 / 已审核 / 隔离 / 命中 / recall 调用数
│   ├── distill_sessions.mjs     # 生产会话蒸馏：直读宿主会话存储 → 参数差异抽取 → 两级门落库
│   ├── evox-weekly.sh           # 周常包装（度量 + 蒸馏提交 + 候选报告）
│   ├── setup.sh                 # 一键初始化（库目录 / 首个修法 / 自检）
│   └── sum_tokens.js            # 跨轮 token / 工具调用 / 错误数聚合
├── traps/                       # 确定性陷阱生成器（含一个「失败陷阱」样本作反面教材）
├── examples/                    # 任务文本样例
├── exp/                         # 陷阱模板与回归用 fixture
└── docs/
    ├── experiment-report.md     # 完整实测报告（含每一步的失败与排查）
    ├── adapter-design.md        # 适配器设计草案 + 宿主 Extensions API 预研
    ├── other-agents.md          # 其他 Agent 宿主接入指南
    ├── providers.md             # Provider 配置
    └── security-and-license.md  # 安全与许可全文
```

> **运维与度量**：本仓库在 `code/` 下附带 3 个零依赖运维脚本（`metrics_collect.mjs` / `distill_sessions.mjs` / `evox-weekly.sh`）与周常 cron 接线，用于观测「经验继承」是否真正生效。详见 [`SKILL.md` 的「运维与度量」小节](SKILL.md#运维与度量ops)。

## 快速开始

依赖：**Node ≥ 22**（召回/沉淀零 npm 依赖）；流程 C 实验另需一个 OpenAI 兼容 LLM key、Pi CLI（随 `npm install` 可选安装）与 Python 3（陷阱生成器）。

```bash
# 0.（可选）安装上游依赖——仅流程 C 实验（Pi CLI）或启用 evolver 集成时需要；A/B 流程可跳过
npm install   # 即 @earendil-works/pi-coding-agent@0.74.2 + @evomap/evolver@2.0.30

# 1. 生成确定性陷阱 fixture（无效 UTF-8 字节）
python traps/make_encoding_trap.py

# 2. 一条命令跑完整闭环（R1 踩坑 → 内置引擎蒸馏 → 审核 → 修法注入 → R2 避坑 → 跨轮对比）
export AGNES_CN_API_KEY="<your-key>"   # 你的 OpenAI 兼容 key
# （可选）LLM 精修端点——未配置时 --llm-refine 自动禁用（外发必须显式授权）
export EVOLVER_REFINE_URL="https://<你的端点>/v1/chat/completions" EVOLVER_REFINE_MODEL="<model>"
node code/pi_evolve.mjs <含陷阱data的模板目录> <任务文本文件> \
    --provider agnes-cn --model agnes-2.5-flash \
    --api-key "$AGNES_CN_API_KEY" --rounds 2 --fresh --auto-approve --llm-refine
```

关键开关：`--fresh`（备份并清空资产库，保证单变量）、`--auto-approve`（跳过人工审核门，默认**保留人工审核**）、`--llm-refine`（蒸馏摘录无修法信号时自动 LLM 重写）、`--ext-inject`（改用 Pi 原生扩展钩子注入）。


## FAQ

常见问题（空库、`$ENV` 插值、`--fresh` 恢复、国内镜像、Node 版本）见 [SKILL.md 的 FAQ 节](SKILL.md)。
## 引用与文档

- 其他 Agent 宿主接入指南：[docs/other-agents.md](docs/other-agents.md)（Claude Code / IDE / 自建智能体的注入模式）

- 完整实验过程（包括踩过的坑：注入缺口、BOM 陷阱失效、蒸馏质量方差、官方 cycle 路线 fail-closed）：[`docs/experiment-report.md`](docs/experiment-report.md)
- Pi Extensions API 预研与适配器设计：[`docs/adapter-design.md`](docs/adapter-design.md)

## 致谢（Acknowledgements）

本项目**不是**任何上游项目的一部分，也不代表它们各自的官方观点——它是一个独立的研究 Harness，站在一批优秀开源项目与公开方法论的肩膀上。

### 一、上游引擎与宿主

| 上游项目 | 在本研究中的角色 |
|---|---|
| **[pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)**（0.74.2 起） | 被测的极简编码智能体。任务执行、session 格式、`before_agent_start` 扩展钩子均来自它；其包内 `docs/extensions.md` 是本机权威资料。 |
| **[@evomap/evolver](https://www.npmjs.com/package/@evomap/evolver)**（2.0.30） | GEP（Genome Evolution Protocol）自进化引擎：Gene/Capsule/EvolutionEvent 资产模型、`ingest --distill → review → inject` 链路、fail-closed 审核治理。感谢其严格的治理设计，使"发现缺口"成为可能。 |

**本研究回馈给上游的缺口清单**（均已提交为官方 issue，详见报告对应章节）：
1. `evolver inject session-start` 只输出基因 summary 标签，不携带可执行的 `strategy` 字段——修法无法抵达下一轮（§16.1）→ [EvoMap/evolver#624](https://github.com/EvoMap/evolver/issues/624)
2. auto-distill 的 strategy 摘录偏向 session 末尾成功叙述，且在关键信息处截断，质量随错误密度波动（§20.3）→ [EvoMap/evolver#625](https://github.com/EvoMap/evolver/issues/625)
3. `evolver cycle` 的 execute/verify 对全部 runtime fail-closed（设计内），Pi 不在 runner 白名单（§19）→ [EvoMap/evolver#627](https://github.com/EvoMap/evolver/issues/627)
4. 适配器契约缺口：generic-chat transcript 需显式 `is_error` 标志才能产生 strong 信号（§13，已在本仓库 adapter 中修复）→ [EvoMap/evolver#626](https://github.com/EvoMap/evolver/issues/626)
5. pi 侧编排 DX 两则：models.json `$ENV` 插值不生效（401 字面量）+ `./package.json` 未导出 → [earendil-works/pi#9258](https://github.com/earendil-works/pi/issues/9258)

### 二、方法论与评测参考

| 参考 | 借鉴之处 |
|---|---|
| **[Palantir Ontology](https://www.palantir.com/docs/foundry/ontology/overview)** | 概念层的参照系："语义层让你*读*业务，运营本体让你*运营*它"。其「**动作门控写 · 审计每次尝试 · 回写权威源**」三件套与本项目的「审核门控注入 · 召回/命中埋点 · 经验库单一真源」逐条对应；正是这个对照让我们把「**回写（write-back）缺失**」识别为结构性缺口。 |
| **[gura105/operational-ontology](https://github.com/gura105/operational-ontology)**（MIT） | 上述理念的**最小可运行参考实现**。研读其 `src/core.ts` 与示例（`defineObject`/`defineLink`/`defineAction` + `preconditions` + `reject(code)` + `writeback`），作为「规则内置于动作、拒绝可被机器读取」的对照样本。 |
| **[fstech-digital/operational-ontology-framework](https://github.com/fstech-digital/operational-ontology-framework)** | 公开治理模型：**Data → Logic → Action → Evidence → Write-back** 纵向链条、Pin/Spec/Handoff/Facts 四类状态物，以及一份**反模式清单**（我们将其当自检表用）。 |
| **[Leading-AI-IO/palantir-ontology-strategy](https://github.com/Leading-AI-IO/palantir-ontology-strategy)** | 开源专著：把本体论讲成「名词（对象）与动词（动作）的统合 + 分支与评审的治理」；"从只能看的数据，转向直接驱动业务的数据"与本研究"从记录经验，转向驱动下一轮行为"同源。 |
| **[ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd)** | 多平台智能体行为约束项目。借鉴两点：**工程组织方式**（同一规则面向多宿主做薄适配层，与本项目「一个实现 + 多个薄钩子」同构）与 **`evals/` 盲评评测体系**（多维度 rubric + 多次试验 + 加权）；其**发布门设计教训**（绝对化规则会让门永不可通过）也被用来复查自家守卫是否过严。 |
| **论文 *From Procedural Skills to Strategy Genes***（arXiv:2604.15097，EvoMap） | 提供「紧凑 Gene 优于冗长 Skill」「失败经验的最佳形态是极度蒸馏后的独立 **AVOID** 警告」两条结论的量化依据（4,590 次受控实验）。本项目独立实测与之同向，据此保留了对**注入内容质量**的高优先关注。 |

> 以上均为**研读与对照**：本项目与它们均无隶属关系，也不代表其观点；本仓库实现均为原创，默认后端是 MIT 的内置引擎。

如果本研究对你的工作有帮助，也请给上面这些项目点 star——它们是真正的主角。

## 项目状态（2026-09-18）

| 项 | 状态 |
|---|---|
| 当前版本 | 0.14.3（版本轨迹：0.3.0 首发 → 0.14.3） |
| 引擎 | 默认内置 light 引擎（零 npm 依赖，MIT）；evolver 为可选集成 |
| 召回 | 唯一实现 `evolver-recall.mjs`：审核门控（台账 **last-write-wins**）+ 修法/叙述双守卫 + **对靶 top-N** |
| 生产蒸馏 | `distill_sessions.mjs` 直读宿主会话存储，按**参数差异**抽取修法；两级门（低风险自动批 / 其余进候选报告）+ **内容去重** |
| 自动召回 | 宿主原生钩子接入已落地（bootstrap 类与 `pre_llm_call` 类各一），端到端实测"会话有历史后即为真对靶" |
| ClawHub | moderation **clean**；clawscan 剩余 findings 均为功能固有（已文档化） |
| skillhub | TRACE「优秀」；科恩实验室 **benign**；云鼎剩余 1 项动态检测（密钥形态值出现在运行输出——LLM 工具普遍特征，已做全局输出脱敏，详见安全文档） |
| 上游 | 4+1 项缺口已提交官方 issue（evolver #624-#627、pi #9258）；核心运行时不依赖其回应 |

**0.14.3 本版要点**：① 召回侧修复「**隔离（quarantine）无法撤销已批准**」——台账改为按 assetId 的**最后一条状态**判定（last-write-wins）② 新增**叙述守卫**，把会话旁白/推理流水式文本挡在注入之外 ③ `distill_sessions.mjs` 由「诊断脚本」升级为**真实蒸馏适配器**（失败/重试的**参数差异**抽取 + 两级门 + 候选报告）④ `light-cli distill` 增加**内容去重**（重复沉淀不再堆积，也不会把已批准资产的审核状态打回）⑤ 召回新增**对靶 top-N**（与任务无关即不注入）。

## 许可提示

**本包为 MIT 全栈**（默认后端是内置 light 引擎，零外部依赖）。[@evomap/evolver](https://www.npmjs.com/package/@evomap/evolver)（GPL-3.0-or-later）为**可选集成**，仅在你主动安装并使用 `--engine evolver` 时涉及。[pi-coding-agent](https://github.com/earendil-works/pi) 为 MIT，仅流程 C 实验需要。

## License

MIT — 见 [LICENSE](LICENSE)。实验基于 pi-coding-agent 与 @evomap/evolver，其各自许可适用于对应组件；本仓库代码与文档仅覆盖本研究原创部分。
