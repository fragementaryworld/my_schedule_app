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

// 用当前这一周里的几天，保证一定落在可见网格内
const WEEK = cal.weekDates(TODAY, 'mon');
const [D0, D1, D2, D3] = [WEEK[1], WEEK[2], WEEK[3], WEEK[4]];

const PROJECTS = [{
  id: 'p1', name: '项目A', icon: '📁', status: 'active', dateFormat: 'iso', blocks: [],
  tasks: [
    { id: 't1', title: '跨三天', startDate: D0, dueDate: D2, subtasks: [] },
    { id: 't2', title: '单日任务', dueDate: D3, subtasks: [] },
    { id: 't3', title: '无日期', subtasks: [] }
  ]
}];

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
  if (u.includes('/api/preferences')) return { ok: true, status: 200, json: async () => ({ weekStart: 'mon' }) };
  if (u.includes('/api/projects')) return { ok: true, status: 200, json: async () => PROJECTS };
  if (u.includes('/api/tasks?from=')) return { ok: true, status: 200, json: async () => [] };
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const tick = () => new Promise((r) => setTimeout(r, 10));
const cellOf = (root, date) => findAllByClass(root, 'cal-col').concat(findAllByClass(root, 'cal-cell'))
  .find((c) => c.dataset.date === date);
const titlesIn = (root, date) => findAllByClass(cellOf(root, date), 'cal-card-title').map((t) => textOf(t));

async function renderToday() {
  const el = document.createElement('div');
  await todayMod.render(el);
  return el;
}

// ——— 纯函数 ———

test('问题1：itemSpan 给出任务跨度（保证 from ≤ to）', () => {
  assert.deepEqual(cal.itemSpan({ startDate: '2024-05-01', dueDate: '2024-05-10' }), { from: '2024-05-01', to: '2024-05-10' });
  assert.deepEqual(cal.itemSpan({ dueDate: '2024-05-10' }), { from: '2024-05-10', to: '2024-05-10' });
  assert.deepEqual(cal.itemSpan({ startDate: '2024-05-10' }), { from: '2024-05-10', to: '2024-05-10' });
  assert.deepEqual(cal.itemSpan({ startDate: '2024-05-10', dueDate: '2024-05-01' }), { from: '2024-05-01', to: '2024-05-10' });
  assert.equal(cal.itemSpan({}), null);
  assert.equal(cal.itemSpan(null), null);
});

test('问题1：spanDays 计算天数', () => {
  assert.equal(cal.spanDays({ from: '2024-05-01', to: '2024-05-01' }), 1);
  assert.equal(cal.spanDays({ from: '2024-05-01', to: '2024-05-03' }), 3);
  assert.equal(cal.spanDays({ from: '2024-04-28', to: '2024-05-02' }), 5);
  assert.equal(cal.spanDays(null), 0);
});

test('问题1：跨多天的任务在每一天都生成条目', () => {
  const entries = cal.projectEntriesForDates(PROJECTS, [D0, D1, D2, D3], TODAY);
  const t1 = entries.filter((e) => e.id === 't1').map((e) => e.date);
  assert.deepEqual(t1, [D0, D1, D2], '跨三天就要出现三次，不是只放开始那天');
  assert.equal(entries.filter((e) => e.id === 't3').length, 0, '没有日期的任务不进日历');
  assert.deepEqual(entries.filter((e) => e.id === 't2').map((e) => e.date), [D3], '单日任务只出现一次');
});

test('问题1：跨度条目带起止与延续标记', () => {
  const entries = cal.projectEntriesForDates(PROJECTS, [D0, D1, D2], TODAY).filter((e) => e.id === 't1');
  assert.deepEqual(entries.map((e) => e.spanStart), [true, false, false]);
  assert.deepEqual(entries.map((e) => e.spanEnd), [false, false, true]);
  assert.deepEqual(entries.map((e) => e.continued), [false, true, true]);
  assert.ok(entries.every((e) => e.spanDays === 3 && e.spanFrom === D0 && e.spanTo === D2));
});

test('问题1：只请求可见日期的条目', () => {
  const entries = cal.projectEntriesForDates(PROJECTS, [D1], TODAY);
  assert.deepEqual(entries.filter((e) => e.id === 't1').map((e) => e.date), [D1]);
  assert.equal(cal.projectEntriesForDates(PROJECTS, [], TODAY).length, 0);
  assert.equal(cal.projectEntriesForDates(null, [D0], TODAY).length, 0);
});

// ——— 页面 ———

test('问题1：周视图里跨天任务出现在每一天的格子里', async () => {
  const el = await renderToday();
  assert.deepEqual(titlesIn(el, D0), ['跨三天']);
  assert.deepEqual(titlesIn(el, D1), ['跨三天'], '中间那天也要显示');
  assert.deepEqual(titlesIn(el, D2), ['跨三天'], '最后那天也要显示');
  assert.deepEqual(titlesIn(el, D3), ['单日任务'], '不相关的那天不受影响');
});

test('问题1：延续的那几天带 ↳ 与"续"标记，首日带"起"', async () => {
  const el = await renderToday();
  const first = findAllByClass(cellOf(el, D0), 'cal-card')[0];
  const middle = findAllByClass(cellOf(el, D1), 'cal-card')[0];
  const last = findAllByClass(cellOf(el, D2), 'cal-card')[0];

  assert.equal(first.classList.contains('continued'), false);
  assert.equal(middle.classList.contains('continued'), true);
  assert.ok(middle.classList.contains('spanning'));
  assert.equal(findAllByClass(first, 'cal-cont').length, 0, '首日不显示延续箭头');
  assert.equal(textOf(findAllByClass(middle, 'cal-cont')[0]), '↳', '中间那天显示延续箭头');

  assert.ok(textOf(first).includes('起 · 共 3 天'));
  assert.ok(textOf(middle).includes('续 · 共 3 天'));
  assert.ok(textOf(last).includes('止 · 共 3 天'));
});

test('问题1：月视图里同样铺满整段', async () => {
  const el = await renderToday();
  findAllByTag(el, 'button').find((b) => textOf(b) === '月视图').click();
  await tick();
  assert.deepEqual(titlesIn(el, D0), ['跨三天']);
  assert.deepEqual(titlesIn(el, D1), ['跨三天']);
  assert.deepEqual(titlesIn(el, D2), ['跨三天']);
});

test('问题1：跨天任务的勾选写到同一层接口', async () => {
  const el = await renderToday();
  calls.length = 0;
  findAllByClass(cellOf(el, D1), 'cal-check')[0].click();
  await tick();
  assert.equal(calls.find((c) => c.method === 'PUT').url, '/api/projects/p1/tasks/t1');
});
