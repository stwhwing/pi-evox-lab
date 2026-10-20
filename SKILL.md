---
name: pi-evox-loop
slug: pi-evox-loop
displayName: "Pi EvoX Loop"
description: "Give your coding agent an 'experience inheritance' runtime: recall validated fixes from an Evolver gene store at task start, register hits when a fix is actually used, and deposit newly-learned fixes after repairing a non-obvious failure. Optionally run controlled closed-loop experiments (R1 trap → distill → inject → R2) to measure inheritance gains. Use at the START of non-trivial tasks, after fixing a non-obvious failure, or when you want to measure agent self-evolution. Trigger words: 经验召回, 错题本, 经验继承, 自进化, evolver, 避坑, distill."
description_zh: "给编码智能体装上「经验继承」运行时：任务开始时从 Evolver 基因库召回已验证修法（编号列表），相关则采用并在结束时登记命中；任务中修复了非显而易见的失败后，将修法入库供未来召回；可选跑受控闭环实验量化继承收益。非平凡任务开始时、修复有价值失败后、或想测量 agent 自进化效果时使用。触发词：经验召回、错题本、经验继承、自进化、evolver、避坑、distill"
description_en: "Experience-inheritance runtime for coding agents: recall validated fixes (numbered) at task start, register hits when used, deposit fixes after repairing failures; optional controlled closed-loop experiments to measure inheritance gains."
version: 0.26.0
platforms: [linux, macos, windows]
homepage: https://github.com/stwhwing/pi-evox-lab
---

# Pi × EvoX Loop — 智能体经验继承 Skill

> 让 Agent 的每个坑只踩一次：失败经验自动入库（守卫过滤），同类任务自动召回已验证修法。
>
> **文档地图（0.21 分层）**：
> - **新用户只需读三节**：30 秒上手 → 流程 A → 流程 B（约 60 行）；其余按需查。
> - **最佳实践集中入口**：`examples/quickstart.md`（5 分钟闭环）+ `docs/overview.md`（项目概览）+ `docs/common-mistakes.md`（14 条反模式）——三份覆盖"上手/全景/避坑"。
> - 本文件其余部分 = 触发点/安全摘要/反模式速查/导航；`docs/advanced.md` = 回填寻址/时间线/harvest/并发锁/共享库/宿主接入/运维/安全门明细；`docs/common-mistakes.md` = 常见错误用法完整清单；`docs/config-errors.md` = 常见配置错误；`docs/faq.md` = 完整 FAQ。
> - `docs/research.md` = 流程 C 受控实验 + 陷阱设计纪律——**研究专用，绝大多数用户无需打开**。

## 30 秒上手（Quick-Start）

> **EN**: Requires Node >= 22. Optional `@evomap/evolver` integration is GPL-3.0-or-later (only if you install and use `--engine evolver`); the default light backend is MIT, zero-dependency, zero-exfiltration. Three things only: **A recall** validated fixes at task start, **B deposit** after fixing a non-obvious failure, **C (optional, research) controlled experiments**. Daily use = A/B only.
> ⚠️ **前置要求：Node ≥ 22**（`node -v` 检查；旧版不支持，需先升级）。可选集成 `@evomap/evolver` 为 **GPL-3.0-or-later**——仅在你主动安装并使用 `--engine evolver` 时涉及，默认 light 后端为 MIT、零依赖零外发。
>
> 本 Skill 只做三件事：**A 任务开始召回**已验证修法、**B 修复失败后背沉淀**、**C（可选，研究用）受控实验量化收益**。日常只用 A/B，C 默认全关，请勿用于生产。

```bash
# A — 任务开始，对靶召回（替换成你的任务一句话）
node code/evolver-recall.mjs --query "处理 GBK 编码文件报错" --top 5

# B — 修复了非显而易见的失败后，贴原始报错生成草稿，再补 FIX 落库
node code/light-cli.mjs draft --error "<原始报错>" --tool <工具名> --context "<当时在做什么>"
node code/light-cli.mjs draft --error "<原始报错>" --strategy "AVOID: <什么不该做> FIX: <具体参数/命令/编码>" --commit
```

命令均在本仓库根目录执行；未安装依赖先见下方「安装」。

### 首次运行 · 3 步就绪（先跑自检，再沉淀）

