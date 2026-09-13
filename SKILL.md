---
name: pi-evox-loop
slug: pi-evox-loop
displayName: "Pi EvoX Loop"
description: "Give your coding agent an 'experience inheritance' runtime: recall validated fixes from an Evolver gene store at task start, register hits when a fix is actually used, and deposit newly-learned fixes after repairing a non-obvious failure. Optionally run controlled closed-loop experiments (R1 trap → distill → inject → R2) to measure inheritance gains. Use at the START of non-trivial tasks, after fixing a non-obvious failure, or when you want to measure agent self-evolution. Trigger words: 经验召回, 错题本, 经验继承, 自进化, evolver, 避坑, distill."
description_zh: "给编码智能体装上「经验继承」运行时：任务开始时从 Evolver 基因库召回已验证修法（编号列表），相关则采用并在结束时登记命中；任务中修复了非显而易见的失败后，将修法沉淀入库供未来召回；可选跑受控闭环实验量化继承收益。非平凡任务开始时、修复有价值失败后、或想测量 agent 自进化效果时使用。触发词：经验召回、错题本、经验继承、自进化、evolver、避坑、distill"
description_en: "Experience-inheritance runtime for coding agents: recall validated fixes (numbered) at task start, register hits when used, deposit fixes after repairing failures; optional controlled closed-loop experiments to measure inheritance gains."
version: 0.9.0
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
node code/evolver-recall.mjs
```

- 输出「已审核且通过修法守卫」的编号修法列表（空库有明确提示，属正常——价值随使用积累）；
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


当你修复了一个不显而易见的坑（环境怪癖、反直觉报错、特定参数/编码/绕过方式），把修法沉淀入库：

```bash
node_modules/.bin/evolver distill --category repair --signals bash,exception \
    --strategy "<一句话修法；多步用分号分隔；要具体到参数/命令/编码>" \
    --summary "<坑的一句话描述>"
node_modules/.bin/evolver review --approve <distill 输出的 gene_id>
```

- strategy 必须写成**可执行修法**（含具体参数/命令），不要写成功总结——召回侧有修法守卫，成功总结会被过滤（宁缺毋滥）；
- `--approve` 是否自动化由你的部署策略决定：单用户环境可自动（召回守卫兜底防噪声），多人/严谨场景保留人工审核门；
- **内置后端（默认）的沉淀/审核命令**（零依赖）：
  ```bash
  node code/light-cli.mjs distill --signals bash,encoding-error \
       --strategy "用 encoding='gbk' 读取文件" --summary "GBK 文件按 utf-8 解码失败"
  node code/light-cli.mjs approve <gene_id>     # 审核通过（可注入）
  node code/light-cli.mjs list                  # 查看台账
  ```
  （若已安装可选集成 evolver，也可继续使用 `evolver distill` / `evolver review --approve`。）

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
- Pi 扩展桥（`code/evolver-bridge.ts`，放 `~/.pi/agent/extensions/` 或项目 `.pi/extensions/`）激活后，编排器自动切换为扩展注入（单通道），并附带 tool_result 失败点教学。

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

基于 [pi-coding-agent](https://github.com/earendil-works/pi) 与 [@evomap/evolver](https://github.com/EvoMap/evolver)。实测中发现的 4+1 项上游缺口已提交官方 issue（evolver#624-#627、pi#9258），详见 README「上游致谢与缺口清单」。完整 22 节实验报告：`docs/experiment-report.md`。
