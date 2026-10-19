import fs from 'node:fs';
import { readGenes, withLock, STORE_DIR } from './engine/light/store.mjs';
import { signGene, verifyGene } from './engine/light/identity.mjs';
const KW = {
 'ops-deploy': ['nginx','certbot','systemctl','dnf','服务器','部署','ssh','authorized_keys','服务','linux','conf.d'],
 'coding-debug': ['gbk','encoding','utf-8','unicode','decode','json','type-or-value-error','exception','python','node','bash','parse','语法'],
 'release-publish': ['publish','release','版本','skillhub','clawhub','scan','审核','平台','approv'],
 'api-integration': ['api','webhook','token','timeout','endpoint','http','fetch','undici','端点','key'],
 'git-workflow': ['git','branch','commit','push','pull','merge','repo','仓库','仓库根'],
 'agent-runtime': ['register-hit','recall','hook','host','沉淀','pipeline','session','identity','签名','provenance','approve'],
};
const genes = readGenes();
withLock(STORE_DIR, () => {
  for (const g of genes) {
    const text = JSON.stringify(g.strategy||'') + JSON.stringify(g.summary||'') + JSON.stringify(g.signals_match||'');
    const tl = text.toLowerCase();
    let best = null, hits = 0;
    for (const [scene, kws] of Object.entries(KW)) {
      const c = kws.filter((k) => tl.includes(k.toLowerCase())).length;
      if (c > hits) { best = scene; hits = c; }
    }
    const newCat = best || 'coding-debug';
    if (g.category !== newCat) { g.category = newCat; if (g.sig) signGene(g); } // 变更即重签
  }
  fs.writeFileSync(STORE_DIR + '/genes.jsonl', genes.map((g) => JSON.stringify(g)).join('\n') + '\n');
});
const back = JSON.parse(fs.readFileSync(STORE_DIR + '/genes.jsonl','utf8').split('\n').filter(Boolean).map((l)=>l).join('\n') || '[]');
const bad = genes.filter((g) => g.sig && verifyGene(g).status !== 'verified');
console.log('本地库回填+重签完成 | 验签失败:', bad.length, bad.map(g=>g.id).join(',') || '');
const dist = {};
for (const g of genes) dist[g.category] = (dist[g.category]||0)+1;
console.log('分布:', JSON.stringify(dist));
