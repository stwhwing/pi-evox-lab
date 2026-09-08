# Evolver 安装与单轮离线蒸馏 · 实测报告

> 日期：2026-09-05 ｜ 执行环境：Windows 11 + 受管 Node v22.22.2（沙箱隔离目录 `evolver-lab/`，未污染全局）
> 证据分级：[A]=亲测/亲读官方源 ｜ [A-KB]=本地知识库 ｜ [C]=推断待核查
> 全程 offline（未配置 A2A_HUB_URL / A2A_NODE_ID，未注册 EvoMap 节点）

---

## 1. 安装实测结论 [A]

| 项 | 实测结果 |
|---|---|
| npm 包 | `@evomap/evolver` 存在，latest = **2.0.30**（另有 1.x  lineage，最新 1.94.0） |
| 安装方式 | `npm install @evomap/evolver@2.0.30`（项目级隔离安装，未用 `-g`） |
| Node 要求 | package.json engines = `^22.13.0 \|\| >=23.4.0`；Node 22.12.0 触发 EBADENGINE 警告，**换 22.22.2 后正常** |
| 依赖 | 7 个 `@evomap/*` 子包（cli/core/mcp/proxy/adapter-public/runtime-adapters/webui）+ `@evomap/gep-sdk`，共 50 包 |
| 仓库/许可证 | github.com/EvoMap/evolver 存在，**GPL-3.0-or-later**；README 明示核心引擎模块以混淆形式分发，未来将转 source-available |
| 运行前置 | 必须在 git 仓库内运行（rollback/blast radius/solidify 依赖 git） |

## 2. v2.0.30 与启动文档（基于 v1 知识库）的关键差异 [A]

⚠️ 这是本轮最重要的实测修正——启动输入中的 v1 用法在 v2 已变：

| v1（启动输入/KB 描述） | v2.0.30 实测 | 影响 |
|---|---|---|
| 裸跑 `evolver` = 单轮进化，stdout 输出 GEP 提示词 | 裸跑仅打印弃用通知："V1 one-shot run has no safe V2 equivalent"，**不执行任何动作** | MVP 步骤 1 的「单轮跑 GEP 提示词」在 v2 无直接等价物 |
| `evolver --review` / `--loop` | 改为子命令：`evolver review` / `evolver autoexec`（常驻守护）；`run` 为 v1 兼容 shim，拒绝执行 | D1 决策需重新评估 |
| 资产存 `<workspace>/.evolver/gep/` | 实测存 **全局 `~/.evomap/assets/`**（genes.jsonl + review.jsonl） | D2 会话目录指针逻辑变化 |
| ingest 未提及 | 新增 `evolver ingest <session-log> [--dry-run\|--distill]`，**原生支持会话日志蒸馏** | 路线 B 有官方入口，适配器工作量大幅下降 |

## 3. 单轮离线蒸馏全闭环实测 [A]

在样例 git 仓（`evolver-lab/sample-repo/`）以 generic-chat 格式模拟一段 Pi 会话（含「报错→重试→修复→验证成功」模式），跑通完整链路：

```
pi-sample.transcript.jsonl (9 turns)
  → evolver ingest <file> --dry-run     # 识别 [generic-chat]，提取 1 个信号 [success/verified_success]
  → evolver ingest <file> --distill     # 产出 UNPROVEN 候选 gene_distilled_51e31a91（quarantined 隔离态）
  → evolver review                      # 人工门禁队列：1 gene(s) awaiting review
  → evolver review --approve <id>       # 人工批准 → {approved}
  → evolver inject session-start        # 输出 GEP 注入提示词（见第 5 节）
```

**关键实测发现：**

1. **offline 完全可用** [A]：ingest / distill / review / inject 全链路无网络、无 Hub 配置跑通。回答了待研究问题 1——核心蒸馏/固化/注入不依赖 EvoMap 网络，Hub 仅解锁网络功能（skill 共享、worker pool、排行榜）。
2. **去重守卫** [A]：对同一文件重复 distill 被拦："near-duplicate of gene_distilled_51e31a91 (candidate signal subset)"——有 admission gate 防泛滥。
3. **fail-closed 注入** [A]：未 approve 前 `inject session-start` 输出为空——隔离态 Gene 不会进入注入提示词，人工门禁是硬约束。
4. **晋升需积累** [A]：review 显示 `promote: needs 3 more`——与 KB 所述「连续成功≥2 次才晋升」一致的机制存在（具体阈值 v2 为 3）。
5. **自动蒸馏质量粗糙** [A]：auto-draft 的 strategy 字段直接复制 assistant 原文（含"Root cause found..."叙述），summary 标注 "UNPROVEN — curate via review"。**证实 D1 决策正确：必须人工 review 策展，不能 --loop 放任。**

## 4. Gene / Capsule schema 权威定义 [A]

权威源：包内正式 JSON Schema（`@evomap/gep-sdk/schemas/*.schema.json`）+ 真实内置资产（`evolver-core/assets/gep/genes.jsonl`，schema_version 1.13.0）+ 实测蒸馏产物。

### 4.1 Gene（本地 schema v1.13.0）

必填：`type, schema_version, id, category, signals_match, strategy, constraints, validation, asset_id`

| 字段 | 类型 | 说明 |
|---|---|---|
| `category` | enum | `repair / optimize / innovate / explore`（注意：Hub 发布文档另有 `regulatory`） |
| `signals_match` | string[] | 触发信号（**≈ KB 说的 keywords**，官方名为 signals_match） |
| `preconditions` | string[] | 前置条件（可选） |
| `strategy` | string[] | 有序策略步骤（KB 说的 strategy 在此，是数组非单串） |
| `constraints` | object | **必填** `{max_files: int≥1, forbidden_paths: string[]}`——爆炸半径硬约束在 Gene 层 |
| `validation` | string[] | 验证命令（仅 node/npm/npx，禁 shell 操作符，180s 限时，cwd=仓根） |
| `summary` | string | 一句话描述 |
| `anti_patterns` | object[] (≤12) | **负面经验载体** `{at, mode, reason_class, learning_signals[]}`——**KB 说的 AVOID 在 v2 schema 中无独立字段，由本字段承接** |
| `tool_policy` | object\|null | 工具门 `{allow_only[], deny[], severity: warn\|block}`——AVOID 的另一承载点（慎用工具 → deny 列表） |
| `learning_history` | object[] (≤20) | 学习履历 `{at, outcome, mode, reason_class, retryable, learning_signals[]}` |
| `claims` / `scope` / `runtime_profile` / `verifier_profile` | object\|null | 可机判断言/作用域/运行时/验证者坐标（v2 证据投影体系） |
| `routing_hint` | object\|null | `{tier: cheap\|mid\|expensive, reasoning_level}` 路由提示 |
| `asset_id` | string | `sha256:` + canonical JSON（排序键、剔除 asset_id 自身）的 SHA-256 |

### 4.2 Capsule

必填：`type, schema_version, id, trigger[], gene, summary, confidence(0-1), blast_radius{files,lines}, outcome{status: success|failed, score}, asset_id`
可选：`success_streak, success_reason, env_fingerprint{platform,arch,...}, source_type(generated|reused|reference|user_authored), content, diff, strategy, validation`

### 4.3 EvolutionEvent

必填：`type, intent(repair|optimize|innovate|explore), outcome, asset_id`；可选 `capsule_id, genes_used[], mutations_tried, total_cycles`