1. **装 Node ≥22**（traps 生成器与 pi/evolver 均要求；见 FAQ·Q8）；
2. **自检环境**：`node code/light-cli.mjs doctor` —— 校验 Node 版本、经验库目录可写、命中登记目录可达（失败项给修正指引）；
3. **点亮经验库**：空库无修法可召回属正常，按下方流程 B 沉淀第一条修法即点亮。

### 新手必读（高频问答速览）
- **首次运行召回显示「无可召回修法」？** 正常——库从零开始，先跑一次 B 沉淀即可点亮（FAQ·Q1）。
- **Node 版本要求？** 需 **≥22**（traps 生成器还需 Python 3），过低 pi/evolver 会启动失败（FAQ·Q8）。
- **更多问题**见 `docs/faq.md`（完整 14 条）与下方反模式速查。

## 安装（一次性）

> **EN**: One-time setup. **A/B flows need ONLY Node >= 22 — zero npm dependencies.** Get the folder by any of three paths below; any location works (a "skill" is just a folder — put it wherever your host expects, e.g. `~/.claude/skills/pi-evox-lab`). Default backend = built-in light (pure Node, MIT). evolver is an optional integration (`--engine evolver`, needs `npm install`). Flow C additionally needs Pi CLI + an OpenAI-compatible LLM key.

**三种获取路径（任选其一）**：
```bash
# 路径 1：git clone（推荐）
git clone https://github.com/stwhwing/pi-evox-lab.git && cd pi-evox-lab
# 路径 2：受限网络 → Release zip 直下（附 sha256），解压即用
#   https://github.com/stwhwing/pi-evox-lab/releases （国内可达镜像见 FAQ Q7）
# 路径 3：市场一键安装 —— skillhub.cn / ClawHub 搜 pi-evox-loop（WorkBuddy/OpenClaw 用户）
```
```bash
node -v                # 前置要求：Node >= 22（唯一硬依赖）
node code/light-cli.mjs doctor   # 30 秒自检——通过即可用，无需任何安装步骤
```
- **A/B 日常流程零 npm 依赖**；以下 `npm install` 仅为可选集成/实验模式 C 准备：

## Provider 配置（仅流程 C 需要）

> **EN**: Flow C only - any OpenAI-compatible endpoint; `$ENV` interpolation needs pi >= 0.85.1. Examples + domestic endpoints (DeepSeek/Bailian/SiliconFlow/Zhipu): [`docs/providers.md`](docs/providers.md).

## 流程 A：任务开始 — 召回经验（任何非平凡任务）

> **EN**: Flow A - recall at task start. `--query` with the task text does targeted recall (unrelated experience is never injected - injection is gated by signals_match x query-token overlap, below threshold = no injection). On error (T3), the raw error text IS the query. Multiple matches: geneConflicts drops anti_patterns-mutual low scorers; no targeted hit = no injection. Register the hit at task end with `--register-hit --gene <id>` (id-addressed, concurrency-safe).
```bash
# 推荐：带上任务文本做「对靶」召回（与任务无关的经验不会注入）
node code/evolver-recall.mjs --query "<当前任务的一句话/关键信号>" --top 5

# 遇到报错时（T3）：报错原文即查询——错误本身就是提醒
node code/evolver-recall.mjs --error "UnicodeDecodeError: 'utf-8' codec can't decode byte 0xc4"
```

- 只输出「已审核 **且** 通过修法守卫 **且** 与查询对靶」的编号修法列表（空库有明确提示，属正常）；
- **参数默认值**：`--top` 默认 5 条（软提示注入有上下文成本，宁少勿多）；经验库无硬性容量上限，但建议单库 <500 条（超过后对靶精度下降，可用共享池分流）；
- **对靶规则**：按基因 `signals_match` 命中与查询词的交集打分，**低于阈值即整条不注入**（避免不对靶注入反而增加成本）；
- **多基因冲突时**：`geneConflicts` 守卫已自动剔除 `anti_patterns` 互斥的低分项；仍有多条时取分高者；**无对靶项时宁可不注入**，不用无关基因凑数；
- 与本任务相关时优先采用；结束时实际采用了某条，登记命中（`--gene <id>` 按 id 寻址，并发安全）：

```bash
node code/evolver-recall.mjs --register-hit --gene <asset_id或gene_id> --note "<任务一句话>"
```

- 无关的经验不要硬套；未采用的条目不必登记。

## 流程 B：失败修复后 — 沉淀经验

