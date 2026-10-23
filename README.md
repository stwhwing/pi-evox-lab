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

## 诚实边界（先说清楚，避免误读）

- **供给密度低是真实约束**：在生产真实会话里，能被**自动**抽取成"干净修法对"的样本密度很低（实测 `distillablePairs=0`）。当前基因库主要来自**人工 / 引导式沉淀** —— 因此本工具的价值**随沉淀累积**，而不是"装上就自动白捡经验"。正因如此，0.14.4 新增**引导式沉淀**（`light-cli draft --error`：贴原始报错 → 只补 FIX），把沉淀门槛降到最低。
- **注入是软提示**：修法注入到 system prompt，遵从度**与模型相关**；守卫只保证噪声不入库 / 不出库，**不承诺 100% 避坑**。
- **指标必须配对读**：单跑 token 方差可达 ±30%，且重复执行本身带有 ≈ -22% 的学习效应 —— **绝对降幅 ≠ 继承收益**。
- **对靶能力依赖宿主**：各宿主会话存储格式不一，结构化标志（`isError` / `exit_code`）最可靠；只靠文本标记时召回率随宿主而异。

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
    ├── adapter-design.md        # ⚠️ 历史草案（已被现实实现取代，仅存档勿按此集成）
    ├── other-agents.md          # 其他 Agent 宿主接入指南
    ├── providers.md             # Provider 配置
    └── security-and-license.md  # 安全与许可全文
