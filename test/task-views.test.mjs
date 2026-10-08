import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/page/p1' };
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });

const projectsUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href;
const projects = await import(projectsUrl);

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const P = {
  id: 'p1',
  name: 'P',
  startDate: '2024-05-01',
  dueDate: '2024-05-31',
  tasks: [
    { id: 't1', title: '有时间的', done: false, dueDate: '2024-05-10', subtasks: [{ id: 's1', title: '子任务', done: true }], createdAt: '2024-01-01' },
    { id: 't2', title: '已完成的', done: true, dueDate: '2024-05-20', subtasks: [], createdAt: '2024-01-02' },
    { id: 't3', title: '没时间', done: false, dueDate: null, subtasks: [], createdAt: '2024-01-03' }
  ]
};

test('问题2：任务提供四种视图（表格/时间线/看板/信息流）', () => {
  assert.deepEqual(projects.TASK_VIEWS.map((v) => v.label), ['表格', '时间线', '看板', '信息流']);
});

test('问题2：表格视图含 完成/任务/时间/状态/子任务 列', () => {
  const table = projects.buildTaskTable(P);
  const headers = findAllByTag(table, 'th').map((t) => textOf(t));
  for (const col of ['完成', '任务', '时间', '状态', '子任务']) {
    assert.ok(headers.includes(col), `缺少列：${col}`);
  }
  assert.equal(findAllByTag(table, 'tr').length, 4, '表头 + 3 条任务');
  const badges = findAllByClass(table, 'badge').map((b) => textOf(b));
  assert.ok(badges.includes('已完成') && badges.includes('未排期'), '应显示状态徽章');
});

test('问题2：时间线视图有日期刻度与时间条', () => {
  const tl = projects.buildTaskTimeline(P);
  assert.ok(findAllByClass(tl, 'timeline-tick-label').length >= 2, '应有顶部日期刻度');
  assert.ok(findAllByClass(tl, 'timeline-axis').length === 1, '应有时间轴');
  assert.equal(findAllByClass(tl, 'timeline-bar').length, 2, '两条有时间的任务各一条时间条');
});

test('问题2：时间线在范围内显示今日红线', () => {
  const tl = projects.buildTaskTimeline(P);
  const t = todayStr();
  const inRange = t >= '2024-05-01' && t <= '2024-05-31';
  assert.equal(findAllByClass(tl, 'timeline-today').length, inRange ? 2 : 0);
});

test('问题2：看板视图分为待办/已完成两列', () => {
  const board = projects.buildTaskBoard(P);
  const cols = findAllByClass(board, 'kanban-col');
  assert.equal(cols.length, 2);
  assert.equal(findAllByClass(cols[0], 'kanban-card').length, 2, '待办 2 条');
  assert.equal(findAllByClass(cols[1], 'kanban-card').length, 1, '已完成 1 条');
});

test('问题2：信息流视图每条任务一张卡片', () => {
  const feed = projects.buildTaskFeed(P);
  assert.equal(findAllByClass(feed, 'feed-post').length, 3);
  const titles = findAllByClass(feed, 'feed-title').map((t) => t.textContent);
  assert.deepEqual(titles, ['有时间的', '已完成的', '没时间'], '按时间排序');
  assert.ok(findAllByClass(feed, 'kanban-col').length >= 2, '每条任务应带子任务看板');
});

test('问题2：taskIsOverdue 只按日期判断', () => {
  assert.equal(projects.taskIsOverdue({ dueDate: '2024-01-01', done: false }, '2024-06-01'), true);
  assert.equal(projects.taskIsOverdue({ dueDate: '2024-01-01', done: true }, '2024-06-01'), false);
  assert.equal(projects.taskIsOverdue({ dueDate: null, done: false }, '2024-06-01'), false);
  assert.equal(projects.taskIsOverdue({ dueDate: '2024-12-01', done: false }, '2024-06-01'), false);
});

test('问题2：sortTasksForFeed 有时间的在前、无时间的在后', () => {
  assert.deepEqual(projects.sortTasksForFeed(P.tasks).map((t) => t.id), ['t1', 't2', 't3']);
});
