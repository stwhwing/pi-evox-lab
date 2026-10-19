/**
 * engine/light/store.mjs — 轻量后端的存储层
 *
 * 与 Evolver 资产库格式**完全兼容**（schema 1.13.0）：
 *   ~/.evomap/assets/genes.jsonl   —— 基因（每行一个 Gene）
 *   ~/.evomap/assets/review.jsonl  —— 审核台账（每行 {assetId, state, reason, at}）
 *
 * 设计约定：
 * - 后端可互换：本模块写入的记录，evolver 后端可直接读取（反之亦然）；
 * - 容错：坏行跳过（不因单行损坏导致整体不可读）；
 * - 库路径可用 EVO_STORE_DIR 覆盖（测试/隔离用）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const STORE_DIR = process.env.EVO_STORE_DIR || path.join(os.homedir(), '.evomap', 'assets');
export const GENES_PATH = path.join(STORE_DIR, 'genes.jsonl');
export const REVIEW_PATH = path.join(STORE_DIR, 'review.jsonl');

/** 读取 JSONL（坏行静默跳过；文件不存在返回空数组） */
const WARNED_MISSING = new Set();
export function readJsonl(p, { warn = false } = {}) {
  const out = [];
  let raw = '';
  try { raw = retryIo(() => fs.readFileSync(p, 'utf8'), 'readJsonl'); } catch {
    // 0.22（0.21.0 评测 errorHandling 点名"文件不存在场景静默返回空数组"）：
    // 区分「空库」与「文件缺失」——CLI 路径（info/timeline/evidence/list）传 warn:true 告警一次；
    // 热路径（approvedAssetIds 等内部调用）保持静默，避免刷屏。
    if (warn && !WARNED_MISSING.has(p)) { WARNED_MISSING.add(p); console.warn(`[pi-evox] 提示：账本文件不存在（${p}）——按空处理；首次沉淀/召回后自动创建`); }
    return out;
  }
  const bad = [];
  let lineNo = 0;
  for (const line of raw.split('\n')) {
    lineNo++;
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { bad.push({ n: lineNo, s: s.slice(0, 80) }); }
  }
  if (warn && bad.length) console.warn(`[pi-evox] 提示：${p} 有 ${bad.length} 行无法解析（已跳过）：行 ${bad.map((b) => b.n).join(', ')}；首条预览: ${bad[0].s}（0.23：手工编辑后请校验 JSON 格式）`);
  return out;
}

// 0.24 场景受控词表（治理/拉取/策展用；召回对靶仍走 signals_match 自由信号）
export const SCENES = ['ops-deploy', 'coding-debug', 'release-publish', 'api-integration', 'git-workflow', 'agent-runtime'];

export const readGenes = () => readJsonl(GENES_PATH);
export const readReview = () => readJsonl(REVIEW_PATH);

function ensureDir() {
  try { fs.mkdirSync(STORE_DIR, { recursive: true }); } catch { /* 已存在 */ }
}

/**
 * 0.21 稳定性：瞬态 IO 错误重试 + 硬截止（stability 评测 0.19.1/0.20.3 两轮点名
 * 「未见显式重试逻辑和超时控制」）。
 * 边界纪律（与 fail-open 哲学一致）：
 *   - 只重试**瞬态**错误（EBUSY/EPERM/EACCES/ETIMEDOUT——Windows 上文件被占用/杀软扫描的典型表现）；
 *   - 总截止 RETRY_DEADLINE_MS（默认 3s）内有限次重试（RETRY_MAX 次），**到点即放行**：
 *     重试是优化不是门——绝不让 IO 因重试机制无限期阻塞调用方；
 *   - 非瞬态错误（ENOENT/EISDIR 等）立即交还原逻辑，不重试。
 */
const RETRY_MAX = Math.max(1, parseInt(process.env.EVOX_IO_RETRY || '3', 10) || 3);
const RETRY_DEADLINE_MS = Math.max(0, parseInt(process.env.EVOX_IO_DEADLINE_MS || '3000', 10) || 3000);
const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES', 'ETIMEDOUT']);

export function retryIo(fn, label = 'io') {
  const start = Date.now();
  let lastErr = null;
  for (let attempt = 1; ; attempt++) {
    try { return fn(); } catch (e) {
      lastErr = e;
      const code = e && e.code;
      const outOfTime = Date.now() - start >= RETRY_DEADLINE_MS;
      if (!TRANSIENT.has(code) || outOfTime || attempt >= RETRY_MAX) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * attempt); // 50/100ms 退避
    }
  }
}

