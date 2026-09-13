/**
 * engine/light/ledger.mjs — 轻量后端的审核台账
 *
 * 语义与 evolver `review` 对齐：approve / quarantine / list。
 * fail-closed 不变量：只有台账中 state 含 "approv" 的 asset 才可被注入（读取侧见 store.approvedAssetIds）。
 */
import { appendReview, readGenes, readReview, assetIdOf } from './store.mjs';

/** 审核通过（接受 gene_id 或 asset_id） */
export function approve(idOrAssetId) {
  const assetId = String(idOrAssetId).startsWith('sha256:') ? String(idOrAssetId) : assetIdOf(String(idOrAssetId));
  if (!assetId) return { ok: false, reason: `找不到 gene: ${idOrAssetId}` };
  const already = readReview().some((r) => r.assetId === assetId && String(r.state || '').includes('approv'));
  if (already) return { ok: true, assetId, alreadyApproved: true };
  appendReview({ assetId, state: 'approved', reason: 'approved via light ledger' });
  return { ok: true, assetId, alreadyApproved: false };
}

/** 隔离（起草态，等价 evolver 的 quarantined） */
export function quarantine(idOrAssetId, reason = 'drafted — review before use') {
  const assetId = String(idOrAssetId).startsWith('sha256:') ? String(idOrAssetId) : assetIdOf(String(idOrAssetId));
  if (!assetId) return { ok: false, reason: `找不到 gene: ${idOrAssetId}` };
  appendReview({ assetId, state: 'quarantined', reason });
  return { ok: true, assetId };
}

/** 台账列表（附带基因摘要，便于人工审阅） */
export function list() {
  const genes = new Map(readGenes().map((g) => [g.asset_id, g]));
  const latest = new Map();
  for (const r of readReview()) latest.set(r.assetId, r); // 后写覆盖前写 = 最新态
  return [...latest.values()].map((r) => {
    const g = genes.get(r.assetId);
    return {
      assetId: r.assetId,
      state: r.state,
      at: r.at,
      id: g?.id ?? null,
      category: g?.category ?? null,
      strategy: (g?.strategy?.[0] ?? '').slice(0, 120),
    };
  });
}
