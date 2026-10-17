// 主题包生成器：把挑色台里的 8 套预设固化成 .accio-theme.json
// 用法：node build-themes.mjs
// 产出：themes/<id>.accio-theme.json（每套含 light / dark 各 49 个颜色 token）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const hex2rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const rgb2hex = a => '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((v, i) => v + (B[i] - v) * t)); };
const alpha = (a, o) => `rgba(${hex2rgb(a).join(',')},${o})`;

export const PRESETS = [
  { id: 'abyss', name: '沉静蓝', en: 'abyss', desc: '冷静克制的靛蓝，深蓝底 + 冷靛主色',
    light: { bg: '#fbfcff', layout: '#f1f4fb', container: '#ffffff', surface: '#f6f8fe', text: '#141a2b', text2: '#5d6884', border: '#dfe5f2', primary: '#2f52d8', pfg: '#ffffff', accent: '#edf1fe' },
    dark: { bg: '#0a0d16', layout: '#05070d', container: '#111527', surface: '#0d1020', text: '#e6eaf5', text2: '#96a1bd', border: '#202741', primary: '#6f8dff', pfg: '#080d1c', accent: '#1a2140' } },
  { id: 'aurora', name: '极光青', en: 'aurora', desc: '清冽通透的青绿，高饱和主色',
    light: { bg: '#fbfefd', layout: '#eef8f5', container: '#ffffff', surface: '#f4fbf9', text: '#0f211d', text2: '#55736c', border: '#d8eae4', primary: '#0b7f69', pfg: '#ffffff', accent: '#e3f7ef' },
    dark: { bg: '#06110f', layout: '#030b09', container: '#0c1c18', surface: '#081614', text: '#e2f5ef', text2: '#85a9a1', border: '#17332c', primary: '#35e0b0', pfg: '#03211a', accent: '#0f2620' } },
  { id: 'nebula', name: '星云紫', en: 'nebula', desc: '深邃漫射的紫，夜感最强',
    light: { bg: '#fdfbff', layout: '#f5f1fe', container: '#ffffff', surface: '#faf7ff', text: '#1d1730', text2: '#6b5f8a', border: '#e7e0f7', primary: '#6d3fe0', pfg: '#ffffff', accent: '#f0eafe' },
    dark: { bg: '#0b0816', layout: '#060410', container: '#17102a', surface: '#110b1f', text: '#ece6fb', text2: '#a294c4', border: '#2b2147', primary: '#b18cff', pfg: '#150c2b', accent: '#221a3d' } },
  { id: 'ember', name: '余烬橙', en: 'ember', desc: '温暖克制的琥珀，暖底不发黄',
    light: { bg: '#fffdf9', layout: '#faf3ea', container: '#ffffff', surface: '#fdf8f1', text: '#20180f', text2: '#7c6a55', border: '#efe1cd', primary: '#b45510', pfg: '#ffffff', accent: '#fdefdb' },
    dark: { bg: '#110d09', layout: '#0a0705', container: '#1d1610', surface: '#15100b', text: '#f7ede1', text2: '#bda48d', border: '#352a1e', primary: '#ffa54f', pfg: '#241406', accent: '#2a1d12' } },
  { id: 'midnight', name: '午夜黑', en: 'midnight', desc: '纯黑 OLED，零色彩干扰',
    light: { bg: '#fcfcfc', layout: '#f2f2f3', container: '#ffffff', surface: '#f8f8f8', text: '#131314', text2: '#6a6a70', border: '#e3e3e5', primary: '#1a1a1c', pfg: '#ffffff', accent: '#ededef' },
    dark: { bg: '#000000', layout: '#000000', container: '#0d0d0f', surface: '#080809', text: '#f4f4f5', text2: '#9b9ba1', border: '#26262a', primary: '#f4f4f5', pfg: '#0a0a0b', accent: '#1a1a1c' } },
  { id: 'ivory', name: '极简白', en: 'ivory', desc: 'iOS 暖白 + 系统蓝，最像原生',
    light: { bg: '#fdfcf9', layout: '#f4f1ec', container: '#ffffff', surface: '#faf8f4', text: '#1a1917', text2: '#6c6a64', border: '#e6e2da', primary: '#0062cc', pfg: '#ffffff', accent: '#edf2fb' },
    dark: { bg: '#1b1b1d', layout: '#101012', container: '#262629', surface: '#202023', text: '#f2f2f7', text2: '#9a9aa2', border: '#37373c', primary: '#4da3ff', pfg: '#07192b', accent: '#1e2733' } },
  { id: 'mist', name: '干净明亮', en: 'mist', desc: '清透玻璃，浅色模式最透气',
    light: { bg: '#fcfefe', layout: '#ecf5f7', container: '#ffffff', surface: '#f3fafb', text: '#12262b', text2: '#55707a', border: '#d6e8ec', primary: '#0b7d94', pfg: '#ffffff', accent: '#e5f4f7' },
    dark: { bg: '#0a1315', layout: '#050d0f', container: '#102022', surface: '#0c181a', text: '#e6f2f4', text2: '#8fa8ad', border: '#1d3134', primary: '#43c6dc', pfg: '#04232a', accent: '#10262a' } },
  { id: 'rose', name: '材质粉', en: 'rose', desc: 'Material 粉，明快但不刺眼',
    light: { bg: '#fffbfc', layout: '#fdf1f4', container: '#ffffff', surface: '#fef7f9', text: '#231a1c', text2: '#7e6469', border: '#f1dde2', primary: '#c2185b', pfg: '#ffffff', accent: '#fdeaf1' },
    dark: { bg: '#120b0e', layout: '#0b0507', container: '#1f1419', surface: '#171013', text: '#f8eaee', text2: '#bb9ba1', border: '#37242a', primary: '#ff7ba6', pfg: '#2a0713', accent: '#2a181d' } }
];

