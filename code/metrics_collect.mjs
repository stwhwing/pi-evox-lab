import fs from 'node:fs';
import path from 'node:path';
// 公共仓库：禁止硬编码私有绝对路径，全部改为可配置环境变量（带合理默认值）。
//   EVOX_ROOT         部署根目录，默认 $HOME/pi-evox-lab
//   EVOX_STORE_DIR    基因库目录，默认 $HOME/.evomap/assets
//   EVOX_HERMES_USAGE Hermes 使用统计文件，默认 $HOME/.hermes/skills/.usage.json
const HOME = process.env.HOME || (process.env.USERPROFILE || '/root');
const ROOT = process.env.EVOX_ROOT || path.join(HOME, 'pi-evox-lab');
const STORE = process.env.EVOX_STORE_DIR || path.join(HOME, '.evomap', 'assets');
const LOG = path.join(ROOT, 'exp/metrics/metrics.log');
const countLines = (p) => { try { return fs.readFileSync(p,'utf8').split('\n').filter(l=>l.trim()).length; } catch { return 0; } };
const countState = (p, s) => { try { return fs.readFileSync(p,'utf8').split('\n').filter(l=>l.trim() && l.includes('"state":"'+s+'"')).length; } catch { return 0; } };
const genes = countLines(path.join(STORE,'genes.jsonl'));
const approved = countState(path.join(STORE,'review.jsonl'),'approved');
const quarantined = countState(path.join(STORE,'review.jsonl'),'quarantined');
const hits = countLines(path.join(ROOT,'experiments/hits.jsonl'));
const recallCalls = countLines(path.join(ROOT,'experiments/recall_calls.jsonl'));
let hermes = 'absent';
try {
  const u = JSON.parse(fs.readFileSync(process.env.EVOX_HERMES_USAGE || path.join(HOME, '.hermes/skills/.usage.json'),'utf8'));
  const e = u['pi-evox-loop'];
  hermes = e ? 'view='+(e.view_count??0)+' use='+(e.use_count??0)+' last='+(e.last_used_at??'never') : 'absent';
} catch {}
const ts = new Date().toISOString();
const line = ts+' genes='+genes+' approved='+approved+' quarantined='+quarantined+' hits='+hits+' recallCalls='+recallCalls+' hermes=['+hermes+']';
fs.mkdirSync(path.dirname(LOG), {recursive:true});
fs.appendFileSync(LOG, line+'\n');
console.log(line);
