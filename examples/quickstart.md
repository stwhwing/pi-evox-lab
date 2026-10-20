# 5 分钟体验：让 Agent 的每个坑只踩一次

> 零依赖（Node ≥22 即可）、全程本地、不装任何外部服务。本页是**最短路径**——跑完你就完成了一次完整的「经验继承」闭环。

> **EN**: 5-minute minimal loop: doctor -> starter -> targeted recall -> (optionally deposit). Zero dependencies beyond Node >= 22, fully local.

## 1. 自检（30 秒）
```bash
node code/light-cli.mjs doctor
# 期望：✓ 全部就绪，可正常使用 recall / 沉淀
```

## 2. 装起步包（10 条通用教训）
```bash
node code/light-cli.mjs starter
```

## 3. 体验「对靶召回」（1 分钟）
```bash
# 假装你遇到了一个编码报错——注意：只有相关的经验会被注入
node code/evolver-recall.mjs --error "UnicodeDecodeError: 'utf-8' codec can't decode byte 0xc4"
# 期望：输出 [#1|...] GBK 修法（而不是全部 10 条）——这就是「对靶」
```

## 3b.（可选）拉取官方基因池（策划修法 66+ 条）
```bash
node code/light-cli.mjs gene pull --pool https://zyx.pink/pool/genes.jsonl --tier official
# 只想要某个场景？加 --scene ops-deploy（可用场景见 SKILL.md 部署与分发节）
```

## 4.（可选）体验「沉淀」（2 分钟）
```bash
# 把你最近修过的一个坑丢进去（真实报错 + 你当时的做法）
node code/light-cli.mjs draft --error "<你的真实报错>" --context "<当时在做什么>"
# 照草稿补全 FIX 后落库
node code/light-cli.mjs draft --error "<你的真实报错>" --strategy "AVOID: <什么不该做> FIX: <具体怎么做>" --commit
```

## 5. 看到闭环（30 秒）
```bash
node code/light-cli.mjs info        # 召回次数 / 命中 / 沉淀数
node code/light-cli.mjs timeline    # 刚才一切事件的时间线
```

## 然后？
- **接入你的 Agent**：`node code/light-cli.mjs install-snippet --file <你的项目>/AGENTS.md --yes`（或 OpenClaw/Hermes 用 `install-hooks`）——之后每个会话都会自动触发；
- **深入**：`docs/faq.md`（15 问）/ `docs/common-mistakes.md`（14 条反模式）/ `docs/advanced.md`（共享池/宿主接入/运维）；
- **反馈**：`node code/light-cli.mjs feedback "<想说的话>"`，或到 [GitHub Discussions](https://github.com/stwhwing/pi-evox-lab/discussions)；
- **分享你的配置**（帮助验证真实环境可用性）：[adoption-report](https://github.com/stwhwing/pi-evox-lab/issues/new?template=adoption-report.yml)。

## 5. 完整输出样例（0.26 补：照着核对第一步）

```bash
$ node code/light-cli.mjs doctor
  IO 重试: 瞬态错误 3 次 / 截止 3000ms（EVOX_IO_RETRY / EVOX_IO_DEADLINE_MS 可调）
  Node: v22.x ✓｜后端: light ✓｜库: ~/.evomap/assets ✓
✓ 全部就绪，可正常使用 recall / 沉淀。

$ node code/light-cli.mjs starter
[pi-evox] 起步包已装载（20 条通用教训）。现在跑一次召回试试：
  node code/evolver-recall.mjs --query "读取中文日志报 UnicodeDecodeError"

$ node code/evolver-recall.mjs --query "读取中文日志报 UnicodeDecodeError"
[pi-evox] 基因总数=20 | 已审核=20 | 守卫通过=20 | 对靶选中=2/20
以下为已验证修法，与本任务相关时优先采用；任务结束时请回填效果：
  采用了 → node evolver-recall.mjs --register-hit --gene <asset_id或gene_id> --note "<任务一句话>"
[#1|gene_manual_438719a5] [coding-debug] AVOID: assume-default-utf8 (file). FIX: 用 encoding='gbk' 打开…
[#2|gene_manual_6211858d] [coding-debug] AVOID: 在 Bash heredoc 中手打反斜杠构造 Windows 路径…FIX: 用 chr(92) 构造…

$ node code/light-cli.mjs info
  基因总数: 20 ｜ 已审核(可注入): 20 ｜ 待审: 0
  召回调用: 1 ｜ 注入待回填: 2 ｜ 已回填: 0（回填才能算效果转化率）

$ node code/light-cli.mjs report --days 7
[gene-share] 效果周报（近 7 天）
  L1 活性：召回 1 次（对靶 1）｜注入 2 条次｜沉淀 0 条
  L2 相关性：注入待回填 2｜验证记录 0｜回填率 0%
```
