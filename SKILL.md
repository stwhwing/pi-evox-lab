---
name: pi-evox-loop
slug: pi-evox-loop
displayName: "Pi EvoX Loop"
description: "Give your coding agent an 'experience inheritance' runtime: recall validated fixes from an Evolver gene store at task start, register hits when a fix is actually used, and deposit newly-learned fixes after repairing a non-obvious failure. Optionally run controlled closed-loop experiments (R1 trap → distill → inject → R2) to measure inheritance gains. Use at the START of non-trivial tasks, after fixing a non-obvious failure, or when you want to measure agent self-evolution. Trigger words: 经验召回, 错题本, 经验继承, 自进化, evolver, 避坑, distill."
description_zh: "给编码智能体装上「经验继承」运行时：任务开始时从 Evolver 基因库召回已验证修法（编号列表），相关则采用并在结束时登记命中；任务中修复了非显而易见的失败后，将修法沉淀入库供未来召回；可选跑受控闭环实验量化继承收益。非平凡任务开始时、修复有价值失败后、或想测量 agent 自进化效果时使用。触发词：经验召回、错题本、经验继承、自进化、evolver、避坑、distill"
description_en: "Experience-inheritance runtime for coding agents: recall validated fixes (numbered) at task start, register hits when used, deposit fixes after repairing failures; optional controlled closed-loop experiments to measure inheritance gains."
version: 0.14.4
platforms: [linux, macos, windows]
homepage: https://github.com/stwhwing/pi-evox-lab
---

# Pi × EvoX Loop — 智能体经验继承 Skill

> 让 Agent 的每个坑只踩一次：失败经验自动入库（守卫过滤），同类任务自动召回已验证修法。

## 安装（一次性）

```bash
git clone https://github.com/stwhwing/pi-evox-lab.git && cd pi-evox-lab
npm install            # @evomap/evolver（必需）+ @earendil-works/pi-coding-agent（仅实验模式 C 需要）
```

- **默认后端 = 内置 light（0.12.0 起）**：零 npm 依赖即可运行召回/沉淀全流程（纯 Node 内置模块，MIT）；
- **evolver 为可选集成**：已安装时可用 `--engine evolver` 启用（`--engine auto` 为旧行为：检测到即用）；
- 两后端**共享同一资产库格式**（schema 1.13.0），产物可互操作、无需迁移。
- **流程 C（受控实验）**：需要 Pi CLI 与一个 OpenAI 兼容 LLM key（provider 配置见 `docs/providers.md`）。

以下命令均在本仓库根目录执行（`SKILL.md` 所在目录）。

## Provider 配置（精简指引）

- 支持任意 OpenAI 兼容端点；`$ENV` 插值需 **pi ≥ 0.85.1**（旧版用 `--api-key` 显式传）；
- 完整 models.json 示例、国内端点（DeepSeek/百炼/硅基流动/智谱）与 deepseek 内置 provider 用法：[`docs/providers.md`](docs/providers.md)。

## 流程 A：任务开始 — 召回经验（任何非平凡任务）

```bash
# 推荐：带上任务文本做「对靶」召回（与任务无关的经验不会注入）
node code/evolver-recall.mjs --query "<当前任务的一句话/关键信号>" --top 5

# 不带查询时：按入库顺序取最近 5 条（仅数量封顶）
node code/evolver-recall.mjs
```

- 只输出「已审核 **且** 通过修法守卫 **且** 与查询对靶」的编号修法列表（空库有明确提示，属正常——价值随使用积累）；
- **对靶规则**：按基因 `signals_match` 命中与查询词的交集打分，**低于阈值即整条不注入**（避免不对靶注入反而增加成本）；
- 与本任务相关时优先采用；结束时实际采用了某条，登记命中（命中率盘点的数据源）：

```bash
node code/evolver-recall.mjs --register-hit <N> --note "<任务一句话>"
```

- 无关的经验不要硬套；未采用的条目不必登记。

