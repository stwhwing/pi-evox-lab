---
name: pi-evox-loop
slug: pi-evox-loop
displayName: "Pi EvoX Loop"
description: "Give your coding agent an 'experience inheritance' runtime: recall validated fixes from an Evolver gene store at task start, register hits when a fix is actually used, and deposit newly-learned fixes after repairing a non-obvious failure. Optionally run controlled closed-loop experiments (R1 trap → distill → inject → R2) to measure inheritance gains. Every fix is traced to its model/host and checked across models. Use at the START of non-trivial tasks, after fixing a non-obvious failure, or when you want to measure agent self-evolution. Trigger words: 经验召回, 错题本, 经验继承, 自进化, evolver, 避坑, distill."
description_zh: "给编码智能体装上「经验继承」运行时：任务开始时从 Evolver 基因库召回已验证修法（编号列表），相关则采用并在结束时登记命中；任务中修复了非显而易见的失败后，将修法入库供未来召回；可选跑受控闭环实验量化继承收益。每条修法都记录来源模型与宿主，并做跨模型核验。非平凡任务开始时、修复有价值失败后、或想测量 agent 自进化效果时使用。触发词：经验召回、错题本、经验继承、自进化、evolver、避坑、distill"
description_en: "Experience-inheritance runtime for coding agents: recall validated fixes (numbered) at task start, register hits when used, deposit fixes after repairing failures; optional controlled closed-loop experiments to measure inheritance gains. Every fix is traced to its model/host and checked across models."
version: 0.33.0
platforms: [linux, macos, windows]
homepage: https://github.com/stwhwing/pi-evox-lab
metadata:
  openclaw:
    requires:
      bins:
        - node
    envVars:
      - name: EVO_STORE_DIR
        required: false
        description: 基因库目录（默认 ~/.evomap/assets）；仅 evolver 引擎模式读取
      - name: EVOX_HITS_DIR
        required: false
        description: 命中登记目录（默认与基因库同级）
      - name: EVOX_TOPN
        required: false
        description: 召回 top-N 数量（默认由 skill 内部策略决定）
      - name: EVOX_AUTO_APPROVE
        required: false
        description: 沉淀是否自动批准（默认按 TTY/非 TTY 规则）
      - name: EVOX_SOURCE_MODEL
        required: false
        description: 覆盖溯源记录的服务模型名（默认从宿主会话读取）
      - name: EVOX_SOURCE_HOST
        required: false
        description: 覆盖溯源记录的宿主名
      - name: EVOX_HOME
        required: false
        description: evomap 根目录（默认 ~/.evomap）
      - name: EVO_POOL_DIR
        required: false
        description: 共享基因池目录（跨实例同步）
      - name: EVO_IDENTITY_DIR
        required: false
        description: 签名链身份目录（Ed25519 密钥对）
      - name: EVOX_ALIGN_INJECT_MOD4
        required: false
        description: 注入块估算 token 数补齐到 4 的倍数（相位对齐实验开关）
      - name: EVOX_KV_COMPRESSION
        required: false
        description: 标记本机模型的 kv 压缩族（none/csa-s4/stride2/unknown）
      - name: EVOX_SAME_KV_WEIGHT
        required: false
        description: 同 kv 压缩族基因的加权分（默认 +1.5，设 0 关闭）
      - name: EVOX_GENE_DECAY
        required: false
        description: 基因有效性衰减总开关（默认开；设 0 关闭，行为与此前版本一致）
      - name: EVOX_GENE_DECAY_DAYS
        required: false
        description: 衰减半衰期天数（默认 90：距上次反馈每过一个半衰期，该基因排序分减半）

---

# Pi × EvoX Loop — 智能体经验继承 Skill