### 4.4 对启动输入 D3 的实测回答

启动输入假设 Gene 字段 = `keywords/summary/strategy/AVOID`（约 230 token）。**实测 v2 schema 无 `keywords` 无 `AVOID` 字段**：
- 正向策略 → `signals_match` + `strategy[]` + `preconditions[]`
- 负面经验（AVOID）→ 三个承载点：`anti_patterns[]`（学习履历型）、`tool_policy.deny[]`（工具禁用型）、`constraints.forbidden_paths[]`（路径禁区型）
- Hub 发布 profile（skill-structures.md，schema_version 1.5.0）是更窄子集（signals_match+summary+validation），且要求 outcome.score≥0.7、blast_radius.files/lines>0 才可广播

## 5. GEP 注入提示词格式实测 [A]

`evolver inject session-start` 实际输出（approve 后）：

```
evolver memory — use these learned hints silently when directly relevant; do not mention
Evolver, preflight, status, or this memory block unless the user asks or reuse materially
changes the answer:
quiet_context: injected_count=1; use silently; do not mention unless asked or material to the answer.
- gene_distilled_51e31a91 [innovate]: Auto-drafted from generic-chat session (UNPROVEN — curate via review): parser, reproduce, crash
```

形态：一段「静默使用」指示 + quiet_context 元信息 + Gene 摘要列表。注入点 = 宿主 agent 的 session-start 钩子（v2 通过 `evolver setup-hooks --platform=<cursor|claude-code|codex|kiro|opencode>` 接线；部分宿主平台可原生解释 stdout 注入指令）。

## 6. ingest 支持的会话格式（路线 B 直接相关）[A]

实测报错信息 + 源码（`evolver-runtime-adapters/dist/adapters.js`）双重证实，v2 原生支持：

| 格式 | 触发方式 | 内容形状 |
|---|---|---|
| claude-code / codex / cursor / gemini / antigravity / kimi | 各自原生路径特征 | 各自原生 transcript |
| **generic-chat**（★ 路线 B 目标格式） | **文件名正则**：`*.(chat\|messages\|transcript).jsonl?`（如 `xxx.transcript.jsonl`） | OpenAI chat-completions 形状：JSONL 每行一条消息 / 裸 JSON 数组 / `{messages\|turns:[...]}` 包装；支持 `role: user/assistant/tool`、`tool_calls[]`、`tool_call_id` 关联、`reasoning_content/thinking`、会话级 metadata（model/usage 等） |
| llm-trace | 路径特征 | LLM 调用轨迹 |
| kiro / opencode | **v2 已移除**（无真实样本验证，fail-closed） | — |

**Pi 不在支持列表**——`pi_session_adapter` 的必要性实测成立。适配目标 = 把 Pi session JSONL 归一化为 `*.transcript.jsonl`（generic-chat）。

## 7. 待研究问题实测回答汇总

| # | 问题 | 结论 |
|---|---|---|
| 1 | Evolver 能否完全脱离 EvoMap 网络独立跑？ | **[A] 能**。ingest→distill→review→inject 全链路 offline 跑通，零网络配置 |
| 2 | Gene 230 token 结构具体字段？ | **[A] 已获取权威 schema**（第 4 节）。与 KB 描述有出入：无 keywords/AVOID 字段，以 signals_match/strategy/constraints/anti_patterns/tool_policy 承载 |
| 3 | 经验蒸馏能否用现有 LLM 调用自研、绕开 GPL？ | **[C] 可行且更轻**。实测 v2 auto-distill 本身是启发式规则（信号提取+模板起草，未见 LLM 调用痕迹），产出粗糙需人工策展；自研「LLM 蒸馏 + 人工 review + 注入」链路技术门槛低。Evolver 的增量价值在资产库/review 台账/晋升机制/协议互通，不在蒸馏本身 |
| 4 | 能否先做最小 skill 把 learnings→AVOID 跑通？ | **[C] 可行**。落点：蒸馏 Gene 时把踩坑写入 `tool_policy.deny` / `anti_patterns`，或以 warning 风格 summary 起草 Gene 走 review 门禁 |

## 8. 对关键技术决策的实测修正建议

- **D1**：维持「人工 review」结论且被实测强化（auto-draft 质量粗糙 + fail-closed 注入）。v2 无 `--loop` 一键守护等价物，`autoexec` 是常驻守护，首轮不启用。
- **D2**：v2 资产存全局 `~/.evomap/assets/`，不再依赖 per-repo `.evolver/gep/`；AGENT_SESSIONS_DIR 空转问题在路线 B 不存在（我们显式喂文件给 ingest）。
- **D5**：GPL-3.0-or-later 确认；v2 核心模块混淆分发——若走路线 A 深度集成，只能调 CLI/stdout 界面，无法读改引擎源码。
- **D6**：offline 首轮方案实测可行，无需任何 Hub 配置。

## 9. 第二轮：真实 Pi session 全链路（2026-09-05 下午，MVP 步骤 3）[A]

**Pi 本体**：`@earendil-works/pi-coding-agent@0.74.2` 隔离安装成功（注意：npm 上 `pi-coding-agent` 是 Armin Ronacher 的占位包，真包必须带 `@earendil-works/` scope，官方要求 `--ignore-scripts`）。

**字段勘察 [C]→[A] 闭环**：官方 Session format 文档 + Pi 自身 SessionManager 生成的真实 v3 文件双重核实——10 种 entry 类型（session/message/model_change/thinking_level_change/compaction/branch_summary/custom/custom_message/label/session_info），树 = id(8位hex)+parentId；7 种消息 role（user/assistant/toolResult/bashExecution/custom/branchSummary/compactionSummary）；assistant content 为类型化块（text/thinking/toolCall{id,name,arguments}）；toolResult 含 isError 标志；usage 含 totalTokens（token 下降验证有数据基础）。

**适配器原型**（`evolver-lab/adapter/pi_session_adapter.js`，非生产代码）：树→按 leaf 逐分支线性化（主分支 13 turns + 死路分叉 6 turns 各出一份）、7 种 role→generic-chat 映射、toolResult.isError→`ERROR (tool failed):` 显式标注、bashExecution→bash 调用对+exit_code、env_fingerprint 头部注入。

**真实结构 session 全链路实测**：
- 主分支（成功路径）→ 3 信号（2×weak/difficulty + 1×success/verified_success）→ `gene_distilled_d6a16a9c`（UNPROVEN/quarantined）→ review --approve → 注入生效
- 死路分叉（纯失败路径）→ 信号被捕获（weak/difficulty），但 **auto-distill 拒绝起草**："need ≥1 strong signal and ≥1 substantive assistant step"——**纯 AVOID 分支不会自动成 Gene**
- AVOID 通路补全：`evolver distill --category repair --signals ... --strategy ...` 手工蒸馏成功（`gene_distilled_898f2ed4`，source=manual，**{eligible} 免隔离**）
- 最终 `inject session-start`：`injected_count=2`（策略 Gene + AVOID Gene 同时注入）✅
- **v1 `solidify` 亦已弃用**：Capsule 固化改走 `evolver cycle`（需外部 runner claude/codex/gemini）→ review → publish。离线无 LLM 环境下 Gene 级继承完整可用，Capsule 级固化需接 runner

