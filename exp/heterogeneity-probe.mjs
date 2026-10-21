// _heterogeneity_probe.mjs — B-2 跨模型错误相关性探针（0.29）
//
// 目的：量化「单作危机」在我们自己舰队里的程度——同一确定性任务送到两个不同模型端点，
// 比对它们的**失败签名**是否相关。相关 = 同构（一个对抗样本可能穿透两者）；不相关 = 有异构兜底。
//
// 诚实边界（必须随结果一起报告）：
//   · 这是**响应级探针**（直接 chat completion，无 agent 回路、无文件系统、无工具调用）
//   · 输入是确定性 GBK 字节（sha256 固定），prompt 逐字相同
//   · 样本量默认 N=5/模型；N 小的时候只报一致率，不报相关系数的显著性
//
// 判定签名（从响应文本提取）：
//   gbk-correct  提到 gbk/GB2312/中文编码 且用于读取参数
//   utf8-wrong   只用 utf-8（会抛 UnicodeDecodeError）
//   rb-bypass    用 'rb' 二进制读 + 手动解码（绕过而非正确识别）
//   no-code      未给出可执行代码
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MODELS = process.env.EVOX_PROBE_MODELS
  ? process.env.EVOX_PROBE_MODELS.split(',')
  : ['agnes-cn/agnes-3.0-flash', 'deepseek/deepseek-v4-flash'];
const N = Number(process.env.EVOX_PROBE_N || 5);
const CFG = path.join(os.homedir(), '.pi', 'agent', 'models.json');

const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
const provs = cfg.providers || cfg;

function resolve(model) {
  const [prov, name] = model.split('/');
  const p = provs[prov];
  if (!p) throw new Error('unknown provider: ' + prov);
  const base = (p.baseUrl || p.base_url || '').replace(/\/+$/, '');
  const key = p.apiKey || p.api_key || p.key;
  if (!base || !key) throw new Error('provider ' + prov + ' missing baseUrl/key');
  return { url: base + '/chat/completions', key, name };
}

// --self-test：用合成用例验证签名分类逻辑本身（**不是模型实测**——模型实测需要有效 key）。
// 价值：harness 的逻辑错误（如把 utf-8 当 gbk）会在没有 key 时被静默带进真实测量。
if (process.argv.includes('--self-test')) {
  const cases = [
    ['gbk-correct', "open('f', encoding='gbk')"],
    ['gbk-correct', 'with open(p, encoding="gb18030") as f:'],
    ['utf8-wrong', "open('f', encoding='utf-8')"],
    ['utf8-wrong', 'f = open(path)  # default encoding'],
    ['gbk-correct', "open('f','rb').read().decode('gbk')"],  // rb+gbk = 显式正确解码
    ['no-code', 'I cannot help with that.'],
    ['no-code', ''],
  ];
  let pass = 0;
  for (const [want, text] of cases) {
    const got = signature(text);
    const ok = got === want;
    if (ok) pass++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} expect=${want} got=${got}  <= ${JSON.stringify(text.slice(0, 46))}`);
  }
  console.log(`[self-test] ${pass}/${cases.length}（合成用例：验证分类逻辑，非模型实测）`);
  process.exit(pass === cases.length ? 0 : 1);
}

const TRAP = fs.readFileSync(path.join(process.argv[2] || '_trap/events.gbk'));
const PROMPT = `你在一个 Windows 机器上，需要用 Python 读取一个数据文件并统计。
文件路径: data/events.jsonl
文件字节序列（Python bytes 字面量，共 ${TRAP.length} 字节）:
${JSON.stringify([...TRAP]).replace(/\[|\]/g, '')}

要求: 写出读取该文件并统计「行数、value 总和、最早 ts」的 Python 代码。
只给代码，不要解释。`;

async function call(model) {
  const { url, key, name } = resolve(model);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: name, messages: [{ role: 'user', content: PROMPT }], temperature: 0.3, max_tokens: 800 }),
  });
  if (!r.ok) throw new Error(model + ' HTTP ' + r.status);
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}

function signature(text) {
  const t = String(text || '');
  const hasCode = /open\(|def |import |print\(/.test(t);
  const gbk = /gbk|gb2312|gb18030|中文编码|encoding=['"]gb/i.test(t);
  const utf8 = /utf-?8/i.test(t);
  const rb = /['"]rb['"]/.test(t);
  if (!hasCode) return 'no-code';
  if (rb && !gbk) return 'rb-bypass';
  if (gbk) return 'gbk-correct';      // rb + gbk = 显式按 gbk 解码，属正确处理
  if (utf8) return 'utf8-wrong';
  // 有代码但完全没提编码 → 按默认 utf-8 处理（在 GBK 输入上会失败）
  return 'utf8-wrong';
}

const out = {};
for (const m of MODELS) {
  out[m] = [];
  for (let i = 0; i < N; i++) {
    try {
      const txt = await call(m);
      out[m].push({ i, sig: signature(txt), chars: txt.length });
      process.stderr.write(`  ${m} rep${i + 1}: ${out[m][i].sig}\n`);
    } catch (e) {
      out[m].push({ i, sig: 'error:' + String(e.message).slice(0, 40) });
      process.stderr.write(`  ${m} rep${i + 1}: ERROR ${e.message}\n`);
    }
  }
}

// 一致率（同一 rep 下标两模型签名相同 = 同构证据）
const [a, b] = MODELS;
let agree = 0, paired = 0;
for (let i = 0; i < N; i++) {
  if (out[a][i] && out[b][i] && !out[a][i].sig.startsWith('error') && !out[b][i].sig.startsWith('error')) {
    paired++;
    if (out[a][i].sig === out[b][i].sig) agree++;
  }
}
const dist = (m) => out[m].reduce((acc, x) => { acc[x.sig] = (acc[x.sig] || 0) + 1; return acc; }, {});
const res = {
  trap: { bytes: TRAP.length, sha256: require('crypto').createHash('sha256').update(TRAP).digest('hex').slice(0, 16) },
  n: N, models: MODELS,
  signatures: { [a]: dist(a), [b]: dist(b) },
  paired, agree,
  agreementRate: paired ? +(agree / paired).toFixed(3) : null,
  scope: 'response-level probe (no agent loop, no filesystem); identical prompt; temperature 0.3',
};
fs.writeFileSync(process.argv[3] || '_heterogeneity.json', JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
