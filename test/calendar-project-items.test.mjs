import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByTag, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr, addDays } from '../public/js/utils.js';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/today' };

const TODAY = todayStr();
const TOMORROW = addDays(TODAY, 1);
const YESTERDAY = addDays(TODAY, -1);

const PROJECTS = [{
  id: 'p1', name: '项目A', icon: '📁', status: 'active', dateFormat: 'iso', blocks: [],
  startDate: TODAY, dueDate: TOMORROW,
  tasks: [
    {
      id: 't1', title: '项目任务1', done: false, startDate: TODAY, dueDate: TOMORROW, dueTime: '10:00', subtasks: [
        {
          id: 's1', title: '子任务1', done: false, dueDate: TODAY, subtasks: [
            { id: 's2', title: '子子任务', done: true, startDate: TODAY, subtasks: [] }
          ]
        }
      ]
    },
    { id: 't2', title: '无日期任务', done: false, subtasks: [] },
    { id: 't3', title: '逾期任务', done: false, dueDate: YESTERDAY, subtasks: [] }
  ]
}];

const DAY_TASKS = [
  { id: 'd1', title: '每日任务', date: TODAY, time: '08:00', priority: 'high', done: false }
];

const calls = [];
let dayTasks = DAY_TASKS;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
  if (u.includes('/api/preferences')) return { ok: true, status: 200, json: async () => ({ weekStart: 'mon' }) };
  if (u.includes('/api/projects')) return { ok: true, status: 200, json: async () => PROJECTS };
  if (u.includes('/api/tasks?from=')) {
    const from = /from=([\d-]+)/.exec(u)[1];
    const to = /to=([\d-]+)/.exec(u)[1];
    return { ok: true, status: 200, json: async () => dayTasks.filter((t) => t.date >= from && t.date <= to) };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const calendarUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'calendar.js')).href;
const todayUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'today.js')).href;
const cal = await import(calendarUrl);
const todayMod = await import(todayUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));
const cellOf = (root, date) => findAllByClass(root, 'cal-col').concat(findAllByClass(root, 'cal-cell'))
  .find((c) => c.dataset.date === date);
const titleIn = (root, text) => findAllByClass(root, 'cal-card').find((c) => textOf(c).includes(text));

async function renderToday() {
  calls.length = 0;
  dayTasks = DAY_TASKS;
  const el = document.createElement('div');
  await todayMod.render(el);
  // 视图选择是全局状态，显式回到周视图，避免用例之间互相影响
  const week = findAllByTag(el, 'button').find((b) => textOf(b) === '周视图');
  if (week) week.click();
  await tick();
  return el;
}

// ——— 纯函数 ———

test('问题3：flattenProjectItems 摊平所有层级的任务', () => {
  const flat = cal.flattenProjectItems(PROJECTS);
  assert.deepEqual(flat.map((x) => x.node.id), ['t1', 's1', 's2', 't2', 't3']);
  assert.deepEqual(flat.map((x) => x.depth), [1, 2, 3, 1, 1]);
  assert.deepEqual(flat.find((x) => x.node.id === 's2').path, ['t1', 's1', 's2']);
  assert.equal(flat[0].project.name, '项目A');
});

test('问题3：flattenProjectItems 对非数组安全', () => {
  assert.deepEqual(cal.flattenProjectItems(null), []);
  assert.deepEqual(cal.flattenProjectItems({ ok: true }), []);
});

test('问题3：itemCalendarDate 优先截止日，其次开始日', () => {
  assert.equal(cal.itemCalendarDate({ startDate: '2024-05-01', dueDate: '2024-05-10' }), '2024-05-10');
  assert.equal(cal.itemCalendarDate({ startDate: '2024-05-01' }), '2024-05-01');
  assert.equal(cal.itemCalendarDate({ dueDate: '2024-05-10' }), '2024-05-10');
  assert.equal(cal.itemCalendarDate({}), null);
  assert.equal(cal.itemCalendarDate(null), null);
});

