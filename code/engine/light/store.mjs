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

/** 追加一条基因；asset_id 已存在则跳过（去重）。返回 true=已写入 */
export function appendGene(gene) {
  ensureDir();
  const exists = readGenes().some((g) => g.asset_id && g.asset_id === gene.asset_id);
  if (exists) return false;
  fs.appendFileSync(GENES_PATH, JSON.stringify(gene) + '\n');
  return true;
}

/** 追加审核台账记录 */
export function appendReview(rec) {
  ensureDir();
  const entry = { assetId: rec.assetId, state: rec.state, reason: rec.reason ?? '', at: new Date().toISOString() };
  fs.appendFileSync(REVIEW_PATH, JSON.stringify(entry) + '\n');
  return entry;
}

/** 已 approved 的 asset_id 集合（fail-closed：台账不可用时为空集，调用方据此跳过注入） */
export function approvedAssetIds() {
  const set = new Set();
  for (const r of readReview()) {
    const state = typeof r?.state === 'string' ? r.state : '';
    if (state.toLowerCase().includes('approv') && r.assetId) set.add(String(r.assetId).replace(/^"|"$/g, ''));
  }
  return set;
}

/** 由 gene id 找 asset_id（台账写入用） */
export function assetIdOf(geneId) {
  const g = readGenes().find((x) => x.id === geneId);
  return g?.asset_id ?? null;
}
