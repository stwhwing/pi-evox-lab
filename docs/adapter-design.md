# 路线 B · pi_session_adapter 设计草案

> ⚠️ **历史注记（2026-09-10 补）**：本文是 **预研阶段（2026-09-05）的设计草案**，其中的边界声明（如"不写 Pi Extension""全程 offline"）描述的是当时的范围。**后续路线 A 已实现扩展桥**（`code/evolver-bridge.ts`，随本包装分发）并引入可选外发（`--llm-refine`，默认禁用、需显式配置）。**现状以 README.md / SKILL.md 为准**，本文仅作设计演进记录。

> 版本：v0.1（2026-09-05）｜ 状态：方案与 schema 对齐，**不写生产代码**
> 依据：`evolver_实测报告.md`（@evomap/evolver 2.0.30 实测）+ 启动输入中的 Pi 事实 [A-KB]
> 定位：Pi session JSONL → Evolver `generic-chat` 可消费格式的归一化适配层，验证蒸馏质量后再进入路线 A（Pi Extension）

---

## 1. 目标与边界

**做什么**：读 `~/.pi/agent/sessions/*.jsonl`（树形，entry 含 id + parentId），归一化为 Evolver v2 `ingest` 原生可识别的 generic-chat 转录文件，使「Pi 执行轨迹 → Gene/AVOID 候选 → 人工 review → 注入下轮继承」闭环离线跑通。

**不做什么**：
- 不改 Pi 内核、不写 Pi Extension（那是路线 A）
- 不连 EvoMap Hub（全程 offline）
- 不自动改任何代码（Gene 仅生成提示词，人工应用）
- 本轮不出生产代码，仅锁定契约

## 2. 输出格式契约（已实测锁定）[A]

适配器输出必须同时满足两条硬约束（源自 `evolver-runtime-adapters/dist/adapters.js` 实测读取）：

### 2.1 文件命名（detect 触发条件）
```
正则：/(^|[/\\])[^/\\]*\.(chat|messages|transcript)\.jsonl?$/i
推荐：<sessionId>.transcript.jsonl
```
命名为其他后缀（如 `.log`、`.jsonl` 裸名）会被拒绝：`ingest: unrecognized session-log format`。

### 2.2 内容形状（generic-chat 解析器接受三种，选 JSONL）
每行一条 OpenAI chat-completions 风格消息：

```jsonl
{"role":"user","content":"<用户指令原文>"}
{"role":"assistant","content":"<助手文本>","tool_calls":[{"id":"call_1","type":"function","function":{"name":"read","arguments":"{\"path\":\"...\"}"}}]}
{"role":"tool","tool_call_id":"call_1","content":"<工具输出原文>"}
{"role":"assistant","content":"<含报错/重试/修复叙述的文本>"}
```

解析器能力（源码实证）：
- `role: user/assistant/tool` 三类；`tool_calls[]` 与 `role:tool` 通过 `tool_call_id` 关联（`correlateToolNames`）
- 支持 `reasoning_content` / `thinking` 字段（Pi 推理轨迹可保留）
- 支持会话级 metadata（`model`、`usage` 等），会合并进首个非 meta turn
- 信号提取器作用于 turn 文本（text / errorMessage / toolResult）——**报错与修复叙述必须保留在自然语言文本里，这是蒸馏信号源**

## 3. 输入侧：Pi session JSONL 结构假设 [A-KB / 待核查]

来自启动输入 [A-KB]：每条 entry 含 `id` + `parentId` 形成树，所有分支共存一个文件，存于 `~/.pi/agent/sessions/`。

⚠️ **待核查项 [C]**：Pi entry 的具体字段名（消息 role/工具调用/工具结果/时间戳的字段形态）本轮未亲验（本机未装 Pi）。**适配器开发前第一件事：取一份真实 Pi session 文件做字段勘察**，下表映射按行业惯例假设，需按实测修正。

## 4. 映射设计（Pi entry → generic-chat message）

