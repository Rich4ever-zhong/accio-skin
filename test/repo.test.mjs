// 仓库完整性：脚本能解析、README 图片不坏链、关键常量还在
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const MODULES = ['injector.mjs', 'build-themes.mjs', 'tools/shoot-docs.mjs'];

test('所有 .mjs 通过 node --check', () => {
  for (const f of MODULES) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' }), `${f} 语法错误`);
  }
});

test('preview.html 的内联脚本能解析', () => {
  const html = read('preview.html');
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(m, '找不到内联 script');
  assert.doesNotThrow(() => new vm.Script(m[1], { filename: 'preview-inline.js' }));
});

test('preview.html 不是被截断的（关键函数都在顶层）', () => {
  const html = read('preview.html');
  for (const fn of ['function b64u', 'function unb64u', 'async function inflate', 'async function loadShare', 'function apply', 'function renderList']) {
    assert.ok(html.includes(fn), `preview.html 缺少 ${fn}`);
  }
  // loadShare 必须在顶层：出现位置应在最后一个点击回调之后
  const clickHandler = html.lastIndexOf("addEventListener('click'");
  assert.ok(html.indexOf('async function loadShare') > clickHandler, 'loadShare 又被插进某个回调里了');
});

test('README 引用的图片都存在', () => {
  const md = read('README.md');
  const refs = [...md.matchAll(/\((docs\/[a-z0-9._-]+\.png)\)/gi)].map(m => m[1]);
  assert.ok(refs.length >= 5, `README 只引用了 ${refs.length} 张图`);
  for (const r of refs) {
    assert.ok(fs.existsSync(path.join(root, r)), `README 引用了不存在的图：${r}`);
  }
});

test('docs 里的图没有孤儿（除了有意的）', () => {
  const md = read('README.md');
  const files = fs.readdirSync(path.join(root, 'docs')).filter(f => f.endsWith('.png'));
  const orphans = files.filter(f => !md.includes('docs/' + f));
  assert.deepEqual(orphans, [], '这些图没被 README 引用：' + orphans.join(', '));
});

test('注入器的关键契约还在', () => {
  const src = read('injector.mjs');
  const must = [
    'const VERSION =',
    'WALL_WARN',
    'ACCIO1.',
    "['ELECTRON_RUN_AS_NODE'",   // 必须剥掉这个环境变量
    'Page.addScriptToEvaluateOnNewDocument',
    'readAccioVersion'
  ];
  for (const m of must) assert.ok(src.includes(m), `injector.mjs 丢了：${m}`);
});

test('托盘脚本含 UTF-8 BOM 且能解析', () => {
  const p = path.join(root, 'tray', 'accio-skin-tray.ps1');
  const buf = fs.readFileSync(p);
  assert.deepEqual([...buf.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'tray 脚本丢了 BOM，中文会乱码');
  const text = buf.toString('utf8');
  for (const m of ['Resolve-Node', 'Start-Injector', 'Invoke-Takeover', 'Get-SkinStatus']) {
    assert.ok(text.includes(m), `托盘脚本缺 ${m}`);
  }
});

test('package.json 版本号格式正确', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.license, 'MIT');
  assert.ok(pkg.scripts.test, '没有 test 脚本');
});