## 流程 B：失败修复后 — 沉淀经验

**判定标准（满足任一条即值得沉淀）**：
- 排查过程需要查文档 / 试错 ≥2 次才解决；
- 依赖本机或环境特性（编码、路径规范、shell 差异、网络环境）；
- 报错信息反直觉，或与文档描述不符；
- 同一坑在历史任务中出现过第二次。
（不满足任一条的普通失败不必沉淀——避免经验库噪声。）

**推荐路径：引导式（贴原始报错，信号与「负经验」自动抽取）**

```bash
# 1) 生成草稿：自动抽 signals_match + 预填 AVOID 模板 + 写入 anti_patterns（负经验 token）
node code/light-cli.mjs draft --error "<原始报错文本>" \
    --tool <出错工具名> --context "<你当时在做什么>"

# 2) 照草稿补全 FIX 后落库（--strategy 覆盖预填占位符）
node code/light-cli.mjs draft --error "<原始报错文本>" \
    --strategy "AVOID: <什么不该做> FIX: <具体参数/命令/编码>" --commit

# 3) 审核
node code/light-cli.mjs approve <gene_id>
```

- `draft` 只替你预填 **AVOID**（"什么不该做"）与 **`anti_patterns`**；**FIX 必须你自己补**，且要具体到参数 / 命令 / 编码；
- **未补 FIX 的占位符草稿会被守卫拒绝落库**——这保证入库的一定是可执行修法，而非半成品；
- 若你已能直接写出修法，可用一行式：`node code/light-cli.mjs distill --error "<报错>" --strategy "FIX: <修法>"`。

**备选路径：手写式（已明确 signals 时）**

```bash
# 内置后端（默认，零依赖）
node code/light-cli.mjs distill --category repair --signals bash,exception \
    --strategy "<一句话修法；多步用分号分隔；要具体到参数/命令/编码>" \
    --summary "<坑的一句话描述>"
node code/light-cli.mjs approve <gene_id>     # 审核通过（可注入）
node code/light-cli.mjs list                  # 查看台账

# 可选集成 evolver（已 npm install 时）
node_modules/.bin/evolver distill --category repair --signals bash,exception \
    --strategy "<...>" --summary "<...>"
node_modules/.bin/evolver review --approve <gene_id>
```

- strategy 必须写成**可执行修法**（含具体参数/命令），不要写成功总结——召回侧有修法守卫，成功总结会被过滤（宁缺毋滥）；
- `--approve` 是否自动化由你的部署策略决定：单用户环境可自动（召回守卫兜底防噪声），多人/严谨场景保留人工审核门；
- **沉淀门槛的真实数据（诚实边界）**：在**生产真实会话**中可自动抽取的"干净修法对"密度很低（实测 `distillablePairs=0`）。因此**本库当前基因主要来自人工/引导式沉淀**——引导式 `draft` 正是为降低这一门槛而设。

## 流程 C（可选）：受控闭环实验 — 量化继承收益

> ⚠️ **研究用途（research only）**：流程 C 是受控实验框架——`--auto-approve`、`--llm-refine` 等均为
> **演示/实验开关**（默认关闭；组合启用默认拒绝），实验路径会主动制造并测量失败。
> **日常与生产使用请只用流程 A/B**，不要照搬流程 C 的参数组合。

```bash
# 1. 生成确定性陷阱（无效 UTF-8 字节——任何 utf-8 文本读取必失败）
python traps/make_encoding_trap.py

# 2. 配置 Pi provider（models.json 或 --api-key 显式传；注意 models.json 的 $ENV 插值不可用）
# 3.（可选）配置 LLM 精修端点——未配置时 --llm-refine 自动禁用（数据外发必须显式授权）
export EVOLVER_REFINE_URL="https://<你的 OpenAI 兼容端点>/v1/chat/completions"
export EVOLVER_REFINE_MODEL="<model>"
# 4. 一键闭环：R1 踩坑 → 自动蒸馏 → 守卫审核 → 修法注入 → R2 → 跨轮对比
node code/pi_evolve.mjs exp/encoding-trap-template examples/task-gbk.txt \
    --provider <provider> --model <model> --api-key "$LLM_API_KEY" \
    --rounds 2 --fresh --auto-approve --llm-refine --root exp/loop-$(date +%s)
```

