import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByTag, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr } from '../public/js/utils.js';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/today' };

const TODAY = todayStr();
const calendarUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'calendar.js')).href;
const todayUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'today.js')).href;
const cal = await import(calendarUrl);
const todayMod = await import(todayUrl);

const PROJECTS = [
  {
    id: 'p1', name: '项目一', icon: '📁', status: 'active', dateFormat: 'iso',
    tasks: [
      {
        id: 't1', title: '有内容的项目任务', dueDate: TODAY, done: false,
        desc: '这是描述',
        blocks: [{ id: 'b1', type: 'text', text: '内容块里的文字' }, { id: 'b2', type: 'h2', text: '小标题' }],
        subtasks: [{ id: 's1', title: '子1', done: true }, { id: 's2', title: '子2', done: false }]
      },
      { id: 't2', title: '没有内容的项目任务', dueDate: TODAY, done: true, blocks: [], subtasks: [] }
    ]
  }
];

const DAY_TASKS = [
  { id: 'd1', title: '有备注的每日任务', date: TODAY, time: '08:00', done: false, note: '记得带伞，顺便买牛奶' },
  { id: 'd2', title: '没有备注的每日任务', date: TODAY, time: '09:00', done: false, note: '' }
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
const board = (root) => findAllByClass(root, 'cal-board')[0];
const cols = (root) => findAllByClass(board(root), 'kanban-col');
const cardIn = (root, i, text) => findAllByClass(cols(root)[i], 'cal-board-card').find((c) => textOf(c).includes(text));

async function renderToday() {
  const el = document.createElement('div');
  await todayMod.render(el);
  const week = findAllByTag(el, 'button').find((b) => textOf(b) === '周视图');
  if (week) week.click();
  await tick();
  return el;
}

const drag = (card, id) => {
  const data = {};
  card.fire('dragstart', { dataTransfer: { setData: (k, v) => { data[k] = v; } } });
  return data['text/plain'];
};
const drop = (col, id) => col.fire('drop', { preventDefault() {}, dataTransfer: { getData: () => id } });

// ——— 纯函数 ———

test('问题3：blocksText 拼接内容块文字', () => {
  assert.equal(cal.blocksText([{ text: 'a' }, { text: ' b ' }, { text: '' }]), 'a b');
  assert.equal(cal.blocksText([{ type: 'divider' }]), '');
  assert.equal(cal.blocksText(null), '');
});

test('问题3：truncate 超长才截断', () => {
  assert.equal(cal.truncate('abc', 5), 'abc');
  assert.equal(cal.truncate('abcdefgh', 3), 'abc…');
  assert.equal(cal.truncate('  x  '), 'x');
  assert.equal(cal.truncate(null), '');
});

test('问题3：detailText 用内容（整篇 Markdown）', () => {
  assert.equal(cal.detailText({ desc: '描述' }), '描述');
  assert.equal(cal.detailText({ desc: '  第一行\n第二行  ' }), '第一行\n第二行');
  assert.equal(cal.detailText({ desc: '' }), '');
  assert.equal(cal.detailText({ blocks: [{ text: '旧的多行内容块' }] }), '', '内容已统一到 desc，不再读旧内容块');
  assert.equal(cal.detailText(null), '');
});

test('问题3：条目上带详情与子任务统计', () => {
  const entries = cal.projectEntriesByDate(PROJECTS, TODAY);
  const t1 = entries.find((e) => e.id === 't1');
  assert.equal(t1.detail, '这是描述', '只取内容，不再拼接旧内容块');
  assert.equal(t1.subtaskCount, 2);
  assert.equal(t1.subtaskDone, 1);

  const t2 = entries.find((e) => e.id === 't2');
  assert.equal(t2.detail, '');
  assert.equal(t2.subtaskCount, 0);
});

// ——— 看板拖动 ———

test('问题3：看板卡片可以拖动，拖到已完成会写回完成', async () => {
  const el = await renderToday();
  const card = cardIn(el, 0, '有备注的每日任务');
  assert.equal(card.getAttribute('draggable'), 'true');
  assert.equal(drag(card, 'x'), 'd1', 'dragstart 带上任务 id');

  calls.length = 0;
  drop(cols(el)[1], 'd1');
  await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, '/api/tasks/d1');
  assert.deepEqual(put.body, { done: true });
});

test('问题3：拖回待办会取消完成', async () => {
  const el = await renderToday();
  const card = cardIn(el, 1, '没有内容的项目任务');
  assert.ok(card, '已完成列里有它');

  calls.length = 0;
  drop(cols(el)[0], 't2');
  await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, '/api/projects/p1/tasks/t2', '项目任务写到它自己那一层');
  assert.deepEqual(put.body, { done: false });
});

test('问题3：拖到原来那一列不做任何事', async () => {
  const el = await renderToday();
  calls.length = 0;
  drop(cols(el)[0], 'd1');
  await tick();
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
});

test('问题3：拖动时列会高亮', async () => {
  const el = await renderToday();
  const col = cols(el)[1];
  col.fire('dragover', { preventDefault() {} });
  assert.ok(col.classList.contains('drop-hover'));
  col.fire('dragleave', {});
  assert.equal(col.classList.contains('drop-hover'), false);
});

// ——— 看板显示详细内容 ———

test('问题3：有详细内容的任务在看板上显示详情', async () => {
  const el = await renderToday();

  const projectCard = cardIn(el, 0, '有内容的项目任务');
  const detail = findAllByClass(projectCard, 'cal-board-detail')[0];
  assert.ok(detail, '项目任务应显示详情');
  assert.equal(textOf(detail), '这是描述', '只显示内容（不再拼旧内容块）');

  const dayCard = cardIn(el, 0, '有备注的每日任务');
  const dayDetail = findAllByClass(dayCard, 'cal-board-detail')[0];
  assert.ok(dayDetail, '每日任务的备注也要显示');
  assert.equal(textOf(dayDetail), '记得带伞，顺便买牛奶');
});

test('问题3：没有详细内容的任务不显示详情区', async () => {
  const el = await renderToday();
  const plain = cardIn(el, 0, '没有备注的每日任务');
  assert.equal(findAllByClass(plain, 'cal-board-detail').length, 0);
});

test('问题3：详情过长会截断', async () => {
  const backup = globalThis.fetch;
  const long = 'x'.repeat(200);
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/api/preferences')) return { ok: true, status: 200, json: async () => ({ weekStart: 'mon' }) };
    if (u.includes('/api/projects')) return { ok: true, status: 200, json: async () => [] };
    if (u.includes('/api/tasks?from=')) {
      return { ok: true, status: 200, json: async () => [{ id: 'd9', title: '超长备注', date: TODAY, done: false, note: long }] };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const el = document.createElement('div');
  await todayMod.render(el);
  const detail = findAllByClass(el, 'cal-board-detail')[0];
  assert.ok(detail);
  const text = textOf(detail);
  assert.equal(text.length, 91, '90 字 + 省略号');
  assert.ok(text.endsWith('…'));
  globalThis.fetch = backup;
});

test('问题3：子任务数量显示在看板卡片上', async () => {
  const el = await renderToday();
  const card = cardIn(el, 0, '有内容的项目任务');
  assert.ok(textOf(card).includes('子任务 1/2'));
  const plain = cardIn(el, 0, '没有备注的每日任务');
  assert.ok(!textOf(plain).includes('子任务'));
});
