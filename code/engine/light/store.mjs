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
export function readJsonl(p) {
  const out = [];
  let raw = '';
  try { raw = fs.readFileSync(p, 'utf8'); } catch { return out; }
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* 跳过坏行 */ }
  }
  return out;
}

export const readGenes = () => readJsonl(GENES_PATH);
export const readReview = () => readJsonl(REVIEW_PATH);

function ensureDir() {
  try { fs.mkdirSync(STORE_DIR, { recursive: true }); } catch { /* 已存在 */ }
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
    fs.appendFileSync(GENES_PATH, JSON.stringify(gene) + '\n');
    return true;
  });
}

/** 追加审核台账记录 */
export function appendReview(rec) {
  ensureDir();
  return withLock(STORE_DIR, () => {
    const entry = { assetId: rec.assetId, state: rec.state, reason: rec.reason ?? '', at: new Date().toISOString() };
    fs.appendFileSync(REVIEW_PATH, JSON.stringify(entry) + '\n');
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