- `--fresh` 会清空经验库（自动备份）——执行前确认；
- Pi 扩展桥（`code/evolver-bridge.ts`，放 `~/.pi/agent/extensions/` 或项目 `.pi/extensions/`）激活后，编排器自动切换为扩展注入（单通道）。**能力边界（透明声明，避免误读）**：当前 `evolver-bridge.ts` 已实现 `before_agent_start` 召回注入（读取已审核基因的 strategy 拼入系统提示）；`tool_result` 失败点教学属于**规划中的增强能力**，并非当前 bridge 已实现的行为——本 SKILL.md 对该通道的描述均为「规划/可选」，不代表已上线。

## 陷阱设计纪律（做实验前必读）

- 只用「**环境必然失败**」型陷阱，且**命中率必须实测**（陷阱可靠性是「陷阱×模型」联合属性）。
  **内置 6 个生成器**（`traps/`，按实测可靠性分两档）：

  **确定性档（推荐）**
  | 生成器 | 陷阱机制 | 必然失败点 | 实测 |
  |---|---|---|---|
  | `make_encoding_trap.py` | GBK 字节写入 JSONL | utf-8 文本读取必抛 `UnicodeDecodeError` | ✓ 5/5 |
  | `make_json_trap.py` | 非法 JSON（尾随逗号等） | `json.loads` 必抛 `JSONDecodeError` | ✓ 3/3 |
  | `make_readonly_trap.py` | 配置 0444 只读 | 写入必被拒（`PermissionError` / `EPERM`），**无法绕行**（修法即 chmod） | ✓ 1/1 |

  **对照档（有绕过路径，勿作继承实验主陷阱）**
  | 生成器 | 陷阱机制 | 绕过路径 | 实测 |
  |---|---|---|---|
  | `make_crlf_trap.py` | 可执行脚本 CRLF 行尾 | agent 用 `python3 x.py` 直调即绕过 shebang | ✗ 0/1 |
  | `make_nfd_trap.py` | 磁盘 NFD 名 / 任务给 NFC 名 | agent 列目录后按实际名读取即绕过 | ✗ 0/1 |
  | `make_type_trap.py` | 数值类型（`"120.0"` 等） | 属「模型可能犯错」型，capable model 不犯 | ✗ 0/3 |

  > 教训：判定「必然失败」不仅要看陷阱本身，还要**审视 agent 的合理绕行路径**——只要存在"另一种正确做法"，
  > 该陷阱的命中率就不可控（与模型能力相关），不能用于需要可复现统计的继承实验。
- 不要用「模型可能犯错」型（BOM、`int("120.0")`——对 capable model 实测命中率 0/3，且随模型升级漂移）；
- 错误统计用精确口径（`isError=true` 的 toolResult），不要用字符串计数（文本提及会混入）；
- token 对比必须扣除重复执行效应基线（实测 ≈ -22%）——绝对降幅 ≠ 继承收益。

## 许可提示（精简版）

- **本包为 MIT 全栈**（默认后端是内置 light 引擎，无外部依赖）；
- `@evomap/evolver` 为**可选集成**（GPL-3.0-or-later）——仅在主动安装并使用 `--engine evolver` 时涉及；
- 详细说明与上游许可核对记录：[`docs/security-and-license.md`](docs/security-and-license.md)。

## 常见错误用法（反模式速查）

