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
  tasks: [{ id: 't1', title: '项目任务', dueDate: TODAY, subtasks: [] }]
}];

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
  if (u.includes('/api/preferences')) return { ok: true, status: 200, json: async () => ({ weekStart: 'mon' }) };
  if (u.includes('/api/projects')) return { ok: true, status: 200, json: async () => PROJECTS };
  if (u.includes('/api/tasks?from=')) return { ok: true, status: 200, json: async () => [] };
  if (method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 'newday1' }) };
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const todayMod = await import(todayUrl);
const tick = () => new Promise((r) => setTimeout(r, 10));

async function renderToday() {
  globalThis.location.hash = '#/today';
  calls.length = 0;
  const el = document.createElement('div');
  await todayMod.render(el);
  return el;
}

const topRow = (el) => findAllByClass(el, 'cal-toolbar-top')[0];
const tabsOf = (el) => findAllByClass(el, 'cal-views')[0];
const addOf = (el) => findAllByClass(el, 'cal-add')[0];

test('问题1：新增任务按钮挪到最右边，视图切换留在左边', async () => {
  const el = await renderToday();
  const top = topRow(el);
  const kids = top.children;

  assert.equal(kids.length, 3, `第一行应是「视图切换 + 分隔 + 新增任务」，实际 ${kids.length} 个`);
  assert.ok(kids[0].classList.contains('cal-views'), '第一个是视图切换');
  assert.ok(kids[1].classList.contains('spacer'), '中间是分隔');
  assert.ok(kids[2].classList.contains('cal-add'), '最后一个（最右）是新增任务');
});

test('问题1：新增任务与视图窗口是分开的（不再挨着）', async () => {
  const el = await renderToday();
  const tabs = tabsOf(el);
  const add = addOf(el);

  assert.equal(findAllByClass(tabs, 'add-day-task').length, 0, '按钮不应在视图切换里面');
  assert.equal(findAllByClass(el, 'cal-views').length, 1, '视图切换只有一处');
  assert.notEqual(add.parentNode, tabs, '两者不是父子关系');

  // 中间夹着分隔元素
  const top = topRow(el);
  const iTabs = top.children.indexOf(tabs);
  const iAdd = top.children.indexOf(add);
  const between = top.children.slice(iTabs + 1, iAdd);
  assert.equal(between.length, 1);
  assert.ok(between[0].classList.contains('spacer'), '中间必须有分隔把它推到右边');
});

test('问题1：分隔元素带最小间距（窄屏也不会贴在一起）', async () => {
  const el = await renderToday();
  const gap = findAllByClass(el, 'cal-toolbar-gap')[0];
  assert.ok(gap, '应有分隔元素');
  assert.ok(gap.classList.contains('spacer'), '复用 flex:1 的 spacer');
});

test('问题1：视图切换仍在左边且顺序不变', async () => {
  const el = await renderToday();
  const tabs = tabsOf(el);
  assert.deepEqual(findAllByClass(tabs, 'tab').map((t) => textOf(t)), ['周视图', '月视图']);
  assert.equal(tabs, topRow(el).children[0], '视图切换是第一项');
});

test('问题1：挪位后按钮仍然可用（新建任务并跳到任务页面）', async () => {
  const el = await renderToday();
  addOf(el).click();
  await tick();
  const post = calls.find((c) => c.method === 'POST' && c.url === '/api/tasks');
  assert.ok(post, '应创建任务');
  assert.equal(post.body.title, '新任务');
  assert.equal(globalThis.location.hash, '#/plan/newday1');
});

test('问题1：第二行仍是周期标题与翻页', async () => {
  const el = await renderToday();
  const nav = findAllByClass(el, 'cal-nav')[0];
  assert.ok(nav, '导航行应保留');
  assert.equal(findAllByClass(nav, 'cal-add').length, 0, '新增任务不在导航行里');
  assert.ok(textOf(findAllByClass(nav, 'cal-period')[0]).length > 0, '有周期标题');
  assert.ok(findAllByClass(nav, 'cal-prev')[0] && findAllByClass(nav, 'cal-next')[0]);
});

test('问题1：按钮在周视图与月视图下都在右侧同一位置', async () => {
  const el = await renderToday();
  findAllByTag(el, 'button').find((b) => textOf(b) === '月视图').click();
  await tick();
  const top = topRow(el);
  assert.equal(top.children.length, 3);
  assert.ok(top.children[0].classList.contains('cal-views'));
  assert.ok(top.children[2].classList.contains('cal-add'));
  assert.ok(findAllByClass(el, 'cal-add')[0], '切到月视图后按钮仍在');
});
