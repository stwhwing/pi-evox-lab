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
