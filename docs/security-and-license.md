# 安全与许可（详细版）

> SKILL.md 保留精简摘要；本页为完整版。**使用前必读**。

## 许可提示（商业使用前必读）

- **本包（pi-evox-lab）**：MIT（见 LICENSE / package.json）。
- **上游依赖**：`@evomap/evolver` 为 **GPL-3.0-or-later**（其 npm 元数据与实际许可不一致，以仓库声明为准）；**在商业/闭源场景使用本 skill 时，请自行评估 GPL 传染性**。`@earendil-works/pi-coding-agent` 为 MIT。
- 本包通过 CLI 进程边界调用 evolver（不链接其代码），但仍建议法务视角复核后再商用。

## 安全与数据外发声明

- **无 shell 执行（0.7.0 起）**：全部 CLI 调用改为 argv 数组形式的 `node <入口>` 直调，**不经 shell、无字符串拼接**，命令注入面已从架构上消除；`--llm-refine` 的外发改用 Node 原生 `fetch`（不再依赖 curl）；
- **`--llm-refine` 涉及数据外发**：会把会话 transcript（截 9000 字符）发送到 `EVOLVER_REFINE_URL` 指定的外部端点。**未配置该变量时此功能自动禁用**，不存在默认外发。请在了解外发范围后启用，或使用本地/自有端点；
- **`--fresh` 有破坏性**：备份后清空全局经验库 `~/.evomap/assets/`——执行前确认，恢复用备份目录；
- **实验产物含会话内容**：`--root` 目录下的 sessions/transcript/inject-*.txt 包含任务文本、代码与工具输出，注意保管；
- **`--auto-approve` 为显式 opt-in**：默认保留人工审核门（quarantined 基因不生效），开启后由召回/沉淀双向守卫兜底；
- **注入块透明标注**：所有注入内容均带 `[Evolver inherited fixes]` 明示来源，无隐蔽指令；扩展留痕文件 `bridge-last-inject.txt` 仅含时间戳与注入内容（不含路径）；
- **adapter 默认脱敏 cwd**：transcript 头部的 env_fingerprint 默认不含工作目录（可泄露项目/客户身份），实验确需时显式传 `--include-cwd`；
- **全局输出脱敏（0.10.0）**：编排器的所有 stdout/stderr 输出统一做密钥掩码（已注册的 API key 与 sk-/Bearer 形态），密钥不出现在任何输出；
- **关于安全扫描器**：本 skill 的核心功能（持久化并复用模型生成的经验）会被启发式扫描器持续标记为 Excessive Agency / Prompt Injection——这是功能本质而非缺陷。我们的安全基线 = 显式 opt-in 标志 + 双向守卫 + 透明标注 + 默认人工审核门；`--auto-approve --llm-refine` 组合启用时编排器默认拒绝（需 `--allow-unreviewed-refine` 显式放行）。

## 已知的安全扫描器判定（透明记录）

- ClawHub `clawscan`：`suspicious`（功能固有：持久化复用模型生成的经验）；
- ClawHub `static-analysis`：`suspicious.dangerous_exec`（编排器本质是执行子进程，child_process 无法移除；0.7.0 起已 argv 化消除 shell 拼接）与 `env_credential_access`（API key 经环境变量传递，功能必需）；
- skillhub 云鼎实验室：0.5.0 起 benign（0.4.0 的 3 项可疑已全部修复：argv 化、透明标注、组合默认拒绝、全局输出脱敏）；
- skillhub 科恩实验室：benign；
- 平台审核层：ClawHub `moderation.verdict = clean`、skillhub TRACE 综合评级「优秀」。

我们的安全基线：显式 opt-in 标志 + 双向守卫 + 透明标注 + 默认人工审核门 + 全局输出脱敏（0.10.0）。
