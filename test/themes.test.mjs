// 主题包结构与对比度门禁
// 运行：npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const themesDir = path.join(root, 'themes');

const files = fs.readdirSync(themesDir).filter(f => f.endsWith('.accio-theme.json'));
const packs = files.map(f => ({ file: f, pack: JSON.parse(fs.readFileSync(path.join(themesDir, f), 'utf8')) }));

const hex2rgb = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const lum = hex => {
  const [r, g, b] = hex2rgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

test('至少 8 套主题，文件名与 id 一致', () => {
  assert.ok(packs.length >= 8, `只有 ${packs.length} 套`);
  for (const { file, pack } of packs) {
    assert.equal(file, pack.id + '.accio-theme.json');
    assert.equal(pack.schema, 'accio-theme/1');
    assert.ok(pack.name && pack.en, `${pack.id} 缺 name/en`);
  }
});

test('每套主题有完整的 49×2 颜色 token', () => {
  for (const { pack } of packs) {
    for (const mode of ['light', 'dark']) {
      const t = pack.tokens[mode];
      assert.ok(t, `${pack.id} 缺 ${mode}`);
      assert.equal(Object.keys(t).length, 49, `${pack.id}/${mode} token 数不对`);
      for (const [k, v] of Object.entries(t)) {
        assert.equal(typeof v, 'string', `${pack.id}/${mode}/${k} 不是字符串`);
        assert.ok(v.trim().length > 0, `${pack.id}/${mode}/${k} 是空值`);
      }
    }
    assert.deepEqual(Object.keys(pack.tokens.light).sort(), Object.keys(pack.tokens.dark).sort(),
      `${pack.id} 明暗两套 token 名不一致`);
  }
});

test('颜色取值都是合法 hex', () => {
  const hex = /^#[0-9a-f]{6}$/i;
  for (const { pack } of packs) {
    for (const mode of ['light', 'dark']) {
      for (const [k, v] of Object.entries(pack.tokens[mode])) {
        if (k === 'sidebar-item-hover') continue; // 这个刻意用 rgba
        assert.match(v, hex, `${pack.id}/${mode}/${k} = ${v} 不是 hex`);
      }
    }
  }
});

test('正文对比度全部 ≥ 4.5（WCAG AA）', () => {
  const pairs = [
    ['text-primary', 'background', '正文/背景'],
    ['text-secondary', 'bg-container', '次要文字/卡片'],
    ['primary-foreground', 'primary', '主按钮字/主色']
  ];
  const bad = [];
  for (const { pack } of packs) {
    for (const mode of ['light', 'dark']) {
      const t = pack.tokens[mode];
      for (const [fg, bg, label] of pairs) {
        const r = contrast(t[fg], t[bg]);
        if (r < 4.5) bad.push(`${pack.id}/${mode} ${label} = ${r.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(bad, [], '以下组合低于 4.5：\n' + bad.join('\n'));
});

test('8 套预设彼此的主色不重复', () => {
  const primaries = packs.map(p => p.pack.tokens.dark.primary.toLowerCase());
  assert.equal(new Set(primaries).size, primaries.length, '有主题主色撞车：' + primaries.join(','));
});
