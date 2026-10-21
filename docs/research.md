# Research — 流程 C 受控实验与陷阱设计纪律

> **EN**: Research-only (flow C is a controlled-experiment framework; `--auto-approve` / `--llm-refine` are demo switches, off by default). Daily/production use = flows A/B in SKILL.md only. Traps must be 'environment-guaranteed-failure' types with MEASURED hit rates - reliability is a trap-x-model joint property; control-tier traps (CRLF/NFD/type) have bypass paths and must not be used for statistical main traps.


> ⚠️ **研究用途（research only）**：流程 C 是受控实验框架——`--auto-approve`、`--llm-refine` 等均为**演示/实验开关**（默认关闭；组合启用默认拒绝）。**日常与生产使用请只用 SKILL.md 的流程 A/B**，不要照搬流程 C 的参数组合。

## 流程 C：受控闭环实验 — 量化继承收益

```bash
# 1. 生成确定性陷阱（无效 UTF-8 字节——任何 utf-8 文本读取必失败）
python traps/make_encoding_trap.py

# 2. 配置 Pi provider（models.json 或 --api-key 显式传；注意 models.json 的 $ENV 插值需 pi ≥ 0.85.1）
# 3.（可选）配置 LLM 精修端点——未配置时 --llm-refine 自动禁用（数据外发必须显式授权）
export EVOLVER_REFINE_URL="https://<你的 OpenAI 兼容端点>/v1/chat/completions"
export EVOLVER_REFINE_MODEL="<model>"

# 4. 一键闭环：R1 踩坑 → 自动蒸馏 → 守卫审核 → 修法注入 → R2 → 跨轮对比
node code/pi_evolve.mjs exp/encoding-trap-template examples/task-gbk.txt \
    --provider <provider> --model <model> --api-key "$LLM_API_KEY" \
    --rounds 2 --fresh --auto-approve --llm-refine --root exp/loop-$(date +%s)
```

- `--fresh` 会清空经验库（自动备份）——执行前确认；
- Pi 扩展桥（`code/evolver-bridge.ts`，放 `~/.pi/agent/extensions/` 或项目 `.pi/extensions/`）激活后，编排器自动切换为扩展注入（单通道）。**能力边界（透明声明）**：当前已实现 `before_agent_start` 召回注入；`tool_result` 失败点教学属于**规划中的增强能力**，并非当前 bridge 已实现的行为；
- 端到端完整走查（含预期输出）：[`examples/walkthrough-process-c.md`](../examples/walkthrough-process-c.md)。

## 陷阱设计纪律（做实验前必读）

- 只用「**环境必然失败**」型陷阱，且**命中率必须实测**（陷阱可靠性是「陷阱×模型」联合属性）。

**内置 6 个生成器**（`traps/`，按实测可靠性分两档）：

**确定性档（推荐）**
| 生成器 | 陷阱机制 | 必然失败点 | 实测 |
|---|---|---|---|
| `make_encoding_trap.py` | GBK 字节写入 JSONL | utf-8 文本读取必抛 `UnicodeDecodeError` | ✓ 5/5 |
| `make_json_trap.py` | 非法 JSON（尾随逗号等） | `json.loads` 必抛 `JSONDecodeError` | ✓ 3/3 |
| `make_readonly_trap.py` | 配置 0444 只读 | 写入必被拒（`PermissionError`/`EPERM`），**无法绕行** | ✓ 1/1 |

**对照档（有绕过路径，勿作继承实验主陷阱）**
| 生成器 | 陷阱机制 | 绕过路径 | 实测 |
|---|---|---|---|
| `make_crlf_trap.py` | 可执行脚本 CRLF 行尾 | agent 用 `python3 x.py` 直调即绕过 shebang | ✗ 0/1 |
| `make_nfd_trap.py` | 磁盘 NFD 名 / 任务给 NFC 名 | agent 列目录后按实际名读取即绕过 | ✗ 0/1 |
| `make_type_trap.py` | 数值类型（`"120.0"` 等） | 属「模型可能犯错」型，capable model 不犯 | ✗ 0/3 |

