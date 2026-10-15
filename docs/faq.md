# FAQ（完整版）

> SKILL.md 只保留高频速览；这里是完整 14 条。按「先自救（doctor/info）→ 再查此处」的顺序。

**Q1：召回输出「无可召回修法」是坏了吗？**
不是。经验库从零开始，首次运行必然为空。想**立刻有东西可召回**，装起步包最快：
```bash
node code/light-cli.mjs starter      # 装载 10 条通用教训（编码/JSON/权限/文件/语法/类型/网络）
node code/evolver-recall.mjs --query "读取中文日志报 UnicodeDecodeError"   # 立刻能命中
```
**EN A1**: Normal - the store starts empty. Fastest way to get something recallable: `starter` loads 10 curated general lessons.


**Q2：models.json 里配 `$ENV` 环境变量不生效？**
pi **0.85.1 起已支持 `$ENV` 插值**（实测确认，上游 issue #9258 已闭环）；**0.74.2 及更早不支持**，需 `--api-key "$MY_KEY"` 显式传。
**EN A2**: pi >= 0.85.1 supports `$ENV` in models.json (upstream issue #9258 closed); <= 0.74.2 does not - pass `--api-key` explicitly.


**Q3：`--fresh` 会不会丢数据？**
不会丢——运行前自动备份到 `~/.evomap/assets/backup-<时间戳>/`。恢复时把该目录下的 `genes.jsonl` 与 `review.jsonl` **配套**拷回。但清空动作仍是破坏性的，执行前请确认。
**EN A3**: No data loss - auto-backup to `~/.evomap/assets/backup-<ts>/` before running. Restore genes.jsonl + review.jsonl together.


**Q4：修法注入后还是踩坑了，为什么？**
修法注入是软提示（system prompt），遵从度模型相关——它把「多次试错」压成「最多一次教训」，但不承诺 100% 避坑（诚实边界见报告 §22）。
**EN A4**: Injection is a soft prompt (system prompt) - adherence is model-dependent. It compresses many tries into at most one lesson; it never promises 100% avoidance (see report section 22).


**Q5：沉淀/审核时报「命令找不到」？**
默认后端（light）**零外部依赖**，只要 node ≥22 就能跑：
```bash
node code/light-cli.mjs doctor    # 环境自检
node code/light-cli.mjs list      # 查看台账
```
只有在用 evolver 集成（`--engine evolver`）时才需先 `npm install`。
**EN A5**: The default light backend has zero external dependencies - Node >= 22 suffices. `doctor` for environment self-check. npm install only needed for the evolver integration.


**Q6：approve 能全自动吗？**
**0.16.0 起默认就是自动的**——自己沉淀的基因自动通过、立即可注入（召回侧守卫仍兜底）。想改回人工：`config --auto-approve off` 或单次 `--no-auto-approve`。注意：**从共享池 `gene import` 不受此项影响**，仍按 `--tier` 判定。
**EN A6**: Automatic since 0.16.0 - your own deposits are approved immediately (recall-side guards still apply). Change with `config --auto-approve off`. Pool imports are unaffected (still `--tier` gated).


**Q7：国内网络 npm/GitHub 慢？**
npm 换国内镜像：`npm config set registry https://registry.npmmirror.com`；GitHub 克隆可用镜像代理或直接下载 Release zip。
**EN A7**: npm domestic mirror: `npm config set registry https://registry.npmmirror.com`; for GitHub, use a mirror proxy or download the Release zip directly.


**Q8：Node 版本要求？**
≥22（traps 生成器还需 Python 3）。版本过低时 pi/evolver 可能启动失败。
**EN A8**: >= 22 (traps also need Python 3). Lower versions may fail to start pi/evolver.


**Q9：我沉淀了很多，但好像从来没被用过？**
先看闭环健康度——大概率是两个静默失效之一：
```bash
node code/light-cli.mjs info      # 看「召回次数 / 命中 / 待审」
```
- **召回次数 0** ⇒ 要么手工跑一次召回，要么 `install-hooks` 让宿主自动召回；
- **待审 > 0** ⇒ 这些基因不会注入，用 `approve <gene_id>` 放行。
**EN A9**: Check loop health via `info` first - likely recall never ran (run it once or install-hooks) or genes await review (approve them).


**Q10：`install-hooks` 会不会改坏我的宿主配置？**
不会擅自改。它**默认只演练**：打印将要复制的文件、目标路径、需手工确认的注册步骤，**不落盘**。确认后加 `--yes` 才写入（写入前自动备份）。回滚 = 删除钩子目录。
**EN A10**: It never writes without consent - dry-run by default, `--yes` applies after confirmation, with automatic backup. Rollback = delete the hook directory.


**Q11：起步包里的基因是哪来的？安全吗？**
是策展过的**通用工程教训**，来源为实际踩坑并人工筛选；装载时同样**过脱敏闸门 + 注入扫描**两道门；不收集、不上传任何数据，纯本地文件。
**EN A11**: Curated general engineering lessons from real incidents, human-filtered; loading passes the same redaction + injection gates. No collection, no upload, pure local files.


**Q12：我的 Agent 既不是 OpenClaw 也不是 Hermes，怎么让它自动用？**
用规程粘贴：`node code/light-cli.mjs snippet` 输出「五个触发点」操作规程，粘进你的 AGENTS.md / CLAUDE.md / 系统提示即可。这是没有钩子机制的宿主最可靠的接入方式。
**EN A12**: Use the procedure paste: `snippet` outputs the five-trigger-point protocol; paste it into AGENTS.md / CLAUDE.md / system prompt. The most reliable integration for hosts without hooks.


**Q13：为什么我的 agent 修完坑从来不自动沉淀？**
因为 T4（修好坑后沉淀）没出现在它的上下文里——技能只在被加载时影响 agent。解法：`install-snippet --file <项目>/AGENTS.md --yes` 把五触发点规程写进项目指令文件。这是**写侧的 last mile**。
**EN A13**: Because T4 never entered the agent context - skills only influence agents when loaded. Fix: `install-snippet --file <project>/AGENTS.md --yes` writes the procedure into the project instruction file (the write-side last mile).


**Q14：多会话并行时 register-hit 为什么会错记？**
0.17.0 及以前用位置编号（#N），而「本次召回选中集」是共享单文件，会被其他会话的 recall 覆盖 → 编号漂移。**0.18 起用 `--gene <asset_id|gene_id>` 按 id 寻址**，并发安全。
**EN A14**: Pre-0.18 used positional numbers against a shared single-file selection snapshot (overwritten by other sessions' recall). 0.18+ addresses by `--gene <asset_id|gene_id>` - concurrency-safe.