**admission gate 行为补充**：信号级去重（"candidate signal subset"）与相似度去重（similarity 0.60 即拦）双轨；手工 distill 同信号也会拒绝（fully overlaps）。

## 10. 遗留观察项

- `evolver doctor` 在沙箱中挂起被 SIGTERM（[C] 疑似尝试网络/daemon 行为），不影响主链路，未深究。
- v2 自动蒸馏未见 LLM 调用 [C]（依据：distill 秒级完成、无 API 配置、产出为原文模板拼接），如需高质量蒸馏可评估 `evolver cycle`（接 claude/codex/gemini runner）或自研 LLM 蒸馏器。

## 11. 第三轮：继承对比实验（MVP 验收步 4，agnes-cn 实测，2026-09-05）

### 11.1 实验设计
- **唯一变量**：Round 2 通过 `pi --append-system-prompt` 注入 `evolver inject session-start` 输出（`injected_count=2`：`gene_distilled_d6a16a9c` [innovate] + `gene_distilled_898f2ed4` [repair/AVOID：JSONL 不可当单个 JSON array 解析，须逐行+空行过滤]）。
- 其余全一致：同一任务文本（逐字）、同一 repo 模板（`exp/round-template` 整目录复制为 round2，含同一 git init commit）、同模型 `agnes-2.5-flash`、同 provider `agnes-cn`、同 `--api-key` 显式传参。
- 指标：totalTokens（session usage 求和）、assistant 消息数、toolCalls、toolErrors、墙钟、产出正确性（独立脚本重算 fixture 真值交叉验证，非模型自证）。

### 11.2 基线修正 [A]
重查 Round 1 session 目录实为 **2 个文件**：R1-a（09:59:47）= 401「无效的令牌」首发失败（`stopReason=error`、usage 全 0，即 `models.json` `$ENV` 插值失效那次）；R1-b（10:01:17）= `--api-key` 后的有效运行。**修正口径**：Round 1 有效轮 = 4 assistant / 4 toolCalls / 0 任务错误 / 12,824 tokens；目录聚合口径中的 1 次 error 是基础设施 401（0 token，与任务执行无关）。

### 11.3 结果对比 [A]（独立重算 fixture 真值：11 entries / 4 leaves {f6,h8,i9,k1} / 2 orphans {g7,i9}，两轮产出均正确）

| 指标 | Round 1（有效轮） | Round 2（注入基因） | Δ |
|---|---|---|---|
| totalTokens | 12,824 | 17,091 | **+4,267（+33%）** |
| input | 11,529 | 15,589 | +4,060 |
| output | 1,295 | 1,502 | +207 |
| assistant 消息 | 4 | 5 | +1 |
| toolCalls | 4 | 5 | +1 |
| 任务相关错误 | 0 | 0 | 0 |
| 墙钟 | 1m35s | 1m08s | -27s（-28%，单样本） |
| 产出正确 | ✅ | ✅ | — |

### 11.4 归因（逐消息 token 分解）[A]
- 注入块 564 字符 ≈ **140 token/请求**恒定附加（R2 首请求 input 2094 vs R1 1956，Δ=138）。
- Δ 大头是 R2 多出 1 个 turn：末次请求全上下文重发 4,121 input，单这一轮即占 input Δ 的绝大部分。
- 多出的一步**不是试错**：R2 主动写了更精细实现（malformed 行容错告警、box-drawing 树形打印、`__root__` 哨兵节点），msg3 output 966（R1 最大单条 802）——属"做得更多"，非"重复踩坑"。

### 11.5 结论：MVP 验收假设未证实，暴露三个方法学发现
1. **token 下降未出现（+33%）**：R1 有效轮本就零试错，AVOID 基因针对的失败模式（JSONL 当单个 array 解析）agnes-2.5-flash 首轮即未犯，基因无坑可避；注入块本身成净开销（~140 tok/req）。
2. **闭环缺口 [A]**：Evolver v2.0.30 信号门槛（需 ≥1 strong signal + ≥1 substantive assistant step）导致**干净成功轮蒸馏不出任何资产**（第 9 节实测：R1 真实 session → 0 signals）。即"成功→继承→下轮更省 token"此路在当前 admission gate 下不通；只有"失败→AVOID→下轮避坑"能产资产。
3. **基因必须与失败模式同源**：本次注入的是异源 curated session 的基因，与本任务实际失败模式不匹配。有效继承实验须：R1 真实踩坑 → 从该 session 蒸馏 → R2 验证避坑。
4. **单跑方差大**：同任务同模型两跑步数可差 1 轮（token ±30% 量级），对比实验需 N≥5 取中位数，或以"错误数/避坑率"为主指标。

### 11.6 下一步建议
- 重设计继承实验：选模型**必然首踩**的陷阱型任务，让 R1 自然产生 error narrative → 适配器转换 → distill（auto 不足则 `evolver distill --category repair` 手工补）→ R2 注入验证避坑率 + token。
- 评估 `evolver cycle` 接外部 runner 的 LLM 高质量蒸馏（v2 自动蒸馏为模板拼接，无 LLM）。
- token 对比改多次重复取中位数；主指标改避坑率/错误数。

## 12. 第四轮：对靶继承实验（BOM 陷阱，agnes-cn，2026-09-05）——继承假设首次证实

### 12.1 设计（针对第 11 节三教训重做）
- **陷阱 fixture**：`data/events.jsonl` 首行带 UTF-8 BOM（EF BB BF，xxd 实证），朴素 `json.loads` 逐行解析必抛 `JSONDecodeError: Unexpected UTF-8 BOM`。真值独立重算：count=8 / sum=1005 / earliest=2026-08-31T22:10:00Z。
- **四轮对照**：R1a/R1b 无注入基线；R2a/R2b 注入单基因。任务文本逐字一致、repo 模板整目录复制、同模型 agnes-2.5-flash、同 provider agnes-cn。
- **单变量控制**：实验前备份并清空 `~/.evomap/assets`（backup-2026-09-05-trap/），R2 注入块仅含新基因（`injected_count=1`）。

### 12.2 蒸馏链实测（闭环缺口复现并细化）[A]
- R1a session（含 **2 次真实 BOM 报错**）经适配器转换 → `ingest --distill`：仅抽出 1 条 weak `success/success_prose` 信号，auto-distill 仍拒绝（"need ≥1 strong signal and ≥1 substantive assistant step"）。**即使 session 内含真实工具错误，v2.0.30 generic-chat 信号抽取也不会把错误提升为 strong 信号**——闭环缺口从第 11 节的"干净轮 0 信号"细化为"含错轮同样产不出 strong 信号"，auto-distill 在离线场景形同虚设。
- 人工补位：`evolver distill --category repair --signals jsonl_bom_decode_error,tool_failure_observed --strategy "AVOID: ...utf-8-sig..."` 成功（`gene_distilled_495d2b2a`，manual 源免隔离）→ `review --approve` → `inject` 确认单基因。

### 12.3 结果 [A]（四轮产出均独立验证正确）

| 指标 | R1a | R1b | R2a（注入） | R2b（注入） | 基线均值→注入均值 |
|---|---|---|---|---|---|
| totalTokens | 14,932 | 14,000 | 8,181 | 7,656 | 14,466 → 7,919（**-45.3%**） |
| BOM 报错次数 | 2 | 1 | 0 | 0 | 1.5 → 0（**避坑 2/2**） |
| toolCalls | 6 | 6 | 4 | 3 | 6 → 3.5 |
| assistant 消息 | 5 | 5 | 3 | 3 | 5 → 3 |
| 墙钟 | 43s | 15s | 13s | 33s | 噪声大仅供参考 |
| 产出正确 | ✅ | ✅ | ✅ | ✅ | — |

