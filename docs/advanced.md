# Advanced — 回填寻址 / 时间线 / 并发 / 共享库 / 宿主接入 / 运维

> 本文档是 SKILL.md（日常用法）的进阶分册：接生产环境、排查「没生效」、跨实例共享时看这里。

## 回填寻址与时间线（0.18）

> 方法论致谢：timeline/harvest 的「取证重建」思路来自 **Perplexity 开源的 numbat**（agent 行为审计器，github.com/perplexityai/numbat，Apache-2.0）——「把账本变成监控录像」；实现为本机账本自有格式。

### register-hit/negate 改按 id 寻址（并发安全）
多会话并行写同一库时，位置编号会漂移（选择快照 `.evox-last-selection.json` 是共享单文件，会被其他会话的 recall 覆盖——实测错记 63→65）。0.18 起：

```bash
node code/evolver-recall.mjs --register-hit --gene gene_manual_xxx --note "<任务一句话>"
node code/evolver-recall.mjs --negate --gene <asset_id> --note "<为什么没起作用>"
```
位置写法 `--register-hit <N>` 仍兼容，但并发环境不可靠。

### `light-cli timeline`：四账本时间线
```bash
node code/light-cli.mjs timeline [--last 50]
```
把 召回/注入/回填/工具错误 四个账本按时间合并成 Markdown 表——一眼看出"先踩哪个坑→召回了哪条→是否回填"。失效修法的典型信号：**注入之后 N 步仍出现同类报错**。

### `light-cli harvest`：错误候选 → 沉淀建议
```bash
node code/light-cli.mjs harvest [--last 10]                    # 盘点未处理候选（附可复制的 draft 命令）
node code/light-cli.mjs harvest --done <N>                     # 已沉淀：移入 error_candidates.done.jsonl（留痕）
node code/light-cli.mjs harvest --dismiss <N>                  # 无价值驳回：同样留痕，不产基因
```
候选只是线索：**FIX 必须由你补全成可执行修法**（占位符会被 depositionGate 拒绝）。处理过的候选移入 `.done.jsonl`——未处理列表只减不增。

### 并发写锁（0.19）
多会话/多进程并行写同一基因库时，`append` 之间的「读-改-写」窗口会被并发回滚（实测 shareable 标记毫秒级丢失、approve 假 ✓）。0.19 起所有台账写入（genes/review/hits/pending）与池 staging 均持 **O_EXCL 文件锁**（`.evox.lock`）：15s stale 自动破除（持锁进程崩溃不死锁）、5s 超时 **fail-open**（锁是优化不是门，绝不让写入因锁失败）。Python 侧 hook 用同一协议。

