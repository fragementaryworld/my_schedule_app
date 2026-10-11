import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByTag, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr, addDays } from '../public/js/utils.js';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/today' };

const TODAY = todayStr();
const cal = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'calendar.js')).href);
const todayMod = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'today.js')).href);

const WEEK = cal.weekDates(TODAY, 'mon');
const D1 = WEEK[1];
const D3 = WEEK[3];
const D4 = WEEK[4];
const D5 = WEEK[5];
const COL_W = 100; // 一行 700px / 7 列

const PROJECTS = [{
  id: 'p1', name: '项目一', icon: '📁', status: 'active', dateFormat: 'ymd', blocks: [],
  tasks: [
    { id: 'pt1', title: '跨天项目任务', startDate: D1, dueDate: D3, subtasks: [] },
    { id: 'pt2', title: '单日项目任务', dueDate: D5, subtasks: [] }
  ]
}];

const DAY_TASKS = [
  { id: 'd1', title: '跨天每日任务', date: D1, endDate: D3, time: '09:00', done: false },
  { id: 'd2', title: '单日每日任务', date: D4, time: '10:00', done: false }
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
    return {
      ok: true,
      status: 200,
      json: async () => DAY_TASKS.filter((t) => t.date <= to && (t.endDate || t.date) >= from)
    };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const tick = () => new Promise((r) => setTimeout(r, 10));
const rows = (el) => findAllByClass(el, 'cal-row');
const cellOf = (el, date) => findAllByClass(el, 'cal-col').concat(findAllByClass(el, 'cal-cell'))
  .find((c) => c.dataset.date === date);
const spanOf = (el, title) => findAllByClass(el, 'cal-span').find((s) => textOf(s).includes(title));
const cardOf = (el, title) => findAllByClass(el, 'cal-card').find((c) => textOf(c).includes(title));

async function renderToday() {
  globalThis.location.hash = '#/today';
  calls.length = 0;
  const el = document.createElement('div');
  await todayMod.render(el);
  const week = findAllByTag(el, 'button').find((b) => textOf(b) === '周视图');
  if (week) week.click();
  await tick();
  return el;
}

// 让行有真实宽度：700px / 7 列 = 每列 100px
function stubRow(el) {
  for (const row of rows(el)) row.getBoundingClientRect = () => ({ width: COL_W * 7 });
  return rows(el)[0];
}

// 注意：事件对象不要自带 stopPropagation，否则会覆盖桩的实现、失去冒泡语义
function press(handle, dx, { release = true } = {}) {
  handle.fire('mousedown', { button: 0, clientX: 300 });
  document.dispatchEvent('mousemove', { clientX: 300 + dx });
  if (release) document.dispatchEvent('mouseup', {});
}

async function drag(handle, dx) {
  press(handle, dx);
  await tick();
}

const lastPut = () => [...calls].reverse().find((c) => c.method === 'PUT');

// ══════════ 纯函数 ══════════

test('问题1：clampColDelta 把拖动限制在本行内', () => {
  assert.equal(cal.clampColDelta('move', 1, 3, 5, 7), 3, '右移不超出本行');
  assert.equal(cal.clampColDelta('move', 1, 3, -5, 7), -1, '左移不超出本行');
  assert.equal(cal.clampColDelta('start', 2, 4, 5, 7), 2, '开始不能越过结束');
  assert.equal(cal.clampColDelta('start', 2, 4, -5, 7), -2);
  assert.equal(cal.clampColDelta('end', 2, 4, -5, 7), -2, '结束不能越过开始');
  assert.equal(cal.clampColDelta('end', 2, 4, 9, 7), 2);
});

test('问题1：dragRangePatch 平移 / 改开始 / 改结束', () => {
  const day = { kind: 'day', spanFrom: '2024-05-10', spanTo: '2024-05-12' };
  assert.deepEqual(cal.dragRangePatch(day, 2, 'move'), { date: '2024-05-12', endDate: '2024-05-14' });
  assert.deepEqual(cal.dragRangePatch(day, -3, 'start'), { date: '2024-05-07', endDate: '2024-05-12' });
  assert.deepEqual(cal.dragRangePatch(day, 1, 'end'), { date: '2024-05-10', endDate: '2024-05-13' });
  assert.equal(cal.dragRangePatch(day, 0, 'move'), null, '没位移就不提交');

  const project = { kind: 'project', spanFrom: '2024-05-10', spanTo: '2024-05-12' };
  assert.deepEqual(cal.dragRangePatch(project, 1, 'move'), { startDate: '2024-05-11', dueDate: '2024-05-13' });
  assert.deepEqual(cal.dragRangePatch(project, -1, 'start'), { startDate: '2024-05-09', dueDate: '2024-05-12' });
  assert.deepEqual(cal.dragRangePatch(project, -9, 'end'), { startDate: '2024-05-10', dueDate: '2024-05-10' }, '结束不早于开始');
});

test('问题1：开始越过结束时会被夹住；单日收缩会清掉结束日期', () => {
  const day = { kind: 'day', spanFrom: '2024-05-10', spanTo: '2024-05-12' };
  assert.deepEqual(cal.dragRangePatch(day, 9, 'start'), { date: '2024-05-12', endDate: null }, '开始拖到结束那天 → 变回单日');
  const collapsed = cal.dragRangePatch({ kind: 'day', spanFrom: '2024-05-10', spanTo: '2024-05-11' }, -1, 'end');
  assert.deepEqual(collapsed, { date: '2024-05-10', endDate: null }, '收缩成一天就没有区间了');
});

test('问题1：dragSinglePatch 只动已有的日期字段', () => {
  assert.deepEqual(cal.dragSinglePatch({ kind: 'day', date: '2024-05-10' }, 2), { date: '2024-05-12' });
  assert.deepEqual(
    cal.dragSinglePatch({ kind: 'project', startDate: '2024-05-10', dueDate: '2024-05-10' }, -1),
    { startDate: '2024-05-09', dueDate: '2024-05-09' }
  );
  assert.deepEqual(
    cal.dragSinglePatch({ kind: 'project', dueDate: '2024-05-10' }, 1),
    { dueDate: '2024-05-11' },
    '只有截止日的任务不会被凭空加上开始日'
  );
  assert.equal(cal.dragSinglePatch({ kind: 'day', date: '2024-05-10' }, 0), null);
});

// ══════════ 周视图拖动 ══════════

test('问题1：跨天 block 两端都有把手', async () => {
  const el = await renderToday();
  const blocks = findAllByClass(el, 'cal-span');
  assert.equal(blocks.length, 2, '两个跨天任务');
  for (const b of blocks) {
    assert.equal(findAllByClass(b, 'cal-span-handle').length, 2, '每条 block 两端各有把手');
  }
  assert.ok(findAllByClass(el, 'cal-span-handle')[0].getAttribute('title').includes('开始'));
  assert.ok(findAllByClass(el, 'cal-span-handle')[1].getAttribute('title').includes('结束'));
});

test('问题1：拖右把手 → 结束日期右移（每日任务）', async () => {
  const el = await renderToday();
  stubRow(el);
  const block = spanOf(el, '跨天每日任务');
  await drag(findAllByClass(block, 'cal-span-handle')[1], COL_W * 2);
  const put = lastPut();
  assert.equal(put.url, '/api/tasks/d1');
  assert.deepEqual(put.body, { date: D1, endDate: addDays(D3, 2) });
});

test('问题1：拖右把手 → 结束日期右移（项目任务）', async () => {
  const el = await renderToday();
  stubRow(el);
  const block = spanOf(el, '跨天项目任务');
  await drag(findAllByClass(block, 'cal-span-handle')[1], COL_W);
  const put = lastPut();
  assert.equal(put.url, '/api/projects/p1/tasks/pt1');
  assert.deepEqual(put.body, { startDate: D1, dueDate: addDays(D3, 1) });
});

test('问题1：拖左把手 → 开始日期左移', async () => {
  const el = await renderToday();
  stubRow(el);
  const block = spanOf(el, '跨天每日任务');
  await drag(findAllByClass(block, 'cal-span-handle')[0], -COL_W);
  assert.deepEqual(lastPut().body, { date: addDays(D1, -1), endDate: D3 });
});

test('问题1：拖 block 中间 → 整段平移', async () => {
  const el = await renderToday();
  stubRow(el);
  const block = spanOf(el, '跨天项目任务');
  await drag(block, COL_W);
  assert.deepEqual(lastPut().body, { startDate: addDays(D1, 1), dueDate: addDays(D3, 1) });
});

test('问题1：拖出本行会被夹住，不会把任务拖没', async () => {
  const el = await renderToday();
  stubRow(el);
  const block = spanOf(el, '跨天每日任务');
  await drag(block, COL_W * 20);
  const body = lastPut().body;
  assert.equal(body.date, addDays(D1, 3), '最多贴到行尾（第 3..6 列）');
  assert.equal(body.endDate, addDays(D3, 3));
});

test('问题1：轻微抖动不算拖动', async () => {
  const el = await renderToday();
  stubRow(el);
  const block = spanOf(el, '跨天每日任务');
  await drag(findAllByClass(block, 'cal-span-handle')[1], 2);
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
});

test('问题1：拖动后会重新拉数据刷新', async () => {
  const el = await renderToday();
  stubRow(el);
  const block = spanOf(el, '跨天每日任务');
  calls.length = 0;
  await drag(findAllByClass(block, 'cal-span-handle')[1], COL_W);
  assert.ok(calls.some((c) => c.method === 'GET' && c.url.includes('/api/tasks?from=')), '应重新拉取');
});

test('问题1：刚拖完的那次点击不会顺手改选中日期', async () => {
  const el = await renderToday();
  stubRow(el);
  const before = findAllByClass(el, 'cal-col').find((c) => c.classList.contains('selected'));
  const block = spanOf(el, '跨天每日任务');

  // 浏览器会在 mouseup 后紧接着派发 click
  press(findAllByClass(block, 'cal-span-handle')[1], COL_W, { release: false });
  document.dispatchEvent('mouseup', {});
  cellOf(el, D5).click();
  await tick();

  const after = findAllByClass(el, 'cal-col').find((c) => c.classList.contains('selected'));
  assert.equal(after && after.dataset.date, before && before.dataset.date, '选中日期不应被拖动带偏');
});

test('问题1：点把手本身不会打开任务页面', async () => {
  const el = await renderToday();
  stubRow(el);
  globalThis.location.hash = '#/today';
  const block = spanOf(el, '跨天每日任务');
  findAllByClass(block, 'cal-span-handle')[1].click();
  assert.equal(globalThis.location.hash, '#/today');
});

// ══════════ 单日卡片拖动 ══════════

test('问题1：单日卡片有改期与拉伸两个把手', async () => {
  const el = await renderToday();
  const card = cardOf(el, '单日每日任务');
  assert.ok(findAllByClass(card, 'cal-card-move')[0], '应有改期把手');
  assert.ok(findAllByClass(card, 'cal-card-stretch')[0], '应有调整结束日期的把手');

  const project = cardOf(el, '单日项目任务');
  assert.ok(findAllByClass(project, 'cal-card-move')[0]);
});

test('问题1：拖卡片改期把手 → 任务整体改到另一天', async () => {
  const el = await renderToday();
  stubRow(el);
  const card = cardOf(el, '单日每日任务');
  await drag(findAllByClass(card, 'cal-card-move')[0], COL_W * 2);
  const put = lastPut();
  assert.equal(put.url, '/api/tasks/d2');
  assert.deepEqual(put.body, { planDate: addDays(D4, 2), planPeriod: 'morning', planTime: '10:00', planEndTime: null, planOrder: null });
});

test('问题1：拖卡片改期把手也能往前挪', async () => {
  const el = await renderToday();
  stubRow(el);
  const card = cardOf(el, '单日项目任务');
  await drag(findAllByClass(card, 'cal-card-move')[0], -COL_W * 2);
  assert.deepEqual(lastPut().body, { planDate: addDays(D5, -2), planPeriod: null, planTime: null, planEndTime: null, planOrder: null, planEndDate: null }, '周视图安排执行日，不改项目截止日');
});

test('问题1：拖卡片右边缘 → 把它拉成跨天区间', async () => {
  const el = await renderToday();
  stubRow(el);
  const card = cardOf(el, '单日每日任务');
  await drag(findAllByClass(card, 'cal-card-stretch')[0], COL_W * 2);
  const put = lastPut();
  assert.equal(put.url, '/api/tasks/d2');
  assert.deepEqual(put.body, { planDate: D4, planEndDate: addDays(D4, 2), planPeriod: 'morning', planTime: '10:00', planEndTime: null, planOrder: null }, '拉长执行安排并保留具体时间');
});

test('问题1：单日卡片不能往左缩成 0 天', async () => {
  const el = await renderToday();
  stubRow(el);
  const card = cardOf(el, '单日每日任务');
  await drag(findAllByClass(card, 'cal-card-stretch')[0], -COL_W * 3);
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 0, '没有有效位移就不提交');
});

// ══════════ 月视图 ══════════

test('问题1：月视图里同样能拖 block 调整起止', async () => {
  const el = await renderToday();
  findAllByTag(el, 'button').find((b) => textOf(b) === '月视图').click();
  await tick();
  stubRow(el);

  const block = spanOf(el, '跨天每日任务');
  assert.ok(block, '月视图里也有连续 block');
  assert.equal(findAllByClass(block, 'cal-span-handle').length, 2);
  await drag(findAllByClass(block, 'cal-span-handle')[1], COL_W);
  assert.deepEqual(lastPut().body, { date: D1, endDate: addDays(D3, 1) });
});