| 错误做法 | 后果 | 正确做法 |
|----------|------|----------|
| 注入「成功总结」型 strategy（"脚本运行正确，结果如下…"） | 守卫过滤 / 等效噪声，比不注入更差（实测 +36pp） | 写成可执行修法（含参数/命令/编码："用 `encoding='gbk'` 打开"） |
| 用「模型可能犯错」型陷阱做实验（BOM、`int("120.0")`） | 命中率不可控（实测 0/3），结论不可复现 | 改用「环境必然失败」型（无效 UTF-8 字节、非法 JSON） |
| token 降幅直接当继承收益 | 把重复执行效应（≈ -22%）误算成继承 | 设无注入对照组，报告净收益 |
| 用字符串计数统计错误 | 把文本提及误计为错误（曾致"11→4"实为 8→4） | 用精确口径：`isError=true` 的 toolResult |
| 冷启动就期待避坑效果 | 空库无修法可召回，误判工具无效 | 先按流程 B 沉淀，价值随使用复利增长 |
| 在生产环境开 `--auto-approve --llm-refine` | 未复核的 LLM 重写内容直接注入 | 保留人工审核门；确需演示时加 `--allow-unreviewed-refine` 并知悉风险 |

## 安全与数据外发声明（精简版，全文见 [`docs/security-and-license.md`](docs/security-and-license.md)）

- 全部 CLI 调用为 **argv 直调**（无 shell、无拼接）；外发仅 `--llm-refine`（默认禁用、需显式配置端点）；
- `--fresh` 有破坏性（自动备份）；实验产物含会话内容；`--auto-approve` 为显式 opt-in（默认人工审核门）；
- 注入块透明标注、全局输出脱敏（密钥不出现在任何 stdout）；平台安全判定记录见上方链接文档。

## 运维与度量（ops）

本仓库附带零依赖运维脚本（`code/` 下），用于在生产环境观测「经验继承」是否真正生效。所有私有绝对路径已参数化为环境变量（默认值见下），克隆到任意自托管环境即可直接使用。

| 脚本 | 作用 | 默认触发 |
|------|------|----------|
| `metrics_collect.mjs` | 采集基因库指标：基因总数 / 已审核 / 隔离 / 命中数 / **recall 调用数**（智能体是否在真实任务中主动调用本技能的直接证据），追加到 `exp/metrics/metrics.log` | 周常 |
| `distill_sessions.mjs` | 生产会话蒸馏适配器：直读宿主**真实会话存储**（SQLite），按「失败调用 vs 重试调用的**参数差异**」抽取可执行修法，过守卫后落库（见下「抽取口径」） | 周常 |
| `evox-weekly.sh` | 周常包装：`metrics_collect.mjs` + `distill_sessions.mjs --days 7 --commit --auto-approve-lowrisk` | cron `17 3 * * 1` |

**抽取口径（宁缺毋滥）**：先判定「失败」——**结构化标志优先于文本标记**（`isError` / 非零 `exit_code` / `error` 字段），且**文本错误标记只对命令执行类工具生效**（读一份「讲错误的文档」不算失败）；再在同一会话内找**紧接着（≤6 个事件）、同名工具、结果不再失败**的下一次调用，取两者**参数差异**作为修法。差异过大（整体换成另一条命令）或与失败无相似度者一律拒绝；落库前再过**修法信号 + 叙述守卫**双闸。

**两级门（B+C）**：`--commit` 落库时，仅**纯参数微调型**——改动不含删除/权限/服务/网络外发/装包/写盘/密钥类字样——自动批准；其余进 quarantine 并写入**候选报告** `exp/metrics/distill-candidates-<日期>.md`（内含可一次性批量批准的清单）。**内容去重**：`light-cli distill` 按归一化 strategy 判重，重复重扫不会堆积重复基因（历史基因的审核状态也不会被重扫打回）。

**对靶注入**：`evolver-recall.mjs --query "<任务文本>" [--top N]` 按 `signals_match` 命中 + 与 strategy 的 token 交集打分，**低于阈值即不注入**（避免不对靶注入的净开销）；无 query 时按入库顺序取最近 N 条，仅做数量封顶（不再任意截断）。

