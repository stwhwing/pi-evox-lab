#!/usr/bin/env node
/**
 * light-cli.mjs — 内置 light 后端命令行（零 npm 依赖）
 *
 * 用途：不安装 evolver 时，手工「沉淀 / 审核 / 查看」经验库的入口。
 *
 * 用法：
 *   node code/light-cli.mjs distill --signals bash,encoding-error \
 *        --strategy "用 encoding='gbk' 读取文件；不要用默认 utf-8" --summary "GBK 文件解码失败"
 *   node code/light-cli.mjs approve <gene_id>
 *   node code/light-cli.mjs quarantine <gene_id>
 *   node code/light-cli.mjs list
 *   node code/light-cli.mjs info           # 显示库路径与统计
 *
 * 说明：库路径默认 ~/.evomap/assets，可用 EVO_STORE_DIR 覆盖（与 evolver 后端共用同一格式）。
 * 去重：distill 按「归一化 strategy」判重，库中已有相同修法则跳过（不写基因也不写台账）。
 */
import * as distill from './engine/light/distill.mjs';
import * as ledger from './engine/light/ledger.mjs';
import { STORE_DIR, readGenes, readReview, approvedAssetIds } from './engine/light/store.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, def = undefined) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : def;
};
const positional = rest.filter((a) => !a.startsWith('--'));

function usage() {
  console.log(`light-cli — 内置经验库运维命令（零依赖）

用法：
  node code/light-cli.mjs distill --signals <a,b> --strategy "<可执行修法>" [--summary "<坑>"] [--category repair]
  node code/light-cli.mjs approve <gene_id>
  node code/light-cli.mjs quarantine <gene_id> [--reason "<原因>"]
  node code/light-cli.mjs list
  node code/light-cli.mjs info

库路径：${STORE_DIR}（可用 EVO_STORE_DIR 覆盖）`);
}

switch (cmd) {
  case 'distill': {
    const strategy = flag('strategy');
    if (!strategy) { console.error('缺少 --strategy（写可执行修法：具体参数/命令/编码）'); process.exit(2); }
    const signals = (flag('signals', 'manual') || 'manual').split(',').map((s) => s.trim()).filter(Boolean);
    // ── 内容去重（2026-09-18 实测补充）──────────────────────────────────────
    // asset_id **不是内容派生**的：同一条 strategy 连跑两次 distill 会得到两个不同 sha256，
    // 故 store 那层「按 asset_id 去重」在本场景形同虚设，重复沉淀会不断堆积（周常重扫尤甚）。
    // 这里按「归一化 strategy」判重：命中即跳过 —— **不写基因，也不写台账**
    // （写台账会把已 approved 的资产重新打回 quarantined，等于悄悄撤销审核）。
    const { appendGene, appendReview, readGenes } = await import('./engine/light/store.mjs');
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const target = norm(strategy);
    if (readGenes().some((g) => norm((g.strategy || []).join(' ')) === target)) {
      console.log('[light-distill] 跳过：库中已存在相同 strategy 的基因（内容去重）');
      break;
    }
    const { gene, raw } = distill.distillManual({
      category: flag('category', 'repair'),
      signals,
      strategy,
      summary: flag('summary'),
    });
    // 只在真正写入时登记 quarantined（等待审核）
    const written = appendGene(gene);
    if (written) {
      appendReview({ assetId: gene.asset_id, state: 'quarantined', reason: 'manually distilled — review before use' });
    }
    console.log(raw + (written ? '' : '\n（asset 已存在，跳过重复写入）'));
    if (written) console.log(`\n下一步审核：node code/light-cli.mjs approve ${gene.id}`);
    break;
  }
  case 'approve': {
    const id = positional[0];
    if (!id) { console.error('用法：light-cli.mjs approve <gene_id>'); process.exit(2); }
    const r = ledger.approve(id);
    console.log(r.ok ? `✓ 已审核通过${r.alreadyApproved ? '（此前已通过）' : ''}：${r.assetId}` : `✗ ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
    break;
  }
  case 'quarantine': {
    const id = positional[0];
    if (!id) { console.error('用法：light-cli.mjs quarantine <gene_id> [--reason ...]'); process.exit(2); }
    const r = ledger.quarantine(id, flag('reason', 'manually quarantined'));
    console.log(r.ok ? `✓ 已隔离：${r.assetId}` : `✗ ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
    break;
  }
  case 'list': {
    const rows = ledger.list();
    if (!rows.length) { console.log('（台账为空）'); break; }
    console.log('state       | id                        | category | strategy（截断）');
    for (const r of rows) {
      console.log(`${String(r.state).padEnd(11)} | ${String(r.id || r.assetId).padEnd(25)} | ${String(r.category || '-').padEnd(8)} | ${r.strategy}`);
    }
    break;
  }
  case 'info': {
    const genes = readGenes(); const review = readReview(); const approved = approvedAssetIds();
    console.log(`库路径      : ${STORE_DIR}`);
    console.log(`基因总数    : ${genes.length}`);
    console.log(`台账记录    : ${review.length}`);
    console.log(`已审核(可注入): ${approved.size}`);
    break;
  }
  default:
    usage();
    process.exit(cmd ? 2 : 0);
}
