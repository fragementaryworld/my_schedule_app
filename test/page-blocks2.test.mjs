import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass } from '../test-helpers/dom-shim.mjs';

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
const { buildBlocksEditor, reorderIds, dropPosition, BLOCK_TYPE_OPTIONS } = await import(pageUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));

test('增量5：reorderIds 前插/后插/非法目标', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(reorderIds(ids, 'c', 'a', true), ['c', 'a', 'b']);
  assert.deepEqual(reorderIds(ids, 'a', 'b', false), ['b', 'a', 'c']);
  assert.deepEqual(reorderIds(ids, 'a', 'zzz', true), ['a', 'b', 'c']);
  assert.deepEqual(reorderIds(ids, 'a', 'b', true), ['a', 'b', 'c']);
});

test('增量5：dropPosition 依中线判断前后', () => {
  assert.equal(dropPosition(10, 0, 100), 'before');
  assert.equal(dropPosition(60, 0, 100), 'after');
  assert.equal(dropPosition(0, 0, 0), 'before');
});

test('增量5：类型选项完整', () => {
  assert.deepEqual(BLOCK_TYPE_OPTIONS.map((o) => o[0]),
    ['text', 'h1', 'h2', 'h3', 'todo', 'bullet', 'number', 'quote', 'divider']);
});

test('增量5：待办勾选切换 checked', async () => {
  calls.length = 0;
  const page = { id: 'p1', name: 'P', blocks: [{ id: 'b1', type: 'todo', text: '待办', checked: false }] };
  const editor = buildBlocksEditor(page);
  const marker = findAllByClass(editor, 'block-marker')[0];
  marker.fire('click');
  await tick();
  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/blocks/b1'));
  assert.ok(put, '应保存勾选状态');
  assert.deepEqual(put.body, { checked: true });
});

test('增量5：切换块类型', async () => {
  calls.length = 0;
  const page = { id: 'p1', name: 'P', blocks: [{ id: 'b1', type: 'text', text: '内容' }] };
  const editor = buildBlocksEditor(page);
  const sel = findAllByClass(editor, 'block-type-select')[0];
  sel.value = 'h2';
  sel.fire('change');
  await tick();
  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/blocks/b1'));
  assert.ok(put, '应保存类型');
  assert.deepEqual(put.body, { type: 'h2' });
});

test('增量5：拖动块到其它块之前重排', async () => {
  calls.length = 0;
  const page = { id: 'p1', name: 'P', blocks: [
    { id: 'b1', type: 'text', text: '一' },
    { id: 'b2', type: 'text', text: '二' },
    { id: 'b3', type: 'text', text: '三' }
  ] };
  const editor = buildBlocksEditor(page);
  const rows = findAllByClass(editor, 'block-row');
  rows[0].fire('drop', { clientY: 0, dataTransfer: { getData: () => 'b3' } });
  await tick();
  const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/blocks') && c.body && c.body.order);
  assert.ok(put, '应保存新顺序');
  assert.deepEqual(put.body.order, ['b3', 'b1', 'b2']);
});

test('增量5：拖到自己身上不重排', async () => {
  calls.length = 0;
  const page = { id: 'p1', name: 'P', blocks: [{ id: 'b1', type: 'text', text: '一' }] };
  const editor = buildBlocksEditor(page);
  findAllByClass(editor, 'block-row')[0].fire('drop', { clientY: 0, dataTransfer: { getData: () => 'b1' } });
  await tick();
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
});
