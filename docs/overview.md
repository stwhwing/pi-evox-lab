# Pi × EvoX Loop 项目概览

> **EN**: One-pager: coding agents re-discover the same fixes from scratch every session. PiEvoX gives them an "experience inheritance" runtime - recall validated fixes at task start, deposit new ones after fixing non-obvious failures. Local-first, MIT (zero-dep default backend), four security gates, measured gains (GBK trap: decode errors 11->4, tokens -55%; illegal JSON: errors 14->3, tokens -53%; paired control isolates the ~-22% repeat-execution baseline).

## 一句话
给编码智能体装「经验继承」：**Agent 踩过的每个坑，只踩一次。**

## 问题
- 每次新会话，Agent 都从零开始——同一个坑（编码、路径、权限、API 限流）反复踩；
- 个人/团队的经验散落在聊天记录和备忘里，无法在**下一次任务开始时自动生效**。

## 方案
- **流程 A（召回）**：任务开始/遇到报错时，`evolver-recall --query/--error` 把**已验证的修法**注入上下文（对靶过滤，不相关不注入）；
- **流程 B（沉淀）**：修好一个不显而易见的坑后，`draft --error` 引导式生成基因（含负经验 anti_patterns），过质检门后入库；
- **流程 C（可选，研究）**：受控实验量化继承收益（陷阱 → R1/R2 对比）。

## 安全属性
- **本地优先**：默认后端零依赖纯 Node；唯一外发选项 `--llm-refine` 默认禁用；
- **四道安全门**：修法守卫/叙述守卫/注入守卫（11/11 恶意样本拦截、7/7 正常零误杀）/脱敏闸门；
- **可验证的效果**：配对对照实验（扣除重复执行基线 ≈-22%）；
- **provenance 签名链**（0.21）：Ed25519 每机身份，池基因验签，篡改拒收。

## 场景词表（基因分类，0.24）
`ops-deploy`（部署/服务器）· `coding-debug`（编码/解析）· `release-publish`（发布/版本）· `api-integration`（API/webhook）· `git-workflow`（git/仓库）· `agent-runtime`（宿主/管线）——拉取/策展/退役按此分；召回对靶仍由 signals 自由匹配。

## 上手路径
见 [`examples/quickstart.md`](../examples/quickstart.md)。Node ≥22，无其他依赖。

## 已知局限
- 修法注入是**软提示**——遵从度随模型而异，不承诺 100% 避坑；
- 库的价值随使用复利增长，冷启动需要先沉淀几条；
- 共享池是自建 opt-in 机制，不是中心化服务。

### 规模的量化边界（0.29 补，全部标注实测状态）
| 维度 | 当前实测值 [A] | 边界说明 |
|---|---|---|
| 库规模 | 本机 217 条记录 / **133 条活跃（已审核）**（2026-10-21） | 打分公式：信号匹配 +3/个、正文 token 交集 +1/个、负载均衡 ±2，**低于 2 分不注入**；召回排序对 10² 量级稳定 |
| 库规模上限 | **未实测** | 预期在 >500 条活跃后需重新校准 top-N 与阈值（届时用 `report` 的 L1/L2 指标做 A/B，不拍脑袋） |
| 注入条数 | `--top` 默认 5 条 | 只注入「已审核 + 过修法守卫 + 与查询对靶」的条目；宁缺毋滥（实测：不对靶注入比不注入更差） |
| 并发写入 | 单机多会话：文件锁（withLock，5s 超时 fail-open） | **跨机并发无分布式锁**——靠「各自库 + git 合并 + LWW 台账」裁定，不适合多机同时写同一库 |
| 池同步延迟 | 自建 Git 池：推拉即 git 往返（秒级~分钟级，取决于网络） | 池不是实时服务；`gene pull` 拉到的是上次快照 |
| 溯源覆盖 | deposit/register-hit 记录 `source_model` + `source_host`（0.29 起） | `report` 的 L4 出「跨源率」——单源占比高 = 修法只被一个（模型｜宿主）验证过，换环境可能失效 |

## 致谢
方法论受 [numbat](https://github.com/perplexityai/numbat)（Perplexity，Apache-2.0，取证重建）与 [FlyLoRA](https://arxiv.org/abs/2510.08396)（NeurIPS 2025，负载均衡/免训练合并不干扰）启发；上游引擎 [pi-coding-agent](https://github.com/earendil-works/pi)（MIT）/ [@evomap/evolver](https://github.com/EvoMap/evolver)（GPL，可选集成）。