> **EN**: Flow B - deposit after fixing a non-obvious failure. Deposit bar (any one): docs/2+ tries needed, environment-specific, counter-intuitive error, or second occurrence. Guided path: `draft --error` auto-extracts signals + pre-fills AVOID + writes anti_patterns; fill in FIX then `--commit`. Manual path: `distill` with explicit signals. strategy MUST be an executable fix (params/commands/encodings) - success summaries are filtered by the repair-signal guard. `--shareable` only for genes meant for the shared pool.
**判定标准（满足任一条即值得沉淀）**：
- 排查过程需要查文档 / 试错 ≥2 次才解决；
- 依赖本机或环境特性（编码、路径规范、shell 差异、网络环境）；
- 报错信息反直觉，或与文档描述不符；
- 同一坑在历史任务中出现过第二次。
（不满足任一条的普通失败不必沉淀——避免经验库噪声。）

**推荐路径：引导式（贴原始报错，信号与「负经验」自动抽取）**

```bash
# 1) 生成草稿：自动抽 signals_match + 预填 AVOID 模板 + 写入 anti_patterns（负经验 token）
node code/light-cli.mjs draft --error "<原始报错文本>" --tool <出错工具名> --context "<你当时在做什么>"

# 2) 照草稿补全 FIX 后落库（--strategy 覆盖预填占位符）
node code/light-cli.mjs draft --error "<原始报错文本>" \
    --strategy "AVOID: <什么不该做> FIX: <具体参数/命令/编码>" --commit

# 3) 审核（默认自动通过；可 config --auto-approve off 改人工）
node code/light-cli.mjs approve <gene_id>
```

**AVOID/FIX 模板适用边界**（写清才不被守卫拒）：
| 段 | 写什么 | 边界 |
|---|---|---|
| `AVOID:` | 什么不该做（负经验，可含危险词——那是**警告**） | 一句到两句；不要写成功总结 |
| `FIX:` | 具体到**参数/命令/编码**的可执行修法 | **必须真填**——占位符/重试日志/旁白会被 depositionGate 拒绝（fail-closed） |
| `anti_patterns:` | 单 token 字面量（如 `assume-default-utf8`） | 冲突判定按整串匹配，勿写 kebab 长句 |
| `signals_match:` | 召回对靶信号词 | 与查询词有交集才召得回；勿堆无关词 |

**备选路径：手写式（已明确 signals 时）**

```bash
node code/light-cli.mjs distill --category repair --signals bash,exception \
    --strategy "<一句话修法；多步用分号分隔；要具体到参数/命令/编码>" \
    --summary "<坑的一句话描述>" [--shareable]
```

- strategy 必须写成**可执行修法**（含具体参数/命令），不要写成功总结——召回侧有修法守卫，成功总结会被过滤（宁缺毋滥）；
- `--shareable` 仅当你希望该基因进入**共享池**时加（默认不共享 = 不外发）；
- **沉淀门槛的真实数据（诚实边界）**：生产真实会话中可自动抽取的"干净修法对"密度很低（实测 `distillablePairs=0`）——本库基因主要来自人工/引导式沉淀。

## 沉淀质检 depositionGate（0.17.0，fail-closed）

> **EN**: 0.16.0 proven gap: under autoApprove, retry-log noise and unfilled-FIX placeholder genes were deposited and injected directly (all three recall guards pass). Fix: quality gate moved to DEPOSITION time. depositionGate rejects (fail-closed): unfilled placeholder, retry-log repetition, narration openings, missing repair-signal words. Non-interactive deposits (no TTY) default to quarantined unless --auto-approve is explicit.
`distill` / `draft --commit` 时逐条检查，不合法**直接拒绝**（不落盘）：

| 拒绝条件 | 理由 | 下一步 |
|---|---|---|
| FIX 是未填占位符 `<在此填写可执行修法>` | 注入后毫无价值 | 在 draft 里补上真实修法再提交 |
| `retry with corrected args`（重试日志复述） | "重试然后好了"不是修法 | 写 AVOID(为何错)+FIX(怎么做) |
| 旁白开场（Now I understand…） | 推理流水不可执行 | 同上 |
| 缺修法信号词 | 不像在描述坑与修法 | 同上 |
| 有 AVOID 无 FIX（半成品） | 只有坑没有修法，注入后毫无价值（0.22 复审实证：3 条截断 deposit 全是此形态） | 补上可执行修法（参数/命令/编码） |