- R2 两轮脚本**首版即** `encoding="utf-8-sig"`（grep 实证 `trap-r2a/analyze.py:15`、`trap-r2b/analyze.py:3`），全程零 BOM 报错。
- token 下降构成：省去的是错误恢复轮（每次 BOM 报错 ≈ 1 toolResult + 1 assistant 重试 ≈ 数千 tok 上下文重发）；单基因注入块自身 ~40 tok/req，开销可忽略。

### 12.4 结论
1. **继承假设首次证实 [A]**：基因与失败模式同源时，注入轮 2/2 精确避开目标陷阱，token 均值 -45.3%，assistant 步数 5→3。第 11 节 +33% 反例的根因确认是"基因不对靶"，而非继承机制无效。
2. **闭环仍断在蒸馏自动化**：含真实错误的 session 也过不了 strong-signal 门槛。"Pi 执行 → Evolver 自动学 → 下轮继承"目前必须在 distill 环节人工补位，或接 `evolver cycle` 的 LLM runner。
3. **可复用的对靶实验范式**：陷阱 fixture + 逐字任务文本 + 整目录 repo 复制 + 资产库备份重置（单变量）+ 每侧 N≥2 + 独立真值脚本交叉验证（非模型自证）。

### 12.5 局限
- N=2/侧样本小；单陷阱类型、单模型，泛化（换模型/换陷阱）未测。
- Gene promotion 积累制（"needs 3 more"）未走到；Capsule 固化未测。

### 12.6 下一步
- N≥5 复跑固统计；换陷阱类型/换模型测泛化。
- 补自动蒸馏：研究 evolver 信号抽取规则，适配器侧将 toolResult isError 段定向改写为其认可的 strong 信号格式；或 `evolver cycle` 接 runner。
- Capsule 固化（cycle+runner）与 Route A（Pi Extensions API）预研照旧。
- 实验后资产池已合并回 3 条基因（inject 确认 `injected_count=3`）。

## 13. 第五轮：攻自动蒸馏缺口——is_error 契约修复，auto-distill 闭环打通（2026-09-05）

### 13.1 根因定位（源码级）[A]
逐层研读 v2.0.30 安装源码（evolver-core/signals/extractor.js + evolver-runtime-adapters/adapters.js + evolver-cli/distillPrimitives.js），链路判定如下：
1. **抽取器规则**（extractor.js，混淆代码中正则明文可见）：`STRONG_TEXT=/(^|\n)\s*(Error:|Traceback|Exception|FAILED|panic:|exit code [1-9])/` 只测 turn 的 `text` 字段；**strong 错误信号另有专道——`turn.errorMessage` 分支直推 strong/error_result**。
2. **errorMessage 来源**（adapters.js:864-878 `chatMessageToTurns`）：role=tool 的消息**仅当**带 `is_error/isError===true` 显式标志、或文本以 `Exit code: N≠0` 开头，才设置 `turn.errorMessage`；源码注释明言"extractSignals mines strong tool errors from errorMessage … without this a failure produces no signal"。
3. **准入门**（distillPrimitives.js:145-153 `draftGeneCandidate`）：`hasStrongError = sigs.some(s=>s.strength==='strong')`，无 strong 错误信号则只能走 innovate 兜底（sniffer 不中就返回 null → "not enough to distill"）。
4. **旧适配器缺陷**：仅用文本前缀 `ERROR (tool failed):` 标注失败，该文本落在 `toolResult` 字段——`STRONG_TEXT` 不测它、`errorMessage` 未设置 → strong 信号恒为 0。这就是"干净轮/含错轮都产不出 strong 信号"的统一根因。

### 13.2 修复（忠实标注，非造假）
`pi_session_adapter.js`：toolResult 的 `isError===true` 时输出消息追加 `"is_error": true`；bashExecution 的 `exitCode!==0 || cancelled` 时同样追加。仅把 Pi session 里真实的失败事实翻译成 evolver 契约认可的显式标志，内容零改动。

### 13.3 端到端验证 [A]
- R1a trap session 重转 → `ingest --distill`：**2× strong/error_result + 1× success_prose** → auto-distill **自动起草** `gene_distilled_65dec53a`（repair/UNPROVEN/quarantined，strategy 从 session 自身 turns 草拟："The file has a UTF-8 BOM. Let me fix the script:…"）→ `review --approve` → inject 生效。**全程零人工 distill 补位**。
- R1b（同类 BOM 错误）→ 被 `candidate signal subset` 去重正确拦截（near-duplicate of 65dec53a）——去重门行为符合设计。
- 资产池已合并恢复：`injected_count=4`。

### 13.4 结论
1. **自动蒸馏缺口已打通**：Pi 执行 → 适配器转换 → `ingest --distill` 自动起草 → 人工 review（保留人工门）→ inject，全链路首次无断点。闭环只剩 review 这一个人工节点（属设计内的人工把关，非缺陷）。
2. **质量分层仍在**：auto-draft 的 signals_match（bash/exception）与 strategy（叙述摘录）比手工蒸馏的精准 AVOID 规则粗糙——量大靠 auto、质精靠 manual/cycle-runner，两者互补。
3. 附帶发现：`autoDistillTranscript.js` 内置 LLM 兜底蒸馏路径（prose-rich + weak/zero signal 时触发，默认 OFF、输出隔离），可作为日后接 LLM 的官方入口。

### 13.5 剩余待办（用户确认保留）
N≥5 复跑 / 换陷阱换模型泛化 / Capsule 固化（cycle+runner）/ Route A（Pi Extensions API）。

---

## 14. 一站式闭环编排器 `pi_evolve.mjs`（端到端验证）[A]

### 14.1 动机与定位
§11–§13 已分别验证「继承机制成立」（§12，同源 BOM 陷阱 -45.3%）与「自动蒸馏缺口已打通」（§13）。但三步仍靠手工串联：`adapter 转换 → evolver ingest --distill → evolver review --approve → evolver inject → Pi R2`。为把整条链路固化成可复跑、可单变量、可演示的一条命令，构建 `evolver-lab/bin/pi_evolve.mjs`。

### 14.2 设计
- 单命令：`node bin/pi_evolve.mjs <repo模板目录> <任务文本文件> --provider X --model Y --api-key $K --rounds 2 [--fresh] [--auto-approve]`。
- 主循环：每轮 `cp 模板→rN` → Pi 执行（`--session-dir`，R>1 时 `--append-system-prompt "$(cat inject-rN.txt)"` 注入已审核基因）→ `sum_tokens.js` 聚合 token/工具调用/错误数。
- R1 之后：adapter 转换 session → `evolver ingest --distill` 自动起草 gene；命中 `gene_distilled_xxx` 则按 `--auto-approve` 决定自动 `review --approve`（全自动化演示）或打印人工审核门命令（默认保留人工把关）。
- `--fresh`：运行前备份 `~/.evomap/assets` 到 `backup-<ts>` 并清空（单变量控制，隔离历史资产）。
- 路径契约修正（本轮实测发现并修复的两处真 bug）：工作目录含空格（`Pi × EvoX 项目`），原脚本对 `cat` 的入参**未加引号**，在含空格路径下会断裂；改为 `path.replace(/\\/g,'/')` 转 posix 并对 `cat "..."` 双引号包裹。另：调用方原先用 `/tmp/bom_task.txt`，Windows 下 bash 写入路径与 Node `readFileSync` 解析路径不一致（`C:\tmp\...` ENOENT）；改为 Windows 绝对路径 `C:/.../evolver-lab/exp/bom_task.txt`，bash 与 Node 两边解析一致。

