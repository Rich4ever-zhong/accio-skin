// Accio Skin · 外部换肤注入器（v0.2 / P2）
//
// 原理：以 --remote-debugging-port 拉起 Accio，通过 CDP 向渲染进程注入一份样式，
//       覆盖 Accio 的两层设计 token（:root 的 --color-*-value 与 html.dark 派生的 --color-*），
//       并在右下角挂一个 Shadow DOM 控制面板（皮肤 / 强调色 / 壁纸 / 主题包）。
//
// 用法：
//   node injector.mjs                  默认皮肤，自动探测并启动 Accio
//   node injector.mjs --theme=nebula   指定默认皮肤
//   node injector.mjs --attach         不启动，只挂到已在跑的调试端口
//   node injector.mjs --list           只列出 CDP 目标
//   node injector.mjs --shot=a.png     注入后截图退出（自检）
//   node injector.mjs --no-panel       不注入控制面板
//   node injector.mjs --port=9222 --exe="C:\path\Accio.exe"
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const args = {};
for (const a of argv) {
  if (!a.startsWith('--')) continue;
  const [k, v] = a.slice(2).split('=');
  args[k] = v === undefined ? true : v;
}
const PORT = Number(args.port || 9222);
const THEME = args.theme || 'abyss';
const WITH_PANEL = !args['no-panel'];
const SHOT = typeof args.shot === 'string' ? path.resolve(args.shot) : null;
const BASE = `http://127.0.0.1:${PORT}`;

const c = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  ok: s => `\x1b[32m${s}\x1b[0m`,
  warn: s => `\x1b[33m${s}\x1b[0m`,
  err: s => `\x1b[31m${s}\x1b[0m`,
  b: s => `\x1b[1m${s}\x1b[0m`
};
// --log=路径 时同时写文件（托盘模式下没有控制台可看）
const LOG_FILE = typeof args.log === 'string' ? args.log : null;
let logStream = null;
if (LOG_FILE) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  } catch (e) { }
}
const strip = s => String(s).replace(/\u001b\[[0-9;]*m/g, '');
const log = (...a) => {
  const line = a.map(strip).join(' ');
  console.log(line);
  if (logStream) {
    try { logStream.write(new Date().toISOString().slice(11, 19) + '  ' + line + '\n'); } catch (e) { }
  }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 主题包 ----------
function loadThemes() {
  const dir = path.join(__dirname, 'themes');
  if (!fs.existsSync(dir)) {
    console.error(c.err('找不到 themes/ 目录，请先运行：node build-themes.mjs'));
    process.exit(1);
  }
  const out = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.accio-theme.json'))) {
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    out[p.id] = { name: p.name, en: p.en, tokens: p.tokens };
  }
  if (!out[THEME]) {
    console.error(c.err(`没有 ${THEME} 这套主题，可选：${Object.keys(out).join(' / ')}`));
    process.exit(1);
  }
  return out;
}

// ---------- 定位 Accio（不硬编码个人路径，方便开源） ----------
function findAccio() {
  if (args.exe) return String(args.exe);
  if (process.env.ACCIO_EXE) return process.env.ACCIO_EXE;
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(local, 'Programs', 'Accio', 'Accio.exe'),
    path.join(local, 'Accio', 'Accio.exe'),
    'C:\\Program Files\\Accio\\Accio.exe',
    'C:\\Program Files (x86)\\Accio\\Accio.exe',
    'D:\\Accio\\Accio.exe',
    'E:\\Accio\\Accio.exe'
  ];
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch (e) { }
  }
  return null;
}