> **审核取证（0.20.3 建，0.22 绑死）**：`approve` **自动先跑取证**——本地四台账（工具错误/召回/注入/回填）检索该基因声称失败/修法的对应事件，三级输出（强证据/弱上下文/无证据）。核对一致才批；**结论被后续事件推翻的保持隔离并留痕**（实例：一条"CNAME 放仓库根即持久化"的基因被同批两条实证基因推翻，隔离时注明 superseded）。无本地证据的（共享池/其他机器/起步包来源）按内容与来源审。`--skip-evidence` 为已知无证据场景的显式逃生门（不鼓励）。
> 为什么绑死：0.20.3 建了 `evidence` 命令却依赖"记得跑"——当天审 6 条基因全部没跑（用户问才补跑）。机制必须绑在动作节点上，这是本项目自己的核心哲学（T3：错误本身就是提醒）。

> **EN**: Review-with-evidence (0.20.3): before `approve`, run `evidence <gene_id>` to check the four local ledgers for events matching the gene's claimed failure/fix. Approve only when consistent; genes whose conclusions were overturned by later events stay quarantined with an audit note. Genes without local evidence (pool imports / other machines / starter pack) are reviewed on content and source, noted at approval.

## 基因签名与 provenance（0.21）

> **EN**: Provenance signing (0.21, one of the last 1.0 criteria): every deposit is signed with this machine's Ed25519 identity (`~/.evomap/identity/`, private key 0600, never leaves the machine); genes carry {sig, keyid, pubkey}. Pool imports verify signatures - tampered content is REJECTED, unsigned/legacy genes pass with a note. `light-cli identity` shows your keyid; `light-cli verify <gene_id>` verifies.

- 沉淀自动签、入池随行、导入验签：**内容被篡改 → 拒绝导入**；无签名的老基因原样接受（legacy）；
- 私钥不出本机；公钥随基因出入池供他机验签——信任模型是“按 keyid 溯源”，不是中心化 CA。

## 部署与分发（0.23）

> **EN**: Download paths (GitHub / npm / restricted-network mirror), host integration one-command, and concurrency semantics for shared deployments.

- **下载**：GitHub Release zip / npm（`npm config set registry https://registry.npmmirror.com`）；网络受限环境用国内镜像 zip（附 sha256 校验，见 FAQ Q7）；
- **宿主接入**：`light-cli.mjs install <claude-code|cursor|codex|agents-md>`（自动定位配置文件写入规程，`--yes` 落盘）；OpenClaw/Hermes 用 `install-hooks`；
- **基因池协作**：`gene pull --pool https://zyx.pink/pool/genes.jsonl --tier official` 从官方镜像拉取全池（签名验证，66+ 条策划基因）；`gene submit --bundle <file>` 产出提交包回传维护者（PR / issue 附件 / 文件交换）；导入默认隔离+验签；池仓库贡献条款见 CONTRIBUTING.md（CC-BY-4.0）；
- **场景拉取**（0.24）：`gene pull --pool <URL> --scene <场景>` 只拉该场景子集；受控场景词表：`ops-deploy`（部署/服务器）/ `coding-debug`（编码/解析）/ `release-publish`（发布/版本）/ `api-integration`（API/webhook）/ `git-workflow`（git/仓库）/ `agent-runtime`（宿主/钩子/管线）；`gene list --scene <名>` 本地同粒度过滤；
- **并发语义**（三层）：单机多会话=withLock 文件锁；跨机=基因池 Git 化（提交→审核→合并，LWW 台账裁定冲突）；多宿主召回幂等（重复召回同一基因不重复计数）。多宿主并行时按 gene_id 寻址（0.18 起），不用位置序号。
- **命名池（0.25）**：`~/.evomap/pools.json` 定义命名池源（`{"pools":{"official":"<url>","team":"<git-url>"}}`），`gene pull official` 按名拉取；已拉池缓存在 `~/.evomap/pool-cache/`。
- **效果量化（0.25）**：`light-cli.mjs report` 周报（L1 活性/L2 回填率/L3 错误家族复发，`--json` 可机读）；`recall --record "<结论>"` 把验证结论回填生产账本；`draft/distill --commit` 自动写 deposit 事件。
- **许可验证（0.25）**：`light-cli.mjs license verify <token>` 验证 Ed25519 签名许可（发行方公钥随包 `assets/issuer-pub.txt（ClawHub/GitHub 0.25.0 首发的 .pem 版同样兼容）`）；许可机制本身开源，便于任何发行方接入。
- **IO 重试语义**：文件读写对瞬态错误（EBUSY/EPERM/EACCES/ETIMEDOUT）自动重试（默认 3 次/截止 3s，`EVOX_IO_RETRY`/`EVOX_IO_DEADLINE_MS` 可调）；非瞬态错误不重试；重试是优化不是门——绝不因重试机制阻塞调用方（fail-open）。

