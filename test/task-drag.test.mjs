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

const projectsUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href;
const projects = await import(projectsUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));

const P = {
  id: 'p1',
  name: 'P',
  startDate: '2024-05-01',
  dueDate: '2024-05-31',
  tasks: [
    { id: 't1', title: '有区间的', done: false, startDate: '2024-05-01', dueDate: '2024-05-10', subtasks: [{ id: 's1', title: '子任务', done: false }], createdAt: '2024-01-01' },
    { id: 't2', title: '已完成的', done: true, dueDate: '2024-05-20', subtasks: [], createdAt: '2024-01-02' },
    { id: 't3', title: '没时间', done: false, dueDate: null, subtasks: [], createdAt: '2024-01-03' }
  ]
};

test('问题3：taskTimelineBar 支持区间与单点', () => {
  const start = '2024-05-01';
  const end = '2024-05-21';
  assert.deepEqual(projects.taskTimelineBar({ startDate: '2024-05-01', dueDate: '2024-05-11' }, start, end), { left: 0, width: 50 });
  const point = projects.taskTimelineBar({ dueDate: '2024-05-11' }, start, end);
  assert.equal(point.width, 3, '只有截止时间时显示为小点');
  assert.equal(point.left, 47);
});

test('问题3：shiftTaskDates 有区间平移、单点只移截止', () => {
  assert.deepEqual(
    projects.shiftTaskDates({ startDate: '2024-05-01', dueDate: '2024-05-11' }, 2),
    { startDate: '2024-05-03', dueDate: '2024-05-13' }
  );
  assert.deepEqual(
    projects.shiftTaskDates({ dueDate: '2024-05-11' }, 2),
    { dueDate: '2024-05-13' }
  );
});

test('问题3：时间线分为待办/已完成两组且可拖放切换完成', async () => {
  calls.length = 0;
  const tl = projects.buildTaskTimeline(P);
  const boxes = findAllByClass(tl, 'timeline-groupbox');
  assert.equal(boxes.length, 2, '待办 / 已完成 两组');
  assert.ok(findAllByClass(tl, 'timeline-bar').length >= 2, '应有时间条');
  assert.ok(findAllByClass(tl, 'timeline-handle').length >= 4, '时间条两端应有把手');

  boxes[1].fire('drop', { preventDefault() {}, dataTransfer: { getData: () => 't1' } });
  await tick();
  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/api/projects/p1/tasks/t1'));
  assert.ok(put, '拖到「已完成」应更新任务');
  assert.deepEqual(put.body, { done: true });
});

test('问题3：看板卡片可拖动切换完成', async () => {
  calls.length = 0;
  const board = projects.buildTaskBoard(P);
  const cols = findAllByClass(board, 'kanban-col');
  assert.equal(cols.length, 2);
  const card = findAllByClass(cols[0], 'kanban-card')[0];
  assert.equal(card.getAttribute('draggable'), 'true');

  const data = {};
  card.fire('dragstart', { dataTransfer: { setData: (k, v) => { data[k] = v; } } });
  assert.equal(data['text/plain'], 't1');

  cols[1].fire('drop', { preventDefault() {}, dataTransfer: { getData: () => 't1' } });
  await tick();
  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/api/projects/p1/tasks/t1'));
  assert.deepEqual(put.body, { done: true });
});

test('问题3：信息流标题可就地编辑保存', async () => {
  calls.length = 0;
  const feed = projects.buildTaskFeed(P);
  const title = findAllByClass(feed, 'feed-title')[0];
  assert.equal(title.getAttribute('contenteditable'), 'true');
  assert.equal(title.textContent, '有区间的');

  title.textContent = '改后的任务';
  title.dispatchEvent('blur');
  await tick();
  const put = calls.find((c) => c.method === 'PUT' && c.body && Object.prototype.hasOwnProperty.call(c.body, 'title'));
  assert.deepEqual(put.body, { title: '改后的任务' });
});

test('问题3：信息流子任务可拖动切换完成', async () => {
  calls.length = 0;
  const feed = projects.buildTaskFeed(P);
  const post = findAllByClass(feed, 'feed-post')[0];
  const cols = findAllByClass(post, 'kanban-col');
  assert.equal(cols.length, 2, '未完成 / 已完成 两列');

  cols[1].fire('drop', { preventDefault() {}, dataTransfer: { getData: () => 's1' } });
  await tick();
  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/subtasks/s1'));
  assert.ok(put, '应更新子任务');
  assert.deepEqual(put.body, { done: true });
});