### 4.1 树 → 线性序列（核心决策）

Pi session 是树，generic-chat 是线性序列。规则：

| 决策点 | 方案 | 理由 |
|---|---|---|
| 默认导出哪条分支 | **活跃分支**（leaf 沿 parentId 回溯到 root） | 对应 /compact 后主上下文，是「被继承的经验」 |
| /fork 分支 | 每个非平凡 leaf 分支导出为**独立 transcript 文件**（`<sessionId>.fork-<leafId>.transcript.jsonl`） | 分支=独立任务尝试，成功/失败各异，分开蒸馏避免信号污染 |
| 已 compact 的压缩段 | 保留压缩摘要为一条 `assistant` meta 消息，标记 `"isMeta":true` | 保留上下文又防止摘要被当策略蒸馏 |
| 孤儿 entry（parentId 悬空） | 挂到最近公共祖先，记录 adapter 警告 | 实测样例中出现过此模式 |

### 4.2 角色与内容映射

| Pi entry 类型（假设字段） | generic-chat 输出 | 备注 |
|---|---|---|
| 用户消息 | `{"role":"user","content"}` | 原文保留 |
| 助手文本 | `{"role":"assistant","content"}` | 含报错分析/重试决策的叙述**必须保留**——蒸馏信号源 |
| 助手工具调用（bash/read/edit/write） | `assistant.tool_calls[]`，`function.name` = Pi 工具名，`arguments` = JSON 字符串 | 与 Pi 4 工具对齐 |
| 工具结果（含非零退出码） | `{"role":"tool","tool_call_id","content"}` | **工具失败结果原样保留**（AVOID 信号源），失败状态进文本（如前缀 `exit_code=1:`） |
| 推理/thinking 段 | `reasoning_content` 字段 | 解析器原生支持 |
| 系统/元信息 entry | 会话级 metadata（model、usage） | 合并进首个非 meta turn |

### 4.3 env_fingerprint 注入

每条 transcript 文件头部注入一条 meta 消息携带环境指纹（解析器会并入 metadata）：
```jsonl
{"role":"system","content":"env_fingerprint: platform=win32 arch=x64 node=v22.x pi=<version>"}
```
作用：Capsule 固化时 `env_fingerprint{platform,arch}` 有源可取，跨机迁移经验时可过滤。

## 5. Gene / AVOID 候选生成规则

v2 实测结论先行：**schema 无独立 AVOID 字段**；且 `ingest --distill` 是启发式自动起草，产出粗糙（实测确认）。因此适配器采用「素材保真 + 标注引导」策略，不替代 Evolver 蒸馏，只喂好料：

| Pi 轨迹模式 | 适配器动作 | Evolver 侧落点 |
|---|---|---|
| 成功路径（任务完成、测试通过、用户确认） | 完整保留「问题→尝试→验证成功」叙述链 | `--distill` 提取 `verified_success` 信号 → Gene 候选（UNPROVEN） |
| 报错→重试→修复 | 保留报错原文 + 重试决策叙述 | 信号进入 Gene.strategy（正面）或 anti_patterns（若蒸馏器升级） |
| 工具失败/危险操作（rm、force push、改密钥文件） | 保留失败事实，并在文件尾追加一条结构化提示：`task_domain:tooling avoid:<操作描述>` | 人工 review 时策展为 `tool_policy.deny[]` / `constraints.forbidden_paths[]` |
| 反复踩同一坑（≥2 次同类错误） | 同上，标注 `recurring` | 人工策展优先队列 |

**人工 review 门禁不动**：所有候选 UNPROVEN → `evolver review` → 策展（改写 strategy 为紧凑步骤、补 validation 命令）→ `--approve` → 才可注入。实测证实 fail-closed：未 approve 不注入。

## 6. 闭环流水线（offline）