> 让 Agent 的每个坑只踩一次：失败经验自动入库（守卫过滤），同类任务自动召回已验证修法。
>
> **术语约定（0.29）**：正文以中文为主，技术字段在**首次出现时标注一次英文原名**（如「信号匹配 signals_match」），此后一律用中文，不再反复混排。完整中英对照见 `docs/faq.md` Q17。
>
> **文档地图（0.21 分层）**：
> - **新用户只需读三节**：30 秒上手 → 流程 A → 流程 B（约 60 行）；其余按需查。
> - **一分钟判断要不要用**：`docs/one-pager.md`（0.30 新增）
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
- 私钥不出本机；公钥随基因出入池供他机验签——信任模型是“按 keyid 溯源”，不是中心化 CA；
- **签名规范化 v2（0.31）**：v1 的签名域**不含嵌套字段**（ replacer 数组作用于每一层，嵌套内容被静默丢弃）；v2 递归规范化，把嵌套内容全部纳入。新签名一律 v2，存量 v1 仍有效（验签通过但会提示可升级）；升级用 `light-cli resign --yes`（默认只演练不落盘）。
- **精确归因（0.32 D-2）**：此前 `~/.evomap/source.json` 只是**静态 per-host 默认值**，而宿主有 fallback 链——某轮实际由 fallback 服务时会被误记成 primary。现两个生产钩子把**本轮实际服务的模型**透传（OpenClaw 读 `transcript_events` 里最近一条 assistant 事件的 `model`；Hermes 读 `pre_llm_call` payload 的 `extra.model`），落成 `~/.evomap/last_source.json`。`sourceInfo()` 优先级：**env > last_source.json（7 天窗）> source.json > 空**。⚠️ 语义是「最近一次观测到的服务模型」，不保证与本次 deposit 同轮次；存量基因不回填。
- **压缩方案族 `source_kv`（0.32 B-5/B-6）**：`generation_meta.source_kv` 记录基因出自哪种 **KV 压缩方案**（`none` / `csa-s4`（W=8,S=4）/ `stride2` / `unknown`；闭源或架构未公开一律 `unknown`，不猜）。召回打分对**已知同族**基因加分（`EVOX_SAME_KV_WEIGHT`，默认 1.5，设 0 关闭）；**本机族未知时完全不加权**，行为与此前一致。为什么按压缩方案而非模型血统：arXiv:2609.36322 把 DeepSeek 的 CSA 压缩核移植到 Qwen3-0.6B 骨架从头预训练仍复现「位置相关的检索失败」⇒ 决定因素是压缩核，不是厂商。
- **注入长度留痕（0.32 B-1）**：注入块是追加在 system prompt 尾部的，其 token 数会**平移其后所有内容的相位**；召回是动态 top-N ⇒ 注入长度随会话变化。`evolver-bridge.ts` 现把 `chars`/`estTokens` 写入 sidecar；`EVOX_ALIGN_INJECT_MOD4=1` 可把**估算** token 数对齐到 4 的倍数（估算值，非真实分词）。
- **基因有效性衰减（0.33 C-7）**：修法会过期——环境变了、依赖升级了，老基因的 FIX 可能已失效。召回打分现对**有反馈**（hit/negate 至少一条）的基因按两个信号乘性衰减：**时间半衰期**（距上次反馈每过 `EVOX_GENE_DECAY_DAYS` 天——默认 90——排序分减半）与**否定压力**（negate ≥ 2 且否定率 ≥ 50% ⇒ 再减半）。衰减后低于对靶阈值的自然落选；注入行对衰减中的基因带一眼标记（如 `⚠[衰减:49%·多次未奏效·2天前反馈]`）。**无反馈的基因不衰减**（unproven 由审核门控管，不双重惩罚）；**地板 0.25**——衰减永不单独杀死基因，硬过滤仍是审核门控 + 守卫；`EVOX_GENE_DECAY=0` 一键关闭（行为与此前版本完全一致）。

