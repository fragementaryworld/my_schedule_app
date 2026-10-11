import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByTag, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr } from '../public/js/utils.js';
import { timelineColor } from '../public/js/views/projects.js';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/today' };

const TODAY = todayStr();
const calendarUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'calendar.js')).href;
const todayUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'today.js')).href;
const cal = await import(calendarUrl);
const todayMod = await import(todayUrl);

const WEEK = cal.weekDates(TODAY, 'mon');
const D0 = WEEK[1];
const D1 = WEEK[2];

const PROJECTS = [
  {
    id: 'p1', name: '项目一', icon: '📁', status: 'active', dateFormat: 'iso', blocks: [],
    tasks: [{ id: 't1', title: '项目一的任务', dueDate: D0, subtasks: [] }]
  },
  {
    id: 'p2', name: '项目二', icon: '📁', status: 'active', dateFormat: 'iso', blocks: [],
    tasks: [{ id: 't2', title: '项目二的任务', dueDate: D0, subtasks: [] }]
  }
];

const DAY_TASK = { id: 'd1', title: '每日任务', date: D1, time: '08:00', priority: 'high', done: false };

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
    return { ok: true, status: 200, json: async () => (DAY_TASK.date >= from && DAY_TASK.date <= to ? [DAY_TASK] : []) };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const tick = () => new Promise((r) => setTimeout(r, 10));
const cellOf = (root, date) => findAllByClass(root, 'cal-col').concat(findAllByClass(root, 'cal-cell'))
  .find((c) => c.dataset.date === date);
const barColor = (node) => {
  const m = /border-left:\s*3px solid (#[0-9a-f]{6})/i.exec(String(node.getAttribute('style')));
  return m && m[1];
};
const dotColor = (node) => {
  const m = /background:\s*(#[0-9a-fA-F]{6})/.exec(String(node.getAttribute('style')));
  return m && m[1];
};

async function renderToday() {
  const el = document.createElement('div');
  await todayMod.render(el);
  findAllByTag(el, 'button').find(b => textOf(b) === '周视图').click();
  await tick();
  return el;
}

// ——— 纯函数 ———

test('问题2：不同项目拿到不同颜色', () => {
  const c1 = timelineColor('p1');
  const c2 = timelineColor('p2');
  assert.notEqual(c1, c2, '两个项目颜色应不同');
  assert.equal(cal.DAY_TASK_COLOR === c1, false, '每日任务配色不与项目色板重复');
});

test('问题2：legendFor 汇总颜色 → 来源，且去重', () => {
  const entries = cal.mergeEntries(
    [{ kind: 'day', date: D1, title: '每日任务', color: cal.DAY_TASK_COLOR, projectId: null }],
    cal.projectEntriesForDates(PROJECTS, [D0, D1], TODAY)
  );
  const all = [...(entries.get(D0) || []), ...(entries.get(D1) || [])];
  const items = cal.legendFor(all);
  assert.deepEqual(items.map((i) => i.label).sort(), ['每日任务', '项目一', '项目二']);
  assert.equal(items.filter((i) => i.label === '项目一').length, 1, '同一项目只出现一次');
  assert.equal(items.find((i) => i.label === '项目一').color, timelineColor('p1'));
  assert.equal(items.find((i) => i.label === '每日任务').color, cal.DAY_TASK_COLOR);
});

test('问题2：legendFor 对空输入安全', () => {
  assert.deepEqual(cal.legendFor([]), []);
  assert.deepEqual(cal.legendFor(null), []);
});

// ——— 页面 ———

test('问题2：事件条用所属项目的颜色，不再重复放颜色圆点', async () => {
  const el = await renderToday();
  const cell = cellOf(el, D0);
  const cards = findAllByClass(cell, 'cal-card');
  assert.equal(cards.length, 2);

  const cardA = cards.find((c) => textOf(c).includes('项目一的任务'));
  const cardB = cards.find((c) => textOf(c).includes('项目二的任务'));
  assert.equal(barColor(cardA), timelineColor('p1'));
  assert.equal(barColor(cardB), timelineColor('p2'));
  assert.notEqual(barColor(cardA), barColor(cardB), '两个项目视觉上可区分');

  assert.equal(findAllByClass(cardA, 'cal-dot').length, 0);
  assert.equal(findAllByClass(cardB, 'cal-dot').length, 0);
});

test('问题2：每日任务用自己的颜色', async () => {
  const el = await renderToday();
  const card = findAllByClass(cellOf(el, D1), 'cal-card')[0];
  assert.equal(barColor(card), cal.DAY_TASK_COLOR);
});

test('问题2：日历下方有图例，列出每个来源的颜色', async () => {
  const el = await renderToday();
  const items = findAllByClass(el, 'cal-legend-item');
  const labels = items.map((i) => textOf(i)).sort();
  assert.deepEqual(labels, ['每日任务', '项目一', '项目二'].sort());

  const map = new Map(items.map((i) => [textOf(i), dotColor(findAllByClass(i, 'cal-dot')[0])]));
  assert.equal(map.get('项目一'), timelineColor('p1'));
  assert.equal(map.get('项目二'), timelineColor('p2'));
  assert.equal(map.get('每日任务'), cal.DAY_TASK_COLOR);
});

test('问题2：图例颜色与卡片颜色一致，且随视图范围变化', async () => {
  const el = await renderToday();
  const legendColors = [...new Set(findAllByClass(el, 'cal-legend-item').map((i) => dotColor(findAllByClass(i, 'cal-dot')[0])))];
  const cardColors = [...new Set(findAllByClass(el, 'cal-card').map((c) => barColor(c)))];
  assert.deepEqual(legendColors.sort(), cardColors.sort(), '图例与实际用色一致');
  assert.equal(legendColors.length, 3, '两个项目 + 每日任务');
});

test('问题2：切到月视图后图例仍然给出正确配色', async () => {
  const el = await renderToday();
  findAllByTag(el, 'button').find((b) => textOf(b) === '月视图').click();
  await tick();
  const items = findAllByClass(el, 'cal-legend-item');
  assert.ok(items.length >= 3);
  const map = new Map(items.map((i) => [textOf(i), dotColor(findAllByClass(i, 'cal-dot')[0])]));
  assert.equal(map.get('项目一'), timelineColor('p1'));
});
