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
const D1 = WEEK.filter((d) => d !== TODAY)[0];

const PROJECTS = [
  {
    id: 'p1', name: '项目一', icon: '📁', status: 'active', dateFormat: 'iso', blocks: [],
    tasks: [{ id: 't1', title: '项目一的任务', dueDate: TODAY, subtasks: [] }]
  },
  {
    id: 'p2', name: '项目二', icon: '📁', status: 'active', dateFormat: 'iso', blocks: [],
    tasks: [
      { id: 't2', title: '项目二的任务', dueDate: TODAY, subtasks: [] },
      { id: 't3', title: '跨天任务', startDate: TODAY, dueDate: D1, subtasks: [] }
    ]
  }
];

const DAY_TASK = { id: 'd1', title: '每日任务', date: TODAY, time: '08:00', priority: 'high', done: false };

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
const cardOf = (root, text) => findAllByClass(root, 'cal-card').find((c) => textOf(c).includes(text));
const bgOf = (node) => (/background:(rgba\([^)]+\)|#[0-9a-fA-F]{6})/.exec(String(node.getAttribute('style'))) || [])[1];
const borderOf = (node) => (/border-left:\s*3px solid (#[0-9a-f]{6})/i.exec(String(node.getAttribute('style'))) || [])[1];

async function renderToday() {
  const el = document.createElement('div');
  await todayMod.render(el);
  const week = findAllByTag(el, 'button').find((b) => textOf(b) === '周视图');
  if (week) week.click();
  await tick();
  return el;
}

// ——— 纯函数 ———

test('问题2：tint 把颜色变成半透明同色', () => {
  assert.equal(cal.tint('#4f6ef7'), 'rgba(79, 110, 247, 0.26)');
  assert.equal(cal.tint('#000000', 0.5), 'rgba(0, 0, 0, 0.5)');
  assert.equal(cal.tint('#ffffff', 1), 'rgba(255, 255, 255, 1)');
  assert.equal(cal.tint('bogus'), '');
  assert.equal(cal.tint(null), '');
  assert.equal(cal.tint(undefined), '');
});

test('问题2：tint 默认透明度适合做背景', () => {
  const m = /rgba\(\d+, \d+, \d+, ([\d.]+)\)/.exec(cal.tint('#16a34a'));
  assert.ok(m, '应产出 rgba');
  const a = Number(m[1]);
  assert.ok(a > 0.1 && a < 0.5, `透明度应在可读范围内，实际 ${a}`);
});

// ——— 页面 ———

test('问题2：整个任务 block 的背景都用该任务的颜色（不只左侧色条）', async () => {
  const el = await renderToday();
  const cardA = cardOf(el, '项目一的任务');
  const cardB = cardOf(el, '项目二的任务');
  const cardD = cardOf(el, '每日任务');

  assert.equal(bgOf(cardA), cal.tint(timelineColor('p1')), '项目一：整块背景染色');
  assert.equal(bgOf(cardB), cal.tint(timelineColor('p2')), '项目二：整块背景染色');
  assert.equal(bgOf(cardD), cal.tint(cal.DAY_TASK_COLOR), '每日任务用自己的颜色');

  assert.notEqual(bgOf(cardA), bgOf(cardB), '不同来源背景明显不同');
  assert.equal(borderOf(cardA), timelineColor('p1'), '左侧色条保留');
});

test('问题2：跨天 block 的背景也是整块同色', async () => {
  const el = await renderToday();
  const span = findAllByClass(el, 'cal-span').find((s) => textOf(s).includes('跨天任务'));
  assert.ok(span, '跨天任务应有连续 block');
  assert.equal(bgOf(span), timelineColor('p2'), 'block 用实色铺满');
});

test('问题2：看板卡片同样整块染色', async () => {
  const el = await renderToday();
  await tick();
  const boardCards = findAllByClass(el, 'cal-board-card');
  assert.ok(boardCards.length >= 2);
  const colors = boardCards.map((c) => bgOf(c));
  assert.ok(colors.every((c) => /^rgba\(/.test(String(c))), '每张看板卡片都有染色背景');
  assert.ok(new Set(colors).size >= 2, '不同来源颜色不同');
});

test('问题2：图例仍是实色圆点，与卡片染色对应', async () => {
  const el = await renderToday();
  const items = findAllByClass(el, 'cal-legend-item');
  const map = new Map(items.map((i) => [
    textOf(i),
    (/background:(#[0-9a-fA-F]{6})/.exec(String(findAllByClass(i, 'cal-dot')[0].getAttribute('style'))) || [])[1]
  ]));
  assert.equal(map.get('项目一'), timelineColor('p1'));
  assert.equal(bgOf(cardOf(el, '项目一的任务')), cal.tint(map.get('项目一')), '圆点色 → 卡片背景色可对上');
});