```
~/.pi/agent/sessions/*.jsonl
   │  ① pi_session_adapter（本设计）
   ▼
<work>/evolver-inbox/<sessionId>.transcript.jsonl     ← generic-chat 契约
   │  ② evolver ingest <file> --dry-run               ← 信号预览，不落库
   ▼
   │  ③ evolver ingest <file> --distill               ← 起草 UNPROVEN Gene 候选
   ▼
~/.evomap/assets/genes.jsonl + review.jsonl           ← quarantined
   │  ④ evolver review → 人工策展 → review --approve   ← 硬门禁
   ▼
   │  ⑤ evolver inject session-start                  ← GEP 注入提示词
   ▼
注入下轮 Pi 会话 context（首轮手动粘贴；路线 A 由 Extension 自动接线）
```

验收标准（对齐启动输入 MVP 步骤 4）：同一类任务第二轮 Pi 会话免重复试错、token 下降；Gene/AVOID 召回精准不误伤。

## 7. 与路线 A 的衔接预留

- 适配器输出契约（generic-chat JSONL）即路线 A Extension 的内部中间表示，路线 A 只需把「写文件」换成「进程内传递 + 调 `evolver inject`」
- `inject session-start` 的 stdout 形态已实测（见实测报告第 5 节），路线 A 的 TS 骨架可直接以 `child_process` 调 CLI 为 v0，避免碰混淆的核心模块（GPL + 混淆双重约束）

## 8. 安全与合规边界（D4/D5/D6 落地）

| 项 | 约束 |
|---|---|
| 网络 | 全程 offline；适配器零网络调用；不配置任何 A2A_* 环境变量 |
| 隐私 | Pi session 轨迹不出本机；transcript 文件落 `evolver-inbox/` 本地目录，纳入 .gitignore |
| 权限 | 适配器只读 `~/.pi/agent/sessions/`，只写自己的 inbox 目录；Gene 不授权自动改码 |
| 许可 | Evolver GPL-3.0-or-later；适配器若独立分发需评估传染性，内部自用风险低；路线 A 以 CLI 进程边界调用可降低传染风险（[C] 需法律视角复核） |
| 爆炸半径 | 蒸馏 Gene 的 `constraints.max_files` 默认收紧（实测 auto-draft 给 12，策展时按任务性质下调）；`forbidden_paths` 至少含 `.git, node_modules` + 密钥路径 |

## 9. 开放问题（进入开发前必须关闭）

1. ~~[C] Pi entry 真实字段勘察~~ **已关闭 [A]**（2026-09-05 第二轮）：官方 Session format 文档 + Pi 0.74.2 SessionManager 真实生成文件双重核实，第 4 节映射表已按实证校正并实现于 `evolver-lab/adapter/pi_session_adapter.js` 原型
2. **[C] 多分支导出策略**：原型已验证「逐 leaf 各出一份」可行；死路分支信号可被 ingest 捕获，但 auto-distill 不起草（需 ≥1 强信号）→ AVOID 分支默认只入素材库，蒸馏走人工/半自动
3. ~~[C] AVOID 结构化提示格式~~ **已关闭 [A]**：实测纯 AVOID 分支 auto-distill 拒绝起草；已验证手工通路 `evolver distill --category repair --signals ... --strategy "Do NOT ..."`（manual 源 Gene 免隔离直接 eligible）。适配器应升级为：检测到死路/纯失败分支时自动生成手工 distill 命令建议（或经人工确认后调用）
4. **[C] distill 质量**：heuristic auto-draft 粗糙，是否引入 `evolver cycle`（外部 runner）或自研 LLM 蒸馏器，待真实 LLM session 验证后再定
5. **[C] Capsule 固化**：v1 solidify 已弃用，v2 走 `evolver cycle`（需 claude/codex/gemini runner）→ review → publish；离线 Gene 级继承已完整可用，Capsule 级待接 runner 后验证

## 10. 原型验证记录（2026-09-05 第二轮）[A]