> **EN**: 0.32 provenance & phase line - `~/.evomap/source.json` used to be only a static per-host default, so a turn actually served by a fallback was mis-recorded as the primary. The two production hooks now pass the **actually served model** (OpenClaw reads the most recent assistant event's `model` from `transcript_events`; Hermes reads `extra.model` from the `pre_llm_call` payload) into `~/.evomap/last_source.json`. `sourceInfo()` priority is **env > last_source.json (7-day window) > source.json > empty** - it means "most recently observed serving model", not guaranteed to be this deposit's turn; existing genes are not back-filled. Genes also carry `generation_meta.source_kv`, the **KV compression scheme** they came from (`none` / `csa-s4` (W=8,S=4) / `stride2` / `unknown`; closed or undisclosed architectures are always `unknown`, never guessed), and recall scoring bonus-boosts **known same-family** genes (`EVOX_SAME_KV_WEIGHT`, default 1.5, 0 disables; when the local family is unknown there is no weighting at all). The axis is the compression scheme rather than vendor lineage because arXiv:2609.36322 reproduces position-dependent retrieval failure by porting DeepSeek's CSA kernel onto a Qwen3-0.6B backbone. Finally, because the injected block is appended to the system prompt its token count **shifts the phase of everything after it**, and recall is dynamic top-N, so injection length varies per session: `evolver-bridge.ts` now logs `chars`/`estTokens` and `EVOX_ALIGN_INJECT_MOD4=1` aligns the **estimated** token count to a multiple of four (an estimate, not real tokenization). 0.33 adds **gene validity decay (C-7)**: recall scoring applies a multiplicative decay to genes **with feedback**, from a time half-life (default 90 days, `EVOX_GENE_DECAY_DAYS`) plus negation pressure (≥2 negates and ≥50% negate rate halves again), floored at 0.25. Genes **without feedback are never decayed** (unproven is the review gate's job), decay alone never kills a gene, and `EVOX_GENE_DECAY=0` restores the old behaviour exactly; decayed injections carry a visible marker (e.g. `⚠[衰减:49%·多次未奏效·2天前反馈]`).

## 部署与分发（0.23）

> **EN**: Download paths (GitHub / npm / restricted-network mirror), host integration one-command, and concurrency semantics for shared deployments.

