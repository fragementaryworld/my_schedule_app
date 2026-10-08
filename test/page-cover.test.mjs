import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass, findAllByTag } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/page/p1' };

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({
    url: String(url),
    method: opts.method || 'GET',
    body: opts.body ? JSON.parse(opts.body) : null
  });
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const pageUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'page.js')).href;
const { buildCover, buildIconTitle, coverCss, PAGE_ICONS, PAGE_COVERS } = await import(pageUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));

test('增量6：coverCss 映射封面样式', () => {
  assert.ok(coverCss('blue').includes('linear-gradient'));
  assert.equal(coverCss('none'), '');
  assert.equal(coverCss('不存在'), '');
});

test('增量6：图标与封面预设非空', () => {
  assert.ok(PAGE_ICONS.length >= 8);
  assert.ok(PAGE_ICONS.includes('🚀'));
  assert.ok(PAGE_COVERS.length >= 4);
  assert.equal(PAGE_COVERS[0].key, 'none');
});

test('增量6：有封面时渲染封面条', () => {
  const withCover = buildCover({ id: 'p1', name: 'P', cover: 'blue' });
  assert.equal(findAllByClass(withCover, 'page-cover').length, 1);
  const none = buildCover({ id: 'p1', name: 'P', cover: '' });
  assert.equal(findAllByClass(none, 'page-cover').length, 0);
});

test('增量6：点击可展开封面调色板并保存', async () => {
  calls.length = 0;
  const wrap = buildCover({ id: 'p1', name: 'P', cover: '' });
  findAllByTag(wrap, 'button')[0].click();
  const swatches = findAllByClass(wrap, 'cover-swatch');
  assert.equal(swatches.length, PAGE_COVERS.length, '应显示全部封面色块');
  swatches[1].click();
  await tick();
  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/api/projects/p1'));
  assert.ok(put, '应保存封面');
  assert.deepEqual(put.body, { cover: PAGE_COVERS[1].key });
});

test('增量6：点击图标可展开 emoji 选择器并保存', async () => {
  calls.length = 0;
  const head = buildIconTitle({ id: 'p1', name: 'P', icon: '📁' });
  findAllByClass(head, 'page-icon')[0].click();
  const choices = findAllByClass(head, 'icon-choice');
  assert.equal(choices.length, PAGE_ICONS.length, '应显示全部图标');
  choices[0].click();
  await tick();
  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/api/projects/p1'));
  assert.ok(put, '应保存图标');
  assert.deepEqual(put.body, { icon: PAGE_ICONS[0] });
});
