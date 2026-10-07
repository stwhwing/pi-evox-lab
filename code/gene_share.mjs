/**
 * code/gene_share.mjs — 共享基因库：脱敏闸门 + export / submit / import（0.14.9）
 *
 * 红线：私有内容不可泄漏。任何基因离开本机/入池前必过 redactionGate()，命中即 fail-closed。
 * 底座：与 light-cli 共用同一 light store 模块（asset_id 去重 / review LWW）。
 *
 * 安全设计：import 的审核态由**操作者用 --tier 指定的池信任级别**决定，
 *   绝不读取基因文件里自称的 provenance.tier —— 否则恶意池可伪装 official 骗取自动批准。
 *   默认 --tier community（一律待审）；仅当操作者显式信任某个自建池时才 --tier official（自动通过）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 修复 #3：默认按**模块自身位置**解析底座（跨平台），不再硬编码某台机的 Windows 路径；
// EVO_SKILL_CODE 仅作为「模块被单独放到别处」时的覆盖（例：私有节点试点暂存目录）。
const SKILL_CODE = process.env.EVO_SKILL_CODE || __dirname;
const store = await import(pathToFileURL(path.join(SKILL_CODE, 'engine/light/store.mjs')).href);

const POOL_DIR = process.env.EVO_POOL_DIR || path.join(os.homedir(), '.evomap', 'pool');

// ── 脱敏闸门规则（红线，fail-closed）──────────────────────────────────────
// ⚠️ 默认只含**通用**私有模式（私有IP/本地路径/密钥），不含任何项目私有词——
// 因为本文件会公开发布，不能把使用者的内部代号/地址写进来。
// 项目私有词（内部服务名/代号/自建地址等）由使用者在**本地、不发布**的
// redline.local.json 里自行补充（见 loadRedlineConfig），两边合起来才是完整闸门。
const SECRET_TOKENS = /\b(skh|gho|ghp|clh|sk|pk)_[A-Za-z0-9]{8,}/;
const SECRET_ENV = /\b[A-Za-z0-9_]+_(API_KEY|TOKEN|SECRET|PASSWORD)\b/;
const RULES = [
  { id: 'ip-loopback', re: /\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, why: '回环地址' },
  { id: 'ip-private-10', re: /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, why: '私有网段 10/8' },
  { id: 'ip-private-192', re: /\b192\.168\.\d{1,3}\.\d{1,3}\b/, why: '私有网段 192.168/16' },
  { id: 'ip-private-172', re: /\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/, why: '私有网段 172.16/12' },
  { id: 'ip-linklocal', re: /\b169\.254\.\d{1,3}\.\d{1,3}\b/, why: '链路本地地址' },
  { id: 'host-port', re: /\blocalhost:\d+\b/i, why: '本机端口' },
  { id: 'path-win-users', re: /[A-Za-z]:[\\/]+Users[\\/]+/i, why: 'Windows 用户目录' },
  { id: 'path-win-system', re: /[A-Za-z]:[\\/]+Windows[\\/]+/i, why: 'Windows 系统目录' },
  { id: 'path-posix-home', re: /(^|[\s"'`(])(\/root\/|\/home\/[A-Za-z0-9_.-]+\/|\/Users\/[A-Za-z0-9_.-]+\/)/, why: 'POSIX home/用户目录' },
  { id: 'path-unc', re: /\\\\[A-Za-z0-9_.-]+\\/, why: 'UNC 网络路径' },
  { id: 'secret-token', re: SECRET_TOKENS, why: '疑似令牌字面量' },
  { id: 'secret-env', re: SECRET_ENV, why: '疑似密钥环境变量名' },
];
// 白名单仅对歧义规则(allowExempt)生效；确定性规则一律拦截（fail-closed）。
const ALLOW = /\b(skillhub|clawhub|github|evolver|gep|gepx|pi|npm|node|agnes|deepseek)\b/i;

/** 载入使用者本地私有词表（不发布）：EVO_REDLINE_FILE 或 <store>/redline.local.json，格式 ["词",…] 或 {"terms":[…]} */
function loadRedlineConfig() {
  const cand = process.env.EVO_REDLINE_FILE
    || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'redline.local.json');
  try {
    const raw = JSON.parse(fs.readFileSync(cand, 'utf8'));
    const terms = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.terms) ? raw.terms : []);
    return terms.filter((t) => typeof t === 'string' && t.length >= 2);
  } catch { return []; }
}
const USER_TERMS = loadRedlineConfig();

function collectTextFields(gene) {
  const out = [];
  const push = (p, v) => { if (typeof v === 'string') out.push([p, v]); };
  push('summary', gene?.summary);
  push('generation_meta.source', gene?.generation_meta?.source);
  push('provenance.contributor', gene?.provenance?.contributor);
  (gene?.strategy || []).forEach((s, i) => push(`strategy[${i}]`, s));
  (gene?.anti_patterns || []).forEach((s, i) => push(`anti_patterns[${i}]`, s));
  (gene?.signals_match || []).forEach((s, i) => push(`signals_match[${i}]`, s));
  (gene?.scope?.signals || []).forEach((s, i) => push(`scope.signals[${i}]`, s));
  return out;
}