// ---------- 注入到页面的运行时（自包含，仅依赖 payload） ----------
function bootstrap(payload) {
  const VERSION = 13;
  const STORAGE = 'accio.skin.v4';
  const STYLE_ID = '__accio_skin_style';
  const HOST_ID = '__accio_skin_host';
  const WALL_ID = '__accio_skin_wall';

  if (window.__accioSkin && window.__accioSkin.version === VERSION) {
    window.__accioSkin.payload = payload;
    window.__accioSkin.reapply();
    return;
  }

  // -------- 颜色工具 --------
  const h2r = h => { h = String(h || '').replace('#', ''); if (h.length === 3) h = h.split('').map(x => x + x).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const r2h = a => '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = h2r(a), B = h2r(b); return r2h(A.map((v, i) => v + (B[i] - v) * t)); };

  // -------- 状态 --------
  const state = {
    theme: payload.def,
    off: false,
    accent: null,
    wall: { type: 'none', value: '', opacity: 0.62, blur: 8 }
  };
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) Object.assign(state, JSON.parse(raw));
  } catch (e) { }
  if (!payload.themes[state.theme]) state.theme = payload.def;

  const save = () => { try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch (e) { } };

  // -------- token 计算 --------
  const recolor = (t, mode, accent) => {
    if (!accent) return t;
    const dark = mode === 'dark';
    const bg = t['background'];
    return Object.assign({}, t, {
      'primary': accent,
      'primary-dark': dark ? mix(accent, '#ffffff', 0.14) : mix(accent, '#000000', 0.16),
      'primary-bg': mix(accent, bg, dark ? 0.82 : 0.90),
      'chat-cta-bg': mix(accent, bg, dark ? 0.80 : 0.90),
      'chat-cta-bg-hover': mix(accent, bg, dark ? 0.72 : 0.83),
      'store-gate-arrow': mix(accent, bg, dark ? 0.78 : 0.88),
      'agent-hub-banner-green': mix(accent, bg, dark ? 0.86 : 0.93),
      'expert-author': mix(accent, '#3b82f6', 0.45),
      'badge-success-text': dark ? '#4ecf8f' : mix('#1f8f5f', accent, 0.25)
    });
  };

  const wallpaperOn = () => !state.off && !!(state.wall && state.wall.type !== 'none' && state.wall.value);

  // 浓度 = 面板不透明度。0 表示面板全透明（壁纸最清楚），但正文会糊。
  // 不硬性夹取，只在低于提示线时提醒一次——要什么样的效果由使用者自己决定。
  const WALL_WARN = { light: 0.55, dark: 0.40 };
  const wallOpacity = mode => {
    const want = Number(state.wall.opacity);
    return Math.min(1, Math.max(0, Number.isFinite(want) ? want : 0.62));
  };

  const fade = (t, alpha) => {
    if (!wallpaperOn()) return t;
    const pct = Math.round(Math.min(1, Math.max(0, alpha)) * 100);
    const out = Object.assign({}, t);
    for (const k of ['background', 'bg-layout', 'bg-container', 'surface', 'layer-surface', 'bg-chip', 'muted', 'accent']) {
      if (out[k] && String(out[k]).startsWith('#')) out[k] = `color-mix(in srgb, ${out[k]} ${pct}%, transparent)`;
    }
    return out;
  };

  const tokensOf = mode => {
    const base = payload.themes[state.theme].tokens[mode];
    return fade(recolor(base, mode, state.accent), wallOpacity(mode));
  };

  const val = o => Object.keys(o).map(k => `--color-${k}-value:${o[k]};--color-${k}:${o[k]};`).join('');

  // Accio 有相当一部分表面用的是 Tailwind 调色板（zinc / neutral / slate…），不读语义 token。
  // 把这几个中性色阶整体映射到主题自己的底色与文字色，换肤才能覆盖到那部分界面。
  function rampVars(mode) {
    // 注意：这里必须用未叠加壁纸透明度的原始 token，否则 mix() 会拿到 color-mix 字符串
    const t = recolor(payload.themes[state.theme].tokens[mode], mode, state.accent);
    const dark = mode === 'dark';
    const bg = t['background'], ct = t['bg-container'], bd = t['border'],
      fg = t['text-primary'], s2 = t['text-secondary'], s3 = t['text-tertiary'];
    const r = dark ? {
      '50': fg,
      '100': mix(fg, bg, 0.06),
      '200': mix(fg, bg, 0.16),
      '300': s2,
      '400': s2,
      '500': s3,
      '600': t['border-strong'],
      '700': bd,
      '800': ct,
      '900': mix(bg, ct, 0.5),
      '950': bg
    } : {
      '50': bg,
      '100': mix(bg, fg, 0.04),
      '200': mix(bg, fg, 0.08),
      '300': bd,
      '400': mix(fg, bg, 0.5),
      '500': s2,
      '600': s2,
      '700': t['border-strong'],
      '800': fg,
      '900': fg,
      '950': fg
    };
    // 壁纸模式下，承担「表面」的那几档也要跟着半透明，否则卡片仍是实心
    const alpha = wallpaperOn() ? wallOpacity(mode) : 1;
    const pct100 = Math.round(alpha * 100);
    const surfaceSteps = dark ? ['700', '800', '900', '950'] : ['50', '100', '200', '300'];
    const alphad = (hex, n) => (alpha < 1 && surfaceSteps.indexOf(n) !== -1)
      ? `color-mix(in srgb, ${hex} ${pct100}%, transparent)`
      : hex;
    let out = '';
    for (const n of Object.keys(r)) {
      const v = alphad(r[n], n);
      for (const fam of ['zinc', 'neutral', 'slate', 'gray', 'stone']) out += `--color-${fam}-${n}:${v};`;
    }
    return out;
  }

  function wallCss() {
    const w = state.wall;
    const img = w.type === 'gradient' ? w.value : `url("${w.value}")`;
    return `
html{background-color:#05070a !important}
html,body{background-color:transparent !important}
#root{position:relative;z-index:1;background-color:transparent !important}
#${WALL_ID}{position:fixed;inset:-60px;z-index:0;pointer-events:none;background-image:${img};
  background-size:cover;background-position:center;background-repeat:no-repeat;
  filter:blur(${Number(w.blur) || 0}px) saturate(1.06)}`;
  }

  function css() {
    if (state.off) return '';
    let out = `:root{${val(tokensOf('light'))}${rampVars('light')}}\nhtml.dark,.dark{${val(tokensOf('dark'))}${rampVars('dark')}}`;
    if (wallpaperOn()) out += wallCss();
    return out;
  }

  // -------- 挂载（document-start 阶段 head/body 可能不存在，必须轮询） --------
  let styleEl = null;
  function ensureStyle() {
    if (!styleEl) {
      // 版本升级后旧实例的 <style> 可能还在，先清干净，避免两份规则互相覆盖
      document.querySelectorAll('#' + STYLE_ID).forEach(el => el.remove());
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
    }
    if (!styleEl.isConnected) {
      const host = document.head || document.documentElement;
      if (host) host.appendChild(styleEl);
      else {
        let n = 0;
        const t = setInterval(() => {
          const h = document.head || document.documentElement;
          if (h) { h.appendChild(styleEl); clearInterval(t); }
          else if (++n > 100) clearInterval(t);
        }, 40);
      }
    }
    return styleEl;
  }

  function ensureWall() {
    let el = document.getElementById(WALL_ID);
    if (!wallpaperOn()) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = WALL_ID;
      const parent = document.body || document.documentElement;
      parent.insertBefore(el, parent.firstChild || null);
    }
  }

  function render() {
    ensureStyle().textContent = css();
    ensureWall();
    paint();
  }

  // -------- 面板 --------
  let sr = null, card = null, fab = null;

  const SWATCHES = ['#7d9bff', '#4fd8bd', '#a98bff', '#f0a35a', '#f2f2f2', '#0a84ff',
    '#ff7ba6', '#3fbf7f', '#e5b54a', '#ff6b6b', '#6ee7b7', '#c084fc'];
  const WALLS = [
    { id: 'g1', label: '深青', css: 'linear-gradient(135deg,#0f2027,#203a43,#2c5364)' },
    { id: 'g2', label: '夜紫', css: 'linear-gradient(135deg,#1a1030,#2b1a4a,#3d2a5c)' },
    { id: 'g3', label: '余烬', css: 'linear-gradient(135deg,#2b1a10,#4a2b1a,#6b3d24)' },
    { id: 'g4', label: '极光', css: 'radial-gradient(circle at 30% 20%,#123a3a,#08161a 65%)' }
  ];

  function mountPanel() {
    const stale = document.getElementById(HOST_ID);
    if (stale) stale.remove();

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483646;';

    // 悬浮球可以拖，位置记在 localStorage
    let fabPos = { r: 14, b: 14 };
    try {
      const saved = JSON.parse(localStorage.getItem('accio.skin.fab') || 'null');
      if (saved && typeof saved.r === 'number' && typeof saved.b === 'number') fabPos = saved;
    } catch (e) { }
    const clampPos = q => ({
      r: Math.max(6, Math.min(Math.max(6, window.innerWidth - 40), q.r)),
      b: Math.max(6, Math.min(Math.max(6, window.innerHeight - 40), q.b))
    });
    fabPos = clampPos(fabPos);
    host.style.right = fabPos.r + 'px';
    host.style.bottom = fabPos.b + 'px';
    document.body.appendChild(host);
    sr = host.attachShadow({ mode: 'open' });

    sr.innerHTML = `
<style>
:host{all:initial}
*{box-sizing:border-box}
.wrap{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:12.5px}
.fab{width:30px;height:30px;border-radius:50%;border:1px solid rgba(125,125,125,.28);cursor:pointer;
     display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px -8px rgba(0,0,0,.55);transition:transform .16s}
.fab{cursor:grab}.fab:hover{transform:scale(1.06)}.fab.dragging{cursor:grabbing;transition:none}
.fab i{width:11px;height:11px;border-radius:50%;border:1.6px solid rgba(255,255,255,.92);display:block}
.card{position:absolute;right:0;bottom:40px;width:238px;border-radius:13px;padding:8px;
      background:var(--panel-bg,#fff);border:1px solid var(--panel-line,#e6e6e6);color:var(--panel-fg,#111);
      box-shadow:0 18px 42px -18px rgba(0,0,0,.5);display:none}
.card.on{display:block}
.tabs{display:flex;gap:2px;padding:2px;margin-bottom:6px;background:var(--panel-hover,rgba(127,127,127,.12));border-radius:8px}
.tabs button{flex:1;font:inherit;font-size:11.5px;padding:4px 0;border:0;border-radius:6px;background:transparent;
             color:inherit;opacity:.62;cursor:pointer}
.tabs button.on{background:var(--panel-bg,#fff);opacity:1;font-weight:500}
.pane{display:none}
.pane.on{display:block}
.row{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:7px;cursor:pointer}
.row:hover{background:var(--panel-hover,rgba(127,127,127,.12))}
.row.on{background:var(--panel-hover,rgba(127,127,127,.12));font-weight:500}
.sw{width:13px;height:13px;border-radius:4px;border:1px solid rgba(127,127,127,.3);flex:none}
.ck{margin-left:auto;font-size:10px;opacity:0}
.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;padding:2px 4px 6px}
.dot{width:100%;aspect-ratio:1;border-radius:6px;cursor:pointer;border:1px solid rgba(127,127,127,.28)}
.dot.on{outline:2px solid var(--panel-fg,#111);outline-offset:1px}
.wgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:2px 4px 6px}
.wt{height:34px;border-radius:6px;cursor:pointer;border:1px solid rgba(127,127,127,.25);position:relative}
.wt.on{outline:2px solid var(--panel-fg,#111);outline-offset:1px}
.wt span{position:absolute;left:0;right:0;bottom:2px;text-align:center;font-size:9.5px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.6)}
.field{display:flex;gap:5px;padding:4px 4px 2px}
.field input[type=text]{flex:1;min-width:0;font:inherit;font-size:11px;padding:4px 6px;border-radius:6px;
  border:1px solid var(--panel-line,#e6e6e6);background:transparent;color:inherit}
.btn{font:inherit;font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid var(--panel-line,#e6e6e6);
     background:transparent;color:inherit;cursor:pointer;white-space:nowrap}
.btn:hover{background:var(--panel-hover,rgba(127,127,127,.12))}
.sl{display:flex;align-items:center;gap:7px;padding:3px 6px;font-size:11px;opacity:.85}
.sl input{flex:1;height:3px}
.sl b{width:30px;text-align:right;font-weight:400;opacity:.7}
.ft{margin-top:5px;border-top:1px solid var(--panel-line,#e6e6e6);padding-top:5px}
.hint{padding:2px 6px 6px;font-size:10.5px;opacity:.55;line-height:1.5}
.diag{padding:7px 6px 3px;font-size:10.5px;opacity:.5;line-height:1.5;border-top:1px solid var(--panel-line,#e6e6e6);margin-top:4px}
</style>
<div class="wrap">
  <div class="card" id="card">
    <div class="tabs">
      <button data-tab="theme" class="on">皮肤</button>
      <button data-tab="accent">强调色</button>
      <button data-tab="wall">壁纸</button>
      <button data-tab="pack">包</button>
    </div>
    <div class="pane on" id="pane-theme"><div id="list"></div><div class="diag" id="diag">正在自检…</div></div>
    <div class="pane" id="pane-accent">
      <div class="grid" id="sw"></div>
      <div class="field"><button class="btn" id="rand">随机</button><button class="btn" id="accOff">恢复原色</button></div>
    </div>
    <div class="pane" id="pane-wall">
      <div class="wgrid" id="wg"></div>
      <div class="field"><input type="text" id="wurl" placeholder="图片 URL 或本地路径"><button class="btn" id="wgo">用</button></div>
      <div class="field"><button class="btn" id="wfile">选本地图片</button><button class="btn" id="woff">关闭壁纸</button></div>
      <div class="sl">浓度<input type="range" id="wop" min="0" max="100" step="1"><b id="wopv"></b></div>
      <div class="sl">模糊<input type="range" id="wbl" min="0" max="30" step="1"><b id="wblv"></b></div>
    </div>
    <div class="pane" id="pane-pack">
      <div class="field"><button class="btn" id="mkshare">复制分享码</button><button class="btn" id="mklink">复制分享链接</button></div>
      <div class="field"><button class="btn" id="impshare">粘贴分享码导入</button></div>
      <div class="field"><button class="btn" id="exp">导出 json 到剪贴板</button><button class="btn" id="imp">粘贴 json 导入</button></div>
      <div class="field"><button class="btn" id="dl">下载 .json 文件</button></div>
      <div class="hint">分享码最方便：一串字符，贴到微信/文档都能传。主题包 = 皮肤 + 强调色 + 壁纸。</div>
    </div>
    <div class="ft"><div class="row" data-act="off"><span class="sw" style="background:linear-gradient(135deg,#fff 50%,#333 50%)"></span>还原官方外观<span class="ck" style="opacity:1">✓</span></div></div>
  </div>
  <div class="fab" id="fab"><i></i></div>
</div>`;

    card = sr.getElementById('card');
    fab = sr.getElementById('fab');
    const placeCard = () => {
      if (fabPos.b > window.innerHeight / 2) { card.style.bottom = 'auto'; card.style.top = '40px'; }
      else { card.style.bottom = '40px'; card.style.top = 'auto'; }
    };
    placeCard();

    sr.getElementById('list').innerHTML = Object.keys(payload.themes).map(id =>
      `<div class="row" data-act="theme" data-id="${id}"><span class="sw"></span><span>${payload.themes[id].name}</span><span class="ck">✓</span></div>`
    ).join('');
    sr.getElementById('sw').innerHTML = SWATCHES.map(h =>
      `<div class="dot" data-act="accent" data-v="${h}" style="background:${h}"></div>`).join('');
    sr.getElementById('wg').innerHTML = WALLS.map(w =>
      `<div class="wt" data-act="wall" data-v="${w.id}" style="background:${w.css}"><span>${w.label}</span></div>`).join('');

    let fabDrag = null;
    fab.addEventListener('pointerdown', e => {
      e.stopPropagation();
      fabDrag = { sx: e.clientX, sy: e.clientY, moved: false };
      try { fab.setPointerCapture(e.pointerId); } catch (_) { }
    });
    fab.addEventListener('pointermove', e => {
      if (!fabDrag) return;
      const dx = e.clientX - fabDrag.sx, dy = e.clientY - fabDrag.sy;
      if (!fabDrag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;   // 抖动阈值
      fabDrag.moved = true;
      fab.classList.add('dragging');
      fabPos = clampPos({ r: window.innerWidth - e.clientX - 15, b: window.innerHeight - e.clientY - 15 });
      host.style.right = fabPos.r + 'px';
      host.style.bottom = fabPos.b + 'px';
      placeCard();
      card.classList.remove('on');
    });
    fab.addEventListener('pointerup', () => {
      if (!fabDrag) return;
      const moved = fabDrag.moved;
      fabDrag = null;
      fab.classList.remove('dragging');
      if (moved) {
        try { localStorage.setItem('accio.skin.fab', JSON.stringify(fabPos)); } catch (_) { }
      } else {
        card.classList.toggle('on');       // 没拖动才当点击
      }
    });
    window.addEventListener('resize', () => {
      fabPos = clampPos(fabPos);
      host.style.right = fabPos.r + 'px';
      host.style.bottom = fabPos.b + 'px';
      placeCard();
    });
    card.addEventListener('click', e => {
      const t = e.target.closest('[data-tab]');
      if (t) {
        sr.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b === t));
        sr.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + t.dataset.tab));
        return;
      }
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const act = el.dataset.act;
      if (act === 'off') {
        state.off = true; state.accent = null;
        state.wall = { type: 'none', value: '', opacity: 0.62, blur: 8 };
        save(); render();
      } else if (act === 'theme') { state.off = false; state.theme = el.dataset.id; save(); render(); }
      else if (act === 'accent') { state.off = false; state.accent = el.dataset.v; save(); render(); }
      else if (act === 'wall') {
        const w = WALLS.find(x => x.id === el.dataset.v);
        state.off = false;
        state.wall = Object.assign({}, state.wall, { type: 'gradient', value: w.css });
        save(); render();
      }
    });

    sr.getElementById('rand').addEventListener('click', () => {
      state.off = false;
      const h = Math.floor(Math.random() * 360);
      state.accent = hsl2hex(h, 0.66, 0.6); save(); render();
    });
    sr.getElementById('accOff').addEventListener('click', () => { state.off = false; state.accent = null; save(); render(); });
    sr.getElementById('wgo').addEventListener('click', () => {
      const v = sr.getElementById('wurl').value.trim();
      if (!v) return;
      state.off = false;
      state.wall = Object.assign({}, state.wall, {
        type: 'url',
        value: /^(https?:|file:|data:)/.test(v) ? v : 'file:///' + v.replace(/\\/g, '/')
      });
      save(); render();
    });
    sr.getElementById('woff').addEventListener('click', () => {
      state.wall = Object.assign({}, state.wall, { type: 'none', value: '' }); save(); render();
    });
    sr.getElementById('wfile').addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        shrink(f, url => {
          state.off = false;
          state.wall = Object.assign({}, state.wall, { type: 'url', value: url });
          save(); render();
        });
      };
      inp.click();
    });
    sr.getElementById('wop').addEventListener('input', e => {
      state.wall.opacity = Number(e.target.value) / 100;
      save(); render();
      const dark = document.documentElement.classList.contains('dark');
      const warn = WALL_WARN[dark ? 'dark' : 'light'];
      if (state.wall.opacity < warn) {
        toast('浓度 ' + Math.round(state.wall.opacity * 100) + '%：壁纸更清楚，但文字会比较吃力');
      }
    });
    sr.getElementById('wbl').addEventListener('input', e => { state.wall.blur = Number(e.target.value); save(); render(); });

    sr.getElementById('exp').addEventListener('click', () => { copy(exportPack()); toast('主题包已复制'); });
    sr.getElementById('dl').addEventListener('click', () => {
      const blob = new Blob([exportPack()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'accio-skin-' + state.theme + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    });
    sr.getElementById('mkshare').addEventListener('click', () => {
      makeShareCode()
        .then(c => { copy(c); toast('分享码已复制（' + c.length + ' 字符）'); })
        .catch(e => toast('生成失败：' + e.message));
    });
    sr.getElementById('mklink').addEventListener('click', () => {
      makeShareCode()
        .then(c => { copy(SHARE_BASE + '?share=' + encodeURIComponent(c)); toast('分享链接已复制'); })
        .catch(e => toast('生成失败：' + e.message));
    });
    sr.getElementById('impshare').addEventListener('click', () => {
      navigator.clipboard.readText()
        .then(t => applyShareCode(t))
        .then(n => toast('已导入「' + n + '」'))
        .catch(e => toast('导入失败：' + e.message));
    });

    sr.getElementById('imp').addEventListener('click', () => {
      navigator.clipboard.readText().then(txt => {
        try {
          const p = JSON.parse(txt);
          if (p.schema !== 'accio-theme/1' || !p.tokens) throw new Error('格式不对');
          applyPack(p);
          toast('已导入 ' + (p.name || p.theme || '主题包'));
        } catch (err) { toast('导入失败：' + err.message); }
      }).catch(() => toast('读不到剪贴板'));
    });

    document.addEventListener('click', e => {
      const path = e.composedPath ? e.composedPath() : [];
      if (path.indexOf(host) !== -1) return;
      card.classList.remove('on');
    }, true);

    paint();
  }

  // -------- 辅助 --------
  function hsl2hex(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = n => {
      const k = (n + h / 30) % 12;
      return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
    };
    return r2h([f(0), f(8), f(4)]);
  }
  function shrink(file, cb) {
    const img = new Image();
    const fr = new FileReader();
    fr.onload = () => {
      img.onload = () => {
        const max = 1920;
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * sc) || 1;
        cv.height = Math.round(img.height * sc) || 1;
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        cb(cv.toDataURL('image/jpeg', 0.82));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }
  function copy(txt) {
    try { navigator.clipboard.writeText(txt); } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = txt;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
  }
  let toastEl = null, toastT = 0;
  function toast(msg) {
    if (!sr) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:absolute;right:0;bottom:40px;background:rgba(20,20,24,.94);color:#fff;padding:5px 10px;border-radius:7px;font-size:11px;white-space:nowrap;opacity:0;transition:opacity .2s';
      sr.querySelector('.wrap').appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toastT);
    toastT = setTimeout(() => { toastEl.style.opacity = '0'; }, 1600);
  }

  // -------- 分享码：deflate-raw + base64url，一串字符带走整套皮肤 --------
  const BUILTIN = Object.keys(payload.themes);
  const b64u = u8 => btoa(String.fromCharCode.apply(null, u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = s => {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  };
  async function deflate(str) {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    w.write(new TextEncoder().encode(str));
    w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }
  async function inflate(u8) {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter();
    w.write(u8);
    w.close();
    return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
  }

  const SHARE_BASE = payload.shareBase || 'https://rich4ever-zhong.github.io/accio-skin/preview.html';
  const rawTokens = mode => recolor(payload.themes[state.theme].tokens[mode], mode, state.accent);

  async function makeShareCode() {
    const custom = BUILTIN.indexOf(state.theme) === -1;
    const pack = { v: 1, t: state.theme, n: payload.themes[state.theme].name };
    if (state.accent) pack.a = state.accent;
    const w = state.wall;
    if (w && w.type !== 'none' && w.value) pack.w = [w.type, w.value, w.opacity, w.blur];
    // 自定义主题或改了强调色时，把最终 token 一起带上，保证对方看到完全一致的颜色
    if (custom || state.accent) pack.k = { light: rawTokens('light'), dark: rawTokens('dark') };
    return 'ACCIO1.' + b64u(await deflate(JSON.stringify(pack)));
  }

  async function applyShareCode(code) {
    const s = String(code || '').trim().replace(/\s+/g, '');
    if (s.indexOf('ACCIO1.') !== 0) throw new Error('不是有效的分享码');
    const pack = JSON.parse(await inflate(unb64u(s.slice(7))));
    const id = '__shared';
    if (pack.k) {
      payload.themes[id] = { name: pack.n || '分享的主题', en: id, tokens: pack.k };
      state.theme = id;
      state.accent = null;           // token 里已经算过强调色，不能再叠加一次
    } else if (payload.themes[pack.t]) {
      state.theme = pack.t;
      state.accent = pack.a || null;
    } else {
      throw new Error('分享码里的主题不认识');
    }
    state.off = false;
    state.wall = pack.w
      ? { type: pack.w[0], value: pack.w[1], opacity: pack.w[2], blur: pack.w[3] }
      : { type: 'none', value: '', opacity: 0.62, blur: 8 };
    save(); render();
    return payload.themes[state.theme].name;
  }

  // -------- 主题包导入导出 --------
  function exportPack() {
    return JSON.stringify({
      schema: 'accio-theme/1',
      name: payload.themes[state.theme].name,
      theme: state.theme,
      accent: state.accent,
      wall: state.wall,
      createdAt: new Date().toISOString().slice(0, 10),
      tokens: payload.themes[state.theme].tokens
    }, null, 2);
  }
  function applyPack(p) {
    state.off = false;
    if (p.tokens) {
      const id = p.theme && payload.themes[p.theme] ? p.theme : '__custom';
      payload.themes[id] = { name: p.name || '导入的主题', en: id, tokens: p.tokens };
      state.theme = id;
    }
    if (p.accent !== undefined) state.accent = p.accent;
    if (p.wall) state.wall = Object.assign({}, state.wall, p.wall);
    save(); render();
  }

  // -------- 刷新控件（面板配色跟随当前 token） --------
  function paint() {
    if (!sr || !card) return;
    const cs = getComputedStyle(document.documentElement);
    const pick = (n, fb) => (cs.getPropertyValue(n) || '').trim() || fb;
    card.style.setProperty('--panel-bg', pick('--color-bg-container-value', '#fff'));
    card.style.setProperty('--panel-fg', pick('--color-text-primary-value', '#111'));
    card.style.setProperty('--panel-line', pick('--color-border-value', '#e6e6e6'));
    card.style.setProperty('--panel-hover', 'rgba(127,127,127,.14)');
    fab.style.background = pick('--color-primary-value', '#1ead6f');

    sr.querySelectorAll('[data-act="theme"]').forEach(row => {
      const on = !state.off && row.dataset.id === state.theme;
      row.classList.toggle('on', on);
      row.querySelector('.ck').style.opacity = on ? '1' : '0';
      const p = payload.themes[row.dataset.id];
      if (!p) return;
      const sw = row.querySelector('.sw');
      sw.style.background = p.tokens.dark.primary;
      sw.style.borderColor = p.tokens.light.border;
    });
    sr.querySelectorAll('[data-act="accent"]').forEach(d => {
      d.classList.toggle('on', String(d.dataset.v).toLowerCase() === String(state.accent || '').toLowerCase());
    });
    sr.querySelectorAll('[data-act="wall"]').forEach(d => {
      const w = WALLS.find(x => x.id === d.dataset.v);
      d.classList.toggle('on', state.wall.type === 'gradient' && state.wall.value === w.css);
    });
    const op = sr.getElementById('wop'), bl = sr.getElementById('wbl');
    if (op) { op.value = Math.round(state.wall.opacity * 100); sr.getElementById('wopv').textContent = op.value + '%'; }
    if (bl) { bl.value = state.wall.blur; sr.getElementById('wblv').textContent = bl.value; }

    const dg = sr.getElementById('diag');
    if (dg) {
      const d = window.__accioSkin && window.__accioSkin.diag;
      if (!d) dg.textContent = '正在自检…';
      else if (d.missing.length) {
        dg.textContent = '适配 ' + (d.expected - d.missing.length) + '/' + d.expected + ' · 缺 ' + d.missing.length + ' 项 · Accio ' + d.accio;
        dg.title = '未解析到：' + d.missing.join(', ');
      } else {
        dg.textContent = '适配 ' + d.expected + '/' + d.expected + ' · Accio ' + d.accio;
        dg.title = '全部 token 正常';
      }
    }
  }

  // -------- 挂载时机 --------
  // 自检：49 个 token 是否都能在页面上解析出来。Accio 升级改名时，这里会先报警。
  function runDiag() {
    const cs = getComputedStyle(document.documentElement);
    const sample = payload.themes[state.theme].tokens.light;
    const keys = Object.keys(sample);
    const missing = keys.filter(k => !(cs.getPropertyValue('--color-' + k + '-value') || '').trim());
    const d = { expected: keys.length, missing, accio: payload.accioVersion || 'unknown', at: new Date().toISOString() };
    window.__accioSkin.diag = d;
    if (missing.length) console.warn('[accio-skin] 未解析到的 token（Accio 可能改过名）：' + missing.join(','));
    if (sr && card) { try { paint(); } catch (e) { } }
    return d;
  }

  function whenBody(fn) {
    if (document.body) return fn();
    let n = 0;
    const t = setInterval(() => {
      if (document.body) { clearInterval(t); fn(); }
      else if (++n > 250) clearInterval(t);
    }, 40);
  }

  window.__accioSkin = {
    version: VERSION, payload, state,
    reapply: () => { try { render(); } catch (e) { } },
    setTheme: id => { if (payload.themes[id]) { state.off = false; state.theme = id; save(); render(); } },
    makeCode: () => makeShareCode(),
    applyCode: c => applyShareCode(c),
    setAccent: v => { state.off = false; state.accent = v || null; save(); render(); },
    setOff: () => {
      state.off = true; state.accent = null;
      state.wall = { type: 'none', value: '', opacity: 0.62, blur: 8 };
      save(); render();
    },
    setWall: (type, value, opacity, blur) => {
      state.off = false;
      state.wall = {
        type, value,
        opacity: opacity === undefined ? state.wall.opacity : opacity,
        blur: blur === undefined ? state.wall.blur : blur
      };
      save(); render();
    }
  };

  render();
  if (payload.panel) whenBody(() => setTimeout(() => {
    try { mountPanel(); } catch (e) { window.__accioSkinPanelError = String((e && e.stack) || e); }
    setTimeout(runDiag, 900);
  }, 400));
}

// ---------- CDP ----------
class CDP {
  constructor(url) { this.url = url; this.seq = 0; this.pending = new Map(); this.closed = false; }
  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const t = setTimeout(() => reject(new Error('WS 连接超时')), 8000);
      ws.addEventListener('open', () => { clearTimeout(t); resolve(this); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(t); reject(new Error('WS 连接失败')); }, { once: true });
      ws.addEventListener('message', ev => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.id && this.pending.has(m.id)) {
          const p = this.pending.get(m.id); this.pending.delete(m.id);
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        }
      });
      ws.addEventListener('close', () => {
        this.closed = true;
        for (const p of this.pending.values()) p.reject(new Error('连接已关闭'));
        this.pending.clear();
      });
    });
  }
  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('连接已关闭'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' 超时')); }
      }, 15000);
    });
  }
  close() { try { this.ws.close(); } catch (e) { } }
}

