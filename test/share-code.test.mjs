// 分享码编解码：与注入器页内算法保持一致（deflate-raw + base64url，前缀 ACCIO1.）
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = 'ACCIO1.';

const b64u = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = str => Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const encode = pack => PREFIX + b64u(zlib.deflateRawSync(Buffer.from(JSON.stringify(pack), 'utf8')));
const decode = code => {
  const s = String(code || '').trim().replace(/\s+/g, '');
  if (!s.startsWith(PREFIX)) throw new Error('不是有效的分享码');
  return JSON.parse(zlib.inflateRawSync(unb64u(s.slice(PREFIX.length))).toString('utf8'));
};

const preset = JSON.parse(fs.readFileSync(path.join(root, 'themes', 'nebula.accio-theme.json'), 'utf8'));

test('内置预设分享码：只带 id，长度可控', () => {
  const code = encode({ v: 1, t: 'nebula', n: '星云紫' });
  assert.ok(code.startsWith(PREFIX));
  assert.ok(code.length < 120, `短码应该很短，实际 ${code.length}`);
  assert.deepEqual(decode(code), { v: 1, t: 'nebula', n: '星云紫' });
});

test('带强调色与壁纸的分享码往返一致', () => {
  const pack = {
    v: 1, t: 'aurora', n: '极光青',
    a: '#ff7ba6',
    w: ['gradient', 'linear-gradient(150deg,#0f3a4a,#3a1c46)', 0.5, 12]
  };
  assert.deepEqual(decode(encode(pack)), pack);
});

test('全量 token 分享码往返一致，且长度在预期范围', () => {
  const pack = { v: 1, t: '__shared', n: '星云紫', k: preset.tokens };
  const code = encode(pack);
  assert.ok(code.length > 500 && code.length < 3000, `长码长度异常：${code.length}`);
  const back = decode(code);
  assert.deepEqual(back, pack);
  assert.equal(Object.keys(back.k.light).length, 49);
  assert.equal(back.k.dark.primary, preset.tokens.dark.primary);
});

test('中文与特殊字符不会破坏编解码', () => {
  const pack = { v: 1, t: 'custom', n: '我的主题 · 深色 v2', w: ['url', 'file:///C:/图 片/bg.png', 0.62, 8] };
  assert.deepEqual(decode(encode(pack)), pack);
});

test('粘贴时混入换行/空格也能解', () => {
  const pack = { v: 1, t: 'ember', n: '余烬橙' };
  const code = encode(pack);
  const messy = '  ' + code.slice(0, 10) + '\n' + code.slice(10) + '  ';
  assert.deepEqual(decode(messy), pack);
});

test('非法输入必须抛错，而不是返回半个对象', () => {
  assert.throws(() => decode('ACCIO1.@@@@'), /./);
  assert.throws(() => decode('随便什么东西'), /不是有效的分享码/);
  assert.throws(() => decode(''), /不是有效的分享码/);
});

test('注入器里的前缀与算法常量没被改动', () => {
  const src = fs.readFileSync(path.join(root, 'injector.mjs'), 'utf8');
  assert.ok(src.includes("'ACCIO1.'"), '注入器丢了 ACCIO1 前缀');
  assert.ok(src.includes("new CompressionStream('deflate-raw')"), '压缩算法变了，分享码会不兼容');
  assert.ok(src.includes("new DecompressionStream('deflate-raw')"), '解压算法变了');
});