### 14.3 端到端验证（BOM 陷阱，--fresh --auto-approve --rounds 2）[A]
实测输出（工作区 `exp/loop-1788606387351`）：
```
[fresh] 已备份旧资产库到 .../backup-1788606387354 并清空
ROUND 1 (baseline): Pi 跑通，命中 BOM/file-not-found 错误
  [distill] ✎ drafted UNPROVEN gene gene_distilled_fe6f4613 (sha256:b9075d09…) — quarantined
            signals_match: read, file-not-found, bash, exception
  [gate] 自动审核通过 gene_distilled_fe6f4613（--auto-approve）
ROUND 2 (injected): Pi 注入基因后跑通，utf-8-sig 正确处理 BOM，0 错误
跨轮对比:
  round | injected | totalTokens | input | output | toolCalls | errors
  1     | false    | 52111       | 18735 | 1632   | 17        | 3
  2     | true     | 7555        | 7142  | 413    | 4         | 0
  基线首轮 52111 → 末轮 7555（Δ -85.5%）
```
落盘实证（已用独立命令复核）[A]：
- `genes.jsonl`：`gene_distilled_fe6f4613`（schema 1.13.0 / category repair / source distilled / signals_match=read,file-not-found,bash,exception）。
- `review.jsonl`：该基因 `quarantined @11:08:47` → `approved by cli @11:09:05`，与 `--auto-approve` 一致。
- 工作区：`sessions/r1/*.jsonl`、`sessions/r2/*.jsonl`、`transcript/*.transcript.jsonl`、`inject-r2.txt`（439 B，非空前已被 R2 消费）。

### 14.4 结论与口径诚实声明
1. **闭环编排器可用**：Pi→adapter→ingest --distill→（自动）review→inject→Pi R2 已能用一条命令跑通；`--fresh` 保证单变量、`--auto-approve` 关闭人工门做全自动化演示、`--root` 可指定工作区。整条链路至此**除「人工 review」这一设计内把关节点外无任何断点**。
2. **继承/避坑再次确认**：R1 含 3 处错误 → R2 注入基因后 **0 错误**，BOM 处理（utf-8-sig）被正确继承。
3. **token 降幅口径提示（不夸大为 -85.5% 即「继承收益」）**：本轮 R1=52111 tok 显著偏高，主因是 R1 起步时 `data/events.jsonl` 不在根目录，Pi 先做了 `file-not-found` 探索并把模板拷进 `data/`（额外 17 次工具调用），属一次性探索开销；R2 直接继承故仅 4 次调用。故 **-85.5% 不宜直接等同 §12 的 -45.3% 继承收益**——后者是在「同源、同任务、已就位数据」的受控对比下得到的更干净指标。两条结论互补：**错误规避（3→0）是继承的直接、稳健证据；token 降幅需在同口径下复测才有可比性**（即 §13.5 的 N≥5 复跑应锁定「数据已就位、任务逐字一致」条件）。
4. 全程无 `/etc/msystem … No such file or directory` 之外的报错；该警告为 Git-Bash/MSYS 环境噪音，不影响功能。

### 14.5 下一步（沿用 §13.5 用户确认保留项）
以 `pi_evolve.mjs` 为基准复跑：①N≥5 锁定「数据就位+任务逐字一致」条件取均值避坑率；②换陷阱类型/换模型测泛化；③Capsule 固化（evolver cycle + 外部 runner）；④Route A（Pi Extensions API 预研）；⑤清理生产环境中一份已失效的 fallback 模型配置（独立运维待办）。

---

## 15. N=3 受控复跑：编排器验证通过，但 BOM 陷阱已失效 [A]

### 15.1 目的
锁定「数据就位+任务逐字一致」条件（消除 §14 的 `file-not-found` 探索噪声），以 N=3 独立复跑量化继承效应。

### 15.2 编排器硬化（已落地 `pi_evolve.mjs`）
- 主循环前把陷阱 `data/events.jsonl` 预置到 LAB 根（Pi 的 cwd），R1 直接命中陷阱而非先探索；脚本末尾清理 `LAB/data` 与 `LAB/analyze.py`，避免污染仓库。
- 验证：3 次复跑均干净完成（无 `file-not-found` 噪声），对比表正常打印；当无强信号时 `ingest` 正确返回 `not enough to distill … Nothing stored`，R2 的 `injected=true` 实为对空资产库 `append` 空块（无实际注入、无崩溃）——**编排器鲁棒性确认**。

### 15.3 复跑结果 [A]（工作区 exp/rep-1..3，各 --fresh --auto-approve）
| rep | R1 tok/tool/err | R2 tok/tool/err | Δtok | 陷阱命中 | 自动蒸馏 |
|---|---|---|---|---|---|
| 1 | 7295 / 3 / 0 | 4089 / 3 / 0 | -43.9% | 否 | 否 |
| 2 | 4089 / 3 / 0 | 11017 / 6 / 0 | +169.4% | 否 | 否 |
| 3 | 6597 / 6 / 0 | 6597 / 6 / 0 | 0.0% | 否 | 否 |

全部 3 次 R1 **0 错误**；`ingest` 三连 `not enough to distill — need ≥1 strong signal`，**0 次自动起草基因**。R1 输出均自述「UTF-8 BOM … handled via utf-8-sig」——模型首轮即正确识别并处理 BOM，陷阱未触发。

### 15.4 关键发现：BOM 陷阱对 agnes-2.5-flash 已失效 [A]
- 对照 §12/§14（BOM 命中 2/2、R1 3 错误）本次 **0/3 命中**：agnes-2.5-flash 已对 BOM 具备主动鲁棒性（首读即 `utf-8-sig`），**BOM 不再是该模型的可靠失败注入点**。
- 故 §12 的「避坑 2/2、token -45.3%」与 §14 的「R1 3错误→R2 0错误」均为**陷阱命中时的偶发个例**，非可复现统计效应；其价值退化至「机制级证明」（闭环在陷阱命中时确实工作，见 §14 单跑），**不可作为继承效应的重复统计证据**。
- 三次 token Δ（-43.9% / +169.4% / 0.0%，均值≈+41.8%）为**纯 LLM 轮间方差噪声**（无陷阱、无注入），与继承无关，不可解读。

### 15.5 结论与转向
1. **编排器可用且鲁棒**：单命令闭环、干净基线、空库优雅降级、产物清理均已验证——这是本回合的扎实 [A] 产出。
2. **当前测试夹具（BOM）已破产**：无法稳定诱导失败 → 无法稳定产基因 → 无法测继承/避坑率；继续在 BOM 上堆 N 无意义。
3. **下一步必须是「可靠陷阱」**：需一个**确定性错误**（agnes-2.5-flash 稳定命中且单轮内不自愈）的夹具，才可能得到可复现避坑率。候选方向：①确定性编解码陷阱（含无效 UTF-8 字节强制 `UnicodeDecodeError`，但须验证模型不会单轮自愈）；②换用更易踩坑的模型/provider；③环境型确定性失败（依赖缺失/版本钉死致必错命令）。在找到 hit-rate 高且稳定的陷阱前，继承效应不做统计声称。

