import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr, addDays } from '../public/js/utils.js';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/today' };

const TODAY = todayStr();
const TASKS = [
  { id: 't1', title: '今天的事', date: TODAY, time: '09:00', priority: 'high', done: false, source: { type: 'project', id: null } },
  { id: 't2', title: '已完成的事', date: TODAY, time: null, priority: 'low', done: true },
  { id: 't3', title: '明天的事', date: addDays(TODAY, 1), time: null, priority: 'medium', done: false, repeat: 'daily' },
  { id: 't4', title: '月内别的事', date: addDays(TODAY, 40), time: null, priority: 'medium', done: false }
];

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
  if (u.includes('/api/preferences')) return { ok: true, status: 200, json: async () => ({ weekStart: 'mon' }) };
  if (u.includes('/api/projects')) return { ok: true, status: 200, json: async () => [] };
  if (u.includes('/api/tasks?from=')) {
    const from = /from=([\d-]+)/.exec(u)[1];
    const to = /to=([\d-]+)/.exec(u)[1];
    return { ok: true, status: 200, json: async () => TASKS.filter((t) => t.date >= from && t.date <= to) };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const calendarUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'calendar.js')).href;
const todayUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'today.js')).href;
const cal = await import(calendarUrl);
const todayMod = await import(todayUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));
const colOf = (root, date) => findAllByClass(root, 'cal-col').concat(findAllByClass(root, 'cal-cell'))
  .find((c) => c.dataset.date === date);
const tabBtn = (root, label) => findAllByTag(root, 'button').find((b) => textOf(b) === label);

// ——— 纯函数 ———

test('日历：weekdayLabels 按一周起始日排序', () => {
  assert.deepEqual(cal.weekdayLabels('mon'), ['一', '二', '三', '四', '五', '六', '日']);
  assert.deepEqual(cal.weekdayLabels('sun'), ['日', '一', '二', '三', '四', '五', '六']);
});

test('日历：weekStartOf/weekDates', () => {
  assert.equal(cal.weekStartOf('2024-05-15', 'mon'), '2024-05-13');
  assert.equal(cal.weekStartOf('2024-05-15', 'sun'), '2024-05-12');
  assert.deepEqual(cal.weekDates('2024-05-15', 'mon'), [
    '2024-05-13', '2024-05-14', '2024-05-15', '2024-05-16', '2024-05-17', '2024-05-18', '2024-05-19'
  ]);
});

test('日历：monthGridDates 是 6 周 × 7 天并含跨月日期', () => {
  const grid = cal.monthGridDates(2024, 5, 'mon');
  assert.equal(grid.length, 42);
  assert.equal(grid[0], '2024-04-29', '5/1 是周三，网格从上周一开始');
  assert.equal(grid[41], '2024-06-09');
  assert.equal(grid.filter((d) => cal.sameMonth(d, 2024, 5)).length, 31);
});

test('日历：periodTitle 周/月两种标题', () => {
  assert.equal(cal.periodTitle('2024-05-15', 'month'), '2024年5月');
  assert.equal(cal.periodTitle('2024-05-15', 'week'), '2024年5月13–19日');
  assert.equal(cal.periodTitle('2024-05-30', 'week'), '5月27日 – 6月2日', '跨月时分别标月份');
});

test('日历：shiftAnchor 周 ±7 天、月 ±1 月并收敛日号', () => {
  assert.equal(cal.shiftAnchor('2024-05-15', 'week', 1), '2024-05-22');
  assert.equal(cal.shiftAnchor('2024-05-15', 'week', -1), '2024-05-08');
  assert.equal(cal.shiftAnchor('2024-05-15', 'month', 1), '2024-06-15');
  assert.equal(cal.shiftAnchor('2024-01-31', 'month', 1), '2024-02-29', '1/31 的下个月收敛到 2/29');
  assert.equal(cal.shiftAnchor('2024-01-15', 'month', -1), '2023-12-15');
});

test('日历：分组与同一天排序（先时间、未完成优先）', () => {
  const entries = [
    { date: '2024-05-01', time: '10:00', done: false, title: 'b' },
    { date: '2024-05-01', time: '09:00', done: true, title: 'a' },
    { date: '2024-05-01', time: null, done: false, title: 'c' },
    { date: '2024-05-02', time: null, done: false, title: 'd' }
  ];
  const map = cal.groupByDate(entries);
  assert.deepEqual([...map.keys()], ['2024-05-01', '2024-05-02']);
  assert.deepEqual(cal.sortDayEntries(map.get('2024-05-01')).map((e) => e.title), ['a', 'b', 'c']);
});

test('日历：rangeOf 给出要请求的日期区间', () => {
  const r = cal.rangeOf('2024-05-15', 'week', 'mon');
  assert.equal(r.from, '2024-05-13');
  assert.equal(r.to, '2024-05-19');
  const m = cal.rangeOf('2024-05-15', 'month', 'mon');
  assert.equal(m.from, '2024-04-29');
  assert.equal(m.to, '2024-06-09');
  assert.equal(m.dates.length, 42);
});

// ——— 页面 ———

async function renderToday() {
  calls.length = 0;
  const el = document.createElement('div');
  await todayMod.render(el);
  tabBtn(el, '周视图').click();
  await tick();
  return el;
}

