#!/usr/bin/env bash
# setup.sh — Pi × EvoX Loop 一键安装/自检（评测建议：降低开箱即用门槛）
# 用法：bash code/setup.sh
set -u
OK=0; WARN=0
say()  { echo "[setup] $*"; }
warn() { echo "[setup] ⚠️  $*"; WARN=$((WARN+1)); }
good() { echo "[setup] ✓ $*"; OK=$((OK+1)); }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Pi × EvoX Loop 安装/自检（root: $ROOT）==="

# 1) Node 版本
if ! command -v node >/dev/null 2>&1; then
  warn "未找到 node —— 请安装 Node ≥ 22（https://nodejs.org 或 nvm install 22）"
else
  NODEV=$(node -v | tr -d 'v')
  NODEMAJOR=${NODEV%%.*}
  if [ "$NODEMAJOR" -ge 22 ] 2>/dev/null; then good "node v$NODEV"; else warn "node v$NODEV < 22，pi/evolver 可能启动失败（建议 nvm install 22）"; fi
fi

# 2) Python 3（仅陷阱生成器需要）
if command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then good "python 可用（陷阱生成器用）"; else warn "未找到 python3 —— 仅影响 traps/ 陷阱生成器，流程 A/B 不需要"; fi

# 3) npm 依赖
if [ -x node_modules/.bin/evolver ]; then
  good "依赖已安装（evolver CLI 就位）"
else
  say "npm install（首次约 30s；国内慢可先: npm config set registry https://registry.npmmirror.com）"
  if npm install --ignore-scripts --no-fund --no-audit 2>&1 | tail -1; then
    [ -x node_modules/.bin/evolver ] && good "依赖安装完成" || warn "安装完成但 evolver CLI 缺失，请检查上方输出"
  else
    warn "npm install 失败——检查网络或换镜像后重试"
  fi
fi

# 4) 召回自检（空库也正常）
if [ -x node_modules/.bin/evolver ] || [ -f code/evolver-recall.mjs ]; then
  say "召回自检："
  node code/evolver-recall.mjs || true
fi

# 5) LLM 端点（可选，仅流程 C 需要）
if [ -n "${EVOLVER_REFINE_URL:-}" ]; then good "EVOLVER_REFINE_URL 已配置（--llm-refine 可用）"; else warn "EVOLVER_REFINE_URL 未配置 —— 流程 C 的 --llm-refine 将自动禁用（无默认外发，见 SKILL.md 安全声明）"; fi

echo ""
echo "=== 完成：$OK 项通过, $WARN 项提醒 ==="
echo "下一步：SKILL.md 流程 A（召回）开始使用；实验模式见流程 C。FAQ 见 SKILL.md。"