## 安全：四道门（0.16.0）

> **EN**: Genes are soft prompts injected into the system prompt - one malicious gene is one prompt injection. Four gates: repair-signal guard, narration guard, injection guard (malice; AVOID=warning allowed vs FIX=instruction blocked - 11/11 malicious caught, 7/7 legitimate zero false-kill), redaction gate (privacy, fail-closed off-machine). Full details: `docs/advanced.md`.

| # | 门 | 管什么 | 在哪生效 |
|---|---|---|---|
| 1 | **修法守卫** | 有没有**真修法**（无可执行内容 → 不注入） | 召回 |
| 2 | **叙述守卫** | 是不是**旁白流水**（开场白式 → 不注入） | 召回 |
| 3 | **注入守卫** | 是不是**恶意指令**（提示词注入 → 不注入） | 召回 + 导入 + 导出 |
| 4 | **脱敏闸门** | 会不会**泄私有内容**（IP/路径/密钥 → 拦截不出网） | 导出 + 导入 |

守卫模块缺失时 fail-closed（导出/导入拒绝执行；召回侧跳过注入门但其余三门照常——只读不阻断、写入必须 closed）。

## 什么时候提醒：五个触发点（0.16.0 的核心设计）

> **EN**: Recall must be bound to concrete action nodes, never left to memory. Five trigger points: T1 task start (recall --query), T2 before actions, T3 on error (recall --error), T4 after fixing a pit (deposit immediately), T5 task end (register-hit/negate --gene). Integration: install-hooks for hooked hosts, install-snippet to paste the procedure into any agent instruction file.
> 「装了技能但没人调用」是本项目最根本的失效模式——**连作者都会忘**（实测：相关基因能召回排 #1，却因为动手前没跑召回而重复踩坑）。所以不能指望"用户记得"，必须把召回**绑死在具体动作节点上**。

| # | 触发点 | 时机 | 命令 | 没接会怎样 |
|---|---|---|---|---|
| **T1** | 任务开始 | 拿到非平凡任务、**规划之前** | `recall --query "<任务>"` | 预防失效：该避的坑照踩 |
| **T2** | 行动前 | 即将执行写文件/跑命令/调接口 | 同上（query=将做的事） | 贴身预防（可选） |
| **T3** | **遇到报错** | 工具返回错误、**准备重试之前** | `recall --error "<报错原文>"` | **最可惜**：明明库里就有修法，却盲目重试 |
| **T4** | 修好坑后 | 修复了一个不显而易见的坑 | `draft --error ...`（沉淀） | 经验流失，下台机器再踩 |
| **T5** | 任务结束 | 收尾 | `--register-hit --gene <id>` / `--negate --gene <id>` | 无法度量，失效修法发现不了 |

**触发词中英对照**（任一出现即视为触发信号）：

| 中文 | English | 触发动作 |
|---|---|---|
| 经验召回 / 错题本 / 避坑 | recall / experience inheritance / lessons learned | T1：`recall --query` |
| 沉淀 / 记一笔 | deposit / distill / remember this | T4：`draft --error` |
| 自进化 / 经验继承 | self-evolution / evolver / pi-evox | T1 + T4 |
| distill / evolver | distill / evolver | T4（手写式） |

**接入方式**：有钩子的宿主（OpenClaw/Hermes）用 `install-hooks`；任何有 AGENTS.md/CLAUDE.md 的宿主用 `install-snippet` 把五触发点规程写进指令文件。完整接入契约（三步+模板）见 `docs/advanced.md`。

## 常见错误用法（反模式速查）

> **EN**: Anti-pattern quick list - each row explains the MECHANISM, not just the symptom. Full 14-item catalog with [A] evidence: `docs/common-mistakes.md`. Key ones: success-summary strategies are noise (+36pp worse than nothing), model-may-fail traps have unreliable hit rates, token deltas need a no-injection control group (~-22% repeat-execution baseline), error counting must use authoritative flags (isError=true), cold start needs flow-B deposits first.
> 每条附「**为什么会错**」——讲机制而非现象。完整清单（含更多条目）见 [`docs/common-mistakes.md`](docs/common-mistakes.md)。