- **下载**：GitHub Release zip / npm（`npm config set registry https://registry.npmmirror.com`）；网络受限环境用国内镜像 zip（附 sha256 校验，见 FAQ Q7）；
- **宿主接入**：`light-cli.mjs install <claude-code|cursor|codex|agents-md>`（自动定位配置文件写入规程，`--yes` 落盘）；OpenClaw/Hermes 用 `install-hooks`；
- **基因池协作**：`gene pull --pool https://zyx.pink/pool/genes.jsonl --tier official` 从官方镜像拉取全池（签名验证，66+ 条策划基因）；`gene submit --bundle <file>` 产出提交包回传维护者（PR / issue 附件 / 文件交换）；导入默认隔离+验签；池仓库贡献条款见 CONTRIBUTING.md（CC-BY-4.0）；
- **场景拉取**（0.24）：`gene pull --pool <URL> --scene <场景>` 只拉该场景子集；受控场景词表：`ops-deploy`（部署/服务器）/ `coding-debug`（编码/解析）/ `release-publish`（发布/版本）/ `api-integration`（API/webhook）/ `git-workflow`（git/仓库）/ `agent-runtime`（宿主/钩子/管线）；`gene list --scene <名>` 本地同粒度过滤；
- **并发语义**（三层，**完整行为表见「五个触发点」节的"多宿主同时召回会发生什么"**）：单机多会话=withLock 文件锁；跨机=基因池 Git 化（提交→审核→合并，LWW 台账裁定冲突）；多宿主召回幂等（重复召回同一基因不重复计数）。多宿主并行时按 gene_id 寻址（0.18 起），不用位置序号。
- **召回打分与阈值（公开数值，0.28 补）**：每条候选基因的得分 = **signals 精确命中 +3/个** + **与基因正文 token 交集 +1/个** + 负载均衡偏置 **±2**（冷门基因上抬、热门下压；命中全 0 时不生效）；**低于阈值 2 分即不注入**（宁缺毋滥：只注入不对靶内容比不注入更差，实测 +36pp）。命中判定用与召回同一套分词：ASCII token（≥3 字符）+ 中文 **2 字二元词**（CJK bigram）——因此**多字中文短语写进 signals 是无效的**（见 `fix-signals`）。`--top` 默认注入条数见 `evolver-recall.mjs --help`。
- **命名池（0.25）**：`~/.evomap/pools.json` 定义命名池源（`{"pools":{"official":"<url>","team":"<git-url>"}}`），`gene pull official` 按名拉取；已拉池缓存在 `~/.evomap/pool-cache/`。
- **会话围栏（0.27）**：`light-cli.mjs session open "<任务名>"` 一步完成「T1 召回 + 记账」（落生产账本）；`session close "<本轮结论>"` 收尾记结论；`session` 查看围栏记录。**围栏让召回与沉淀可审计**：跳过召回或收尾沉淀，账本里没有配对的 open/close，外部构建门禁会拒绝构建。配套：`doctor` 检查埋点落点漂移。
- **召回别名与触发词（0.28）**：`code/engine/light/aliases.json` 是概念别名表（concept → 英文 canonical + 中文别名短语）；①`draft --trigger "<动手前的措辞>"` 把触发短语展开成 signals（英文 canonical + 中文二元词**双写**）——预防型经验因此能在**动手前**被召回；②召回时中文 query 也会映射到英文 canonical（两种措辞都能命中）；③`light-cli.mjs fix-signals` 体检并展开存量基因里的**无效中文 signal**（>2 字在二元分词下永远匹配不上）。**打分公式与阈值不变**——语义只扩召回面，注入仍由确定性门决定。
- **溯源与异构验证（0.29）**：deposit / `--register-hit` / `--negate` 都记录 `source_model` + `source_host`（环境变量 `EVOX_SOURCE_MODEL` 可显式指定模型）；`report` 新增 **L4 异源复现率**（同一基因被 ≥2 个不同「模型｜宿主」复现过才算 cross-source）与 **negate 根因分布**（`--because model-diff|env-diff|scene-mismatch|fix-wrong`）；`gene export` 给基因打 `trust` 标签（single-source / unknown-source）。**动机**：基因库是单点，防污染的三道门是同源代码——「单作危机」的直接指标就是跨源率，单源占比高说明该修法只被一个环境验证过。
> **EN**: Our "heterogeneous verification" question comes from arXiv:2512.05117 (models of the same architecture share a low-dimensional weight subspace, and may therefore **inherit shared biases and failure modes**; the paper leaves "is that lack of diversity a bottleneck" as an **open question** and notes cross-architecture comparison has no method yet). What we do is a **response-level measurement** (failure-signature agreement across models on one deterministic trap) - not a port of its weight-space results.
- **理论出处（0.30）**：本项目的「异构验证」问题意识来自 arXiv:2512.05117《The Universal Weight Subspace Hypothesis》（同架构模型共享低维参数子空间 → 可能**继承共同偏差与失败模式**；该文把"是否构成瓶颈"列为**开放问题**，跨架构比较尚无方法）。我们据此做的是**响应级实测**（不同模型在同一确定性陷阱上的失败签名一致率），**不是**权重空间结论的移植——详见 README 致谢区与 `docs/research.md`。
- **效果量化（0.25）**：`light-cli.mjs report` 周报（L1 活性/L2 回填率/L3 错误家族复发，`--json` 可机读）；`recall --record "<结论>"` 把验证结论回填生产账本；`draft/distill --commit` 自动写 deposit 事件。
- **许可验证（0.25）**：`light-cli.mjs license verify <token>` 验证 Ed25519 签名许可（发行方公钥随包 `assets/issuer-pub.txt（ClawHub/GitHub 0.25.0 首发的 .pem 版同样兼容）`）；许可机制本身开源，便于任何发行方接入。
- **IO 重试语义**：文件读写对瞬态错误（EBUSY/EPERM/EACCES/ETIMEDOUT）自动重试（默认 3 次/截止 3s，`EVOX_IO_RETRY`/`EVOX_IO_DEADLINE_MS` 可调）；非瞬态错误不重试；重试是优化不是门——绝不因重试机制阻塞调用方（fail-open）。