### 15.6 对 §12/§14 置信度修正
- §12/§14 保留为「机制级 [A] 实证」（陷阱命中时闭环确实工作），但**删除其作为『继承效应可复现统计证据』的解读**；相关「避坑率/降幅」标注为偶发个例。
- 待办更新：N≥5 复跑暂缓，改为「先建可靠陷阱，再在其上做 N≥5」。

---

## 16. 注入缺口根因 + 策略注入修复 + N=5 验证 [A]

### 16.1 更深层根因：evolver inject 丢弃 strategy（比陷阱更关键）
- 现象：§15 GBK 陷阱修复前 N=5，R2 仍 4/5 含 `UnicodeDecodeError`，token Δ 多为正（均值 +13.8%）——继承不见益处。
- 排查 [A]：基因记录 `genes.jsonl` 含 `strategy` 字段（如 `"The file is GBK… use encoding='gbk'"`），但 `evolver inject session-start` 仅输出 `summary` 标签（`Auto-drafted … : bash, exception`）；`inject prompt-recall --hook-stdin` 对相关提示返回 `{}`。即**注入步只传元数据标签、不传可执行的修法**。
- 结论：此前所有"避坑"观察（含 §14 BOM 的 R1 3错→R2 0错）几乎必然是模型自身反射，而非基因在起作用——因为基因修法从未抵达 R2。

### 16.2 修复：编排器自取 strategy 拼入注入块
- `pi_evolve.mjs` 新增 `loadApprovedStrategy()`：读 `genes.jsonl` 抽取**已审核**（`review.jsonl` 中 `state=approved`）基因的 `strategy` 文本，拼回 R2 的 `append-system-prompt`；交叉核对 `review.jsonl` 以尊重审核门；空库时优雅降级（append 空块）。

### 16.3 N=5 验证（GBK 陷阱 + 策略注入）[A]
| rep | R1 解码错 | R2 解码错 | token Δ |
|---|---|---|---|
| 1 | 1 | 1 | -55.0% |
| 2 | 3 | 0 | -82.6% |
| 3 | 2 | 1 | -62.9% |
| 4 | 3 | 1 | -50.0% |
| 5 | 2 | 1 | -26.2% |
| 合计/均值 | 11 | 4 | 均值 -55.3% |

- 注入块实测确含修法（rep1：`[repair] The file is GBK-encoded… use encoding='gbk'`）。
- 解码错误 R1→R2 由 11 降至 4（**每轮 R2≤R1，方向性避坑 5/5**）；token **5/5 全面下降**（均值 -55.3%，区间 -26%~-83%）。
- 残留：R2 仍偶发 4 次解码错（rep1/3/4/5 各 1），因自动蒸馏的 `strategy` 是叙述性**软提示**，模型首读仍偶尔默认 utf-8。

### 16.4 结论
1. **注入缺口已修复并验证**：修法送达后，继承效益首次被干净证明——5/5 轮 token 显著下降、解码错误 11→4。这是本项目第一个**可复现的继承效益统计证据**。
2. **对前文的修正**：§15「BOM 陷阱失效」仍成立（模型对 BOM 主动鲁棒）；但 §14 的「避坑」被重新解释为模型反射而非基因作用——根因是注入未传 strategy。§12/§14 的避坑率口径作废，以本节 N=5 为准。
3. **局限**：auto-distill 的 `strategy` 为软提示，无法 100% 强制首读即用；完全 0 错仅 rep2 达成。若要 100% 避坑，需 manual 精准 AVOID 基因（§13 已证可行）或更强注入通道。
4. **机制级结论**：Pi→adapter→distill→(审核)→inject→Pi 全链路现在**真正闭环**——R1 踩坑→基因记下修法→R2 继承并显著省 token / 少踩坑。

### 16.5 待办（沿用并收敛）
- 泛化：换陷阱类型 / 换模型验证策略注入继承；N 可加大或换更稳陷阱求 100% 避坑。
- Capsule 固化（evolver cycle + 外部 runner）；Route A（Pi Extensions API 预研）。
- （运维）清理生产环境中一份已失效的 fallback 模型配置（独立待办，与本报告无关）。

---

## 17. 泛化验证：跨陷阱类别成立 + 陷阱设计方法论 + 配对对照修正 [A]

### 17.1 两个新陷阱的实证结果
**（a）数值类型陷阱（预期"模型可能犯错"类）——0/3 触发，失败**
- 设计：`value` 存为带小数字符串 `"120.0"`，任务称其为 integer，诱导 `int(v)`（已实测 `int("120.0")` 必抛 `ValueError`）。
- N=3 实测：R1 ValueError **全 0**——agnes-2.5-flash 直接用 float/转换处理，未踩坑；蒸馏 1/3（且非目标信号）；R2 注入块不含数值修法。
- token Δ：-24.4% / -26.4% / -18.2%（均值 -23.0%）——但 rep2/3 **无基因注入**（空库），此降幅是**重复执行学习效应**，非继承。

**（b）非法 JSON 陷阱（"环境必然失败"类）——泛化验证通过**
- 设计：8 行有效数据（真值 8 / 1005 / earliest=2026-08-31T22:10:00Z，与 GBK 同口径）+ 末尾 1 行缺右括号的坏 JSON——**任何 JSON 解析器遇之必抛**（已实测 `JSONDecodeError: Expecting ',' delimiter`），不依赖模型犯错。
- N=3 实测：

| rep | R1 JSONDecodeError | R2 | token Δ |
|---|---|---|---|
| 1 | 3 | 1 | -31.1% |
| 2 | 4 | 2 | -54.5% |
| 3 | 7 | 0 | -73.4% |
| 合计/均值 | 14 | 3 | -53.0% |

- 蒸馏 3/3；R2 注入块实测含修法（`except` / `malformed` / `skip`——容错跳坏行策略被继承）；**每轮 R2<R1，方向性避坑 3/3**。

### 17.2 陷阱设计方法论（本轮最重要的可迁移结论）
| 陷阱 | 触发机制 | N | R1→R2 错误 | 蒸馏 | 结论 |
|---|---|---|---|---|---|
| GBK 编码（§16） | **环境必然失败**（无效 UTF-8 字节） | 5 | 11→4 | 5/5 | ✅ 有效 |
| 非法 JSON（§17b） | **环境必然失败**（语法错误） | 3 | 14→3 | 3/3 | ✅ 有效 |
| 数值类型（§17a） | 模型可能犯错（int("120.0")） | 3 | 0→0 | 1/3（非目标） | ❌ 不可用 |
| BOM（§15） | 模型可能犯错（是否主动 utf-8-sig） | 3 | 0→0 | 0/3 | ❌ 已失效 |

> **原则：可靠的继承实验陷阱必须是「环境必然失败」**（数据/环境的客观缺陷，任何实现都会撞上），而非「模型可能犯错」（对 capable model 命中率不可控且会随模型升级漂移）。GBK 与非法 JSON 分属**编码类 / 数据格式类**两个类别均验证通过——策略注入继承**不是单一陷阱的过拟合**。