```

> **运维与度量**：本仓库在 `code/` 下附带 3 个零依赖运维脚本（`metrics_collect.mjs` / `distill_sessions.mjs` / `evox-weekly.sh`）与周常 cron 接线，用于观测「经验继承」是否真正生效。详见 [`docs/advanced.md` 的「运维与度量」小节](docs/advanced.md#运维与度量ops)。

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


## 上手与反馈（Getting Started & Feedback）

> **EN**: New here? Run the [5-minute quickstart](examples/quickstart.md) (Node >= 22, zero deps). Feedback: `light-cli feedback "<text>"` or GitHub Discussions. Sharing your setup helps us verify it works in the wild: adoption-report template - registry in ADOPTERS.md.

- **5 分钟体验**：[`docs/one-pager.md`（一分钟判断要不要用，0.30 新增）｜`examples/quickstart.md`](examples/quickstart.md)（Node ≥22，零依赖，全程本地）；
- **项目概览**：[`docs/overview.md`](docs/overview.md)（问题/方案/安全属性/已知局限）；
- **反馈**：`node code/light-cli.mjs feedback "<想说的话>"` 或 [GitHub Discussions](https://github.com/stwhwing/pi-evox-lab/discussions)；
- **实例登记**：用起来了？[提交 adoption-report](.github/ISSUE_TEMPLATE/adoption-report.yml) 或 PR [ADOPTERS.md](ADOPTERS.md)——分享你的部署配置，帮助验证它在真实环境中工作。

## FAQ

常见问题（空库、`$ENV` 插值、`--fresh` 恢复、国内镜像、Node 版本）见 [`docs/faq.md`](docs/faq.md)（SKILL.md 另有高频速览）。
## 引用与文档

- 其他 Agent 宿主接入指南：[docs/other-agents.md](docs/other-agents.md)（Claude Code / IDE / 自建智能体的注入模式）

- 完整实验过程（包括踩过的坑：注入缺口、BOM 陷阱失效、蒸馏质量方差、官方 cycle 路线 fail-closed）：[`docs/experiment-report.md`](docs/experiment-report.md)
- Pi Extensions API 预研与适配器设计：[`docs/adapter-design.md`](docs/adapter-design.md)

## 致谢（Acknowledgements）

本项目**不是**任何上游项目的一部分，也不代表它们各自的官方观点——它是一个独立的研究 Harness，站在一批优秀开源项目与公开方法论的肩膀上。

### 二、理论启发（已读原文并核对）

**[The Universal Weight Subspace Hypothesis](https://arxiv.org/abs/2512.05117)**（Kaushik, Chaudhari, Vaidya, Chellappa, Yuille；arXiv:2512.05117，v1 2025-12-04，v3 2026-10-05）—— 1200+ 个模型（500 Mistral-7B LoRA / 500 ViT / 50 LLaMA-8B）做截断零中心 HOSVD，发现**同一架构内**的不同模型共享低维参数子空间。

它给本项目的启发是**问题意识**，不是结论移植：
- 论文明确把「若网络都塌缩到同一子空间 → **继承共同的偏差、能力与失败模式**、这种缺乏多样性是否构成瓶颈」列为**开放问题**，并指出**跨架构比较尚无方法**——这正是我们做「异构验证（跨源复现）」的出发点。
- 500 个 Mistral LoRA **同基座**（Mistral-7B-Instruct-v0.2）——「共享结构」有多少来自共同检查点，论文自己承认偏离了「共享 θ₀」的理想化条件。**所以「同构风险」在我们的语境下要按「模型 × 版本 × 宿主」联合计算，不能按架构算。**
- **本项目自己的数据**（0.30 实测，N=5/模型，同一确定性 GBK 陷阱）：`deepseek-v4-flash` 5/5 给出正确修法（`encoding='gbk'`），`agnes-3.0-flash` 0/5（3 次默认 utf-8 必失败、2 次用 `'rb'` 绕过=没识别编码），**失败签名一致率 0%**。这与论文的权重空间结论**不是一回事**，是我们的响应级实测。
- **不引用媒体转述**：坊间流传的「16 维 = 智能只需 16 维」「投影后 98–99% 几何误差仍保功能」等说法，在原文中**无法核实**（原文只说「16 个或更少方向集中了大部分信息」，未给方差百分比；投影的定量几何误差不在可核实文本内）——故本项目**不引用**这两个说法。

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
| **[numbat](https://github.com/perplexityai/numbat)**（Perplexity AI，Apache-2.0） | agent 行为审计器（Go 单二进制）——本版 0.18 的 **timeline（四账本取证重建）与 harvest（错误候选→沉淀建议）** 两个命令的方法论直接受其启发：「把账本变成监控录像」「先证明 agent 到底干了什么」。numbat 原生解析 OpenClaw/Claude/Codex 会话日志，可在自有设备上作为 PiEvoX 效果度量的**独立取证后端**（P2 路线）。 |
| **[FlyLoRA](https://arxiv.org/abs/2510.08396)**（NeurIPS 2025，清华大学；[代码](https://github.com/gfyddha/FlyLoRA)） | 权重空间的隐式秩专家（implicit rank-wise MoE）PEFT —— 与本项目（**提示空间**的推理期经验继承）**不在同一层**，因此不是可直接插入的组件；但有两条原理被**显式迁移**：① **负载均衡偏置** —— 本版 0.14.4 的召回打分加入 `-u·sign(c_i − c̄)`（`c_i` = 该基因历史命中数），缓解"高信号重叠的热门基因长期霸榜"；② **免训练合并不干扰** —— 落到提示层即本版的**注入冲突守卫**（选中集合内 `anti_patterns` 互斥者剔除低分项）。其"正交组件合并互不干扰"的判断，与本项目把负经验正交化为 `anti_patterns` 的做法同构。另：其 **FlyHash 式免参数路由**是我们路线图上 **P2（鲁棒召回）** 的参考方向，**当前尚未实现**（诚实标注）。 |
| **[Switch Transformer](https://arxiv.org/abs/2101.03961)**（Fedus et al., 2021） | 上述"**负载均衡偏置**"的思想源头之一 —— MoE 负载均衡以每专家计数 `c_i` 与均值的偏离为据。本项目 P1④ 的加性偏置沿用同一形式（温和封顶，规模未到时恒为 0）。 |

> 以上均为**研读与对照**：本项目与它们均无隶属关系，也不代表其观点；本仓库实现均为原创，默认后端是 MIT 的内置引擎。

如果本研究对你的工作有帮助，也请给上面这些项目点 star——它们是真正的主角。

## 项目状态（2026-10-04）

| 项 | 状态 |
|---|---|
| 当前版本 | 0.31.0（版本轨迹：0.3.0 首发 → 0.25.0 → 0.30.0 → 0.31.0） |
| 引擎 | 默认内置 light 引擎（零 npm 依赖，MIT）；evolver 为可选集成 |
| 让经验真正生效 | 0.16.0 针对「沉淀了却不生效」的四个静默失效：① `info` 显示**闭环健康度**（召回次数/命中/待审 + 下一步命令）② 自己沉淀的基因**默认自动通过**（`config --auto-approve off` 可改回）③ `install-hooks` 自动接线（**默认演练，加 `--yes` 才写入**）④ `starter` 一键装载 10 条通用起步基因 |
| 召回（最后一公里） | 0.15.0 修掉「基因已入库却召回不到」四个断点：① **任务文本清洗**（剥宿主信封前缀/纯URL/心跳样板）② **CJK bigram 分词**（原整段成单 token ⇒ 中文任务与中文基因永不相交）③ **无任务意图不注入**（不再"取最近N条"凑数）④ **注入即登记 + `--negate` 回填**（闭合"注入→有效"漏斗）。私有节点实测有效召回率 **10%** ⇒ 目标 >60% |
| 共享基因库 | 跨实例/跨用户：`distill --shareable` 标记可共享 → `gene submit` 过脱敏闸门入自建池 → 其他实例 `gene import` 幂等拉取（默认 community 待审 / `--tier official` 自建池自动通过）。闸门 fail-closed：私有IP/绝对路径/密钥命中即拦截不出网；项目私有词由本地 `redline.local.json` 补充（不发布） |
| 召回 | 唯一实现 `evolver-recall.mjs`：审核门控（台账 **last-write-wins**）+ 修法/叙述双守卫 + **对靶 top-N** + **负载均衡偏置**（本版新增）+ **注入冲突守卫** |
| 沉淀 | **引导式 `light-cli draft --error`**（本版新增：自动抽信号 + 预填 AVOID + 写 `anti_patterns`，人只补 FIX）+ 手写式 `distill`；内容去重 |
| 生产蒸馏 | `distill_sessions.mjs` 直读宿主会话存储，**只信权威错误标志**（`isError` / 非零 `exit_code`，不再扫正文关键词）；两级门 + 候选报告 |
| 自动召回 | 宿主原生钩子接入已落地（bootstrap 类与 `pre_llm_call` 类各一），并**按宿主记录注入埋点**（`agent` / `targeted` / `injected`） |
| 供给现状（诚实） | 真实生产会话可自动抽取的干净修法对密度低（实测 `distillablePairs=0`）⇒ 基因库主要来自**人工 / 引导式沉淀** |
| ClawHub | moderation **CLEAN**；static-analysis / skillspector 剩余 findings 均为功能固有（已被 moderate=clean 裁决覆盖，已文档化） |
| skillhub | 评测均值 ≈4.54（15 维，0.14.7 版本）；errorHandling / stability / docQuality 均 4.5、usability 4.8；科恩实验室 **benign**；云鼎 suspicious 为 LLM 工具普遍特征（中立声明见下） |
| 上游 | 4+1 项缺口已提交官方 issue（evolver #624-#627、pi #9258）；核心运行时不依赖其回应 |

**0.14.4 本版要点**：① 新增**引导式沉淀** `light-cli draft --error`（自动抽 signals + 预填 AVOID + 写入 `anti_patterns`，未补 FIX 的占位符草稿被守卫拒绝落库）② `anti_patterns` 改为**单 token 字面量**（方案A 词汇对齐），使**注入冲突守卫**真正可触发 ③ 召回新增**负载均衡偏置**（借鉴 FlyLoRA / Switch Transformer 形式，冷门基因不再被热门长期霸榜）④ 新增**按宿主的注入观测**（`recall_calls.jsonl` 记录 `agent` / `targeted` / `injected` / `query`）⑤ **审核语义 last-write-wins 补齐**（`pi_evolve` / `light/store` / `metrics_collect` 三处此前遗漏的读取侧——此前被 quarantine 的基因在部分路径仍会被注入）⑥ 生产蒸馏只信**权威错误标志**（消除 9 例把成功命令误判为失败的噪声）。

**0.14.3 本版要点**：① 召回侧修复「**隔离（quarantine）无法撤销已批准**」——台账改为按 assetId 的**最后一条状态**判定（last-write-wins）② 新增**叙述守卫**，把会话旁白/推理流水式文本挡在注入之外 ③ `distill_sessions.mjs` 由「诊断脚本」升级为**真实蒸馏适配器**（失败/重试的**参数差异**抽取 + 两级门 + 候选报告）④ `light-cli distill` 增加**内容去重**（重复沉淀不再堆积，也不会把已批准资产的审核状态打回）⑤ 召回新增**对靶 top-N**（与任务无关即不注入）。

**0.14.5 / 0.14.6 / 0.14.7 / 0.14.8 本版要点**：
- **0.14.5**：拉升 progressive / antiPatternFaq / boundary 等分项的评测分。
  **EN**: Evaluation-score lift pass (progressive / antiPatternFaq / boundary).
- **0.14.6（内容/UX 版）**：新增 `light-cli doctor` 首次运行自检 + SKILL.md「3 步就绪」；坏行警告补「如何修正」；实验 preflight（Node≥22 / pi≥0.85.1）；新增「何时该沉淀」决策框。
  **EN**: Content/UX release: `light-cli doctor` first-run self-check + SKILL.md 3-step onboarding; bad-line warnings with how-to-fix; experiment preflight (Node>=22 / pi>=0.85.1); deposition decision box.
- **0.14.7（质量版）**：① 统一错误输出（`[pi-evox]` 前缀 + 「→ 修正：」指引 + 一致退出码 0/1/2）；② 坏行警告补**行内容预览**；③ 子进程调用加**可配超时**（`EVOX_CLI_TIMEOUT_MS`，默认 600000）；④ trap 生成器启动前校验 **Python≥3.8**；⑤ 新增 `examples/walkthrough-gbk.md` 端到端走查。
  **EN**: Quality release: unified error output (`[pi-evox]` prefix + fix hints + consistent exit codes 0/1/2); bad-line content preview; configurable subprocess timeout (`EVOX_CLI_TIMEOUT_MS`); trap generator Python>=3.8 check; GBK end-to-end walkthrough.
- **0.14.8（反馈驱动 + 护栏版）**：依据 skillhub 对 0.14.7 的评测（均值 ≈4.54；errorHandling / stability / docQuality 各 4.5、usability 4.8）定向补强——① **召回位置参数护栏**：query 裸传位置参数不再被静默忽略并回落成「注入入库尾部」，现提升为 query 并提示 `--query` 规范写法（消除静默 footgun）；② 反模式速查表新增「**为什么会错**（机制）」列，FAQ 补全可执行命令示例（针对 antiPatternFaq）；③ 新增「**目录与文档导航**」表并厘清 `exp/` 各子目录职责（针对 structure / docQuality）；④ 新增 `examples/walkthrough-json.md` 端到端走查（**数据格式类**陷阱，与 GBK 编码类互补）。
  **EN**: Feedback-driven + guardrails: positional-query guard (no more silent fallback into tail injection); anti-pattern table gains a mechanism column; FAQ executable examples; doc navigation table; JSON walkthrough.

- **0.31.0（安全门加固版）**：
  **中文**：① **审批门子串匹配漏洞修复（P0）**——全仓 **10 处 `approv` + 2 处 `quarantin`** 原先用 `includes('approv')` 判定，`unapproved` / `disapproved` 会被当成已批准 ⇒ 被明确撤销/拒绝的基因仍会被注入 system prompt，甚至进共享池（`gene_share.mjs` 的池导出门危害最大）。现统一改为**精确比对**，判定收敛到单一入口 `store.isApprovedState` / `isQuarantinedState`，未知/畸形状态 fail-closed；② **签名链嵌套内容修复（P0）**——v1 规范化用 replacer 数组做序列化，数组会作用于每一层嵌套，导致嵌套字段被静默丢弃、不在签名域内（改嵌套内容仍验签 `verified`）。现改为**版本化规范化** `sig_v`：v2 递归覆盖嵌套内容，v1 与历史逐字节一致 ⇒ **存量 146 条签名不会集体失效**，可用新增的 `light-cli resign --yes` 升级；③ **注入守卫两处漏检修复（P0）**——a) 扫描器原先把 `FIX:` 之前的文本整体丢弃、不进任何扫描区，「指令覆盖类前缀 + `FIX:` 修法后缀」可绕过注入守卫（ClawHub clawscan 点名的 [T09]，已本地复现）；b) 中文「指令覆盖」正则对动词与指令类名词之间的修饰词限制过死，仅插入一个常见程度副词即不命中；④ **注入守卫补齐到另两条召回通道**——Pi 扩展桥（`evolver-bridge.ts`，单文件部署故内置精简版）与闭环编排器（`pi_evolve.mjs`，用完整扫描器且不静默降级），此前只有 CLI 召回与导入/导出有这道门，而文档声称覆盖「召回」；⑤ **文档与代码一致性**：安全页的"默认人工审核门"改为与实际行为一致（交互式沉淀默认 approved、非 TTY 默认 quarantined）；⑥ **评测还债（低成本项）**：新增 `docs/glossary.md` 术语一页纸（对准 usability 4.5「高级概念学习曲线」）、SKILL.md 新增「T3 报错自动触发」显式小节并把触发词表扩为 6 组、每组给到**可直接复制的具体命令**（对准 trigger 4.8 扣分点）；⑦ **`docs/research.md` 新增 §20**：双陷阱矩阵 + 9 个免费模型补测实测（GBK 9/9 有效样本，其中 6 个稳定 0% 掉坑 ⇒ 陷阱跨模型稳健性再证），并立下**两轴判读纪律**（服务可用性与能力必须分开统计）。
  **EN**: ① **approval-gate substring bug fixed (P0)** - 10 `approv` + 2 `quarantin` sites matched by substring, so `unapproved`/`disapproved` were treated as approved: explicitly revoked/rejected genes still reached the system prompt and even the shared pool (`gene_share.mjs`'s pool-export gate was the worst). Now exact comparison only, funnelled through `store.isApprovedState` / `isQuarantinedState` with unknown/malformed states failing closed; ② **nested content now covered by the signature (P0)** - the v1 canonicalizer passed a replacer array to `JSON.stringify`, which applies to *every* nested level, silently dropping nested fields out of the signing domain (nested edits still verified). Now **versioned canonicalization** (`sig_v`): v2 recursively covers nested content while v1 stays byte-compatible, so the 146 existing signatures do **not** all break; upgrade with the new `light-cli resign --yes`; ③ **two injection-guard false negatives fixed (P0)** - a) the scanner silently dropped the text *before* `FIX:` so an instruction-override prefix plus a `FIX:` suffix bypassed the guard (ClawHub clawscan's [T09], reproduced locally); b) the Chinese override regex was too narrow to match a common intensifier inserted between verb and noun; ④ **injection guard extended to the other two recall channels** - the Pi bridge (`evolver-bridge.ts`, reduced built-in guard because it deploys as a single file) and the closed-loop orchestrator (`pi_evolve.mjs`, full scanner, no silent degradation); previously only CLI recall + import/export had this gate although the docs claimed "recall" coverage; ⑤ **doc/code consistency** - the security page's "manual review by default" now matches actual behaviour (interactive deposits default to approved, non-TTY to quarantined); ⑥ **evaluation debt paid down (low-cost items)** - new `docs/glossary.md` one-pager (usability 4.5: advanced-concept learning curve), an explicit "T3: on-error recall" section in SKILL.md, and the trigger-word table expanded to 6 groups each with a copy-paste command (trigger 4.8 deduction); ⑦ **`docs/research.md` §20 added** - two-trap matrix plus a free-model retest across 9 previously unmeasured models (GBK 9/9 valid samples, 6 of them a stable 0% avoidance => cross-model trap robustness re-confirmed), plus the **two-axis reading rule** (service availability and capability must be counted separately).
- **0.30.0（上手与异构验证版）**：
  **中文**：① **上手路径补两块**：quickstart 新增「宿主接入（一条命令，`install-hooks --auto` 自动探测并给唯一推荐命令）」与「多宿主/多会话并发（文件锁 / 按 gene_id 寻址 / LWW 台账三条机制）」——回应 0.29 评测 usability 扣分；② **「不适用场景」显式化**（docs/overview.md 新增表：跨机同写同库 / 要 100% 避坑 / 实时同步 / 一次性任务 / 把基因库当知识库 / 跨架构直接复用）；③ **溯源自动归因**（deposit/register-hit/negate 自动读 `~/.evomap/source.json` 记录模型与主机，不必改钩子、不必重启）；④ **异构验证实测**（`exp/heterogeneity-probe.mjs` 首次真跑：同一确定性 GBK 陷阱，deepseek-v4-flash **5/5 正确**、agnes-3.0-flash **0/5**，失败签名一致率 **0%** ⇒ 异构兜底真实存在）；⑤ **理论出处致谢**（arXiv:2512.05117 原文核对：其"共享子空间→继承共同失败模式"是**开放问题**，我们做的是响应级实测；媒体转述的"16 维=智能""98–99% 误差仍保功能"**原文不支持，本项目不引用**）；⑥ `docs/one-pager.md` 一页纸（判断要不要用，含信任要素与局限）并挂进导航；⑦ `gene-pull-trust` 池信任分布可见化；⑧ **两个平台的 GBK 陷阱数据修正**（≤0.28 误为 UTF-8，陷阱实际永不触发）。
  **EN**: ① onboarding: quickstart gains "host integration in one command" (`install-hooks --auto` detects and prints the single recommended command) and "multi-host / multi-session concurrency" (file lock, gene_id addressing, LWW ledger) - answering the 0.29 usability deduction; ② explicit "not applicable" scenarios in docs/overview.md; ③ provenance auto-attribution (deposit/hit/negate read `~/.evomap/source.json` automatically - no hook edits, no restarts); ④ first real cross-model measurement (`exp/heterogeneity-probe.mjs`: same deterministic GBK trap - deepseek-v4-flash **5/5 correct**, agnes-3.0-flash **0/5**, failure-signature agreement **0%** => heterogeneous fallback is real); ⑤ theory attribution (arXiv:2512.05117, read at source: its "shared subspace -> shared failure modes" is an **open question**; the media's "16 dims = intelligence" / "98-99% error yet function preserved" are **not supported by the paper** and are not cited here); ⑥ one-pager for the adoption decision; ⑦ pool trust distribution; ⑧ corrected GBK trap data (shipped as UTF-8 in <=0.28, so the trap could never fire).
- **0.29.0（可读性与可验证性版）**：
  **中文**：① **SKILL.md 中英混排治理**（术语首次出现标注一次英文、后文用中文，Q17 完整对照）+ **触发词瘦身**（8+ 收敛为 3 组主词：召回/沉淀/继承，同义词自动折叠）——回应 0.28 评测 usability 扣分；② **规模的量化边界**（docs/overview.md：库规模/上限/注入条数/并发写入/池同步延迟/溯源覆盖，全部标注实测状态，未实测的明确写"未实测"）；③ **CLI 用法分组**（常用 6 条 / 沉淀审核 / 共享池 / 接入规程 / 运维诊断）；④ **溯源与异构验证**：deposit/register-hit/negate 记录 source_model+source_host，report 新增 L4 异源复现率与 negate 根因分布，gene export 打 trust 标签；⑤ exp/heterogeneity-probe.mjs 跨模型错误相关性探针（本机凭据 401/TLS 不通，待有有效 key 时实跑）。
  **EN**: ① mixed CN/EN prose normalised (term defined once, Chinese thereafter) + trigger words trimmed to 3 groups; ② quantified scale boundaries in docs/overview.md (library size / cap / injection count / concurrency / pool sync latency / provenance coverage - measured items marked, unmeasured marked as such); ③ CLI usage grouped (6 daily commands first); ④ provenance & heterogeneity: source_model/source_host on deposit/hit/negate, L4 cross-source reproduction rate + negate cause matrix in report, trust labels on export; ⑤ cross-model error-correlation probe added (blocked locally on credentials - 401/TLS, run when a valid key exists).
- **0.28.0（可召回性版）**：
  **中文**：① **T2「行动前」判定口径补明**（动作未执行 + 有副作用/不可逆 + 本任务首次），并补**多宿主并发同时召回的行为表**（各自独立注入/不共享选择快照/asset_id 去重/审核 LWW）；② **四道安全门细节在 SKILL.md 内自足**（每道门扫什么、命中会怎样，不必跳转 advanced.md）；③ **公开召回打分与阈值数值**（signals 命中 +3、正文 token 交集 +1、负载均衡 ±2、**低于 2 分不注入**）并把并发语义集中到触发点节；④ **召回别名机制**：`aliases.json` 概念表 + `draft --trigger "<动手前措辞>"` 自动展开（英文 canonical + 中文二元词双写）+ 召回时中文 query 映射英文 canonical + `fix-signals` 体检/展开存量无效中文 signal——预防型经验从此能在**动手前**被召回。
  **EN**: ① sharper T2 trigger criteria (before the first irreversible action) + a table of what happens when several hosts recall concurrently; ② the four safety gates are now self-contained in SKILL.md (what each scans, what happens on a hit); ③ **published recall scoring & threshold** (signals hit +3, text-token overlap +1, load-balance bias +/-2, **below 2 points nothing is injected**) with concurrency semantics consolidated; ④ **recall aliasing**: concept table + `draft --trigger` auto-expansion (English canonical + Chinese bigrams) + Chinese queries mapped to English canonicals + `fix-signals` to repair dead Chinese signals - prevention lessons now surface *before* the action.
- **0.27.0（前置检查与可读性版）**：
  **中文**：前置检查与可读性版。① **doctor 新增 Python 3 前置检查**——traps/流程 C 用户得到中文友好提示而非「命令找不到」（0.26 评测在 stability 与 func 两项同时点名）；② **术语对照**：FAQ Q17 中英术语表（ENOENT/EACCES/EBUSY/JSON/POSIX/fail-closed/asset_id/keyid/T1-T5…）由 CLI 错误输出自动引用，普通用户不必离开文档去解码系统错误；③ **模块调用关系图**（advanced.md）+ SKILL.md 明确的「进阶阅读（按需，不必通读）」跳转；④ **timeline 落点自检**：doctor 标记错位账本目录（0.25/0.26 的 HITS_DIR 缺陷类），发版门禁 verify_stages 新增第六项——零配置跑一次 draft 并断言事件落在 <skill>/experiments/（防「环境变量掩盖默认路径缺陷」类问题）；⑤ 携带 store.mjs HITS_DIR 修复上三平台（skillhub/ClawHub 的 0.26.0 副本仍带缺陷——平台禁止同版本重发，本版覆盖）；⑥ **会话围栏**：light-cli.mjs session open "<任务名>" 一步完成 T1 召回+记账（落生产账本），session close "<结论>" 收尾记结论——让召回与沉淀可审计（围栏未配对则构建门禁拒绝构建）。
  **EN**: Preflight & readability release. ① **doctor adds a Python 3 preflight check** - traps/Flow C users get a friendly Chinese hint instead of "command not found" (0.26 evaluation named this under both stability and func); ② **glossary**: FAQ Q17 Chinese-English term table (ENOENT/EACCES/EBUSY/JSON/POSIX/fail-closed/asset_id/keyid/T1-T5...) auto-referenced by the CLI error output, so ordinary users never leave the docs to decode a system error; ③ **module relationship diagram** in advanced.md + explicit "progressive reading" jump links in SKILL.md; ④ **timeline landing self-check**: `doctor` flags misplaced ledger directories (the 0.25/0.26 HITS_DIR defect class) and the release gate `verify_stages` gains a 6th check that runs a zero-config draft and asserts the event lands in `<skill>/experiments/` - preventing the "env var masked the broken default path" class; ⑤ carries the store.mjs HITS_DIR fix to skillhub/ClawHub (their 0.26.0 copies still carry the defect since platforms forbid same-version republish); ⑥ **session fence**: `light-cli.mjs session open "<task>"` performs T1 recall + accounting in one command, `session close "<conclusion>"` records the closing conclusion - recall and sedimentation become auditable (unpaired fences fail build gates). All materials bilingual.
- **0.26.0（可持续性版）**：
  **EN**: Sustainability release - pay down documentation debt, add no new features. ① **anti-pattern status annotations**: every entry in common-mistakes.md now carries 🔧current / ✅fixed markers so historical pitfalls aren't read as live defects; ② **cross-machine handbook** (docs/cross-machine.md): named pools, pull/push/contribute workflow, three-layer concurrency semantics, team-pool structure, troubleshooting table; ③ **deduplication**: SKILL.md quick-list trimmed to the 3 hardest mechanisms, details stay in the catalog; ④ **host compatibility matrix** (8 hosts: claude-code/cursor/codex/agents-md/windsurf/openclaw/hermes/manual); ⑤ **Flow C operational handbook** (research.md: prereqs, three-arm runs, metric definitions, when not to experiment); ⑥ **starter expanded 10 → 20 genes** (cold start); ⑦ full terminal output samples in quickstart. All materials bilingual.
- **0.25.0（可审计的生命周期与量化版）**：
  **EN**: Auditable lifecycle & quantification release: ① **deposit events on the timeline** - draft/distill --commit now writes a deposit event (new ledger type), making deposits auditable; ② **`recall --record "<conclusion>"`** backfills verification results (incl. isolated tests) into the production ledger; ③ **`light-cli report`** weekly effectiveness report (L1 activity / L2 backfill rate / L3 error-family recurrence, --json machine-readable); ④ **license token** (`license issue/verify`, Ed25519-signed, issuer public key shipped in assets/); ⑤ **named pool profiles** (`~/.evomap/pools.json` - `gene pull official`); ⑥ **push-ready hint** in doctor (approved+shareable genes not yet in pool, manual send only); ⑦ **url-guard hook template** (PreToolUse routes content pages through markitdown); ⑧ concurrency semantics expanded to three layers. All materials bilingual.
- **0.24.0（零指导上手与基因分类版）**：
  **EN**: Zero-guidance onboarding & gene categorization release: ① **install section rewritten** - three acquisition paths (git clone / Release zip with sha256 / marketplace one-click on skillhub+ClawHub), explicit "A/B flows need ONLY Node >= 22, zero npm dependencies" up front, skill-location note; ② **official pool mirror URL documented** (`gene pull --pool https://zyx.pink/pool/genes.jsonl --tier official` now discoverable in SKILL.md + quickstart); ③ **scene categorization**: controlled 6-scene vocabulary (ops-deploy / coding-debug / release-publish / api-integration / git-workflow / agent-runtime) activates the dormant category field - all 66 pool genes backfilled (re-signed, 0 signature failures); ④ **`gene pull --scene` / `gene list --scene`** subset filtering; ⑤ quickstart gains a "pull the official pool" step; overview.md documents the scene vocabulary. All materials bilingual.