| 错误做法 | 为什么会错（机制） | 正确做法 |
|----------|--------------------|----------|
| 注入「成功总结」型 strategy | 软提示里「结论」对智能体零信息；只有**可执行动作**改变下一轮行为（等效噪声 +36pp） | 写成可执行修法（含参数/命令/编码） |
| 冷启动就期待避坑效果 | 召回是「对靶注入」，空库时物理上无可注入修法 | 先按流程 B 沉淀，价值复利增长 |
| 生产环境开 `--auto-approve --llm-refine` | 人工审核门是唯一质量闸，跳过即让未复核内容直达注入 | 保留人工审核门 |

> 其余条目（陷阱类型选择、对照组设计、错误统计口径、跨机协作等）见 [`docs/common-mistakes.md`](docs/common-mistakes.md)（每条带 🔧现行/✅已修复 状态标注）；跨机与命名池工作流见 [`docs/cross-machine.md`](docs/cross-machine.md)。

## 安全与数据外发声明（精简版）

> **EN**: All CLI calls are direct argv (no shell). The only egress is `--llm-refine` (disabled by default, needs explicit endpoint config). `--fresh` is destructive (auto-backed-up). Injected blocks are transparently marked; global output is redacted. Full text: `docs/security-and-license.md`.
全文见 [`docs/security-and-license.md`](docs/security-and-license.md)。要点：全部 CLI 调用为 **argv 直调**（无 shell、无拼接）；外发仅 `--llm-refine`（默认禁用、需显式配置端点）；`--fresh` 有破坏性（自动备份）；注入块透明标注、全局输出脱敏（密钥不出现在任何 stdout）。

## 目录与文档导航

| 路径 | 作用 | 何时看 |
|------|------|--------|
| `SKILL.md`（本文件） | 日常用法：流程 A/B、触发点、安全摘要、反模式速查 | 首次使用与日常 |
| `code/evolver-recall.mjs` | 流程 A：召回 + 命中登记（**唯一召回实现**） | 接智能体 / 排查召回为空 |
| `code/light-cli.mjs` | 流程 B：沉淀/审核/取证 + timeline/harvest/gene 池 | 沉淀修法、审核基因 |
| `code/pi_evolve.mjs` · `code/engine/light/` | 流程 C 编排器 · 轻量引擎三件套 | 研究用 / 理解引擎 |
| **`docs/advanced.md`** | 回填寻址/时间线/harvest/并发锁/共享库/宿主接入/运维/安全门明细 | 接生产环境、排查「没生效」 |
| **`docs/common-mistakes.md`** · **`docs/config-errors.md`** · **`docs/faq.md`** | 14 条错误用法 · 常见配置错误 · 完整 FAQ | 踩坑后 / 环境出错 / 速览不够时 |
| `docs/forensics-numbat.md` · `docs/providers.md` · `docs/security-and-license.md` | numbat 取证 PoC · LLM 配置 · 安全与许可 | 对靶验证 / 跑流程 C 前 / 引入生产前 |
| `examples/walkthrough-*.md` · `traps/make_*_trap.py` | 端到端走查（GBK/JSON/流程 C）· 6 种陷阱生成器 | 第一次照着跑 / 流程 C |

## 致谢与上游

**上游引擎与宿主**：基于 [pi-coding-agent](https://github.com/earendil-works/pi) 与 [@evomap/evolver](https://github.com/EvoMap/evolver)。实测发现的 4+1 项上游缺口已提交官方 issue（evolver#624-#627、pi#9258），详见 README。

**方法论致谢（完整列表见 README）**：
- **[numbat](https://github.com/perplexityai/numbat)**（Perplexity AI，Apache-2.0）—— agent 行为审计器。`timeline` 与 `harvest` 的方法论直接受其启发；PoC 手册见 `docs/forensics-numbat.md`。
- **[FlyLoRA](https://arxiv.org/abs/2510.08396)**（NeurIPS 2025，清华大学）—— 负载均衡偏置与免训练合并不干扰两条原理的显式迁移来源（0.14.4）。

> 以上均为**研读与对照**：本项目与它们均无隶属关系，也不代表其观点；本仓库实现均为原创，默认后端是 MIT 的内置引擎。完整方法论清单（Palantir Ontology 等）见 README 致谢节。
