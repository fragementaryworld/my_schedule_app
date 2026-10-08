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
    priority: 'medium',
    goal: '目标1；目标2',
    tasks: [{ id: 't1', title: '任务1', done: false }]
  }]);
}

test('问题2：不再有单独的编辑按钮', () => {
  const feed = feedWithOneProject();
  const btns = findAllByTag(feed, 'button');
  assert.ok(!btns.some((b) => textOf(b).includes('编辑')), '不应再有编辑按钮');
});

test('问题2：标题可就地编辑并保存', async () => {
  calls.length = 0;
  const feed = feedWithOneProject();
  const title = findAllByClass(feed, 'feed-title')[0];
  assert.ok(title, '应有标题元素');
  assert.equal(title.getAttribute('contenteditable'), 'true');
  assert.equal(title.textContent, '项目A');

  title.textContent = '改名后的项目';
  title.dispatchEvent('blur');
  await new Promise((r) => setTimeout(r, 10));

  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/api/projects/p1'));
  assert.ok(put, '应保存标题');
  assert.deepEqual(put.body, { name: '改名后的项目' });
});

test('问题2：标题清空时回退、不保存', async () => {
  calls.length = 0;
  const feed = feedWithOneProject();
  const title = findAllByClass(feed, 'feed-title')[0];
  title.textContent = '   ';
  title.dispatchEvent('blur');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 0, '空标题不应保存');
  assert.equal(title.textContent, '项目A', '应回退原标题');
});

test('问题2：描述可就地编辑并保存', async () => {
  calls.length = 0;
  const feed = feedWithOneProject();
  const goal = findAllByClass(feed, 'feed-goal')[0];
  assert.ok(goal, '应有描述块');
  assert.equal(goal.getAttribute('contenteditable'), 'true');

  goal.textContent = '新的描述内容';
  goal.dispatchEvent('blur');
  await new Promise((r) => setTimeout(r, 10));

  const put = calls.find((c) => c.method === 'PUT' && c.body && Object.prototype.hasOwnProperty.call(c.body, 'goal'));
  assert.ok(put, '应保存描述');
  assert.deepEqual(put.body, { goal: '新的描述内容' });
});

test('问题2：状态与优先级为就地下拉', () => {
  const feed = feedWithOneProject();
  const selects = findAllByTag(feed, 'select');
  assert.ok(selects.length >= 2, '应有状态与优先级下拉');
  assert.ok(selects.some((s) => String(s.className).includes('inline-select')));
});

test('问题6：拖动任务到「已完成」列会标记完成', async () => {
  calls.length = 0;
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