> **教训**：判定「必然失败」不仅要看陷阱本身，还要**审视 agent 的合理绕行路径**——只要存在"另一种正确做法"，该陷阱的命中率就不可控（与模型能力相关），不能用于需要可复现统计的继承实验。

- 不要用「模型可能犯错」型（BOM、`int("120.0")`——对 capable model 实测命中率 0/3，且随模型升级漂移）；
- 错误统计用精确口径（`isError=true` 的 toolResult），不要用字符串计数（文本提及会混入）；
- token 对比必须扣除重复执行效应基线（实测 ≈ -22%）——绝对降幅 ≠ 继承收益；
- 完整 22 节实验报告（含 GBK/JSON 两陷阱的 N=5/N=3 统计证据）：[`experiment-report.md`](experiment-report.md)。

## 可操作手册（命令级，0.26 补）

> 绝大多数用户不需要本节；研究/复现实验时按此执行。

### 1. 前置
```bash
node -v                    # Node >= 22
npm install                # Pi CLI（实验模式 C 必需）+ 可选 evolver
python3 --version           # 陷阱生成器需要 Python 3
export AGNES_CN_API_KEY=... # 或 DEEPSEEK_API_KEY（任一 OpenAI 兼容端点）
# 国内端点示例见 docs/providers.md
```

### 2. 三臂对照实验（含 long-context 基线臂）
```bash
# 生成陷阱（确定性失败环境）
python traps/make_encoding_trap.py          # GBK 无效 UTF-8
python traps/make_json_trap.py              # 非法 JSON

# 运行实验：R1 无注入 → R2 注入（--arm 控制注入臂）
node code/pi_evolve.mjs <repo模板目录> <任务文件> \
  --provider agnes-cn --model agnes-3.0-flash \
  --api-key \$AGNES_CN_API_KEY --rounds 2 [--arm targeted|full-context]
```
- `--arm targeted`（默认）：按对靶注入（继承效应）
- `--arm full-context`：灌入**全部**已审核基因（长上下文基线臂——评测要求的效果声明必须带此对照）

### 3. 指标口径（报告必带三列）
| 列 | 含义 | 陷阱 |
|---|---|---|
| 准确率 | 任务是否修复（GBK：解码是否成功） | 只看"跑完"不算修复 |
| token | 各臂用量 | **必须配无注入对照组**——重复执行本身有 ≈-22% 学习效应 |
| 净收益 | 注入 − 对照 | 直接报降幅会把学习效应算成继承 |

### 4. 复现历史实验
- 编码陷阱：decode errors 11→4、token -55%（[A] 2026-09 私有节点）
- 非法 JSON：JSONDecodeError 14→3、token -53%
- 长上下文基线臂：0.25 起支持，结论见 `docs/experiment-report.md`

### 5. 何时不该做实验
生产环境；模型可能自主绕过的陷阱（BOM 类，命中率不可靠）；无对照组的单臂对比。

> **EN**: Section 19 records where the "heterogeneous verification" idea comes from (arXiv:2512.05117, read at source) and what we measured ourselves. 19.1 theory - the paper keeps "shared subspace implies shared failure modes" as an **open question**, has no cross-architecture comparison method, and its 500 LoRAs share one base checkpoint. 19.2 our measurement (response-level, a different kind of claim): on one deterministic GBK trap, deepseek-v4-flash 5/5 correct vs agnes-3.0-flash 0/5, failure-signature agreement 0%. 19.3 apparatus lesson - the first run mis-scored the reasoning model as "no code" because its token budget went to `reasoning_content`; fixed before drawing conclusions. 19.4 mechanism - L4 cross-source rate + automatic provenance from `~/.evomap/source.json`.
## 19. 异构验证：理论出处与我们的实测（0.30，2026-10-21）