环境变量（均可选，公共仓库已去除硬编码绝对路径）：`EVOX_ROOT`（默认 `$HOME/pi-evox-lab`）、`EVOX_STORE_DIR`（默认 `$HOME/.evomap/assets`）、`EVOX_NODE`（默认 `node`）、`EVOX_HITS_DIR`（默认 `$cwd/experiments`，**生产环境建议固定为 `$EVOX_ROOT/experiments`**，使 recall 调用计数与命中登记落入同一目录供 metrics_collect 汇总）、`EVOX_OC_DB` / `EVOX_HERMES_DB`（宿主会话存储路径）等。

**生产接入（让继承真正发生）**：两条路——
1. **提示词接入**：把「任务开始 recall / 修复后 deposit」写入智能体系统提示词（如 `AGENTS.md` / `SOUL.md`）；
2. **原生钩子接入（推荐：机制保证，而非依赖智能体自觉）**：一类宿主用 `agent:bootstrap` 钩子注入一个**虚拟 bootstrap 文件**；另一类用 `pre_llm_call` shell hook 回 `{"context": …}`（该事件原生带 `is_first_turn`，可直接做「每会话仅首轮」闸）。两者都是**薄适配层，只调用 `evolver-recall.mjs` 这一个实现**；空库零注入、异常不影响宿主调度。

> **诚实边界**：各宿主会话存储格式不一 —— 结构化标志（`isError` / `exit_code`）最可靠；只靠文本标记时召回率随宿主而异。另：bootstrap 类钩子可能**早于**当轮用户消息落库，此时该轮退化为「无查询 → top-N 封顶」；会话有历史后即为真对靶。

## 已知边界

- 修法注入是**软提示**（system prompt），遵从度模型相关；守卫保证噪声不入库不出库，但不承诺 100% 避坑；
- `tool_result` 失败点教学（扩展桥内）只在「策略注入后仍踩坑」时提供增量，价值在长时运行场景。

## FAQ（常见问题）

**Q1：召回输出「无可召回修法」是坏了吗？**
不是。经验库从零开始，首次运行必然为空——价值随使用积累。跑一次流程 B（沉淀一个修法）即可点亮。

**Q2：models.json 里配 `$ENV` 环境变量不生效？**
pi **0.85.1 起已支持 `$ENV` 插值**（实测确认，上游 issue #9258 已闭环该项）；**0.74.2 及更早版本不支持**，需用 `--api-key "$MY_KEY"` 显式传。

**Q3：`--fresh` 会不会丢数据？**
不会丢——运行前自动备份到 `~/.evomap/assets/backup-<时间戳>/`，可随时恢复。但清空动作仍是破坏性的，执行前请确认。

**Q4：修法注入后还是踩坑了，为什么？**
修法注入是软提示（system prompt），遵从度模型相关——它把「多次试错」压成「最多一次教训」，但不承诺 100% 避坑（诚实边界见报告 §22）。

**Q5：沉淀/审核时报「命令找不到」？**
默认后端（light）无需任何外部命令——用 `node code/light-cli.mjs distill|approve|list`；
若在用 evolver 集成（`--engine evolver`），则需先 `npm install` 使其 CLI 就位。

**Q6：approve 能全自动吗？**
可以（`--auto-approve` 或部署时授权），默认是人工审核门。自动化后召回/沉淀双向守卫仍兜底，但建议定期 `evolver review --list` 复查。

**Q7：国内网络 npm/GitHub 慢？**
npm 换国内镜像：`npm config set registry https://registry.npmmirror.com`；GitHub 克隆可用镜像代理或直接下载 Release zip。

**Q8：Node 版本要求？**
≥22（traps 生成器还需 Python 3）。版本过低时 pi/evolver 可能启动失败。

## 致谢与上游