// ---------- 读 Accio 版本（直接从 app.asar 的 package.json 取，不依赖 App 暴露） ----------
function readAccioVersion(exePath) {
  try {
    const asar = path.join(path.dirname(exePath), 'resources', 'app.asar');
    if (!fs.existsSync(asar)) return null;
    const fd = fs.openSync(asar, 'r');
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(12);
    const jsonBuf = Buffer.alloc(headerSize);
    fs.readSync(fd, jsonBuf, 0, headerSize, 16);
    const header = JSON.parse(jsonBuf.toString('utf8'));
    const entry = header.files && header.files['package.json'];
    if (!entry) { fs.closeSync(fd); return null; }
    const buf = Buffer.alloc(entry.size);
    fs.readSync(fd, buf, 0, entry.size, 16 + headerSize + Number(entry.offset));
    fs.closeSync(fd);
    return JSON.parse(buf.toString('utf8')).version || null;
  } catch (e) { return null; }
}

// ---------- 分享页地址（fork 后可用 --share-base 或环境变量覆盖） ----------
const SHARE_BASE = String(
  args['share-base'] ||
  process.env.ACCIO_SKIN_SHARE_BASE ||
  'https://rich4ever-zhong.github.io/accio-skin/preview.html'
);

// ---------- 进程 / 端口 ----------
async function debugAlive() {
  try {
    const r = await fetch(BASE + '/json/version', { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}
function accioRunning() {
  return new Promise(res => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq Accio.exe', '/NH'], { windowsHide: true }, (e, stdout) => {
      res(!e && (stdout || '').includes('Accio.exe'));
    });
  });
}
async function listPages() {
  try {
    const r = await fetch(BASE + '/json/list', { signal: AbortSignal.timeout(2500) });
    const all = await r.json();
    return all.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !String(t.url).startsWith('devtools://'));
  } catch (e) { return []; }
}

