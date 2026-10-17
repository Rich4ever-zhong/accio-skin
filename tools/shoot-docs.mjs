// 生成 docs/ 里的截图：用无头 Edge/Chrome 打开 preview.html，按视口精确截图。
// 用法：node tools/shoot-docs.mjs
// 可指定浏览器：set EDGE_PATH="C:\path\msedge.exe"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const docs = path.join(root, 'docs');
const preview = path.join(root, 'preview.html');
const PORT = 9555;
const W = 1440, H = 860;

const BROWSERS = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);

const exe = BROWSERS.find(p => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) {
  console.error('找不到 Edge 或 Chrome，可用 EDGE_PATH 指定。');
  process.exit(1);
}

const SHOTS = [
  { file: 'theme-nebula.png', q: 'shot=1&theme=nebula&mode=dark' },
  { file: 'theme-ember.png', q: 'shot=1&theme=ember&mode=dark' },
  { file: 'theme-aurora.png', q: 'shot=1&theme=aurora&mode=dark' },
  { file: 'theme-light.png', q: 'shot=1&theme=mist&mode=light' },
  { file: 'theme-wallpaper.png', q: 'shot=1&theme=aurora&mode=dark&wall=40&wallimg=' + encodeURIComponent('linear-gradient(150deg,#0f3a4a 0%,#3a1c46 48%,#5c2a1e 100%)') },
  { file: 'panel.png', q: 'shot=1&theme=nebula&mode=dark&panel=1' }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

const profile = path.join(os.tmpdir(), 'accio-skin-shot-' + Date.now());
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  'about:blank'
], { stdio: 'ignore', detached: false });

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1000) });
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
      if (page) return page;
    } catch (e) { }
    await sleep(300);
  }
  throw new Error('浏览器没有起来');
}

const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  }
});
await new Promise(r => ws.addEventListener('open', r, { once: true }));

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' timeout')); } }, 20000);
});

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

fs.mkdirSync(docs, { recursive: true });

for (const s of SHOTS) {
  const url = 'file:///' + preview.replace(/\\/g, '/') + '?' + s.q;
  await send('Page.navigate', { url });
  await sleep(1200);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(docs, s.file), Buffer.from(data, 'base64'));
  console.log('saved', s.file);
}

ws.close();
try { child.kill(); } catch (e) { }
setTimeout(() => process.exit(0), 300);