`evolver-lab/adapter/pi_session_adapter.js` 已按本设计实现并通过真实格式 session 验证：
- Pi SessionManager 生成 v3 树形 session（15 entries，主分支 + 死路分叉）→ 适配器输出 2 份 transcript（13 turns / 6 turns）
- 主分支 → ingest 3 信号 → auto-distill Gene（quarantined）→ approve → 注入 ✅
- 死路分支 → 信号捕获 → auto-distill 拒绝（符合预期）→ 手工 distill AVOID Gene（eligible）→ 注入 ✅
- 最终 `inject session-start` injected_count=2，「继承」注入侧闭环成立；token 下降验证待真实 LLM 双轮任务

## 11. 输出契约修订：is_error 显式失败标志（2026-09-05 第三轮）[A]

**根因**：evolver `chatMessageToTurns`（runtime-adapters/adapters.js:864-878）仅当 tool 消息带 `is_error/isError===true`（或文本以 `Exit code: N≠0` 开头）时才设置 `turn.errorMessage`；`extractSignals` 只从 `errorMessage` 挖 strong 错误信号（`STRONG_TEXT` 正则只测 `text` 字段，不测 `toolResult`）。此前适配器仅用文本前缀 `ERROR (tool failed):` 标注失败 → strong 信号产出为 0 → auto-distill 永远拒绝。

**修订**（pi_session_adapter.js）：
- `toolResult`：`m.isError===true` 时输出消息追加 `"is_error": true`
- `bashExecution`：`exitCode!==0 || cancelled` 时追加 `"is_error": true`
- 文本前缀保留（人类可读），二者不冲突

**验证**：R1a trap session（2 次 BOM 报错）重转 → ingest 抽出 2×strong/error_result + 1×success_prose → auto-distill 自动起草 `gene_distilled_65dec53a`（repair/quarantined）→ approve → inject ✅；R1b 同类错误被 candidate-signal-subset 去重正确拦截。

---

## 12. Route A 预研：Pi Extensions API 可行性结论（2026-09-06）[A]

### 12.1 资料来源（本机权威源，与 0.74.2 精确对应）
- 包内文档：`node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`（2596 行）
- 现成同构示例：`examples/extensions/claude-rules.ts`（session_start + before_agent_start 从文件加载规则注入）、`prompt-customizer.ts`（before_agent_start + systemPromptOptions）

### 12.2 关键 API 事实 [A]
1. **`before_agent_start` 钩子**（用户提交 prompt 后、agent loop 前，每次 prompt 触发）：
   - `return { systemPrompt: event.systemPrompt + ... }` —— **链式修改 system prompt**
   - `return { message: { customType, content, display } }` —— **注入持久化消息**（存 session、发 LLM）
   - `event.systemPromptOptions` —— 结构化读取 prompt 构建数据（customPrompt/tools/contextFiles/cwd 等）
2. **扩展加载**：`~/.pi/agent/extensions/`（全局）或 `.pi/extensions/`（项目本地）**自动发现**，支持 `/reload` 热重载；`pi -e ./x.ts` 仅快速测试。
3. **硬约束能力存在**：`pi.on("tool_call")` 可拦截、`pi.on("tool_result")` 可改写——理论上可 100% 避坑，但偏离 GEP「prompt governance 而非行为劫持」哲学，作为设计决策保留。
4. **`agent_end` 钩子**（event.messages）——可在会话末自动触发 `evolver ingest --distill`，蒸馏也可原生化。

### 12.3 可行性结论：可行，且是「完全体」方案
当前通路（编排器 `pi_evolve.mjs` 拼 `--append-system-prompt`）与 Route A 对比：

