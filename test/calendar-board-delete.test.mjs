import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByTag, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr } from '../public/js/utils.js';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/today' };

const TODAY = todayStr();
const todayUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'today.js')).href;

const PROJECTS = [{
  id: 'p1', name: '项目一', icon: '📁', status: 'active', dateFormat: 'iso', blocks: [],
  tasks: [
    {
      id: 't1', title: '项目任务甲', dueDate: TODAY, done: false, blocks: [], subtasks: [
        { id: 's1', title: '子任务甲', dueDate: TODAY, done: false, subtasks: [] }
      ]
    },
    {
      id: 't9', title: '有子任务的项目任务', dueDate: TODAY, done: false, subtasks: [
        { id: 's9a', title: '子任务一', dueDate: TODAY, done: false, subtasks: [] },
        { id: 's9b', title: '子任务二', dueDate: TODAY, done: false, subtasks: [] }
      ]
    }
  ]
}];

const DAY_TASKS = [
  { id: 'd1', title: '每日任务甲', date: TODAY, time: '08:00', done: false },
  { id: 'd2', title: '重复每日任务', date: TODAY, time: '09:00', done: false, repeat: 'weekly' }
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
const cardOf = (root, text) => findAllByClass(board(root), 'cal-board-card').find((c) => textOf(c).includes(text));
const delOf = (root, text) => findAllByClass(cardOf(root, text), 'cal-board-del')[0];
const dialogButton = (label) => findAllByTag(document.body, 'button').find((b) => textOf(b) === label);
const dialogText = () => {
  const body = findAllByClass(document.body, 'modal-body')[0];
  return body && body.children[0] ? String(body.children[0].innerHTML) : '';
};

async function renderToday() {
  const el = document.createElement('div');
  await todayMod.render(el);
  const week = findAllByTag(el, 'button').find((b) => textOf(b) === '周视图');
  if (week) week.click();
  await tick();
  return el;
}

const todayMod = await import(todayUrl);

test('问题1：看板每张卡片都有删除按钮', async () => {
  const el = await renderToday();
  const cards = findAllByClass(board(el), 'cal-board-card');
  assert.ok(cards.length >= 4, `看板应有多张卡片，实际 ${cards.length}`);
  for (const c of cards) {
    assert.equal(findAllByClass(c, 'cal-board-del').length, 1, `卡片「${textOf(c)}」缺少删除按钮`);
  }
  const del = delOf(el, '每日任务甲');
  assert.equal(del.getAttribute('title'), '删除「每日任务甲」');
  assert.ok(del.getAttribute('aria-label'));
});

test('问题1：点删除会先确认，取消则什么也不做', async () => {
  const el = await renderToday();
  calls.length = 0;
  delOf(el, '每日任务甲').click();
  await tick();

  assert.ok(findAllByClass(document.body, 'modal-backdrop').length >= 1, '应弹出确认框');
  assert.ok(dialogButton('确认') && dialogButton('取消'));

  dialogButton('取消').click();
  await tick();
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0, '取消不应删除');
});

test('问题1：确认后删除每日任务', async () => {
  const el = await renderToday();
  calls.length = 0;
  delOf(el, '每日任务甲').click();
  await tick();
  dialogButton('确认').click();
  await tick();

  const del = calls.find((c) => c.method === 'DELETE');
  assert.ok(del, '应发出删除请求');
  assert.equal(del.url, '/api/tasks/d1');
  assert.ok(calls.some((c) => c.method === 'GET' && c.url.includes('/api/tasks?from=')), '删除后应重新拉取数据');
});

test('问题1：确认后删除项目任务（写到它自己那一层）', async () => {
  const el = await renderToday();
  calls.length = 0;
  delOf(el, '项目任务甲').click();
  await tick();
  dialogButton('确认').click();
  await tick();

  const del = calls.find((c) => c.method === 'DELETE');
  assert.equal(del.url, '/api/projects/p1/tasks/t1');
});

test('问题1：确认后删除深层子任务', async () => {
  const el = await renderToday();
  calls.length = 0;
  delOf(el, '子任务甲').click();
  await tick();
  dialogButton('确认').click();
  await tick();

  const del = calls.find((c) => c.method === 'DELETE');
  assert.equal(del.url, '/api/projects/p1/tasks/t1/subtasks/s1', '子任务要删它自己那一层');
});

test('问题1：确认文案会提示连带删除的子任务', async () => {
  const el = await renderToday();
  delOf(el, '有子任务的项目任务').click();
  await tick();
  assert.ok(dialogText().includes('有子任务的项目任务'));
  assert.ok(dialogText().includes('2 个子任务'), `实际文案「${dialogText()}」`);
  dialogButton('取消').click();
  await tick();
});

test('问题1：重复任务的确认文案提示会删除整个系列', async () => {
  const el = await renderToday();
  delOf(el, '重复每日任务').click();
  await tick();
  assert.ok(dialogText().includes('整个系列'), `实际文案「${dialogText()}」`);
  dialogButton('取消').click();
  await tick();
});

test('问题1：点删除不会误触打开任务页面或改选中日期', async () => {
  const el = await renderToday();
  globalThis.location.hash = '#/today';
  const before = findAllByClass(el, 'cal-col').find((c) => c.classList.contains('selected'));
  delOf(el, '每日任务甲').click();
  await tick();
  assert.equal(globalThis.location.hash, '#/today', '不应打开任务页面');
  const after = findAllByClass(el, 'cal-col').find((c) => c.classList.contains('selected'));
  assert.equal(after && after.dataset.date, before && before.dataset.date, '选中日期不应改变');
  dialogButton('取消').click();
  await tick();
});

test('问题1：删除按钮不参与拖动（不会把点击当成拖拽）', async () => {
  const el = await renderToday();
  const card = cardOf(el, '每日任务甲');
  assert.equal(card.getAttribute('draggable'), 'true', '卡片本身仍可拖动');
  const del = findAllByClass(card, 'cal-board-del')[0];
  assert.equal(del.getAttribute('draggable'), null, '删除按钮本身不可拖动');
  assert.equal(del.getAttribute('type'), 'button', '避免触发表单提交');
});