- **0.23.0（可信度与可采用性版）**：
  **EN**: Credibility & adoptability release: ① **benchmark methodology**: trap experiments gain a long-context baseline arm (`--arm full-context` injects ALL approved genes unfiltered, per community critique that memory systems must be measured against long-context baselines); ② **one-command host integration**: `install <claude-code|cursor|codex|agents-md>` auto-locates host config files (dry-run default, --yes writes); ③ **90-second demo** command (read-only); ④ **gene pool workflow**: `gene pull --pool <path|url>` (file/git-URL auto-detect, signature-verified, official mirror approves) + `gene submit --bundle <file>` (single-file submission package with keyid header); ⑤ pool repo gains CC-BY-4.0 LICENSE + CONTRIBUTING.md; ⑥ IO retry/timeout made visible (doctor shows config, EVOX_IO_RETRY/EVOX_IO_DEADLINE_MS tunable) + bad-line warnings with line numbers and previews; ⑦ SKILL.md gains deployment & distribution section (download paths/host matrix/concurrency semantics); ⑧ internal experiment-phase comment markers cleaned. All materials bilingual.
- **0.22.0（宿主接入与文档版）**：
  **EN**: Release: feedback command + bilingual onboarding docs + gate hardening: ① **`light-cli feedback`** command (local log + Discussions guidance, no telemetry); ② **`examples/quickstart.md`** 5-minute minimal loop (doctor -> starter -> targeted recall -> deposit -> info/timeline); ③ **`docs/overview.md`** project overview (problem/solution/security properties/known limits/credits); ④ **`ADOPTERS.md`** + **GitHub issue templates** (adoption-report + feedback); ⑤ README getting-started section. All materials bilingual. ⑥ **Gate hardening (2026-10-18 review)**: depositionGate now REJECTS AVOID-only half-products (no FIX) - REPAIR_SIGNAL_RE contained the word `avoid` so pit-without-fix strategies passed (3 truncated deposits were all this shape); ⑦ **Pool rebuild now applies safetyGate** (exported) before export - 3 genes with private-identity words were caught by the redline scan at pooling time; shareable marking must pass the gate first (redline word list is stricter than safetyGate).
