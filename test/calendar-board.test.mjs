import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByTag, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr, addDays } from '../public/js/utils.js';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/today' };

const TODAY = todayStr();
const calendarUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'calendar.js')).href;
const todayUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'today.js')).href;
const cal = await import(calendarUrl);
const todayMod = await import(todayUrl);

const WEEK = cal.weekDates(TODAY, 'mon');
// 取两个"不是今天"的日期，避免和默认选中的今天混淆
const OTHERS = WEEK.filter((d) => d !== TODAY);
const D1 = OTHERS[0];
const D2 = OTHERS[1];

const PROJECTS = [{
  id: 'p1', name: '项目一', icon: '📁', status: 'active', dateFormat: 'iso', blocks: [],
  tasks: [{ id: 't1', title: '项目任务', dueDate: D1, subtasks: [] }]
}];

const DAY_TASKS = [
  { id: 'd1', title: '每日任务A', date: TODAY, time: '08:00', priority: 'high', done: false },
  { id: 'd2', title: '每日任务B', date: TODAY, time: '10:00', priority: 'low', done: true },
  { id: 'd3', title: '每日任务C', date: D1, time: '09:00', priority: 'medium', done: false }
];

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
  if (u.includes('/api/preferences')) return { ok: true, status: 200, json: async () => ({ weekStart: 'mon' }) };
  if (u.includes('/api/projects')) return { ok: true, status: 200, json: async () => PROJECTS };
  if (u.includes('/api/tasks?from=')) {
    const from = /from=([\d-]+)/.exec(u)[1];
    const to = /to=([\d-]+)/.exec(u)[1];
    return { ok: true, status: 200, json: async () => DAY_TASKS.filter((t) => t.date >= from && t.date <= to) };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const tick = () => new Promise((r) => setTimeout(r, 10));
const cellOf = (root, date) => findAllByClass(root, 'cal-col').concat(findAllByClass(root, 'cal-cell'))
  .find((c) => c.dataset.date === date);
const board = (root) => findAllByClass(root, 'cal-board')[0];
const boardCols = (root) => findAllByClass(board(root), 'kanban-col');
const colTitles = (root, i) => findAllByClass(boardCols(root)[i], 'cal-board-card')
  .map((c) => textOf(findAllByClass(c, 'title')[0] || c));

async function renderToday() {
  const el = document.createElement('div');
  await todayMod.render(el);
  const week = findAllByTag(el, 'button').find((b) => textOf(b) === '周视图');
  if (week) week.click();
  await tick();
  return el;
}

// ——— 纯函数 ———

test('问题3：dateBoard 分待办/已完成', () => {
  const entries = [
    { title: 'a', done: false, time: '09:00' },
    { title: 'b', done: true, time: '10:00' },
    { title: 'c', done: false, time: null }
  ];
  const b = cal.dateBoard(entries);
  assert.deepEqual(b.pending.map((e) => e.title), ['a', 'c']);
  assert.deepEqual(b.done.map((e) => e.title), ['b']);
  assert.equal(b.total, 3);
  assert.deepEqual(cal.dateBoard(null), { pending: [], done: [], total: 0 });
});

// ——— 页面 ———

test('问题3：日历下方默认显示"今天"的任务看板', async () => {
  const el = await renderToday();
  const b = board(el);
  assert.ok(b, '应有看板区块');
  assert.ok(textOf(b).includes('的任务看板'));
  assert.deepEqual(boardCols(el).length, 2, '待办 / 已完成两列');
  assert.ok(textOf(findAllByClass(boardCols(el)[0], 'col-head')[0]).includes('待办'));
  assert.ok(textOf(findAllByClass(boardCols(el)[1], 'col-head')[0]).includes('已完成'));
});

test('问题3：点在日历上选日期，看板跟着换', async () => {
  const el = await renderToday();
  assert.deepEqual(colTitles(el, 0), ['每日任务A'], '默认是今天：只有未完成的每日任务A');
  assert.deepEqual(colTitles(el, 1), ['每日任务B']);

  cellOf(el, D1).click();
  await tick();
  assert.ok(textOf(board(el)).includes(`${Number(D1.slice(5, 7))}月${Number(D1.slice(8, 10))}日`), '看板标题是选中的日期');
  assert.deepEqual(colTitles(el, 0), ['每日任务C', '项目任务'], '换成选中那天的任务（含项目任务）');
  assert.ok(!textOf(board(el)).includes('每日任务A'));

  cellOf(el, D2).click();
  await tick();
  assert.equal(colTitles(el, 0).length, 0, 'D2 没有任务');
  assert.ok(textOf(board(el)).includes('这一天还没有任务'));
});

test('问题3：选中的格子有高亮，未选中的没有', async () => {
  const el = await renderToday();
  cellOf(el, D1).click();
  await tick();
  assert.ok(cellOf(el, D1).classList.contains('selected'));
  assert.equal(cellOf(el, D2).classList.contains('selected'), false);

  cellOf(el, D2).click();
  await tick();
  assert.ok(cellOf(el, D2).classList.contains('selected'));
  assert.equal(cellOf(el, D1).classList.contains('selected'), false);
});

test('问题3：点卡片不会误触"选日期"', async () => {
  const el = await renderToday();
  cellOf(el, D2).click();
  await tick();
  globalThis.location.hash = '#/today';

  // 卡片（今天那一格里的）点击应被卡片自己吞掉，不改变选中日期
  const card = findAllByClass(cellOf(el, D1), 'cal-card')[0];
  card.click();
  await tick();
  assert.ok(cellOf(el, D2).classList.contains('selected'), '选中日期不应被卡片点击改掉');
});

test('问题3：看板里的勾选可以完成/取消', async () => {
  const el = await renderToday();
  cellOf(el, D1).click();
  await tick();
  calls.length = 0;
  findAllByClass(boardCols(el)[0], 'cal-check')[0].click();
  await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, '/api/tasks/d3', '第一条待办是「每日任务C」');
  assert.deepEqual(put.body, { done: true });
});

test('问题3：点看板卡片标题进入对应页面', async () => {
  const el = await renderToday();
  cellOf(el, D1).click();
  await tick();
  globalThis.location.hash = '#/today';
  const projectCard = findAllByClass(boardCols(el)[0], 'cal-board-card').find((c) => textOf(c).includes('项目任务'));
  findAllByClass(projectCard, 'row-link')[0].click();
  assert.equal(globalThis.location.hash, '#/task/p1/t1');
});

test('问题3：没有任务的那天看板显示空态', async () => {
  const el = await renderToday();
  cellOf(el, D2).click();
  await tick();
  assert.ok(textOf(board(el)).includes('这一天还没有任务'));
  assert.equal(colTitles(el, 0).length, 0);
  assert.equal(colTitles(el, 1).length, 0);
});

test('问题3：月视图里点格子也能选日期', async () => {
  const el = await renderToday();
  findAllByTag(el, 'button').find((b) => textOf(b) === '月视图').click();
  await tick();
  cellOf(el, D1).click();
  await tick();
  assert.ok(cellOf(el, D1).classList.contains('cal-cell'));
  assert.ok(cellOf(el, D1).classList.contains('selected'));
  assert.deepEqual(colTitles(el, 0), ['每日任务C', '项目任务'], '看板跟着显示选中那天的任务');
});
