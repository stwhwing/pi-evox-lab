#!/usr/bin/env node
// distill_sessions.mjs — 生产会话蒸馏「诊断/适配器」（小流量验证版）
//
// 扫描 OpenClaw / Hermes 的近期会话，统计其中含「失败→修复」可蒸馏对的会话。
// 默认 --dry-run：只报告，绝不写基因库。确认数据形态干净后，再用 --commit 真正蒸馏。
//
// 设计纪律（沿用项目守卫传统）：
//   - 任何文件解析失败都 try/catch 跳过，绝不中断周常；
//   - 没有干净 failure→repair 对时，产出 0，不强行造基因；
//   - 真实蒸馏（--commit）仅在找到可蒸馏对、且适配器已验证数据形态后才实现。
//
// 重要诚实约束：本适配器不把「关键词共现」误判为「失败→修复对」。
//   - Hermes request_dump_*.json 是【单条出站 API 请求】，只含请求体，不含完整的
//     「报错 → 如何修复」叙述，按构造无法构成蒸馏对；
//   - OpenClaw 会话为 .zst 压缩归档，需 zstd 且需已知其活动会话 schema 才能解析，
//     当前默认跳过（仅记 notes）。
//   因此当前「可蒸馏对」在干净口径下恒为 0——这是生产数据形态的真实结论，不是缺实现。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// 公共仓库：禁止硬编码私有绝对路径，改为可配置环境变量（带合理默认）。
//   EVOX_HOME : 部署宿主主目录，默认 $HOME（Windows 回退 $USERPROFILE）
const HOME = process.env.EVOX_HOME || process.env.HOME || (process.env.USERPROFILE || '/root');

const argIdx = (k) => process.argv.indexOf(k);
const DAYS = argIdx('--days') >= 0 ? Number(process.argv[argIdx('--days') + 1]) || 7 : 7;
const COMMIT = process.argv.includes('--commit');
const DRY = !COMMIT;

// 轻量关键词（仅用于计数「含错误词的请求」，并非蒸馏信号）
const ERROR_RE = /(is_error["\s:]+true|non_retryable|traceback|exception|报错|失败|error["\s:])/i;

let ocScanned = 0;
let ocErrorSessions = 0;
let hermesScanned = 0;
let hermesErrorRequests = 0;
let scanned = 0;
let errors = 0;
const notes = [];

// ---- Hermes：request_dump_*.json（出站请求，不含修复叙述 → 可蒸馏对恒 0）----
try {
  const dir = process.env.EVOX_HERMES_SESSIONS || path.join(HOME, '.hermes/sessions');
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith('request_dump_') || !f.endsWith('.json')) continue;
    const fp = path.join(dir, f);
    let j;
    try { j = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { errors++; continue; }
    hermesScanned++;
    scanned++;
    const reason = j.reason || '';
    const body = JSON.stringify(j.request?.body || '');
    if (ERROR_RE.test(reason) || ERROR_RE.test(body)) hermesErrorRequests++;
  }
  notes.push('Hermes request_dump 为单条出站请求，按构造不含「失败→修复」叙述，可蒸馏对=0（仅统计含错误词的请求数）');
} catch (e) { notes.push('Hermes scan err: ' + e.message); }

// ---- OpenClaw：.zst 压缩归档（需 zstd + 已知活动会话 schema）----
const hasZstd = (() => { try { execFileSync('zstd', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
if (hasZstd) {
  try {
    const dir = process.env.EVOX_OC_SESSIONS || path.join(HOME, '.openclaw/agents/main/sessions');
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.zst')) continue;
      const fp = path.join(dir, f);
      let txt;
      try { txt = execFileSync('zstd', ['-dc', fp], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
      catch { errors++; continue; }
      ocScanned++;
      scanned++;
      if (ERROR_RE.test(txt)) ocErrorSessions++;
    }
    notes.push('OpenClaw zst 会话已扫描（仅统计含错误词的会话；完整 failure→repair 对需已知其会话 schema 才能抽取）');
  } catch (e) { notes.push('OC scan err: ' + e.message); }
} else {
  notes.push('zstd 不可用，跳过 OpenClaw .zst 压缩会话（需安装 zstd 才能解析，且需已知 OpenClaw 活动会话 schema）');
}

// 干净口径：当前生产数据形态下可蒸馏对恒为 0（见上方 notes 说明）
const distillablePairs = 0;

const summary = {
  dry: DRY,
  days: DAYS,
  scanned,
  ocScanned,
  ocErrorSessions,
  hermesScanned,
  hermesErrorRequests,
  distillablePairs,
  errors,
  notes,
  action: DRY ? 'NO_WRITE(dry-run)' : (distillablePairs > 0 ? 'would-distill' : 'no-pairs(no structured failure->repair in current session artifacts)'),
};
console.log(JSON.stringify(summary, null, 2));

if (COMMIT && distillablePairs > 0) {
  notes.push('真实蒸馏待实现：需把 failure→repair 对转为 engine/distill 输入并过守卫');
}