## 安全：四道门（0.16.0）

> **EN**: Genes are soft prompts injected into the system prompt - one malicious gene is one prompt injection. Four gates: repair-signal guard, narration guard, injection guard (malice; AVOID=warning allowed vs FIX=instruction blocked - regression suite 16/16 malicious caught, 7/7 legitimate zero false-kill), redaction gate (privacy, fail-closed off-machine). Full details: `docs/advanced.md`.

| # | 门 | 管什么 | 在哪生效 |
|---|---|---|---|
| 1 | **修法守卫** | 有没有**真修法**（无可执行内容 → 不注入） | 召回 |
| 2 | **叙述守卫** | 是不是**旁白流水**（开场白式 → 不注入） | 召回 |
| 3 | **注入守卫** | 是不是**恶意指令**（提示词注入 → 不注入） | 召回（CLI / Pi 扩展桥 / 编排器三条通道）+ 导入 + 导出 |
| 4 | **脱敏闸门** | 会不会**泄私有内容**（IP/路径/密钥 → 拦截不出网） | 导出 + 导入 |

> **四道门各自查什么、命中会怎样（0.28 补全——不必跳转 advanced.md 即可自足使用）**：
>
> | 门 | 具体扫什么 | 命中后的行为 |
> |---|---|---|
> | 修法守卫 | strategy 里是否有**可执行成分**（具体参数/命令/编码/路径等）；空话、"运行正确"式总结、只有结论没有动作 | **该基因不进入注入列表**（宁缺毋滥）；沉淀侧另有 depositionGate 在入库前就拒收同类内容 |
> | 叙述守卫 | 是否为**旁白/流水账**（"我先打开文件，然后……"式叙述、复述日志） | 同样**不注入**；软提示里的旁白对智能体是零信息（实测等效噪声 +36pp，比不注入更差） |
> | 注入守卫 | 是否含**提示词注入特征**（覆盖先前指令、对用户隐匿操作、伪装角色标记等，中英文变体；具体特征表见 `docs/advanced.md`，此处不复述以免文档本身触发扫描） | **不注入 + 导入/导出时拦截**；这是对抗"基因内容反过来操纵宿主"的主防线 |
> | 脱敏闸门 | 是否含**私有内容**（内网 IP、绝对家目录、密钥/令牌、凭据、内部代号） | **导出/导入拦截，不出网**；沉淀时保留语义但中性化表述 |
>
> 门模块缺失时的降级：**导出/导入 fail-closed（拒绝执行）**；`evolver-recall.mjs` 侧只跳过注入门、其余三门照常（宿主 bootstrap 路径不能因守卫失败而阻断使用者）。**例外**：Pi 扩展桥（`evolver-bridge.ts`）内置**精简版**注入守卫（单文件拷贝部署，无法 import 完整扫描器），编排器 `pi_evolve.mjs` 则用完整扫描器且不降级。
>
> **0.31 修复（实测确认的两个漏检）**：① 注入扫描器原先把 `FIX:` **之前**的文本整体丢弃、不进任何扫描区 ⇒ 「指令覆盖类前缀 + `FIX:` 修法后缀」可绕过；② 中文「指令覆盖」正则对动词与指令类名词之间的修饰词限制过死，仅插入一个常见程度副词即不命中。两者均已修复并纳入回归用例。**纪律**：注释与文档里只描述机制类别、不引用触发串原文——说明文字本身会被扫描器当成注入样本（本仓有为此发版的先例）。

