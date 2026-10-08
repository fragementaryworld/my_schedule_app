import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';

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
const { buildProjectFeed } = await import(projectsUrl);

function feedWithOneProject() {
  return buildProjectFeed([{
    id: 'p1',
    name: '项目A',
    status: 'active',
    goal: '目标1；目标2',
    tasks: [{ id: 't1', title: '任务1', done: false }]
  }]);
}

test('问题6：信息流帖子含编辑按钮与可拖拽任务卡片', () => {
  const feed = feedWithOneProject();
  assert.equal(findAllByClass(feed, 'feed-post').length, 1);
  const btns = findAllByTag(feed, 'button');
  assert.ok(btns.some((b) => textOf(b).includes('编辑')), '应有编辑按钮');

  const cards = findAllByClass(feed, 'kanban-card');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].getAttribute('draggable'), 'true');
});

test('问题6：拖动任务到「已完成」列会标记完成', async () => {
  const feed = feedWithOneProject();
  const cols = findAllByClass(feed, 'kanban-col');
  assert.equal(cols.length, 2, '未完成/已完成两列');
  cols[1].dispatchEvent('drop', { preventDefault() {}, dataTransfer: { getData: () => 't1' } });
  await new Promise((r) => setTimeout(r, 10));

  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/api/projects/p1/tasks/t1'));
  assert.ok(put, '应发起 PUT 更新任务');
  assert.deepEqual(put.body, { done: true });
});

test('问题6：信息流提供添加任务输入框', () => {
  const feed = feedWithOneProject();
  const inputs = findAllByTag(feed, 'input');
  assert.ok(inputs.some((i) => String(i.getAttribute('placeholder') || '').includes('添加任务')), '应有添加任务输入框');
});