/**
 * 0.19 并发写锁（2026-10-13 第 7 次并发实证后落地）：
 * 多会话/多进程并行写同一 JSONL 台账时，append 之间隔着「读-改-写」窗口会被并发回滚
 * （实测 shareable 标记毫秒级丢失、approve 假 ✓、池计数矛盾）。
 *
 * 协议：O_EXCL 创建 <dir>/.evox.lock（POSIX 与 Windows 均原子）——拿不到则 25ms 轮询；
 *   - stale 破除：锁文件 mtime 超过 LOCK_STALE_MS 视为死锁，可夺取（防持锁进程崩溃）；
 *   - 超时 fail-open：超过 LOCK_TIMEOUT_MS 放弃锁继续执行——**锁是优化不是门**，
 *     任何情况下都不能因锁让写入失败（fail-closed 的反面：这里 fail-open 保可用）。
 * Python 侧（evox_errcap.py hook）用同一协议（os.open O_CREAT|O_EXCL）。
 */
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 15000;

function acquireLock(dir) {
  const lockPath = path.join(dir, '.evox.lock');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* 已存在 */ }
  const start = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx'); // O_EXCL：原子创建，已存在则 EEXIST
      try { fs.writeSync(fd, String(process.pid)); } catch { /* 内容仅诊断用 */ }
      fs.closeSync(fd);
      return lockPath;
    } catch (e) {
      if (e && e.code !== 'EEXIST') return null; // 锁不可用（只读目录等）→ fail-open
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) { try { fs.unlinkSync(lockPath); } catch { /* 他人先夺 */ } continue; }
      } catch { continue; } // 锁刚好消失 → 重试
      if (Date.now() - start > LOCK_TIMEOUT_MS) return null; // 超时 → fail-open
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); // 同步睡眠 25ms
    }
  }
}

function releaseLock(lockPath) {
  if (!lockPath) return;
  try { fs.unlinkSync(lockPath); } catch { /* 已被 stale 夺取者删除 */ }
}

/** 持锁执行 fn（返回 fn 的返回值）；锁不可用时退化为直接执行（fail-open） */
export function withLock(dir, fn) {
  const lp = acquireLock(dir);
  try { return fn(); } finally { releaseLock(lp); }
}

/** 追加一条基因；asset_id 已存在则跳过（去重）。返回 true=已写入 */
export function appendGene(gene) {
  ensureDir();
  return withLock(STORE_DIR, () => {
    const exists = readGenes().some((g) => g.asset_id && g.asset_id === gene.asset_id);
    if (exists) return false;
    retryIo(() => fs.appendFileSync(GENES_PATH, JSON.stringify(gene) + '\n'), 'appendGene');
    return true;
  });
}

/** 追加审核台账记录 */
export function appendReview(rec) {
  ensureDir();
  return withLock(STORE_DIR, () => {
    const entry = { assetId: rec.assetId, state: rec.state, reason: rec.reason ?? '', at: new Date().toISOString() };
    retryIo(() => fs.appendFileSync(REVIEW_PATH, JSON.stringify(entry) + '\n'), 'appendReview');
    return entry;
  });
}

/** 已 approved 的 asset_id 集合（fail-closed：台账不可用时为空集，调用方据此跳过注入）
 *  追加式台账 ⇒ 以「每个 assetId 的最后一条状态」为准（last-write-wins）。
 *  修复（2026-09-23）：旧实现只要历史上出现过 approved 就计入，导致 quarantine 无法撤销已批准
 *  —— 与 evolver-recall.mjs / evolver-bridge.ts 的 2026-09-17 修复对齐（此前遗漏本处）。 */
export function approvedAssetIds() {
  const latestState = new Map();
  for (const r of readReview()) {
    if (r && typeof r.assetId === 'string' && r.assetId) {
      latestState.set(String(r.assetId).replace(/^"|"$/g, ''), r.state);
    }
  }
  const set = new Set();
  for (const [assetId, state] of latestState) {
    if (typeof state === 'string' && state.toLowerCase().includes('approv')) set.add(assetId);
  }
  return set;
}

/** 由 gene id 找 asset_id（台账写入用） */
export function assetIdOf(geneId) {
  const g = readGenes().find((x) => x.id === geneId);
  return g?.asset_id ?? null;
}