守卫模块缺失时 fail-closed（导出/导入拒绝执行；召回侧跳过注入门但其余三门照常——只读不阻断、写入必须 closed）。

## 什么时候提醒：五个触发点（0.16.0 的核心设计）

> **EN**: Recall must be bound to concrete action nodes, never left to memory. Five trigger points: T1 task start (recall --query), T2 before actions, T3 on error (recall --error), T4 after fixing a pit (deposit immediately), T5 task end (register-hit/negate --gene). Integration: install-hooks for hooked hosts, install-snippet to paste the procedure into any agent instruction file. T2 concretely: run recall before the FIRST side-effecting action in a task (e.g. before committing a cross-file change, before a deploy script that overwrites, before force-push) with the action phrase as the query; pure reads do not trigger. The trigger-word table below is an invocation hint for humans/agents, NOT the matching mechanism - any non-trivial task start takes T1 unconditionally, and Chinese phrasing maps to English canonicals via aliases.json.
> 「装了技能但没人调用」是本项目最根本的失效模式——**连作者都会忘**（实测：相关基因能召回排 #1，却因为动手前没跑召回而重复踩坑）。所以不能指望"用户记得"，必须把召回**绑死在具体动作节点上**。

| # | 触发点 | 时机 | 命令 | 没接会怎样 |
|---|---|---|---|---|
| **T1** | 任务开始 | 拿到非平凡任务、**规划之前** | `recall --query "<任务>"` | 预防失效：该避的坑照踩 |
| **T2** | 行动前 | **即将执行第一次不可逆动作之前**（写文件/提交代码/部署/调外部接口/删改数据）；同一任务内同类动作**只触发一次**，后续沿用本次结论 | 同上（query=**将要做的具体动作**，如"用脚本批量改写文件"） | 贴身预防（可选） |
| **T3** | **遇到报错** | 工具返回错误、**准备重试之前** | `recall --error "<报错原文>"` | **最可惜**：明明库里就有修法，却盲目重试 |
| **T4** | 修好坑后 | 修复了一个不显而易见的坑 | `draft --error ...`（沉淀） | 经验流失，下台机器再踩 |
| **T5** | 任务结束 | 收尾 | `--register-hit --gene <id>` / `--negate --gene <id>` | 无法度量，失效修法发现不了 |

> **T2 的判定口径（0.28 补明）**：①动作**尚未执行**（执行完就晚了）②动作**有副作用或不可逆**（写/提交/部署/外发/删除）③**本任务内首次**做这类动作时；纯读取/查询类动作不需要 T2。query 写**动作短语**（不是任务名）——召回按动作措辞对靶（如"批量改写文件"能命中对应修法）。

> **T2 具体例子（0.33 补，3 个可直接对号的）**：① 刚要 `git commit -m` 一个跨多文件的改动 → query `"提交跨文件改动前检查"`；② 刚要跑一个会**覆盖**目标目录的部署脚本 → query `"部署前备份与干跑"`；③ 刚要把本地改动**强推到远端**（覆盖远端历史） → query `"force push 前确认远端状态"`。都不命中 ⇒ 直接执行（宁缺毋滥，T2 是可选增强，不添延迟负担）；命中 ⇒ 先读修法再动手。**反例（不必触发）**：读文件、搜代码、跑测试、查看状态——纯读取无副作用。

