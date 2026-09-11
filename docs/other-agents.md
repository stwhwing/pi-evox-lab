# 在其他 Agent 宿主中接入 Pi × EvoX Loop

> 本 skill 的两条核心流程（A 召回 / B 沉淀）是**纯 CLI**，与宿主无关——任何能执行命令的 agent 都可以用。
> 宿主差异只体现在**注入方式**：如何把召回结果送进 agent 的上下文。本文给出 5 种宿主模式的最小接入方案。

## 概念区分（先明确边界）

| 能力 | 是否宿主相关 | 说明 |
|---|---|---|
| 召回（流程 A） | ❌ 纯 CLI | `node code/evolver-recall.mjs`，输出编号修法列表 |
| 沉淀（流程 B） | ❌ 纯 CLI | `evolver distill` + `review --approve` |
| **注入（把修法送进上下文）** | ✅ 宿主相关 | Pi 有原生钩子；其他宿主用 hook / rules 文件 / wrapper / skill 指令 |
| 失败点教学（`tool_result` 改写） | ✅ **仅 Pi** | 依赖 Pi 扩展 API，其他宿主无等价能力 |

## 模式 1：Pi（最完整，本包自带）

把 `code/evolver-bridge.ts` 放到 `~/.pi/agent/extensions/`（全局）或项目 `.pi/extensions/`（局部）即自动发现：

- `before_agent_start`：每轮动态注入已审核修法（透明标注）
- `tool_result`：失败点教学（`isError` 时对靶附加修法提示）
- 编排器检测到扩展存在会**自动切换单通道注入**（避免 CLI/扩展双通道重复）

## 模式 2：Claude Code（hooks + 项目说明）

`.claude/settings.json` 加 SessionStart hook（每次会话启动时输出召回结果，注入上下文）：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "node /path/to/pi-evox-lab/code/evolver-recall.mjs" }
        ]
      }
    ]
  }
}
```

并在 `CLAUDE.md` 写明沉淀约定（流程 B 的判定标准与命令），让 agent 在修复非显而易见失败后自行入库。

## 模式 3：Cursor / Windsurf 等 IDE Agent（rules 文件）

在项目规则文件中加入固定指令（示例，按宿主语法调整）：

```markdown
## 经验继承（Evolver）
- 开始非平凡任务前：运行 `node <repo>/code/evolver-recall.mjs`，相关修法优先采用；
- 结束前若采用了某条：#N → `node <repo>/code/evolver-recall.mjs --register-hit N --note "<任务>"`
- 修复了非显而易见的坑（查文档/试错≥2次、环境特性、反直觉报错）：按流程 B 沉淀。
```

## 模式 4：命令行 Agent（OpenCode / Codex CLI 等，wrapper 注入）

用一层 shell wrapper 把召回结果拼进首个提示：

```bash
#!/usr/bin/env bash
# usage: with-memory.sh <agent-cmd...> -- <task text>
RECALL="$(node /path/to/pi-evox-lab/code/evolver-recall.mjs 2>/dev/null)"
"$@" "${RECALL}

---
Task: $TASK_TEXT"
```

（要点：召回块作为提示前缀传入；任务结束后由 agent 或人工执行 `--register-hit`。）

## 模式 5：自建智能体 / Skill 形态（无需宿主钩子）

把两条指令写进 agent 的 skill 说明，由 agent **自觉执行**：

```markdown
## 流程 A：任务开始 — 召回经验
运行 `node <repo>/code/evolver-recall.mjs`，输出为编号修法列表；
与本任务相关时优先采用；结束时实际采用了某条则 `--register-hit <N> --note "<任务>"`。

## 流程 B：失败修复后 — 沉淀经验
判定标准（任一满足即值得沉淀）：查文档/试错≥2次；依赖环境特性；报错反直觉；同一坑第二次出现。
沉淀：`evolver distill --category repair --signals <信号> --strategy "<可执行修法>" --summary "<坑>"`
      `evolver review --approve <gene_id>`
```

该模式已在生产环境的自建智能体平台上以 skill 形式落地验证（任务开始召回 → 结束登记命中，命中账本 `experiments/hits.jsonl`）。

## 已知限制（诚实声明）

- 注入内容为**软提示**，遵从度模型相关；双向守卫保证噪声不入库不出库，但不承诺 100% 避坑；
- **失败点教学仅 Pi 可用**（依赖 Pi 扩展 API）；其他宿主只享受"任务开始注入"；
- 经验库（`~/.evomap/assets/`）是**全局共享**的——多项目使用时认知这一点（不同项目的坑混在同一库中，召回按修法信号词而非项目过滤）。
