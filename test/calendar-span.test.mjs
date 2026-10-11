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
    { id: 't3', title: '无日期', subtasks: [] },
    { id: 't4', title: '跨周任务', startDate: addDays(WEEK[0], -2), dueDate: D0, subtasks: [] }
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
const spansIn = (root) => findAllByClass(root, 'cal-span');
const pctOf = (node, key) => parseFloat(new RegExp(`${key}:([\\d.]+)%`).exec(String(node.getAttribute('style')))[1]);

async function renderToday() {
  const el = document.createElement('div');
  await todayMod.render(el);
  const week = findAllByTag(el, 'button').find((b) => textOf(b) === '周视图');
  if (week) week.click();
  await tick();
  return el;
}

// ——— 纯函数 ———

test('问题1：itemSpan 给出任务跨度（保证 from ≤ to）', () => {
  assert.deepEqual(cal.itemSpan({ startDate: '2024-05-01', dueDate: '2024-05-10' }), { from: '2024-05-01', to: '2024-05-10' });
  assert.deepEqual(cal.itemSpan({ dueDate: '2024-05-10' }), { from: '2024-05-10', to: '2024-05-10' });
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

test('问题1：multiDayEntries 每个任务只出一条，单日/无日期排除', () => {
  const entries = cal.multiDayEntries(PROJECTS, [D0, D1, D2, D3], TODAY);
  assert.deepEqual(entries.map((e) => e.id).sort(), ['t1', 't4'], '只出跨天的，且各一条');
  assert.equal(entries.filter((e) => e.id === 't1').length, 1, '不是每天一条');
  assert.equal(cal.multiDayEntries(PROJECTS, [], TODAY).length, 0);
  assert.equal(cal.multiDayEntries(PROJECTS, [D3], TODAY).length, 0, '范围内没有跨天任务时不产出');
});

test('问题1：spanBarLayout 把跨天任务切成一行里的连续横条', () => {
  const entries = cal.multiDayEntries(PROJECTS, WEEK.slice(0, 7), TODAY);
  const { bars, laneCount } = cal.spanBarLayout(entries, WEEK);
  const t1 = bars.find((b) => b.entry.id === 't1');
  assert.equal(t1.startCol, 1);
  assert.equal(t1.endCol, 3);
  assert.equal(t1.continuesLeft, false);
  assert.equal(t1.continuesRight, false);
  assert.ok(laneCount >= 1);
});

test('问题1：重叠的跨天任务自动分到不同泳道', () => {
  const entries = cal.multiDayEntries(PROJECTS, WEEK, TODAY);
  const { bars, laneCount } = cal.spanBarLayout(entries, WEEK);
  const t1 = bars.find((b) => b.entry.id === 't1');
  const t4 = bars.find((b) => b.entry.id === 't4');
  assert.notEqual(t1.lane, t4.lane, '两者在 D0 上重叠，必须错开');
  assert.equal(laneCount, 2);
});

test('问题1：超出可见范围的跨天任务会被裁切并标记', () => {
  const entries = cal.multiDayEntries(PROJECTS, WEEK, TODAY);
  const { bars } = cal.spanBarLayout(entries, WEEK);
  const t4 = bars.find((b) => b.entry.id === 't4');
  assert.equal(t4.startCol, 0, '从行首开始（真正的起点在本周之前）');
  assert.equal(t4.continuesLeft, true, '左边要被裁切');
  assert.equal(t4.continuesRight, false);

  // 换到下一周：t4 完全不出现
  const nextWeek = WEEK.map((d) => addDays(d, 7));
  const nextEntries = cal.multiDayEntries(PROJECTS, nextWeek, TODAY);
  const nextBars = cal.spanBarLayout(nextEntries, nextWeek).bars;
  assert.equal(nextBars.some((b) => b.entry.id === 't4'), false);
});

// ——— 页面 ———

test('问题1：周视图里跨天任务是一条连续 block，而不是每天一个', async () => {
  const el = await renderToday();
  const spans = spansIn(el);
  assert.equal(spans.length, 2, '两个跨天任务 → 两条 block');
  assert.equal(spans.filter((s) => textOf(s).includes('跨三天')).length, 1, '只画一条，不重复');

  // 不再出现在任何一天的卡片列表里
  for (const d of [D0, D1, D2]) {
    assert.equal(titlesIn(el, d).includes('跨三天'), false, `${d} 不应再有重复卡片`);
  }
  assert.deepEqual(titlesIn(el, D3), ['单日任务'], '单日任务仍是卡片');
});

test('问题1：block 的左右位置正好横跨三天', async () => {
  const el = await renderToday();
  const span = spansIn(el).find((s) => textOf(s).includes('跨三天'));
  const style = String(span.getAttribute('style'));
  assert.ok(Math.abs(pctOf(span, 'left') - (1 / 7) * 100) < 0.01, `left 应为第 2 列，实际 ${style}`);
  assert.ok(Math.abs(pctOf(span, 'width') - (3 / 7) * 100) < 0.01, `width 应横跨 3 列，实际 ${style}`);
  assert.ok(style.includes('background:#'), 'block 用任务颜色铺满');
 });

test('问题1：block 上显示标题与天数，被裁切的那条带箭头', async () => {
  const el = await renderToday();
  const t1 = spansIn(el).find((s) => textOf(s).includes('跨三天'));
  const t4 = spansIn(el).find((s) => textOf(s).includes('跨周任务'));
  assert.ok(textOf(t1).includes('3 天'));
  assert.equal(findAllByClass(t1, 'cal-span-clip').length, 0, '完整落在本周内不需要箭头');
  assert.equal(findAllByClass(t4, 'cal-span-clip').length, 1);
  assert.equal(textOf(findAllByClass(t4, 'cal-span-clip')[0]), '◀');
  assert.ok(String(t4.getAttribute('style')).includes('background:#'));
});

test('问题1：有跨天 block 时，格子顶部会留出空间', async () => {
  const el = await renderToday();
  const list = findAllByClass(cellOf(el, D0), 'cal-cards')[0];
  assert.ok(String(list.getAttribute('style')).includes('padding-top'), '避免卡片压在 block 上');
  const row = findAllByClass(el, 'cal-row')[0];
  assert.ok(row.classList.contains('cal-week-row'));
});

test('问题1：点 block 进入该任务页面（block 上没有勾选框）', async () => {
  const el = await renderToday();
  const span = spansIn(el).find((s) => textOf(s).includes('跨三天'));
  assert.equal(findAllByClass(span, 'cal-check').length, 0, 'block 内不放勾选框');
  globalThis.location.hash = '#/today';
  span.click();
  assert.equal(globalThis.location.hash, '#/task/p1/t1');
});

test('问题1：月视图里同样是一条连续 block', async () => {
  const el = await renderToday();
  findAllByTag(el, 'button').find((b) => textOf(b) === '月视图').click();
  await tick();
  assert.equal(findAllByClass(el, 'cal-cell').length, 42, '网格仍是 6×7');
  const spans = spansIn(el);
  assert.ok(spans.some((s) => textOf(s).includes('跨三天')), '月视图也有连续 block');
  assert.equal(findAllByClass(cellOf(el, D0), 'cal-card-title').some((t) => textOf(t).includes('跨三天')), false);
});

test('跨天任务明确安排到选中日后，勾选只写回该任务自己那一层', async () => {
  PROJECTS[0].tasks[0].planDate = D1;
  const el = await renderToday();
  cellOf(el, D1).click();
  await tick();
  calls.length = 0;
  const board = findAllByClass(el, 'cal-board')[0];
  findAllByClass(board, 'cal-check')[0].click();
  await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.ok(put, '应发出请求');
  assert.equal(put.url, '/api/projects/p1/tasks/t1');
  assert.deepEqual(put.body, { done: true });
  delete PROJECTS[0].tasks[0].planDate;
});