### 17.3 配对对照修正（对 §16 token 结论的精确化）
数值陷阱的失败意外提供了**无基因对照组**（rep2/3 空库，R1→R2 纯重复执行）：token Δ -26.4% / -18.2%，即**重复执行学习效应基线 ≈ -22%**。据此重新校准各条件的因果解读：

| 条件 | token Δ 均值 | 相对重复基线（-22%）的净效应 |
|---|---|---|
| 无陷阱无基因（type-rep2/3） | -23.0% | 0（基线） |
| GBK 陷阱 + 只注入标签（§15 修复前） | +13.8% | **+36pp（更差）** |
| GBK 陷阱 + 策略注入（§16） | -55.3% | **-33pp（净收益）** |
| 非法 JSON 陷阱 + 策略注入（§17b） | -53.0% | **-31pp（净收益）** |

> §16 的因果结论因此**更精确也更稳固**：token 绝对降幅（-55%）中约 -22pp 来自重复执行，**基因注入的净贡献约 -30pp**；且"只注入标签"反而比不注入更差（+36pp）——证明**注入内容的质量是继承有效性的决定变量**，单纯"有注入"没有意义。

### 17.4 结论
1. **泛化验证通过**：跨两个「环境必然失败」类别（编码 / 数据格式），策略注入继承均成立（错误 11→4、14→3；token 净收益约 -30pp）——继承效应不是 GBK 特例。
2. **陷阱设计原则确立**：只认「环境必然失败」型陷阱；「模型可能犯错」型对 capable model 不可靠（数值类型 0/3、BOM 0/3 双重印证）。
3. **方法纪律**：token 指标必须配对对照解读（扣除重复执行基线）；错误指标用陷阱特异信号（UnicodeDecodeError/JSONDecodeError）而非总错误数。

### 17.5 待办
- 换模型泛化（deepseek/agnes-hub）——**阻塞于本机无对应 key**（本地仅 agnes-cn.key；deepseek key 经授权从既有部署环境取得）。
- Capsule 固化（evolver cycle + 外部 runner）；Route A（Pi Extensions API 预研）。

---

## 18. 换模型泛化（deepseek-v4-flash）：机制跨模型成立 + 陷阱触发率边界 [A]

### 18.1 实验准备（key 授权获取）
- 经授权从既有部署环境的智能体配置（OpenAI 兼容自定义 provider 段）提取 deepseek key → 本地 `secrets/deepseek.key`（stdout 重定向写入，key 不经过对话与日志）。
- **对靶验证**：真实 `POST /v1/chat/completions`（deepseek-v4-flash）→ **HTTP 200**。
- 本机 Pi 注册 custom provider：`~/.pi/agent/models.json` 增 deepseek（baseUrl api.deepseek.com/v1，模型 deepseek-v4-flash）；改前备份 `models.json.bak-20260906`。

### 18.2 N=3 结果（GBK 陷阱 + 策略注入，deepseek-v4-flash）
| rep | R1 解码错 | R2 解码错 | 蒸馏 | token Δ |
|---|---|---|---|---|
| 1 | 3 | 2 | ✅ | -2.7% |
| 2 | 0（无真实错误） | 2 | ❌（正确拒绝） | +59.0%（无注入） |
| 3 | 3 | 1 | ✅ | -49.0% |
| 合计 | 9 | 5 | 2/2 | — |

- 触发 2/3、蒸馏 2/2（踩坑轮全蒸馏）、方向性避坑 3/3（9→5）；rep1 注入块实测含 gbk 修法。

### 18.3 rep2 排查：ingest 拒绝是正确行为，非缺陷 [A]
逐条解析 R1 session 原始证据：3 处 `UnicodeDecodeError` 字样**均非真实错误**——1 处是 `read` 工具成功读取 analyze.py 源码（源码含 `except UnicodeDecodeError` 字样），2 处是 assistant thinking 提及。deepseek 首版即写 `'rb'` 二进制读安全代码，**R1 全程零真实错误**（0 条 `isError=True`）→ `not enough to distill` 判定正确。grep 字符串计数必须区分「真实 tool 错误」与「文本提及」，本轮已用 role/isError 逐条核实。

### 18.4 方法论边界修正：「环境必然失败」也有绕过面
- GBK 陷阱的「必然」是**常规 utf-8 文本读**下的必然；模型可用 `'rb'` 二进制读 + 手动解码等非常规路径**绕过**（deepseek rep2 即如此）。
- 触发率实测：agnes-2.5-flash **5/5**（§16）vs deepseek-v4-flash **2/3**。陷阱可靠性是「陷阱 × 模型」的联合属性，不是陷阱单独属性；跨模型实验必须先探触发率，再谈避坑率。

### 18.5 换模型泛化结论
1. **机制链路跨模型成立**：触发→自动蒸馏→审核→修法注入→R2 降错，在 deepseek 上同样走通（rep1/3：R2 解码错均低于 R1；错误合计 9→5）。
2. **效果幅度模型相关**：agnes（软提示遵从度高）净 token 约 -33pp、避坑 5/5；deepseek 方差大（有基因轮 -2.7%/-49.0%，无基因轮 +59.0%），R2 未归零。
3. 对照表（策略注入条件下）：

| 模型 | 陷阱 | 触发率 | R1→R2 错误 | 避坑方向 |
|---|---|---|---|---|
| agnes-2.5-flash | GBK | 5/5 | 11→4 | 5/5 |
| agnes-2.5-flash | 非法JSON | 3/3 | 14→3 | 3/3 |
| deepseek-v4-flash | GBK | 2/3 | 9→5 | 3/3 |

### 18.6 待办更新
- 泛化验证（换陷阱 + 换模型）**已完成**；如需更稳触发可设计"无绕过面"陷阱（如受控破坏环境依赖）或 N 加大。
- Capsule 固化（evolver cycle + 外部 runner）；Route A（Pi Extensions API 预研）。

---

## 20. Route A 扩展注入实测 + auto-distill 质量方差发现 [A]

### 20.1 实验设置
- Route A 预研（设计草案 §12）确认 Pi 0.74.2 原生扩展 `before_agent_start` 钩子可每轮动态注入 system prompt。骨架 `evolver-bridge.ts` 加注入留痕（`~/.evomap/assets/bridge-last-inject.txt`）后激活于项目本地 `.pi/extensions/`（全局零污染）。
- 编排器新增 `--ext-inject` 模式（R2 零 CLI 注入参数）。GBK 陷阱 × N=3（agnes-2.5-flash，--fresh --auto-approve），与 §16 CLI 注入（N=5）同模型同陷阱配对。

### 20.2 结果
| 通道 | N | R1→R2 解码错 | token Δ 均值 | 注入含修法 |
|---|---|---|---|---|
| CLI 拼参数（§16） | 5 | 11→4 | -55.3% | 5/5 |
| **Pi 扩展钩子（本轮）** | 3 | **4→6** | **+3.6%** | **0/3** |