test('问题3：projectEntriesByDate 生成日历条目（含接口与页面地址）', () => {
  const entries = cal.projectEntriesByDate(PROJECTS, TODAY);
  assert.deepEqual(entries.map((e) => e.id).sort(), ['s1', 's2', 't1', 't3'], '没有日期的任务不进日历');
  assert.ok(entries.every((e) => e.kind === 'project'));

  const t1 = entries.find((e) => e.id === 't1');
  assert.equal(t1.date, TOMORROW, '落在截止日');
  assert.equal(t1.time, '10:00');
  assert.equal(t1.base, '/api/projects/p1/tasks/t1');
  assert.equal(t1.href, '#/task/p1/t1');
  assert.equal(t1.projectName, '项目A');

  const s1 = entries.find((e) => e.id === 's1');
  assert.equal(s1.date, TODAY);
  assert.equal(s1.base, '/api/projects/p1/tasks/t1/subtasks/s1');
  assert.equal(s1.href, '#/task/p1/t1/s1');

  const s2 = entries.find((e) => e.id === 's2');
  assert.equal(s2.date, TODAY, '只有开始日就用开始日');
  assert.equal(s2.base, '/api/projects/p1/tasks/t1/subtasks/s1/subtasks/s2');
  assert.equal(s2.href, '#/task/p1/t1/s1/s2');
  assert.equal(s2.depth, 3);
});

test('问题3：逾期标记只看未完成的截止日', () => {
  const entries = cal.projectEntriesByDate(PROJECTS, TODAY);
  assert.equal(entries.find((e) => e.id === 't3').overdue, true);
  assert.equal(entries.find((e) => e.id === 't1').overdue, false);
  assert.equal(entries.find((e) => e.id === 's2').overdue, false, '已完成不算逾期');
});

test('问题3：mergeEntries 把每日任务与项目任务合并分组', () => {
  const map = cal.mergeEntries(DAY_TASKS.map((t) => ({ ...t, kind: 'day' })), cal.projectEntriesByDate(PROJECTS, TODAY));
  assert.deepEqual((map.get(TODAY) || []).map((e) => e.id).sort(), ['d1', 's1', 's2']);
  assert.deepEqual((map.get(TOMORROW) || []).map((e) => e.id), ['t1']);
  assert.deepEqual((map.get(YESTERDAY) || []).map((e) => e.id), ['t3']);
});

// ——— 页面 ———

test('问题3：日历里能看到工作项目的任务（含各级子任务）', async () => {
  const el = await renderToday();
  const todayCell = cellOf(el, TODAY);
  const names = findAllByClass(todayCell, 'cal-card-title').map((t) => textOf(t)).sort();
  // 项目任务1 跨 今天→明天，改由顶部的连续 block 表示，不再重复成卡片
  assert.deepEqual(names, ['子任务1', '子子任务', '每日任务'].sort());

  const projectCards = findAllByClass(todayCell, 'cal-card').filter((c) => c.classList.contains('from-project'));
  assert.equal(projectCards.length, 2, '两条单日子任务来自工作项目');
  assert.ok(textOf(todayCell).includes('📁 项目A'), '标出来自哪个项目');
  assert.ok(findAllByClass(el, 'cal-span').some((s) => textOf(s).includes('项目任务1')), '跨天的项目任务画成 block');

  assert.equal(findAllByClass(cellOf(el, TOMORROW), 'cal-card-title').length, 0, '明天不再重复这张卡片');
});

test('问题3：项目任务勾选写到它自己那一层', async () => {
  const el = await renderToday();
  const card = titleIn(cellOf(el, TODAY), '子子任务');
  calls.length = 0;
  findAllByClass(card, 'cal-check')[0].click();
  await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, '/api/projects/p1/tasks/t1/subtasks/s1/subtasks/s2');
  assert.deepEqual(put.body, { done: false }, '原本已完成，点一下取消');
});

test('问题3：项目任务标题跳到对应层级页面', async () => {
  const el = await renderToday();
  globalThis.location.hash = '#/today';
  findAllByClass(titleIn(cellOf(el, TODAY), '子任务1'), 'cal-card-title')[0].click();
  assert.equal(globalThis.location.hash, '#/task/p1/t1/s1');
});

test('问题3：月视图同样显示项目任务', async () => {
  const el = await renderToday();
  findAllByTag(el, 'button').find((b) => textOf(b) === '月视图').click();
  await tick();
  const cell = cellOf(el, TODAY);
  assert.ok(cell.classList.contains('cal-cell'), '月视图用格子');
  assert.ok(findAllByClass(cell, 'cal-card').some((c) => c.classList.contains('from-project')));
  assert.ok(textOf(cell).includes('子任务1'));
});

test('问题3：项目任务与每日任务按时间混排', async () => {
  const el = await renderToday();
  const titles = findAllByClass(cellOf(el, TODAY), 'cal-card-title').map((t) => textOf(t));
  assert.equal(titles[0], '每日任务', '08:00 的每日任务排最前');
  assert.equal(titles.length, 3, '单日卡片 3 张（跨天的那条走 block）');
});