export function build(a, mode) {
  const dark = mode === 'dark';
  const to = (c, t) => mix(c, dark ? '#ffffff' : '#000000', t);
  const back = (c, t) => mix(c, a.bg, t);
  return {
    'primary': a.primary,
    'primary-dark': to(a.primary, dark ? .14 : .16),
    'primary-foreground': a.pfg,
    'primary-bg': mix(a.primary, a.bg, dark ? .82 : .90),
    'high-contrast': a.text,
    'high-contrast-foreground': a.bg,
    'text-primary': a.text,
    'text-secondary': a.text2,
    'text-tertiary': back(a.text2, dark ? .42 : .58),
    'text-quaternary': to(a.text2, dark ? .12 : .06),
    'input-placeholder': back(a.text2, dark ? .28 : .30),
    'background': a.bg,
    'bg-layout': a.layout,
    'bg-container': a.container,
    'agent-hub-banner-green': mix(a.primary, a.bg, dark ? .86 : .93),
    'agent-hub-banner-blue': mix('#3b82f6', a.bg, dark ? .88 : .94),
    'layer-surface': mix(a.surface, a.bg, .4),
    'layer-background-dim': back(a.text, dark ? .12 : .05),
    'layer-container-dimer': back(a.text, dark ? .18 : .09),
    'bg-chip': back(a.text2, dark ? .78 : .88),
    'foreground': a.text,
    'sidebar-item-hover': alpha(a.text, dark ? .09 : .05),
    'sidebar-nav-foreground': back(a.text, dark ? .28 : .18),
    'sidebar-nav-active-foreground': a.text,
    'sidebar-session-title': back(a.text, dark ? .22 : .16),
    'sidebar-session-title-archived': back(a.text, dark ? .58 : .55),
    'destructive': dark ? '#ff6b6b' : '#e52828',
    'destructive-foreground': '#ffffff',
    'success': dark ? '#3fbf7f' : '#22891f',
    'warning': dark ? '#ffa733' : '#f88000',
    'info': dark ? '#7aa8ff' : '#2f6fd0',
    'expert-author': mix(a.primary, '#3b82f6', .45),
    'badge-success-text': dark ? '#4ecf8f' : mix('#1f8f5f', a.primary, .25),
    'badge-success-bg': mix('#22891f', a.bg, dark ? .84 : .92),
    'badge-warning-text': dark ? '#ffb259' : '#c47100',
    'badge-warning-bg': mix('#f0870a', a.bg, dark ? .84 : .90),
    'chat-cta-bg': mix(a.primary, a.bg, dark ? .80 : .90),
    'chat-cta-bg-hover': mix(a.primary, a.bg, dark ? .72 : .83),
    'store-gate-edge': back(a.border, .35),
    'store-gate-arrow': mix(a.primary, a.bg, dark ? .78 : .88),
    'surface': a.surface,
    'muted': a.layout,
    'muted-foreground': a.text2,
    'border': a.border,
    'border-subtle': back(a.border, .45),
    'border-divider': back(a.border, .25),
    'border-strong': back(a.text2, .38),
    'accent': a.accent,
    'accent-foreground': a.text
  };
}

const outDir = path.join(__dirname, 'themes');
fs.mkdirSync(outDir, { recursive: true });

let n = 0;
for (const p of PRESETS) {
  const pack = {
    schema: 'accio-theme/1',
    id: p.id,
    name: p.name,
    en: p.en,
    desc: p.desc,
    author: 'Rich4ever',
    createdAt: new Date().toISOString().slice(0, 10),
    target: 'Accio Work 0.34.x (Electron / app.asar out/renderer)',
    tokens: {
      light: build(p.light, 'light'),
      dark: build(p.dark, 'dark')
    }
  };
  fs.writeFileSync(path.join(outDir, p.id + '.accio-theme.json'), JSON.stringify(pack, null, 2), 'utf8');
  n++;
}
// ---------- 对比度自检（WCAG）----------
const lum = hex => {
  const [r, g, b] = hex2rgb(hex).map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const L1 = lum(a), L2 = lum(b);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
};
const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

console.log('');
console.log('对比度自检（WCAG AA 正文需 ≥ 4.5，大字/图形需 ≥ 3）');
let warnCount = 0;
for (const p of PRESETS) {
  const rows = [];
  for (const mode of ['light', 'dark']) {
    const t = build(p[mode], mode);
    const pairs = [
      ['正文/背景', t['text-primary'], t['background']],
      ['次要文/卡片', t['text-secondary'], t['bg-container']],
      ['主色按钮字', t['primary-foreground'], t['primary']]
    ];
    for (const [label, fg, bg] of pairs) {
      if (!isHex(fg) || !isHex(bg)) continue;
      const r = ratio(fg, bg);
      const bad = r < (label === '次要文/卡片' ? 4.5 : 4.5);
      if (bad) warnCount++;
      rows.push(`${mode === 'light' ? '浅' : '深'}${label} ${r.toFixed(2)}${bad ? ' ✗' : ''}`);
    }
  }
  console.log(`  ${p.id.padEnd(9)} ${rows.join(' · ')}`);
}
console.log(warnCount ? `\n有 ${warnCount} 项低于 4.5，建议微调（不影响使用，但长文阅读会累）` : '\n全部达标');
console.log(`已生成 ${n} 套主题包 → ${outDir}`);
console.log('token 数：' + Object.keys(build(PRESETS[0].light, 'light')).length + ' × 2 (light/dark)');