- **0.21.0（签名与稳定版）**：
  **EN**: Provenance + stability release: ① **Ed25519 gene signing chain** (1.0 criterion) - deposits auto-signed with the machine identity (`~/.evomap/identity/`, private key 0600); pool imports verify signatures (tampered content REJECTED; unsigned legacy accepted); `identity` / `verify` commands. ② **Bounded IO retry with hard deadline** (stability feedback, two rounds) - transient errors only (EBUSY/EPERM/EACCES/ETIMEDOUT), max 3 attempts, 3s deadline, fail-open boundary preserved. ③ **SKILL.md 238 → 224 lines** (progressive feedback): four-gate details moved to advanced, acknowledgements trimmed, new-user reading path added, research.md marked "most users never need to open".
- **0.20.3（审核取证版）**：
  **EN**: Review-with-evidence release (user proposal 2026-10-15): new `light-cli evidence <gene_id>` searches the four local ledgers (tool errors / recalls / injections / back-fills) for events matching the gene's claimed failure and fix - approve only after consistency check; overturned conclusions stay quarantined with an audit note; genes without local evidence (pool/other-machine/starter) are reviewed on content with the source noted. Designed as evidence-FIRST, not an absolute gate.
- **0.20.2（双语完整版）**：
  **EN**: Bilingual-completeness release per the publish skill's clause (ALL docs / FAQ / changelog history, not just summaries): ① SKILL.md every rewritten section now carries an EN block (1 -> 10; still 236 lines); ② `docs/faq.md` 14 items each with an EN brief; ③ `docs/common-mistakes.md` 14 items each with an EN brief; ④ EN blocks restored in `docs/advanced.md` for the moved sections (4 recovered); ⑤ EN intros for research / config-errors / forensics / flow-C walkthrough / other-agents / providers / security / adapter-design / experiment-report / GBK+JSON walkthroughs; ⑥ **README changelog: all 15 history entries now carry an EN line** (7 added).