// ---------- 主流程 ----------
const themes = loadThemes();
const accioVersion = readAccioVersion(findAccio() || '');
const payload = { themes, def: THEME, panel: WITH_PANEL, shareBase: SHARE_BASE, accioVersion };
const bootSrc = `(${bootstrap.toString()})(${JSON.stringify(payload)})`;

let PKG = {};
try { PKG = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')); } catch (e) { }
log(c.b('Accio Skin') + c.dim(` · v${PKG.version || '?'} · 默认 ${themes[THEME].name} · 端口 ${PORT}`));

if (args.list) {
  const pages = await listPages();
  if (!pages.length) log(c.warn('没有可用的调试端口，或 Accio 尚未启动'));
  pages.forEach(p => log(`  ${p.type}  ${p.id.slice(0, 8)}  ${p.url}`));
  process.exit(0);
}

let ver = await debugAlive();
if (!ver) {
  if (args.attach) {
    log(c.err(`端口 ${PORT} 上没有调试服务。请先完全退出 Accio，再运行本脚本（或去掉 --attach）。`));
    process.exit(2);
  }
  if (await accioRunning()) {
    log(c.err('Accio 已经在运行，但没开调试端口。'));
    log(c.warn('请完全退出 Accio（含右下角托盘图标）后重跑本脚本 —— 我需要从调试端口启动它。'));
    process.exit(3);
  }
  const exe = findAccio();
  if (!exe) {
    log(c.err('找不到 Accio。用 --exe="C:\\路径\\Accio.exe" 或环境变量 ACCIO_EXE 指定。'));
    process.exit(4);
  }
  log(c.dim(`正在以调试模式启动 Accio…  ${exe}`));
  // 关键：从 Electron / VS Code 这类宿主终端启动时会带 ELECTRON_RUN_AS_NODE=1 与 NODE_OPTIONS，
  // Accio 继承后会把自己当纯 Node 进程，直接 "bad option" 退出，必须剥掉。
  const launchEnv = { ...process.env };
  for (const k of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE', 'ELECTRON_ENABLE_LOGGING', 'NODE_OPTIONS']) {
    delete launchEnv[k];
  }
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`, '--remote-allow-origins=*'], {
    detached: true, stdio: 'ignore', windowsHide: false, env: launchEnv
  });
  child.on('error', e => log(c.err(`拉起 Accio 失败：${e.message}`)));
  child.unref();

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await sleep(700);
    if (await debugAlive()) break;
  }
  if (!(await debugAlive())) {
    log(c.err('等了 60 秒仍没等到调试端口。可能被安全软件拦截，或这个版本不接受该参数。'));
    process.exit(5);
  }
  log(c.ok('调试端口已就绪') + c.dim(`  ${(await debugAlive())['Browser'] || ''}`));
}

const sessions = new Map(); // targetId -> { cdp, url }

async function attach(page) {
  if (sessions.has(page.id)) return;
  let cdp;
  try {
    cdp = await new CDP(page.webSocketDebuggerUrl).open();
    await cdp.send('Page.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: bootSrc });
    await cdp.send('Runtime.evaluate', { expression: bootSrc, awaitPromise: false });
    sessions.set(page.id, { cdp, url: page.url });
    log(c.ok('已注入') + c.dim(`  ${page.url.slice(0, 70)}`));
  } catch (e) {
    try { cdp && cdp.close(); } catch (_) { }
    log(c.warn(`注入失败：${e.message}`));
  }
}

log(c.dim('等待 Accio 窗口…'));
let pages = [];
const waitUntil = Date.now() + 45000;
while (Date.now() < waitUntil) {
  pages = await listPages();
  if (pages.length) break;
  await sleep(600);
}
if (!pages.length) {
  log(c.err('没发现任何页面目标。Accio 可能卡在启动阶段，先看看窗口是否正常打开。'));
  process.exit(6);
}

for (const p of pages) await attach(p);

if (SHOT) {
  await sleep(3000);
  const p = (await listPages()).sort((a, b) => a.url.length - b.url.length)[0];
  const s = sessions.get(p.id);
  if (!s) { log(c.err('截图失败：没有可用会话')); process.exit(7); }
  const sc = s.cdp;
  try {
    await sc.send('Page.bringToFront');
    await sleep(800);
    const { data } = await sc.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(SHOT, Buffer.from(data, 'base64'));
    log(c.ok('截图已保存') + c.dim('  ' + SHOT));
  } catch (e) {
    log(c.err('截图失败：' + e.message));
  }
  for (const s2 of sessions.values()) s2.cdp.close();
  process.exit(0);
}

// ---------- 本地控制通道（给托盘调用，只绑 127.0.0.1） ----------
const CONTROL = Number(args.control || 9770);

async function evalInMain(expr) {
  let best = null;
  for (const [, s] of sessions) {
    if (s.cdp.closed) continue;
    if (!best || String(s.url).length < String(best.url).length) best = s;
  }
  if (!best) return null;
  try {
    const r = await best.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

function startControl() {
  const server = http.createServer(async (req, res) => {
    const send = obj => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    const url = new URL(req.url, 'http://127.0.0.1');
    const path0 = url.pathname.replace(/^\/+|\/+$/g, '');
    const ids = Object.keys(themes);

    try {
      if (path0 === 'status') {
        const raw = await evalInMain('window.__accioSkin ? JSON.stringify({theme:window.__accioSkin.state.theme,off:window.__accioSkin.state.off,accent:window.__accioSkin.state.accent,wall:window.__accioSkin.state.wall.type}) : null');
        const st = raw ? JSON.parse(raw) : null;
        const diagRaw = await evalInMain('window.__accioSkin && window.__accioSkin.diag ? JSON.stringify(window.__accioSkin.diag) : null');
        const diag = diagRaw ? JSON.parse(diagRaw) : null;
        return send({
          ok: !!st,
          theme: st ? st.theme : null,
          name: st && themes[st.theme] ? themes[st.theme].name : null,
          off: st ? st.off : null,
          accent: st ? st.accent : null,
          wall: st ? st.wall : null,
          themes: ids.map(id => ({ id, name: themes[id].name })),
          pages: sessions.size,
          diag
        });
      }
      if (path0 === 'next') {
        const raw = await evalInMain('window.__accioSkin ? window.__accioSkin.state.theme : null');
        const i = Math.max(0, ids.indexOf(raw));
        const next = ids[(i + 1) % ids.length];
        await evalInMain(`window.__accioSkin && window.__accioSkin.setTheme(${JSON.stringify(next)})`);
        return send({ ok: true, theme: next, name: themes[next].name });
      }
      if (path0.startsWith('theme')) {
        const id = url.searchParams.get('id') || path0.split('/')[1] || '';
        if (!themes[id]) return send({ ok: false, error: 'unknown theme', themes: ids });
        await evalInMain(`window.__accioSkin && window.__accioSkin.setTheme(${JSON.stringify(id)})`);
        return send({ ok: true, theme: id, name: themes[id].name });
      }
      if (path0 === 'panel') {
        const r = await evalInMain(`(function(){var h=document.getElementById('__accio_skin_host');if(!h)return false;var c=h.shadowRoot.getElementById('card');c.classList.toggle('on');return c.classList.contains('on')})()`);
        return send({ ok: true, open: r });
      }
      if (path0 === 'off') {
        await evalInMain('window.__accioSkin && window.__accioSkin.setOff()');
        return send({ ok: true, off: true });
      }
      return send({ ok: false, error: 'unknown route', routes: ['status', 'next', 'theme?id=', 'panel', 'off'] });
    } catch (e) {
      return send({ ok: false, error: String(e.message || e) });
    }
  });
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') log(c.warn(`控制端口 ${CONTROL} 已被占用（可能已有另一个注入器在跑），托盘控制不可用`));
    else log(c.warn('控制服务启动失败：' + e.message));
  });
  server.listen(CONTROL, '127.0.0.1', () => log(c.dim(`控制通道：http://127.0.0.1:${CONTROL}/status`)));
}

if (!args['no-control']) startControl();

log('');
log(c.ok('皮肤已生效') + c.dim('  右下角悬浮圆点 → 皮肤 / 强调色 / 壁纸 / 主题包'));
log(c.dim('保持这个窗口开着，刷新或切页会自动重新注入；关掉本窗口后样式保留到 Accio 重启。'));
log(c.dim('按 Ctrl+C 退出监听。'));

setInterval(async () => {
  const now = await listPages();
  const live = new Set(now.map(p => p.id));
  for (const [id, s] of sessions) {
    if (!live.has(id) || s.cdp.closed) { try { s.cdp.close(); } catch (e) { } sessions.delete(id); }
  }
  for (const p of now) await attach(p);
}, 4000);

process.on('SIGINT', () => {
  log('');
  log(c.dim('已退出监听。样式会保留到 Accio 重启；想彻底还原，点面板里的「还原官方外观」。'));
  for (const s of sessions.values()) s.cdp.close();
  process.exit(0);
});
