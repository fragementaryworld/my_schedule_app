import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByTag, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr, addDays, isOverdue, rangeEnd } from '../public/js/utils.js';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/today' };

const TODAY = todayStr();
const PAST = addDays(TODAY, -5);
const YESTERDAY = addDays(TODAY, -1);
const FUTURE = addDays(TODAY, 2);

const at = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm, 0, 0);

// ══════════ 区间终点 ══════════

test('问题2：rangeEnd 取时间区间的最后时刻', () => {
  assert.deepEqual(rangeEnd({ date: '2024-05-01' }), { date: '2024-05-01', time: null });
  assert.deepEqual(rangeEnd({ date: '2024-05-01', time: '09:00' }), { date: '2024-05-01', time: '09:00' });
  assert.deepEqual(
    rangeEnd({ date: '2024-05-01', endDate: '2024-05-05', time: '09:00', endTime: '18:00' }),
    { date: '2024-05-05', time: '18:00' }
  );
  assert.deepEqual(
    rangeEnd({ date: '2024-05-01', endDate: '2024-05-05', time: '09:00' }),
    { date: '2024-05-05', time: null },
    '有结束日期但没结束时间 → 到那一天结束'
  );
  assert.deepEqual(rangeEnd({ startDate: '2024-05-01', dueDate: '2024-05-05', dueTime: '18:00' }), { date: '2024-05-05', time: '18:00' });
  assert.deepEqual(rangeEnd({ startDate: '2024-05-01', dueDate: '2024-05-05' }), { date: '2024-05-05', time: null });
  assert.deepEqual(rangeEnd({ startDate: '2024-05-01' }), { date: null, time: null }, '只有开始日 → 没有可比的终点');
  assert.deepEqual(rangeEnd(null), { date: null, time: null });
});

// ══════════ 逾期判定 ══════════

test('问题2：区间还没结束就不算逾期（开始日早已过去也一样）', () => {
  const task = { date: '2024-05-01', endDate: '2024-05-31', done: false };
  assert.equal(isOverdue(task, '2024-05-15', at(2024, 5, 15, 12, 0)), false, '区间中间不算逾期');
  assert.equal(isOverdue(task, '2024-05-31', at(2024, 5, 31, 23, 0)), false, '最后一天没结束也不算');
  assert.equal(isOverdue(task, '2024-06-01', at(2024, 6, 1, 0, 1)), true, '过了最后一天才算逾期');
});

test('问题2：最后一天要比到结束时间', () => {
  const task = { date: '2024-05-01', endDate: '2024-05-10', endTime: '18:00', done: false };
  assert.equal(isOverdue(task, '2024-05-10', at(2024, 5, 10, 17, 59)), false, '还没到结束时间');
  assert.equal(isOverdue(task, '2024-05-10', at(2024, 5, 10, 18, 0)), false, '正好到点不算晚于');
  assert.equal(isOverdue(task, '2024-05-10', at(2024, 5, 10, 18, 1)), true, '晚于结束时间才算逾期');
});

test('问题2：只给到日期时，当天过完才逾期', () => {
  assert.equal(isOverdue({ date: '2024-05-10', done: false }, '2024-05-10', at(2024, 5, 10, 23, 59)), false);
  assert.equal(isOverdue({ date: '2024-05-10', done: false }, '2024-05-11', at(2024, 5, 11, 0, 1)), true);
});

test('问题2：单日任务带时间时按时间判断（原有行为不变）', () => {
  const task = { date: '2024-05-10', time: '09:00', done: false };
  assert.equal(isOverdue(task, '2024-05-10', at(2024, 5, 10, 8, 59)), false);
  assert.equal(isOverdue(task, '2024-05-10', at(2024, 5, 10, 9, 1)), true);
});

test('问题2：项目任务按 dueDate/dueTime 判断', () => {
  assert.equal(isOverdue({ dueDate: '2024-05-10', dueTime: '10:00', done: false }, '2024-05-10', at(2024, 5, 10, 9, 0)), false);
  assert.equal(isOverdue({ dueDate: '2024-05-10', dueTime: '10:00', done: false }, '2024-05-10', at(2024, 5, 10, 10, 1)), true);
  assert.equal(isOverdue({ startDate: '2024-05-01', dueDate: '2024-05-20', done: false }, '2024-05-10', at(2024, 5, 10, 12, 0)), false);
  assert.equal(isOverdue({ startDate: '2024-05-01', dueDate: '2024-05-20', done: false }, '2024-05-21', at(2024, 5, 21, 9, 0)), true);
});