**多宿主同时召回会发生什么（0.28 补明）**：
| 情形 | 行为 | 依据 |
|---|---|---|
| 两个宿主同时召回同一基因 | **各自独立注入**（软提示按宿主上下文渲染，不共享状态） | 召回无跨进程状态 |
| 同一宿主多会话并发召回 | 各自独立选出 top-N，**不共享选择快照**（0.18 起按 gene_id 寻址，不再有位置漂移） | `selectList` 每次现算 |
| 同一基因被多台机器同时沉淀 | `asset_id` 去重（内容哈希）→ 只落一条；**不同内容则各落一条**（不同 asset_id） | store.appendGene |
| 审核状态跨机冲突 | 各自台账 **LWW**（最后一个状态生效）——quarantine 可撤销 approve | review.jsonl |
| 一个宿主钩子重复触发（心跳/重连） | 召回幂等：重复注入不重复计命中（hits 只在 `--register-hit` 时记） | 埋点口径 |
| 钩子 env 到不了 agent 自调命令 | `persistActualSource` 把钩子透传的实测模型落 `last_source.json`，后续 deposit/hit 经它取到 | 0.32 D-2 |

### T3：报错自动触发（最容易被忽略、但收益最高的一个点）

> **EN**: T3 is the highest-yield trigger: when a tool returns an error, run recall with the raw error text **before retrying**. Without it you re-derive a fix your own store already holds.

**为什么单独拎出来**：T3 是唯一「**不用你记得**」的触发点——报错本身就是提醒。实测里最可惜的失效形态正是「库里明明有修法，却盲目重试」。

**口径**：工具返回错误、**准备重试之前**，把**报错原文**直接当查询（不要自己概括）：

```bash
node code/evolver-recall.mjs --error "UnicodeDecodeError: 'utf-8' codec can't decode byte 0xd5 in position 0"
```

命中后按修法重试；仍失败 → 走 T4 沉淀这条新坑。

**触发词 ↔ 命令映射（0.31 补全：每组主词给到可直接复制的命令）**

| 组 | 主词（记这一个就够） | 同义词（说了也算） | 触发点 | 具体命令（可直接复制） |
|---|---|---|---|---|
| **召回类** | **召回** | 经验召回 / 错题本 / 避坑 / recall / lessons | T1 任务开始 | `node code/evolver-recall.mjs --query "<任务一句话>"` |
| **召回类（报错）** | **报错了** | 失败了 / 又挂了 / 重试 / 修一下 / error / traceback | T3 遇到报错 | `node code/evolver-recall.mjs --error "<报错原文>"` |
| **沉淀类** | **沉淀** | 记一笔 / 入库 / deposit / distill / 存起来 | T4 修好坑后 | `node code/light-cli.mjs draft --error "<报错原文>"` |
| **进化类** | **继承** | 自进化 / 经验继承 / evolver / pi-evox | T1 + T4 | 先 T1 召回，修好后 T4 沉淀 |
| **体检类** | **体检** | 自检 / 健康度 / 有没有失效 / doctor / info | 随时 | `node code/light-cli.mjs info` |
| **签名类** | **签名** | 验签 / 篡改 / provenance / identity | 跨机协作前 | `node code/light-cli.mjs verify <gene_id>` |

> 术语不确定时（signals_match / anti_patterns / LWW / depositionGate / sig_v 等）查 [`docs/glossary.md`](docs/glossary.md)（一页纸，每个词配一个最小例子）。

> **触发词覆盖范围说明（0.33 补明）**：① 上表是**人/agent 的调用提示**，不是召回匹配机制——召回命中靠 `signals_match × query-token 重叠`（确定性对靶），触发词只是告诉你"什么时候该跑一次"；② **覆盖不到所有说法是正常的**：任务开始只要判定为"非平凡"就走 T1，不需要措辞命中任何一组（触发词表服务的是"用户明确提到某功能"的场景）；③ 中文措辞走 `aliases.json` 概念别名映射到英文 canonical（0.28），两种措辞都能命中；④ 报错类（T3）不需要触发词——**报错本身就是触发**，见下节。

**接入方式**：有钩子的宿主（OpenClaw/Hermes）用 `install-hooks`；任何有 AGENTS.md/CLAUDE.md 的宿主用 `install-snippet` 把五触发点规程写进指令文件。完整接入契约（三步+模板）见 `docs/advanced.md`。