### 20.3 判定：扩展链路 ✅ 全通，根因在蒸馏产物质量 [A]
1. **扩展链路实证工作**：留痕文件时间戳与 ext-rep3 R2 吻合，扩展的自动发现 → 钩子触发 → store 读取 → systemPrompt 链式修改全通；R1 空库零注入（fail-open）符合设计。**Route A 技术路线验证通过**。
2. **根因**：本轮三轮 auto-distill 均从 R1 session 摘录**末尾成功总结叙述**（"The script works correctly… One note: the file uses…"），evolver 生成 strategy 时截断，`gbk` 修法关键词被切掉 → 注入内容无修法信息 → R2 无收益（4→6，token +3.6%，即 §11「不对靶注入净开销」模式）。
3. **质量方差来源**：蒸馏摘录偏向 session 末尾 turn；R1 错误密度高（§16，合计 11 次）时修复叙述占比大 → 摘到修法；错误密度低（本轮，合计 4 次）时以成功总结收尾 → 摘到噪声。
4. **再次独立印证 §17.3**：注入内容质量是决定变量；"有注入"≠"有继承"。

### 20.4 待办（新议题：蒸馏质量）
- 扩展侧注入质量守卫（strategy 无错误/代码关键词时跳过注入，宁缺毋滥）；
- 蒸馏质量提升：manual 精修通路（已验证）或开启官方 LLM 兜底 `autoDistillTranscript.js`（默认 OFF）实测；
- 扩展骨架保持激活态可复测；硬约束通道（tool_call 改写）仍留作设计决策。

---

## 21. 蒸馏质量治理：守卫 + LLM 重写双保险 [A]

### 21.1 方案设计（研读官方源码后定案）
- **研读**：`@evomap/evolver-cli/dist/autoDistill*.d.ts` [A]——官方 LLM 兜底 `autoDistillTranscript` 的 runner 仅内置 claude/codex（本机均无 CLI），gate 语义为「无 strong 信号才走 LLM」（与我们场景相反：我们有 strong 信号但结构蒸馏摘录质量差）；但官方导出 `runner` 测试接缝与 `buildTranscriptDistillPrompt`/`parseDistillOutput` 纯函数。
- **定案（务实路线）**：不走官方内部对象图，采用「**守卫 → LLM 重写 → 官方 manual-distill CLI**」三段式，全部走已验证的官方 CLI 面（`evolver distill --category repair --strategy ...`，manual 源免隔离）。

### 21.2 实现
1. **注入质量守卫**（双侧）：`REPAIR_SIGNAL_RE`（error/exception/fix/encoding=/utf-8/gbk/except/skip…，大小写不敏感）——**规则先在 4 个真实历史样本上验证再进生产**：§16 gbk修法✓ / §17 容错修法✓ / §20 成功总结✗（正确拒绝）/ §18 gb18030叙述✓，4/4 分类正确。部署位置：扩展 `loadApprovedStrategies()` + 编排器 `loadApprovedStrategy()` 读取侧——无修法信号的 strategy 直接不注入，宁缺毋滥。
2. **`--llm-refine`**（编排器）：R1 蒸馏后守卫检查 → 无修法信号时把 transcript（截 9000 字符）+ 指令喂 agnes-cn 重写 → 输出经守卫二次校验 → `evolver distill`（manual）入库 → `--auto-approve` 时自动审核。

### 21.3 验证（三层证据）
| 层 | 实验 | 结果 |
|---|---|---|
| 守卫规则 | 4 个真实历史样本分类测试 | **4/4 正确**（含 1 例正确拒绝噪声） |
| 端到端 N=2 | GBK ×（--fresh --auto-approve --llm-refine） | 两轮 auto-distill 均摘到修法（守卫正确**放行**，重写未触发）；R2 注入有效；token **-35.4% / -42.0%**（与 §16 -55.3% 同向） |
| 重写分支定向测试 | 强制用 §20 噪声 strategy + 真实 transcript 触发 | 输出 `detect file encoding (gbk)…; open with encoding="gbk" instead of default utf-8; rerun to verify` —— **教科书级修法，守卫判定 ✓** |

### 21.4 结论与诚实声明
1. **守卫 + LLM 重写双保险验证通过**：守卫能区分修法/噪声（4/4），重写分支能把噪声 strategy 重写为含修法 strategy（定向实测 ✓），全链路只依赖官方 CLI 面。
2. **蒸馏质量方差的本轮快照**：端到端 2 轮 auto-distill 2/2 摘到修法（§20 是 0/3）——同一模型同陷阱纯方差，**守卫不能阻止"摘到修法/噪声"的随机性，但能保证"噪声绝不注入、且噪声必被重写"**——把继承有效性从「运气问题」变成「机制保证」。
3. `/tmp` 跨 bash/Node 解析坑二次踩中（§14 已有记录）：跨进程传文件必须用项目内显式路径——该教训强化为铁律。

### 21.5 待办收敛
- 蒸馏质量议题（§20.4）**已治理完毕**；硬约束通道（tool_call 改写）仍留作设计决策（GEP 哲学 vs 100% 避坑）。
- 全项目剩余：清理生产环境中一份已失效的 fallback 模型配置（独立运维待办，不在本报告范围）。

---

## 19. Capsule 固化路线实测：官方 cycle 路线 fail-closed，阻塞结论 [A]

### 19.1 权威资料研读（动手前）
- `evolver cycle --help`：`--runner` 仅枚举 `claude|codex|gemini`——**Pi 不在 runner 列表**。
- `evolver cycle capabilities --json`（全量实测）：九个 runtime 中，execute/verify **全部 unsupported 或 experimental**——claude-code/codex/cursor 均 `unsupported`（fail-closed，理由为 host 文件系统/网络 containment 未验证）；仅 **gemini 为 `experimental`**（"Gemini CLI 0.46.0 deterministic real-runtime cycle smoke passed; provider-backed live E2E smoke is not complete"）；我们使用的 **generic-chat 通路 execute/verify/resume 均 unsupported**。

### 19.2 实测验证（把结论钉死，不停留在文档）
- `evolver solidify --dry-run --json` → `{"ok":false,"deprecated":true,"reason":"migration_required","replacement":"evolver cycle; evolver review; evolver publish","mode":"read_only"}`：**v1 solidify 确认废弃**，官方替代链路 = cycle → review → publish（2.x 生命周期支持，3.0.0 起移除）。
- `evolver cycle --repo <GBK模板> --runner gemini --limit 1` → `action=fail status=refused reason=details-redacted`：即便指定唯一 experimental 的 gemini，**execute 仍被 fail-closed 拒绝**（material 被认领但 action 失败）。

### 19.3 结论
1. **官方 Capsule 固化路线在本机不可执行**，且阻塞原因是 **Evolver 设计内的 fail-closed**（execute/verify 需 host containment 验证后才开放），非环境配置错误。Pi 亦不在 runner 白名单，官方暂无把 Pi session 用于 execute runner 的通路。
2. **我们自建的 `pi_evolve.mjs` 编排器已实现 cycle 想做之事的离线等价闭环**（执行→真实验证→修法注入→跨轮收益统计），这正是本项目自建 harness 的价值所在；差别仅在未走 evolver 的 cycle 状态机与 EvolutionEvent 官方留痕。
3. **可行后续**（按需）：a) 等 Evolver 2.x 开放 execute（watch `cycle capabilities`）；b) 装 gemini CLI 0.46.0+ 走唯一 experimental 通路（离线原则下优先级低）；c) 在自建编排器层面自行沉淀"已验证 strategy 资产文件"（轻量 Capsule 等价物）。
4. 待办收敛：**Capsule 固化（P2）标记为「官方路线阻塞（设计内 fail-closed）」，不再作为当前主线**；优先级让位于 P3 Route A 预研。