### 独立取证（0.19 PoC：numbat）
在自有设备上用 [numbat](https://github.com/perplexityai/numbat)（Perplexity，Apache-2.0，**方法论致谢**）对 agent 会话做取证重建——原生解析 OpenClaw/Claude/Codex 日志。PoC 运行手册与实测结论见 `docs/forensics-numbat.md`：目标是用**时间线对靶核对**「注入的基因是否真的体现在 agent 后续命令里」，补强 register-hit 的自报单源。


## 安全：四道门（明细，自 SKILL.md 下沉）

> **EN**: Four gates detail (moved from SKILL.md for progressive disclosure). The injection guard distinguishes `AVOID:` (warning - allowed) from `FIX:` (instruction - blocked) contexts; measured 11/11 malicious samples caught, 7/7 legitimate zero false-kill. Fail-closed if the guard module is missing: export/import refuse to run; recall skips the injection gate but the other three still apply (read-only must not block, writes must be closed).

| # | 门 | 管什么 | 在哪生效 |
|---|---|---|---|
| 1 | **修法守卫** | 有没有**真修法**（无可执行内容 → 不注入） | 召回 |
| 2 | **叙述守卫** | 是不是**旁白流水**（开场白式 → 不注入） | 召回 |
| 3 | **注入守卫** | 是不是**恶意指令**（提示词注入 → 不注入） | 召回 + 导入 + 导出 |
| 4 | **脱敏闸门** | 会不会**泄私有内容**（IP/路径/密钥 → 拦截不出网） | 导出 + 导入 |

**关键设计：区分 `AVOID` 与 `FIX` 语境**——`AVOID:` 段出现危险词 = 在警告别这么做（合法，放行）；`FIX:` 段出现危险词 = 在指示这么做（可疑，拦截）。

## 共享基因库（跨实例 / 跨用户，0.14.9 新增）

> **EN**: Shared pool (opt-in): mark genes `--shareable` at deposit time, `gene submit --pool <dir>` exports shareable AND approved genes only (pool = approved-only curated collection), `gene import` on other instances (idempotent by asset_id). Tier is decided by the operator-specified pool, never by the gene's self-claimed tier (anti-spoofing). Redaction gate is fail-closed before anything leaves the machine.

> 让「一个坑只踩一次」跨实例生效：把**已验证的修法**沉淀的基因放进**自建共享池**，其他实例拉取复用。**本地库始终是权威源**，共享是增量；离线完全可用。

```bash
# 1) 沉淀时标记「可共享」（默认不共享 = 不外发；命中脱敏闸门的私有内容永不外流）
node code/light-cli.mjs distill --signals gbk,encoding --strategy "FIX: 用 encoding='gbk' 读老文件" --shareable
# 2) 过闸写入自建共享池（幂等；只导出 shareable 且已审核通过的基因——池=已审核集合）
node code/light-cli.mjs gene submit --pool <自有共享池目录>
# 3) 其他实例拉取（按 asset_id 幂等合并；审核态由你指定的池信任级别决定）
node code/light-cli.mjs gene import <池文件>                      # 默认 community → 待审
node code/light-cli.mjs gene import <自建池文件> --tier official   # 自建策展池 → 自动通过
```

**设计要点（务必知悉）**：
- **池语义（0.18.1 拍板）**：submit 只导出 **shareable 且 LWW 审核态=approved** 的基因；待审/未决定留在本地库，submit 会报告「待审未推池 N 条」。**池永远是审核完毕的可共享集合**。
- **脱敏闸门 fail-closed**：基因离开本机/入池前必扫全部文本字段，命中私有 IP、绝对本地路径、密钥、内网服务/代号即**拦截**，不出网。
- **opt-in 共享**：`shareable` 默认 **false**；只有显式 `--shareable` 的基因才可导出。
- **审核门控不被绕过**：导入基因默认 **待审（quarantined）**；仅当显式信任某个自建池（`--tier official`）才自动通过。tier 由**操作者指定的池**决定，**不读取基因自称的 tier**（防恶意池伪装）。
- **幂等合并**：拉取按 `asset_id`(sha256) 去重，重复拉取不产生重复。
- 池目录默认 `~/.evomap/pool`（`EVO_POOL_DIR` 覆盖）。池可放自有 Git 仓（版本化 + 天然审计 + 权限即鉴权）。

## 非交互沉淀默认隔离（0.17.0）

> **EN**: Interactive deposits auto-approve (convenience since 0.16.0); non-interactive ones (scripts/cron/host pipes, no TTY) default to QUARANTINED unless `--auto-approve` is explicit. Auto pipelines are the origin of the 15 noise genes seen on a private node; the gate keeps them out of the injectable pool.

| 沉淀方式 | 默认行为 |
|---|---|
| **交互式**（人在终端敲命令） | 自动通过（0.16.0 便利保持） |
| **非交互**（脚本/cron/宿主自动管道，无 TTY） | **默认隔离**——显式 `--auto-approve` 才通过 |
| `--no-auto-approve` / `config --auto-approve off` | 始终人工审 |

> 设计：自动管道（如宿主把每次重试都记录成基因）是私有节点那 15 条噪音的起源；非交互默认隔离 + 沉淀质检，让「自动沉淀的垃圾」进不了可注入池。

### install-snippet：自动沉淀的绑定点

> **EN**: The root cause of 'the agent never deposits' is that T4 never entered its context. `install-snippet --file <project>/AGENTS.md --yes` writes the five-trigger-point protocol into the project instruction file (idempotent, re-runnable to update).
「agent 不提醒就不沉淀」的根因是 T4（修好坑后）没有出现在它的上下文里。把规程写进**项目指令文件**即可：
```bash
node code/light-cli.mjs install-snippet --file <项目>/AGENTS.md        # 演练
node code/light-cli.mjs install-snippet --file <项目>/AGENTS.md --yes  # 写入（幂等，可重复执行更新）
```
写入后该项目的 agent **每个会话**都会看到 T1–T5（含 T4 修坑即沉淀）。AGENTS.md / CLAUDE.md 均可。

## 让经验真正生效：四个静默失败与对策（0.16.0）

> **EN**: The most common failure is SILENT: genes deposited but never recalled, or deposited but never approved (never injected). Counters: info shows loop health, own deposits are auto-approved by default, install-hooks auto-wires hosts, starter loads 10 curated genes so the first query hits.

| 静默失败 | 症状 | 对策 |
|---|---|---|
| **① 从未召回** | 沉淀了很多，却从没被用过 | `info` 显示「召回次数 0」并给命令；`install-hooks` 帮你接上宿主 |
| **② 沉淀未审核** | 基因入库却被隔离，**永不注入** | 默认自动通过；`info` 列出待审并给 approve 命令 |
| **③ 宿主没接** | 装了但 agent 从不会自动召回 | `install-hooks`（演练 → 确认后才写入） |
| **④ 冷启动没手感** | 库里没几条，召回也不命中 | `starter` 一键装载 10 条通用教训 |

### 三条命令解决 90% 的「没生效」
```bash
node code/light-cli.mjs info            # ① 看闭环健康度：召回次数 / 命中 / 待审
node code/light-cli.mjs starter         # ② 装起步包，立刻有东西可召回
node code/light-cli.mjs install-hooks   # ③ 演练接线（看清会做什么；加 --yes 才写入）
```

### 自动审核开关（默认开）
自己 `distill`/`draft` 沉淀的基因**默认自动通过**，立即可注入。`config --auto-approve off` 可改人工；此项**只作用于本地沉淀**，从共享池 `gene import` 仍按 `--tier` 判定。

## 宿主接入契约（0.15.0 融入实际应用的关键）

> **EN**: Experience inheritance is NOT 'install and forget' - it depends on the host feeding in task intent (T1: --query with the user message body) and reporting outcomes (T5: --register-hit / --negate).

> **EN**: Experience inheritance is NOT "install and forget" - it depends on the host feeding in task intent (T1: --query with the user message body) and reporting outcomes (T5: --register-hit / --negate).

经验继承**不是"装上就生效"**——它依赖宿主把「任务意图」喂进来、把「效果」回填回去。私有节点实测：机制在跑（153 次 recall），但**真正有效（对靶且有注入）仅 10%**。三个断点都在宿主侧。

### 逐步接入（三步，缺一不可）

**第 1 步：任务开始时，把用户的真实诉求传进来**
```bash
node code/evolver-recall.mjs --query "帮我抓取这个公众号文章" --agent openclaw
```
要传的是**用户真正想做的事**，不是信封包着的那条消息。recall 会自动剥离子企业IM/心跳等前缀；剥完若没有实质内容就**不注入**（宁缺毋滥）。

**第 2 步：任务结束时，回填这条修法到底有没有用**
```bash
node code/evolver-recall.mjs --register-hit --gene <id> --note "按 gbk 编码读取，抓取成功"
node code/evolver-recall.mjs --negate --gene <id> --note "仍超时，networkidle2 不够"
```
每次注入都会自动记一笔 `pending_injections.jsonl`；回填后「注入→有效」的转化率才算得出来。

**第 3 步：检查闭环是否真的跑起来了**
```bash
tail -5 experiments/recall_calls.jsonl   # noise=true 表示宿主传的是噪声、没拿到正文
wc -l experiments/hits.jsonl             # >1 条说明闭环闭合
```

### 可直接复制的钩子模板
| 文件 | 宿主 | 事件 |
|---|---|---|
| `examples/hooks/openclaw-bootstrap-recall.js` | OpenClaw | `agent:bootstrap` |
| `examples/hooks/hermes-pre-llm-recall.py` | Hermes | `pre_llm_call` |
| `examples/hooks/README.md` | — | 三步接入 + 常见接入问题排查表 |

改模板顶部三个路径常量即可用（也支持 `EVOX_RECALL_SCRIPT` / `EVOX_HITS_DIR` 环境变量）。

### 常见宿主对照
| 宿主 | 任务开始接入 | 传任务意图 | 结束回填 |
|---|---|---|---|
| **OpenClaw** | 原生钩子（`agent:bootstrap`） | 钩子里取用户正文 | 钩子里回调 |
| **Hermes** | 原生钩子（`pre_llm_call`） | 同 | 同 |
| **通用 Agent** | 提示词里加一句「先跑召回」 | 手工传 `--query` | 人工执行回填命令 |

> ⚠️ 只做第 1 步不做第 2 步：能召回但**不知道有没有用**；两者缺一，经验继承都不成立。宿主若长期「有效召回率」偏低，先确认**运行时部署的是不是最新版**。

## 运维与度量（ops）

| 脚本 | 作用 | 默认触发 |
|------|------|----------|
| `metrics_collect.mjs` | 采集基因库指标（总数/已审核/隔离/命中/recall 调用数），追加到 `exp/metrics/metrics.log` | 周常 |
| `distill_sessions.mjs` | 生产会话蒸馏适配器：直读宿主真实会话存储（SQLite），按「失败调用 vs 重试调用的参数差异」抽取修法 | 周常 |
| `evox-weekly.sh` | 周常包装：`metrics_collect.mjs` + `distill_sessions.mjs --days 7 --commit --auto-approve-lowrisk` | cron `17 3 * * 1` |

**抽取口径（宁缺毋滥）**：先判定「失败」——**结构化标志优先于文本标记**（`isError` / 非零 `exit_code` / `error` 字段），且**文本错误标记只对命令执行类工具生效**；再在同一会话内找**紧接着（≤6 个事件）、同名工具、结果不再失败**的下一次调用，取两者**参数差异**作为修法。差异过大一律拒绝；落库前再过**修法信号 + 叙述守卫**双闸。

**两级门（B+C）**：`--commit` 落库时，仅**纯参数微调型**自动批准；其余进 quarantine 并写入候选报告 `exp/metrics/distill-candidates-<日期>.md`。

**对靶注入**：`evolver-recall.mjs --query "<任务文本>"` 按 `signals_match` 命中 + 与 strategy 的 token 交集打分，**低于阈值即不注入**。

环境变量：`EVOX_ROOT`（默认 `$HOME/pi-evox-lab`）、`EVOX_STORE_DIR`（默认 `$HOME/.evomap/assets`）、`EVOX_NODE`（默认 `node`）、`EVOX_HITS_DIR`（默认 `$cwd/experiments`，**生产环境建议固定为 `$EVOX_ROOT/experiments`**——否则埋点散落在各项目目录，timeline/info 读不到）、`EVOX_OC_DB` / `EVOX_HERMES_DB`（宿主会话存储路径）等。

**生产接入（让继承真正发生）**：两条路——① 提示词接入：把「任务开始 recall / 修复后 deposit」写入智能体系统提示词；② 原生钩子接入（推荐：机制保证，而非依赖智能体自觉）。两类原生钩子均为**薄适配层**，只调用 `evolver-recall.mjs`；空库零注入、异常不影响宿主调度。

**支持的智能体宿主（已验证 / 设计支持）**
| 宿主 | 推荐接入 | 钩子 / 机制 |
|---|---|---|
| OpenClaw | 原生钩子 | `agent:bootstrap` 注入虚拟 bootstrap 文件（或 `pre_llm_call` shell hook） |
| Hermes | 原生钩子 | `pre_llm_call` shell hook，`is_first_turn` 做「每会话仅首轮」闸 |
| WorkBuddy / 通用 Agent | 提示词接入 | 写入系统提示（`AGENTS.md` / `SOUL.md`） |
| 任意支持 system prompt 或钩子的宿主 | 薄适配层 | 只需调用 `evolver-recall.mjs` |

> **诚实边界**：各宿主会话存储格式不一——结构化标志最可靠；只靠文本标记时召回率随宿主而异。bootstrap 类钩子可能**早于**当轮用户消息落库，此时该轮退化为「无查询 → top-N 封顶」。


## 基因签名与 provenance（明细，0.21）

> **EN**: Provenance detail: Ed25519 keypair per machine (`~/.evomap/identity/`, private key mode 0600). Signing domain = asset_id + canonical JSON (signature fields excluded). Deposit signs automatically; `gene submit` carries the signature; `gene import` verifies with the embedded pubkey: tampered -> BLOCKED, unsigned/legacy -> accepted with note, unverifiable -> accepted with warning. Trust model = keyid traceability, not a central CA.

```
light-cli identity            # 查看本机 keyid 与密钥路径
light-cli verify <gene_id>    # 验签本地库基因（exit 1 = 验签失败）
light-cli evidence <gene_id>  # 审核取证（ approve 前自动执行；也可单独跑）
```

## IO 重试与截止（0.21，stability）

> **EN**: `retryIo` (store.mjs): bounded retries on TRANSIENT errors only (EBUSY/EPERM/EACCES/ETIMEDOUT - Windows file-in-use / AV-scan typical), max 3 attempts with 50/100ms backoff, hard deadline 3s, then the error propagates. Non-transient errors (ENOENT/EISDIR) never retried. Retry is an optimization, not a gate - it must never block the caller indefinitely (consistent with the fail-open philosophy).

## 已知边界

- 修法注入是**软提示**（system prompt），遵从度模型相关；守卫保证噪声不入库不出库，但不承诺 100% 避坑；
- `tool_result` 失败点教学（扩展桥内）只在「策略注入后仍踩坑」时提供增量，价值在长时运行场景；
- 并发锁覆盖 JSONL 台账与池 staging 写入；其他文件操作的原子性仍在 0.21 评估范围（stability 评测点名）。