> **进阶阅读（按需，不必通读）**：宿主接入三步模板 → `docs/advanced.md`「宿主接入」节；回填寻址与并发锁 → 同文「回填与并发」；模块调用关系图 → 同文「模块调用关系图」；跨机/命名池 → `docs/cross-machine.md`。

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
| **`docs/glossary.md`**（0.31 新增） | 术语一页纸：signal / signals_match / anti_patterns / LWW / depositionGate / sig_v 等，各配一个最小例子 | 看不懂某个词时 |
| **`docs/common-mistakes.md`** · **`docs/config-errors.md`** · **`docs/faq.md`** | 14 条错误用法 · 常见配置错误 · 完整 FAQ | 踩坑后 / 环境出错 / 速览不够时 |
| `docs/forensics-numbat.md` · `docs/providers.md` · `docs/security-and-license.md` | numbat 取证 PoC · LLM 配置 · 安全与许可 | 对靶验证 / 跑流程 C 前 / 引入生产前 |
| `examples/walkthrough-*.md` · `traps/make_*_trap.py` | 端到端走查（GBK/JSON/流程 C）· 6 种陷阱生成器 | 第一次照着跑 / 流程 C |

## 致谢与上游

**上游引擎与宿主**：基于 [pi-coding-agent](https://github.com/earendil-works/pi) 与 [@evomap/evolver](https://github.com/EvoMap/evolver)。实测发现的 4+1 项上游缺口已提交官方 issue（evolver#624-#627、pi#9258），详见 README。

**方法论致谢（完整列表见 README）**：
- **[numbat](https://github.com/perplexityai/numbat)**（Perplexity AI，Apache-2.0）—— agent 行为审计器。`timeline` 与 `harvest` 的方法论直接受其启发；PoC 手册见 `docs/forensics-numbat.md`。
- **[FlyLoRA](https://arxiv.org/abs/2510.08396)**（NeurIPS 2025，清华大学）—— 负载均衡偏置与免训练合并不干扰两条原理的显式迁移来源（0.14.4）。
- **[Periodic Weak Spots: Phase Sensitivity from Chunked KV-Cache Compression](https://arxiv.org/abs/2609.36322)**（ByteDance Seed）—— **相位轴**与**等长对照臂**这两项的来源（0.32）：分块 KV-cache 压缩引入「相位」这一新位置坐标，长上下文检索精度随其周期性起伏。本项目据此补上 R2-pad 等长中性对照臂，把继承增益从相位运气里分离出来（实测 n=10/臂、长度 Δ=0：语义 +100pp、相位 0pp）；并因论文把 CSA 核移植到 Qwen3-0.6B 骨架仍复现，把基因族字段定在**压缩方案**（`source_kv`）而非模型血统上。**论文自身结论本机未复现**（既未证实也未证伪），已在 `docs/research.md` §21.3 诚实标注；转述中越界的条目（`CSA2`、`Kimi`、`MLA` 等，原文 0 出现）本项目不引用。

> **EN**: **[Periodic Weak Spots](https://arxiv.org/abs/2609.36322)** (ByteDance Seed) - source of the *phase* axis and of the length-matched control arm (0.32): chunked KV-cache compression introduces a new positional coordinate, phase, and long-context retrieval accuracy rises and falls with it. It is why we added the R2-pad control arm that separates the inheritance gain from phase luck (measured n=10/arm, length Δ=0: semantic +100pp, phase 0pp), and why the gene-family field is the **compression scheme** (`source_kv`) rather than vendor lineage - the paper reproduces the effect by porting the CSA kernel onto a Qwen3-0.6B backbone.

> 以上均为**研读与对照**：本项目与它们均无隶属关系，也不代表其观点；本仓库实现均为原创，默认后端是 MIT 的内置引擎。完整方法论清单（Palantir Ontology 等）见 README 致谢节。