- **0.20.1（0.20.0 补丁：三轮审查修复）**：
  **EN**: Post-release three-round review (self-review / cross-reference / live re-run) of the 0.20.0 split found and fixed 6 issues the shallow check missed: ① **snippet text still used the pre-0.18 positional `--register-hit <N>`** (code fix - install-snippet users were getting the concurrency-drift form); ②-⑥ five broken cross-references after the split (README ops anchor + FAQ link, adapter-design, forensics-numbat, walkthrough-json). install-snippet idempotency re-verified (2 writes -> 1 copy).
- **0.20.0（文档分层版）**：
  **EN**: Documentation layering release responding to three rounds of evaluator feedback: ① **SKILL.md split 636 → 227 lines** - daily usage (flows A/B + trigger points + security gates + anti-pattern quick list) stays in the main file; 0.18-0.19 features (addressing/timeline/harvest/concurrency lock/pool/host integration/ops) moved to `docs/advanced.md`; research content (flow C + trap discipline) to `docs/research.md`; ② **`docs/common-mistakes.md`** - 14-item common-mistakes catalog with mechanism explanations (all [A] verified); ③ **AVOID/FIX template applicability boundaries** in the deposition section; ④ **bilingual trigger-word table + gene-conflict trigger rules**; ⑤ **`docs/config-errors.md`** - common configuration errors; ⑥ **`docs/faq.md`** - full 14-item FAQ; ⑦ **`examples/walkthrough-process-c.md`** - flow C end-to-end.