| 维度 | 当前：编排器 + CLI 参数 | Route A：Pi 原生扩展 |
|---|---|---|
| 注入时机 | 会话启动一次性（静态） | **每轮 prompt 动态**（store 更新即生效） |
| 对靶性 | 无（全量注入已审核基因） | 可按 `signals_match` 与上下文匹配（解决 §11「不对靶注入净开销 +33%」） |
| 需要编排器 | 是 | 注入/继承原生；蒸馏仍需 ingest（可用 `agent_end` 原生化） |
| 修法送达 | strategy 拼文本（软提示） | 同为软提示本质，但可结构化 + 对靶过滤 |
| 硬约束 | 不可能 | `tool_call` 拦截 / `tool_result` 改写（能力具备，哲学待定） |
| 对用户 Pi 环境侵入 | 零（CLI 参数级） | 需安装扩展文件（可用项目本地 `.pi/extensions/` 限定范围） |

**核心价值**：继承从「编排器驱动的一次性实验」升级为「Pi 环境常驻能力」——任何 Pi 会话结束蒸馏、下一个 Pi 会话自动继承，闭环不再依赖外部编排器。

### 12.4 骨架（已产出，未激活）
- 文件：`evolver-lab/extensions/evolver-bridge.ts`
- 逻辑：`before_agent_start` → 读 `~/.evomap/assets/{genes,review}.jsonl` → 取已审核（approved）基因 strategy → 拼入 systemPrompt；空库零注入（fail-open 降级）。
- 对靶匹配（Route A.2）与硬约束通道（Route A.3）以 TODO 标注，留作设计决策。

### 12.5 下一步（激活实测，决策点）
1. 激活方式：复制到项目本地 `.pi/extensions/`（限定 evolver-lab 实验范围，不污染全局），或 `pi -e` 快速验证。
2. 实测设计：GBK 陷阱 + 扩展注入 vs CLI 注入，对比避坑率/token（配对解读）；验证热重载与空库降级。
3. 决策点：硬约束通道（tool_call 改写）是否纳入——需要用户在「GEP prompt governance 原则」与「100% 避坑收益」之间拍板。

### 12.6 激活实测结果（2026-09-06）[A]：扩展链路 ✅ 全通，暴露蒸馏质量方差
**激活与实验**：`evolver-bridge.ts`（含注入留痕 sidecar）→ 项目本地 `.pi/extensions/`；编排器新增 `--ext-inject`（R2 零 CLI 注入参数）；GBK 陷阱 × N=3（agnes-2.5-flash，--fresh --auto-approve），与 §16 CLI 注入（N=5）配对。

| 通道 | N | R1→R2 解码错 | token Δ 均值 | 注入内容含修法 |
|---|---|---|---|---|
| CLI 拼参数（§16） | 5 | 11→4 | -55.3%（净 -33pp） | 5/5（含 gbk 修法） |
| Pi 扩展钩子（本轮） | 3 | 4→6 | +3.6% | **0/3（成功总结叙述，无修法）** |

**扩展链路 [A] 实证全通**：留痕 `~/.evomap/assets/bridge-last-inject.txt` 时间戳与 ext-rep3 R2 吻合，内容 = store 中 strategy + 注入头——自动发现、`before_agent_start` 触发、store 读取、systemPrompt 链式修改全部工作；R1 空库零注入（fail-open）也按设计工作。

**根因不在扩展，在蒸馏**：ext 三轮 auto-distill 均摘录 R1 末尾的**成功总结叙述**（"The script works correctly… One note: the file uses…"），且 evolver 生成 strategy 时即截断——`gbk` 关键词被切掉。对比 §16 的 R1 错误密度高（合计 11 次、修复叙述占比大）摘到的全是修法。**蒸馏摘录质量随 session 错误密度波动**。

**再次印证 §17.3**：注入内容质量是决定变量——注入无修法的"成功总结"等效于注入噪声（R2 反而更差），宁缺毋滥。

**Route A 后续方向**（瓶颈转移）：①扩展侧加注入质量守卫（strategy 不含错误关键词/代码模式时跳过注入）；②提升蒸馏质量（manual 精修 / 官方 LLM 兜底 autoDistillTranscript.js 默认 OFF 可开）；③硬约束通道（tool_call 改写）为终极兜底。扩展骨架保持可用，等待蒸馏质量议题解决后复测。
