---
name: pi-evolver-loop
description: 对给定的代码仓库与任务，一键运行「智能体经验继承闭环」受控实验：Pi 第 1 轮执行（踩坑）→ 自动蒸馏失败经验为 Gene → 策略注入第 2 轮 → 输出跨轮避坑率与 token 对比。当用户想验证"agent 自进化/经验继承"效果、对比注入策略、或复现 Pi × EvoX 实验时使用。触发词：经验继承、自进化闭环、evolver、继承实验、跨轮对比。
---

# Pi × EvoX 继承闭环实验

## 目标
验证"第 1 轮智能体踩过的坑，能否让第 2 轮（注入已验证修法后）显著避坑并省 token"。

## 前置条件（缺一即向用户说明并停止）
1. Node ≥ 22（bash 可用，Windows 需 Git Bash）。
2. 已安装并可通过 `node_modules/.bin/pi` 与 `node_modules/.bin/evolver` 调用：
   - `npm install @earendil-works/pi-coding-agent@0.74.2 @evomap/evolver@2.0.30 --ignore-scripts`
3. 一个 OpenAI 兼容 LLM key（实验环境实测 agnes-cn；`EVOLVER_REFINE_URL` / `EVOLVER_REFINE_MODEL` 可替换）。
4. 实验材料（用户提供或用本 skill 默认样例）：
   - **陷阱模板目录**：含 `data/events.jsonl` 的目录。无现成陷阱时，用 `traps/make_encoding_trap.py` 生成 GBK 陷阱（无效 UTF-8 字节，任何 utf-8 文本读取必失败）。
   - **任务文本文件**：一句话任务（样例见 `examples/task-gbk.txt`）。

## 执行流程
1. **材料确认**：向用户确认 4 项输入；缺陷阱则先生成：
   ```bash
   python traps/make_encoding_trap.py   # 产出 exp/encoding-trap-template/
   ```
2. **单变量控制**：确认使用 `--fresh`（自动备份并清空 `~/.evomap/assets`，隔离历史基因干扰）。
3. **跑闭环**：
   ```bash
   export LLM_API_KEY=...   # 用户的 OpenAI 兼容 key（勿写入任何文件/日志）
   node code/pi_evolve.mjs exp/encoding-trap-template examples/task-gbk.txt \
       --provider <provider> --model <model> --api-key "$LLM_API_KEY" \
       --rounds 2 --fresh --auto-approve --llm-refine
   ```
   - 默认保留**人工审核门**：蒸馏出基因后暂停并打印审核命令，除非用户明确要求 `--auto-approve`。
4. **结果解读**（向用户汇报时必须遵守）：
   - 避坑率用**陷阱特异错误计数**（GBK 陷阱数 `UnicodeDecodeError`，非法 JSON 数 `JSONDecodeError`），不用总错误数。
   - token 对比必须说明存在 ≈ -22% 的重复执行学习效应基线，绝对降幅 ≠ 继承收益。
   - 检查 `~/.evomap/assets/review.jsonl` 确认基因确实 quarantined→approved；检查注入块文件确认修法已送达 R2。
5. **陷阱设计提醒**（帮用户设计新实验时）：
   - 只用「环境必然失败」型陷阱（无效编码字节、语法错误）；
   - 不用「模型可能犯错」型（BOM、`int("120.0")`——对 capable model 命中率不可控，实测 0/3）。

## 安全与纪律
- API key 只经环境变量传递，不落盘、不回显。
- `--fresh` 会清空全局 `~/.evomap/assets`——执行前必须向用户确认（脚本会自动备份到 `backup-<ts>/`）。
- 实验产物写在编排器 `--root` 指定目录；不要污染用户其他项目。

## 输出物
跨轮对比表（round / injected / totalTokens / toolCalls / errors）+ 避坑率 + 因果归因说明（配对对照）。
