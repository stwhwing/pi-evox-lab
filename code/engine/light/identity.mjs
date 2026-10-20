/**
 * engine/light/identity.mjs — 基因 provenance 签名链（0.21，1.0 判据之一）
 *
 * 设计：每台机器一个 Ed25519 身份（keypair 存 ~/.evomap/identity/，零依赖，Node 内置 crypto）。
 *   - 沉淀（distill/draft）时用私钥对基因内容签名 → 基因带 {sig, keyid, pubkey} 字段；
 *   - 入池（gene submit）时签名随基因一起导出（submit 不过滤这些字段）；
 *   - 导入（gene import）时用随附 pubkey 验签：内容被篡改 → 拒绝；keyid 不认识 → 接受但警告
 *     （无法验证 ≠ 有问题；老基因无签名字段 → 原样接受，legacy）。
 *   - 验签用公钥、不暴露私钥；私钥文件权限 0600，绝不出本机（脱敏闸门另有一道）。
 *
 * 签名域：asset_id + 规范化基因内容（去掉签名字段后的稳定 JSON）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const IDENTITY_DIR = process.env.EVO_IDENTITY_DIR || path.join(os.homedir(), '.evomap', 'identity');
const PRIV_PATH = path.join(IDENTITY_DIR, 'identity.pem');
const PUB_PATH = path.join(IDENTITY_DIR, 'identity.pub.pem');

function ensureDir() { try { fs.mkdirSync(IDENTITY_DIR, { recursive: true }); } catch { /* 已存在 */ } }

/** 生成或加载本机身份；返回 {keyId, privateKey, publicKey}（PEM 字符串） */
export function loadIdentity() {
  if (fs.existsSync(PRIV_PATH) && fs.existsSync(PUB_PATH)) {
    const privateKey = fs.readFileSync(PRIV_PATH, 'utf8');
    const publicKey = fs.readFileSync(PUB_PATH, 'utf8');
    return { keyId: keyIdOf(publicKey), privateKey, publicKey };
  }
  ensureDir();
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(PRIV_PATH, privPem, { mode: 0o600 });
  fs.writeFileSync(PUB_PATH, pubPem);
  return { keyId: keyIdOf(pubPem), privateKey: privPem, publicKey: pubPem };
}

/** 身份目录与私钥路径（展示/诊断用） */
export function identityDir() { return IDENTITY_DIR; }
export function privateKeyPath() { return PRIV_PATH; }

/** keyid = pubkey 的 sha256 前 16 hex（稳定短标识） */
export function keyIdOf(publicKeyPem) {
  return crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16);
}

/** 规范化签名域：asset_id + 去签名字段后的稳定 JSON */
function canonical(gene) {
  const { sig, keyid, pubkey, signed_at, ...rest } = gene || {};
  return String(rest.asset_id || '') + '\n' + JSON.stringify(rest, Object.keys(rest).sort());
}

/** 给基因签名（原地补 {sig, keyid, pubkey, signed_at} 并返回同一对象） */
export function signGene(gene) {
  if (!gene || !gene.asset_id) return gene;
  const { privateKey, publicKey, keyId } = loadIdentity();
  const data = Buffer.from(canonical(gene), 'utf8');
  const sig = crypto.sign(null, data, privateKey).toString('base64');
  gene.sig = sig; gene.keyid = keyId; gene.pubkey = publicKey; gene.signed_at = new Date().toISOString();
  return gene;
}

/**
 * 验签。pubkeyPem 省略时用基因自带 pubkey。
 * 返回 {ok, status, why}：status = 'verified' | 'tampered' | 'unsigned' | 'bad-format' | 'unverifiable'
 */
export function verifyGene(gene, pubkeyPem) {
  if (!gene || !gene.asset_id) return { ok: false, status: 'bad-format', why: '基因缺少 asset_id' };
  if (!gene.sig) return { ok: true, status: 'unsigned', why: '无签名字段（legacy 基因，原样接受）' };
  const pem = pubkeyPem || gene.pubkey;
  if (!pem) return { ok: true, status: 'unverifiable', why: '有 sig 但无 pubkey，无法验证' };
  try {
    const data = Buffer.from(canonical(gene), 'utf8');
    const ok = crypto.verify(null, data, pem, Buffer.from(String(gene.sig), 'base64'));
    if (ok) return { ok: true, status: 'verified', why: `签名有效（keyid=${gene.keyid || '?'}）` };
    return { ok: false, status: 'tampered', why: '签名与内容不匹配——基因可能被篡改' };
  } catch (e) {
    return { ok: true, status: 'unverifiable', why: `验签异常（${e.message}）——按无法验证处理` };
  }
}

/** 0.25 维1：license token（JWT-lite：base64url(payload).base64url(sig)） */
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url').toString('utf8');

export function signLicense(payload, privateKeyPem) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.sign(null, Buffer.from(body), privateKeyPem).toString('base64url');
  return body + '.' + sig;
}

export function verifyLicense(token, publicKeyPem) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return { ok: false, reason: 'token 格式错误（应为 payload.signature）' };
  try {
    const ok = crypto.verify(null, Buffer.from(parts[0]), publicKeyPem, Buffer.from(parts[1], 'base64url'));
    if (!ok) return { ok: false, reason: '签名无效' };
    return { ok: true, payload: JSON.parse(unb64u(parts[0])) };
  } catch (e) { return { ok: false, reason: '解析失败: ' + String(e.message || e) }; }
}