### 19.1 理论出处（已读原文并核对，不引二手转述）
**arXiv:2512.05117**《The Universal Weight Subspace Hypothesis》（Kaushik, Chaudhari, Vaidya, Chellappa, Yuille；v1 2025-12-04，v3 2026-10-05，56 页）：1200+ 模型（500 Mistral-7B LoRA / 500 ViT / 50 LLaMA-8B），**截断零中心 HOSVD**，发现**同一架构内**模型共享低维参数子空间。

与本项目相关的三点（均为原文支持）：
1. 论文把「若网络都塌缩到同一子空间 → **继承共同的偏差、能力与失败模式**，这种缺乏多样性是否构成瓶颈」明确列为**开放问题**；并写明**跨架构子空间比较尚无方法**（"there is no current method that enables us to compare subspaces of models with different architectures"）。
2. 500 个 Mistral LoRA **同基座**（Mistral-7B-Instruct-v0.2）；理论部分假设共享参考权重 θ₀，作者承认实际分析偏离该理想化条件 ⇒ **「同构」要按「模型 × 版本 × 宿主」联合算，不能按架构算**。
3. 论文**未**给出跨模型的相关盲点或对抗迁移的定量实验。

**明确不引用的说法**（原文无法核实）：「16 维 = 智能只需 16 维」（原文只说"16 个或更少方向集中了大部分信息"，无方差百分比；40 维的数亦不可核实）、「投影后 98–99% 几何误差仍保功能」（投影的定量几何误差不在可核实文本内；原文给的是**掉点**结果：ResNet50 90.89→87.58、9 个从头训模型 81.00→77.91、ViT OOD 91.3→87.8）。

### 19.2 我们的实测（响应级，与论文不同类）
装置：`exp/heterogeneity-probe.mjs`——同一确定性 GBK 字节输入（500 B，sha256 前 16 位 `ebca2ce3b2ee4933`）→ 两个端点各 5 次 → 按失败签名分类（`gbk-correct` / `utf8-wrong` / `rb-bypass` / `no-code` / `reasoning-only`）。

| 模型 | 签名分布（N=5） | 判定 |
|---|---|---|
| `deepseek/deepseek-v4-flash` | gbk-correct ×5 | **5/5 正确**（显式 `encoding='gbk'`） |
| `agnes-cn/agnes-3.0-flash` | utf8-wrong ×3、rb-bypass ×2 | **0/5 正确**（3 次默认 utf-8 必失败；2 次用 `'rb'` 绕过=未识别编码） |

**失败签名一致率 0/5（0%）** ⇒ 两个模型在同一确定性输入上的失败模式**不相关** ⇒ 在这个陷阱上**异构兜底是真实存在的**（deepseek 正好补上 agnes 的盲区）。

### 19.3 装置效应的教训（比结论更重要）
第一轮探针把 deepseek 判成 `no-code` ×4——**那是装置伪影**：deepseek-v4-flash 是推理模型，800 token 预算被 `reasoning_content` 吃光（`finish_reason: length`，正文 0 字符）。修正：token 预算提到 3000，并新增 `reasoning-only` 签名把「正文空但有推理」与「模型没给代码」分开。**没有这一步，就会把装置误差写成"某模型系统性不会写代码"的结论。**

### 19.4 落到机制
- 跨源复现率 → `report` 的 **L4 异源复现率**（同一基因被 ≥2 个不同「模型｜宿主」复现过 = cross-source）；0.30 首测：29 条有证据基因里跨源 1 条（3.2%）。
- 溯源自动归因（0.30 B-2）：deposit / register-hit / negate 自动读 `~/.evomap/source.json` 记录 `source_model` + `source_host`（不必改钩子、不必重启服务）。
- 结论：0.29 之前所有修法**都是单源**（跨源率 0%）——这正是"同构"在我们自己库里的量化形态；异构验证要靠**不同模型/宿主的独立复现**，不是靠多开实例。