**上游引擎与宿主**：基于 [pi-coding-agent](https://github.com/earendil-works/pi) 与 [@evomap/evolver](https://github.com/EvoMap/evolver)。实测中发现的 4+1 项上游缺口已提交官方 issue（evolver#624-#627、pi#9258），详见 README 的致谢与缺口清单。完整 22 节实验报告：`docs/experiment-report.md`。

**方法论与评测参考**（近期研读、按对本项目的影响排序）：

- **[Palantir Ontology](https://www.palantir.com/docs/foundry/ontology/overview)** —— 概念层的参照系："语义层让你*读*业务，运营本体让你*运营*它"。其「**动作门控写 · 审计每次尝试 · 回写权威源**」三件套与本项目的「审核门控注入 · 召回/命中埋点 · 经验库单一真源」逐条对应；正是这个对照，让我们把「**回写（write-back）缺失**」识别为一个结构性缺口（跨实例经验库同步）。
- **[gura105/operational-ontology](https://github.com/gura105/operational-ontology)**（MIT）—— 上述理念的**最小可运行参考实现**。我们研读其 `src/core.ts` 与示例（`defineObject` / `defineLink` / `defineAction`，以及 `preconditions` + `reject(code)` + `writeback`），作为「规则内置于动作、拒绝可被机器读取」这一设计的对照样本。
- **[fstech-digital/operational-ontology-framework](https://github.com/fstech-digital/operational-ontology-framework)** —— 公开治理模型参考：**Data → Logic → Action → Evidence → Write-back** 纵向链条、Pin/Spec/Handoff/Facts 四类状态物，以及一份**反模式清单**（我们将其当作自检表使用）。
- **[Leading-AI-IO/palantir-ontology-strategy](https://github.com/Leading-AI-IO/palantir-ontology-strategy)** —— 开源专著，把本体论讲成「名词（对象）与动词（动作）的统合 + 分支与评审的治理」。其"从只能看的数据，转向直接驱动业务的数据"的表述，与本研究"从记录经验，转向驱动下一轮行为"的取向同源。
- **[ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd)** —— 多平台智能体行为约束项目。对我们有两点价值：**工程组织方式**（同一规则面向多宿主做薄适配层，与本项目「一个实现 + 多个薄钩子」同构）与 **`evals/` 盲评评测体系**（多维度 rubric + 多次试验 + 加权），后者是可直接借鉴的第三方评测范式；其**发布门设计教训**（绝对化规则会让门永不可通过）也被我们用来复查自家守卫是否过严。
- **论文 *From Procedural Skills to Strategy Genes***（arXiv:2604.15097，EvoMap）—— 提供「紧凑 Gene 优于冗长 Skill」「失败经验的最佳形态是极度蒸馏后的独立 **AVOID** 警告」两条结论的量化依据（4,590 次受控实验）。本项目的独立实测与之同向（"只注入标签比不注入更差"），据此我们保留了对**注入内容质量**的高优先关注。
- **[FlyLoRA](https://arxiv.org/abs/2510.08396)**（NeurIPS 2025，清华大学；[代码](https://github.com/gfyddha/FlyLoRA)）—— 权重空间的隐式秩专家 PEFT，与本项目（**提示空间**的推理期继承）不在同一层、**不是可直接插入的组件**；但本版显式迁移了两条原理：① **负载均衡偏置**（召回打分加 `-u·sign(c_i − c̄)`，`c_i` = 该基因历史命中数），② **免训练合并不干扰**（落到提示层 = 注入冲突守卫，`anti_patterns` 互斥者剔除低分项）。其 **FlyHash 式免参数路由**是我们的 **P2（鲁棒召回）** 参考方向，**当前尚未实现**。
- **[Switch Transformer](https://arxiv.org/abs/2101.03961)**（Fedus et al., 2021）—— 上述"负载均衡偏置"的思想源头之一（MoE 以每专家计数 `c_i` 与均值的偏离为据），本版 P1④ 沿用同一形式。

> 以上均为**研读与对照**：本项目与它们均无隶属关系，也不代表其观点；本仓库实现均为原创，默认后端是 MIT 的内置引擎。