test('问题1：今日计划可切到周视图，7 列 + 星期表头', async () => {
  const el = await renderToday();
  assert.deepEqual(findAllByClass(el, 'cal-wd').map((x) => textOf(x)), ['一', '二', '三', '四', '五', '六', '日']);
  assert.equal(findAllByClass(el, 'cal-col').length, 7, '一周 7 列');
  assert.deepEqual(findAllByClass(el, 'tab').map((t) => textOf(t)), ['周视图', '月视图']);
  const req = calls.find((c) => c.url.includes('/api/tasks?from='));
  assert.ok(req, '应按日期区间一次性取数据');
});

test('问题1：今天的列高亮，任务落在对应那一天', async () => {
  const el = await renderToday();
  const todayCol = colOf(el, TODAY);
  assert.ok(todayCol.classList.contains('today'), '今天应高亮');
  const names = findAllByClass(todayCol, 'cal-card-title').map((t) => textOf(t));
  assert.deepEqual(names.sort(), ['今天的事', '已完成的事'].sort());

  if (!colOf(el, addDays(TODAY, 1))) { findAllByClass(el, 'cal-next')[0].click(); await tick(); }
  const tomorrowCol = colOf(el, addDays(TODAY, 1));
  assert.deepEqual(findAllByClass(tomorrowCol, 'cal-card-title').map((t) => textOf(t)), ['明天的事']);
  assert.ok(!tomorrowCol.classList.contains('today'));
});

test('问题1：卡片显示时间/重复，来源标签已移除，完成项划线', async () => {
  const el = await renderToday();
  const todayCol = colOf(el, TODAY);
  const text = textOf(todayCol);
  assert.ok(text.includes('🕐 09:00'), '显示时间');
  assert.ok(!text.includes('📁 项目'), '不再显示重复的来源标签');
  const cards = findAllByClass(todayCol, 'cal-card');
  const done = cards.find((c) => c.classList.contains('done'));
  assert.ok(done, '完成项应有 done 样式');
  if (!colOf(el, addDays(TODAY, 1))) { findAllByClass(el, 'cal-next')[0].click(); await tick(); }
  assert.equal(findAllByClass(findAllByClass(el, 'cal-col').find((c) => c.dataset.date === addDays(TODAY, 1)), 'cal-card-act').length, 1, '重复任务有完成系列按钮');
});

test('问题1：勾选框直接完成/取消完成', async () => {
  const el = await renderToday();
  const card = findAllByClass(colOf(el, TODAY), 'cal-card').find((c) => textOf(c).includes('今天的事'));
  findAllByClass(card, 'cal-check')[0].click();
  await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, '/api/tasks/t1');
  assert.deepEqual(put.body, { done: true });
});

test('问题1：切到月视图是 6×7 网格，含跨月日期', async () => {
  const el = await renderToday();
  tabBtn(el, '月视图').click();
  await tick();
  assert.equal(findAllByClass(el, 'cal-cell').length, 42);
  assert.ok(findAllByClass(el, 'cal-cell').some((c) => c.classList.contains('outside')), '有跨月格子');
  assert.equal(findAllByClass(el, 'cal-col').length, 0);
});

test('问题1：月视图每格最多 3 条，多出的显示 +N', async () => {
  const many = [];
  for (let i = 0; i < 5; i++) {
    many.push({ id: `m${i}`, title: `月内${i}`, date: TODAY, time: null, priority: 'medium', done: false });
  }
  const backup = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/api/preferences')) return { ok: true, status: 200, json: async () => ({ weekStart: 'mon' }) };
    if (u.includes('/api/projects')) return { ok: true, status: 200, json: async () => [] };
    if (u.includes('/api/tasks?from=')) return { ok: true, status: 200, json: async () => many };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const el = document.createElement('div');
  await todayMod.render(el);
  tabBtn(el, '月视图').click();
  await tick();
  const cell = colOf(el, TODAY);
  assert.equal(findAllByClass(cell, 'cal-card').length, 3);
  assert.equal(textOf(findAllByClass(cell, 'cal-more')[0]), '+2');
  globalThis.fetch = backup;
});

test('问题1：‹ 今天 › 导航切换周期', async () => {
  const el = await renderToday();
  const title = () => textOf(findAllByClass(el, 'cal-period')[0]);
  const first = title();
  findAllByClass(el, 'cal-next')[0].click();
  await tick();
  assert.notEqual(title(), first, '下一页标题变化');
  findAllByClass(el, 'cal-prev')[0].click();
  await tick();
  assert.equal(title(), first, '上一页回到原周期');
  findAllByClass(el, 'cal-next')[0].click();
  await tick();
  findAllByTag(el, 'button').find((b) => textOf(b) === '今天').click();
  await tick();
  assert.equal(title(), first, '「今天」回到本周');
});

test('问题1：切到月视图后导航按整月走', async () => {
  const el = await renderToday();
  tabBtn(el, '月视图').click();
  await tick();
  const title = () => textOf(findAllByClass(el, 'cal-period')[0]);
  const cur = title();
  findAllByClass(el, 'cal-next')[0].click();
  await tick();
  assert.notEqual(title(), cur);
  assert.ok(/年\d+月$/.test(title()), '月视图标题是「YYYY年M月」');
});