/** 脱敏闸门：扫描全部文本字段 → { ok, violations:[{rule,why,field,snippet}] } */
export function redactionGate(gene) {
  const violations = [];
  for (const [field, text] of collectTextFields(gene)) {
    for (const r of RULES) {
      const m = r.re.exec(text);
      if (!m) continue;
      if (r.allowExempt) {
        const ctx = text.slice(Math.max(0, m.index - 4), m.index + m[0].length + 4);
        if (ALLOW.test(ctx)) continue;
      }
      violations.push({ rule: r.id, why: r.why, field, snippet: m[0].slice(0, 40) });
    }
    // 使用者本地私有词（来自 redline.local.json，不发布）——大小写不敏感子串匹配
    const lower = text.toLowerCase();
    for (const term of USER_TERMS) {
      if (lower.includes(term.toLowerCase())) violations.push({ rule: 'user-redline', why: '本地私有词表命中', field, snippet: term.slice(0, 40) });
    }
  }
  return { ok: violations.length === 0, violations };
}

const exportable = (genes) => {
  const out = [], blocked = [];
  for (const g of genes) {
    if (g?.shareable !== true) continue;
    const gate = redactionGate(g);
    if (gate.ok) out.push(g); else blocked.push({ gene: g, violations: gate.violations });
  }
  return { out, blocked };
};
const readJsonl = (p) => { try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const writeJsonl = (f, rows) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8'); };
const argOf = (a, n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
const positional = (a) => a.filter((x, i) => !x.startsWith('--') && !(i > 0 && a[i - 1].startsWith('--')));

function reportBlocked(blocked) {
  for (const b of blocked) { const v = b.violations[0]; console.log(`  [BLOCKED] ${b.gene.id} — 规则 ${v.rule}(${v.why}) 字段 ${v.field} 命中「${v.snippet}」`); }
}

function cmdExport(args) {
  const genes = store.readGenes();
  const { out, blocked } = exportable(genes);
  const dest = argOf(args, '--out') || path.join(POOL_DIR, 'export.jsonl');
  if (out.length) writeJsonl(dest, out);
  console.log(`[gene-share] 库内基因 ${genes.length}｜可导出(shareable 且过闸) ${out.length}｜被闸门拦截 ${blocked.length}`);
  reportBlocked(blocked);
  if (out.length) console.log(`[gene-share] 已导出 → ${dest}`);
  return blocked.length ? 2 : 0;
}

function cmdSubmit(args) {
  const pool = argOf(args, '--pool') || POOL_DIR;
  const { out, blocked } = exportable(store.readGenes());
  const dest = path.join(pool, 'genes.jsonl');
  const existing = readJsonl(dest);
  const have = new Set(existing.map((g) => g.asset_id));
  let added = 0;
  for (const g of out) {
    if (have.has(g.asset_id)) continue;
    existing.push({ ...g, provenance: { source: 'local', tier: 'official', exported_at: new Date().toISOString(), ...(g.provenance || {}) } });
    have.add(g.asset_id); added++;
  }
  writeJsonl(dest, existing);
  console.log(`[gene-share] 入池 ${added} 条（幂等：已存在 ${out.length - added} 跳过）→ ${dest}`);
  console.log(`[gene-share] 被闸门拦截 ${blocked.length}（未入池，未出网）`);
  reportBlocked(blocked);
  return blocked.length ? 2 : 0;
}

function cmdImport(args) {
  const file = positional(args)[0] || path.join(POOL_DIR, 'genes.jsonl');
  if (!fs.existsSync(file)) { console.error(`[gene-share] 池文件不存在: ${file}`); return 1; }
  // 审核态由**操作者指定的池信任级别**决定（不读基因自称的 tier）：official=自建策展池→自动通过；community=默认→待审。
  const tier = argOf(args, '--tier') === 'official' ? 'official' : 'community';
  const state = tier === 'official' ? 'approved' : 'quarantined';
  let added = 0, skipped = 0, blocked = 0;
  for (const g of readJsonl(file)) {
    if (!redactionGate(g).ok) { blocked++; continue; }          // 纵深防御：入库前再过闸
    if (g?.shareable !== true) { skipped++; continue; }
    if (store.appendGene(g)) { store.appendReview({ assetId: g.asset_id, state, reason: `imported from ${tier} pool` }); added++; }
    else skipped++;
  }
  console.log(`[gene-share] 导入(tier=${tier}→${state})：新增 ${added}｜跳过 ${skipped}｜闸门拦截 ${blocked}`);
  return 0;
}

/** 供 light-cli 调用的入口（返回退出码，不自行 process.exit） */
export function runGene(args) {
  const [sub, ...rest] = args;
  if (sub === 'export') return cmdExport(rest);
  if (sub === 'submit') return cmdSubmit(rest);
  if (sub === 'import') return cmdImport(rest);
  console.log('用法: gene_share.mjs export|import|submit');
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runGene(process.argv.slice(2)));
}