test('问题2：已完成的任务永远不逾期', () => {
  assert.equal(isOverdue({ date: '2024-05-01', endDate: '2024-05-02', done: true }, '2024-06-01', at(2024, 6, 1, 12, 0)), false);
});

test('问题2：没有日期的任务不逾期', () => {
  assert.equal(isOverdue({ title: 'x', done: false }, '2024-06-01', at(2024, 6, 1, 12, 0)), false);
  assert.equal(isOverdue(null, '2024-06-01'), false);
});

// ══════════ 今日计划页面 ══════════

const cal = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'calendar.js')).href);
const todayMod = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'today.js')).href);

const PROJECTS = [{
  id: 'p1', name: '项目一', icon: '📁', status: 'active', dateFormat: 'ymd', blocks: [],
  tasks: [
    { id: 'pt1', title: '区间中的项目任务', startDate: PAST, dueDate: FUTURE, subtasks: [] },
    { id: 'pt2', title: '已过期的项目任务', startDate: PAST, dueDate: YESTERDAY, subtasks: [] }
  ]
}];

const DAY_TASKS = [
  { id: 'd1', title: '区间中的每日任务', date: PAST, endDate: FUTURE, time: '09:00', endTime: '18:00', done: false },
  { id: 'd2', title: '已过期的每日任务', date: PAST, endDate: YESTERDAY, time: '09:00', endTime: '18:00', done: false }
];

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/api/preferences')) return { ok: true, status: 200, json: async () => ({ weekStart: 'mon' }) };
  if (u.includes('/api/projects')) return { ok: true, status: 200, json: async () => PROJECTS };
  if (u.includes('/api/tasks?from=')) {
    const from = /from=([\d-]+)/.exec(u)[1];
    const to = /to=([\d-]+)/.exec(u)[1];
    return {
      ok: true,
      status: 200,
      json: async () => DAY_TASKS.filter((t) => (t.endDate || t.date) >= from && t.date <= to)
    };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const tick = () => new Promise((r) => setTimeout(r, 10));
const boardCard = (el, text) => findAllByClass(el, 'cal-board-card').find((c) => textOf(c).includes(text));
const selectDay = async (el, date) => {
  findAllByClass(el, 'cal-col').concat(findAllByClass(el, 'cal-cell')).find((c) => c.dataset.date === date).click();
  await tick();
};

async function renderToday() {
  const el = document.createElement('div');
  await todayMod.render(el);
  const week = findAllByTag(el, 'button').find((b) => textOf(b) === '周视图');
  if (week) week.click();
  await tick();
  return el;
}

test('问题2：看板里，区间还没结束的任务不显示逾期', async () => {
  const el = await renderToday();
  const ongoing = boardCard(el, '区间中的每日任务');
  assert.ok(ongoing, '跨天的任务也应出现在看板上');
  assert.equal(textOf(ongoing).includes('逾期'), false, `区间未结束不应逾期：「${textOf(ongoing)}」`);

  const project = boardCard(el, '区间中的项目任务');
  assert.ok(project);
  assert.equal(textOf(project).includes('逾期'), false);
});

test('问题2：区间已结束的任务显示逾期', async () => {
  const el = await renderToday();
  await selectDay(el, YESTERDAY);

  const day = boardCard(el, '已过期的每日任务');
  assert.ok(day, '应显示在最后一天所在的看板');
  assert.ok(textOf(day).includes('逾期'), `区间结束应逾期：「${textOf(day)}」`);

  const project = boardCard(el, '已过期的项目任务');
  assert.ok(project);
  assert.ok(textOf(project).includes('逾期'));
});

test('问题2：日历条目上的 overdue 标记也按区间终点算', () => {
  const entries = cal.projectEntriesByDate(PROJECTS, TODAY);
  assert.equal(entries.find((e) => e.id === 'pt1').overdue, false, '区间未结束');
  assert.equal(entries.find((e) => e.id === 'pt2').overdue, true, '区间已结束');
});

test('问题2：跨天条目按每一天铺开后，逾期标记一致', () => {
  const byDate = cal.expandEntries(cal.projectEntriesByDate(PROJECTS, TODAY), [PAST, YESTERDAY, FUTURE]);
  const pt1 = byDate.filter((e) => e.id === 'pt1');
  assert.ok(pt1.length >= 2);
  assert.ok(pt1.every((e) => e.overdue === false), '同一条目各天标记一致');

  const pt2 = byDate.filter((e) => e.id === 'pt2');
  assert.ok(pt2.every((e) => e.overdue === true));
});
