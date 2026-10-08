import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({
    url: String(url),
    method: opts.method || 'GET',
    body: opts.body ? JSON.parse(opts.body) : null
  });
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const projectsUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href;
const { buildProjectBoard } = await import(projectsUrl);

test('问题5：卡片设为可拖拽并携带项目 id', () => {
  const board = buildProjectBoard([{ id: 'pX', name: 'X', status: 'active', tasks: [] }]);
  const card = findAllByClass(board, 'kanban-card')[0];
  assert.ok(card, '看板应有卡片');
  assert.equal(card.getAttribute('draggable'), 'true');
  const data = {};
  card.dispatchEvent('dragstart', { dataTransfer: { setData: (k, v) => { data[k] = v; } } });
  assert.equal(data['text/plain'], 'pX');
});

test('问题5：把卡片拖到其它列会更新项目状态', async () => {
  const board = buildProjectBoard([{ id: 'p1', name: '项目A', status: 'active', tasks: [] }]);
  const cols = findAllByClass(board, 'kanban-col');
  const active = cols.find((c) => c.className.includes('board-col-active'));
  const paused = cols.find((c) => c.className.includes('board-col-paused'));
  assert.ok(active && paused, '应存在进行中与暂停两列');
  assert.equal(findAllByClass(active, 'kanban-card').length, 1, '进行中列应有 1 张卡片');

  paused.dispatchEvent('drop', { preventDefault() {}, dataTransfer: { getData: () => 'p1' } });
  await new Promise((r) => setTimeout(r, 10));

  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/api/projects/p1'));
  assert.ok(put, '应发起 PUT 更新状态');
  assert.deepEqual(put.body, { status: 'paused' });
});

test('问题5：空列作为拖放目标存在', () => {
  const board = buildProjectBoard([{ id: 'p1', name: 'A', status: 'active', tasks: [] }]);
  const done = findAllByClass(board, 'kanban-col').find((c) => c.className.includes('board-col-done'));
  assert.ok(done, '完成列应存在');
  assert.equal(findAllByClass(done, 'kanban-card').length, 0, '完成列暂无卡片');
});
