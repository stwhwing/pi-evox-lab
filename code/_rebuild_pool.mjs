import fs from 'node:fs';
import { readGenes, readReview, withLock } from './engine/light/store.mjs';
import { verifyGene } from './engine/light/identity.mjs';
import { safetyGate } from './gene_share.mjs';
const dir = 'C:/Users/user/WorkBuddy/Pi × EvoX 项目/_rel0220/pool_repo';
const genes = readGenes();
const lww = {};
for (const r of readReview()) lww[r.assetId] = r.state;
const candidates = genes.filter((g) => g.shareable === true && String(lww[g.asset_id] || '').toLowerCase().includes('approv'));
const out = [];
const blocked = [];
for (const g of candidates) {
  const gate = safetyGate(g);
  if (gate.ok) out.push(g); else blocked.push(g.id + ':' + (gate.reason || gate.kind || '?'));
}
withLock(dir, () => { fs.writeFileSync(dir + '/genes.jsonl', out.map((g) => JSON.stringify(g)).join('\n') + '\n'); });
const broken = out.filter((g) => g.sig && verifyGene(g).status !== 'verified');
console.log('池重建:', out.length, '条 | 闸门拦截:', blocked.length, blocked.join(' ') || '', '| 验不过:', broken.length);