- **0.19.1（0.19.0 补丁：双语补齐 + 上游检查入档）**：
  **EN**: Bilingual completion for the three 0.19 SKILL.md sections (concurrency lock / harvest triage / numbat forensics - EN summaries added after the 0.19.0 release skipped the skill's own bilingual step); upstream dependency check recorded (evolver 2.0.42, unchanged since 0.17.0 evaluation - deferred conclusion stands).
- **0.19.0（稳定与取证版）**：
  **EN**: Stability + forensics release. ① **Concurrency lock** (O_EXCL `.evox.lock`, stale-break, timeout fail-open) on all four ledger writes (genes/review/hits/pending) and pool staging - after the 7th proven race (shareable flags reverted mid-window); concurrent dedup test 2×50→1 row. ② **harvest --done/--dismiss <N>** moves processed candidates to `error_candidates.done.jsonl` (audit trail kept) so the candidate list only shrinks. ③ **numbat forensic PoC on the private node** (Perplexity's agent auditor, native OpenClaw log parsing) - runbook + findings in `docs/forensics-numbat.md`; timeline cross-checking of injected genes is the next evidence source beyond self-reported register-hit.
- **0.18.1（0.18.0 补丁：池语义 + 审核幂等）**：
  **EN**: Two fixes that missed the 0.18.0 artifact (built from a stale base): ① **approved-only pool semantics** — `submit` exports shareable AND review-approved genes; pending ones stay in the local workbench with an explicit report (the pool is a curated approved-only collection); ② **ledger approve idempotency now LWW** — the old `.some()` check let "previously approved -> later quarantined" genes become permanently un-re-approvable (silent no-op, proven with 5 genes). Also: submit/export counter messages fixed.
- **0.18.0（回填寻址 + 时间线 + 收获版）**：
  **EN**: register-hit/negate now address genes by **asset_id/gene_id** (`--gene <id>`; positional N kept for compat but unreliable under concurrent sessions - proven drift), `light-cli timeline` merges the four ledgers (recall/inject/feedback/error-candidates) into a Markdown forensic report, `light-cli harvest` turns captured error candidates into copy-paste deposition drafts, doctor detects scattered instrumentation, and docs get the alignment pass (Node>=22 / GPL front-and-center, FAQ centralized, adapter-design deprecated, walkthrough anchors). Pool semantics released: approved-only.
- **0.17.0（沉淀质检版）**：
  **EN**: Deposition-quality release - closes the 0.16.0 autoApprove gap (retry-log noise and unfilled-placeholder genes were deposited-and-injected; all three recall guards pass). Adds depositionGate (fail-closed reject: placeholder / retry-log / narration / no-signal), non-interactive deposits default to quarantined (explicit --auto-approve overrides), a 4th recall guard against stored noise, three-way loop health (pending vs quarantined vs approved), cwd-independent HITS_DIR, `install-snippet` (write the T1-T5 procedure into project AGENTS.md/CLAUDE.md - the deposit-side last mile), injection scan AVOID-context extension to high-risk action patterns, and state-aware distill messages.堵 0.16.0 autoApprove 的实测洞（retry-log 噪音与未填占位符基因**沉淀即注入**，三道召回守卫全放行——隔离库复现）。① **沉淀质检 depositionGate**（fail-closed）：占位符未填 / retry-log 复述 / 旁白开场 / 缺信号词 → **拒绝入库**并给出修正指引；② **非交互沉淀默认隔离**：无 TTY（脚本/cron/管道）默认 quarantined，显式 `--auto-approve` 才通过——交互式人工沉淀便利不变；③ **召回侧第四道守卫**（retry-log，与沉淀同口径）——历史已入库的噪音也不再注入；④ **loopHealth 三分类**：待审(未决定)/已隔离/已批准分开计数，隔离不再被误报为待审并错误引导 approve；⑤ **HITS_DIR 默认脱离 cwd**（技能根/experiments，修「在别的目录跑 info 误报从未召回」）；⑥ **`install-snippet`**：把五触发点规程写进项目 AGENTS.md/CLAUDE.md（演练→--yes，幂等）——**自动沉淀的绑定点**（T4 进上下文）；⑦ 注入扫描 **AVOID 语境扩展到高危动作类**（修 0.16.0 实测的 exfiltrate 误杀 AVOID 警告）；⑧ distill 提示语随审核状态输出。评测驱动清理：trigger/errorHandling 4.3→4.8（0.16.0 修复生效）。
- **0.16.0（评测驱动 + 生效性版）**：
  **EN**: Evaluation-driven + effectiveness release - loop health in `info`, auto-approve for own deposits (default on, switchable), `install-hooks` (dry-run default), `starter` pack (10 curated genes, first-query hit), five trigger points with new `--error` recall, malicious-gene injection scan, copy-paste hook templates, and targeted fixes for the two low-scored dimensions (trigger/errorHandling both 4.3 -> 4.8).**新增让经验真正生效的四项**（针对「沉淀了却不召回」这个最根本的产品风险）：① **`info` 闭环健康度**——显示召回次数/命中/待审，并把「从未召回」「有基因待审」两类**静默失效**变成可见诊断 + 可执行命令；② **自己沉淀的基因默认自动通过**（`config --auto-approve off` 可改回人工把关；仅作用于本地沉淀，共享池 import 仍按 tier 判定）；③ **`install-hooks`**——探测 OpenClaw/Hermes 并准备钩子，**默认只演练不落盘**，加 `--yes` 才写入且写入前自动备份，权力完全在用户手上；④ **`starter`**——一键装载 10 条策展的通用起步基因（编码/JSON/权限/文件/语法/类型/网络），让新用户**第一次查询就能命中**，解决冷启动。**新增安全能力**：`injection_scan.mjs` 恶意基因注入扫描（区分 AVOID/FIX 语境，实测 11/11 恶意全拦、7/7 正常零误杀；三处生效：召回/导入/导出）。**新增** `examples/hooks/` 可直接复制的钩子模板（OpenClaw + Hermes + 接入 README）。另按评测补强低分项。
- **0.16.0（评测驱动优化版）**：依据 skillhub 对 0.15.0 的评测定向补强低分项（多数维度已达 4.8，两个低分：**trigger 4.3 / errorHandling 4.3**）。① **trigger**：宿主接入契约从「表格」改为**分步逐步说明 + 可直接复制的真实命令与输出示例**，并简化共享基因库三步流程（先给最小可用路径）。② **errorHandling**：统一错误提示语言——本 CLI 自身消息已是中文，但 Node/系统抛出的错误是英文，现于顶层捕获并映射为**中文原因 + 可执行修正**（保留英文原文于末行备查），确保**任何失败都有一句中文说明**，而非只丢英文堆栈。
  **EN**: Trigger-point release: five trigger points bound to concrete action nodes; own deposits auto-approve; four silent-failure counters; starter pack (10 curated genes); four security gates with AVOID/FIX context distinction (11/11 malicious caught, 7/7 legit zero false-kill).
- **0.15.0（最后一公里修复版）**：依据私有节点埋点实测（153 次 recall 调用、**真正有效仅 10%**）定位并修复「基因已入库却仍犯错」的四个断点——① **任务文本清洗**：剥掉宿主注入前缀（企业IM群/私聊前缀、心跳样板）、纯 URL、心跳探针，只留用户真实诉求（实测 63% 的召回因 query 噪声落空）；② **CJK bigram 分词**：原实现把整段中文当**一个 token**，导致中文任务与中文基因永不相交、signals 里的中文词也命中不了——这是「已入库却召回不到」的直接死因，现改二元切分（零依赖、无需分词器），冲突守卫 `tokenSet` 同步同口径；③ **无任务意图一律不注入**：删掉「取最近 N 条」回落（原路径在私有节点产生 30 次与任务无关的注入，而本项目实验已证不对靶注入净开销为正 +36pp）；④ **注入即登记 + `--negate` 回填**：每次注入落 `pending_injections.jsonl`，任务结束按实际结果登记命中/未采用，使「注入→有效」转化率可算、失效修法可及时发现。新增 SKILL.md「宿主接入契约」章节（喂干净意图 + 回填效果，缺一则经验继承不成立）。
  **EN**: Host integration contract: hosts must feed task intent (T1 --query with the user message body) and report outcomes (T5 --register-hit/--negate); runnable hook templates in examples/hooks/.

- **0.14.9（共享基因库版）**：新增跨实例/跨用户基因共享——`distill/draft --shareable` 标记可共享（默认不外发）→ `gene submit` 过**脱敏闸门**写入自建共享池（幂等）→ 其他实例 `gene import` 拉取合并。**闸门 fail-closed**：基因离开本机前扫全部文本字段，命中私有IP/绝对本地路径/密钥即拦截不出网；项目私有词由使用者本地 `redline.local.json` 补充（不随包发布）。**审核门控不被绕过**：导入默认 community→待审，仅对自建策展池显式 `--tier official` 才自动通过（tier 由操作者指定的池决定，不信基因自称）。新增 `code/gene_share.mjs`；底座路径改为按模块自身位置解析（跨平台）。
  **EN**: Shared gene pool (opt-in `--shareable` + `gene submit/import`, redaction gate fail-closed, idempotent merge by asset_id).

### 关于第三方静态 / 动态扫描结果的说明（中立声明）

- 本工具是**LLM 调用型 CLI**：它把模型返回的文本（含工具输出、终端回显）原样呈现给使用者。因此「**密钥形态字符串出现在运行输出**」是这一类工具的**普遍特征**，而非本项目的密钥泄露路径 —— 本项目**不读取、不缓存、不外发**用户密钥；密钥仅经 `argv` / 环境变量传入；所有 CLI 调用为 **argv 直调（无 shell、无字符串拼接）**；全局输出已做脱敏（已注册敏感值整体掩码 + `sk-***` / `Bearer ***` 形态掩码）。
- 同理，扫描器中与「文件读写 / 子进程 / 网络」相关的 finding 多为**功能固有**（本工具的存在意义就是执行命令与读写文件）。我们只修复**可消除项**（消除 shell 拼接、外发改为显式 opt-in、全局脱敏），不对「工具本身具备执行能力」做伪装 —— **更希望被按事实评估**。
- 逐条对照（含 ClawHub / skillhub / 云鼎 三平台历史判定与修复记录）：[`docs/security-and-license.md`](docs/security-and-license.md)。

## 许可提示

**本包为 MIT 全栈**（默认后端是内置 light 引擎，零外部依赖）。[@evomap/evolver](https://www.npmjs.com/package/@evomap/evolver)（GPL-3.0-or-later）为**可选集成**，仅在你主动安装并使用 `--engine evolver` 时涉及。[pi-coding-agent](https://github.com/earendil-works/pi) 为 MIT，仅流程 C 实验需要。

## License

MIT — 见 [LICENSE](LICENSE)。实验基于 pi-coding-agent 与 @evomap/evolver，其各自许可适用于对应组件；本仓库代码与文档仅覆盖本研究原创部分。
