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
