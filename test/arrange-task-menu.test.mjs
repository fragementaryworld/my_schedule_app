import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { buildDailyBoard, dailyEntries } from '../public/js/daily.js';
import { todayStr, addDays } from '../public/js/utils.js';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
const { apiFixture } = createRequire(import.meta.url)('../test-helpers/api-fixture.js');
const date = todayStr(), future = addDays(date, 2);
const button = (root, label) => findAllByTag(root, 'button').find(e => textOf(e) === label);
const tick = () => new Promise(r => setTimeout(r, 15));
const taskRow = (root, base) => findAllByClass(root, 'daily-task').find(e => e.dataset.entry === base);
const taskMenu = (root, base) => findAllByClass(taskRow(root, base), 'daily-task-menu')[0];
const editor = () => findAllByClass(document.body, 'modal').find(e => !e.classList.contains('daily-arrange-modal'));

function setup(t) {
  const nativeFetch = globalThis.fetch, nativeDocument = globalThis.document;
  globalThis.document = makeDocument();
  const tasks = [
    { id: 'a', title: '整理发票', date, planDate: date, planPeriod: 'morning' },
    { id: 'b', title: '持续调研', date: addDays(date, -1), endDate: future }
  ];
  const projects = [{ id: 'p', name: '项目', tasks: [{ id: 'root', title: '项目任务', dueDate: future, subtasks: [
    { id: 'child', title: '子任务', dueDate: future, planDate: date, planEndDate: future, planPeriod: 'afternoon' }
  ] }] }];
  const entries = dailyEntries(tasks, projects), writes = [];
  let refreshed = 0;
  globalThis.fetch = async (url, options) => { writes.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({}) }; };
  t.after(() => { globalThis.fetch = nativeFetch; globalThis.document = nativeDocument; });
  const root = buildDailyBoard(entries, date, async () => { refreshed++; }, { onRemove: async () => {} });
  document.body.append(root); button(root, '安排任务').click();
  return { entries, root, modal: findAllByClass(document.body, 'daily-arrange-modal')[0], writes, refreshed: () => refreshed };
}

test('安排弹窗的普通事务、持续任务和项目子任务都有可读菜单，已安排任务可撤销', t => {
  const { modal } = setup(t);
  for (const base of ['/api/tasks/a', '/api/tasks/b', '/api/projects/p/tasks/root', '/api/projects/p/tasks/root/subtasks/child']) {
    const menu = taskMenu(modal, base); assert.ok(menu, base);
    assert.ok(button(menu, '调整日期或时间')); assert.ok(button(menu, '改到明天')); assert.ok(button(menu, '删除任务'));
    assert.equal(button(menu, '↑ 上移'), undefined, '候选列表不提供看板排序');
  }
  assert.ok(button(taskMenu(modal, '/api/tasks/a'), '撤销当天安排'));
  assert.ok(button(taskMenu(modal, '/api/projects/p/tasks/root/subtasks/child'), '撤销这段安排'));
  assert.equal(button(taskMenu(modal, '/api/tasks/b'), '撤销当天安排'), undefined);
});

test('安排弹窗中点击菜单内容不会误关闭，外部点击和 Escape 正常收起', t => {
  const { modal } = setup(t), menu = taskMenu(modal, '/api/tasks/a');
  const summary = findAllByTag(menu, 'summary')[0];
  menu.open = true; menu.fire('toggle');
  findAllByClass(menu, 'daily-task-menu-items')[0].click(); assert.equal(menu.open, true);
  modal.click(); assert.equal(menu.open, false);
  menu.open = true; menu.fire('toggle'); document.dispatchEvent('keydown', { key: 'Escape' });
  assert.equal(menu.open, false); assert.equal(document.activeElement, summary);
});

test('取消编辑保留安排弹窗与跨清单选择，保存失败允许重试，成功后关闭旧弹窗', async t => {
  const { modal, writes, refreshed } = setup(t), menu = taskMenu(modal, '/api/tasks/a');
  const pick = findAllByTag(modal, 'input').find(e => e.getAttribute('aria-label') === '选择安排：持续调研');
  pick.checked = true; pick.fire('change');
  menu.open = true; button(menu, '调整日期或时间').click();
  assert.equal(menu.open, false); assert.ok(editor());
  button(editor(), '取消').click(); await tick();
  assert.equal(modal.isConnected, true); assert.equal(pick.checked, true); assert.equal(writes.length, 0);
  button(menu, '调整日期或时间').click();
  let form = editor(); findAllByTag(form, 'select')[0].value = 'evening';
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: '模拟写盘失败' }) });
  findAllByTag(form, 'form')[0].fire('submit'); await tick();
  assert.ok(textOf(form).includes('安排未保存')); assert.equal(modal.isConnected, true); assert.equal(pick.checked, true);
  assert.equal(refreshed(), 0);
  globalThis.fetch = async (url, options) => { writes.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({}) }; };
  findAllByTag(form, 'form')[0].fire('submit'); await tick();
  assert.equal(writes.length, 1); assert.equal(writes[0].url, '/api/tasks/a');
  assert.equal(writes[0].body.planPeriod, 'evening'); assert.equal(refreshed(), 1);
  assert.equal(modal.isConnected, false); assert.equal(editor(), undefined);
});

test('弹窗菜单改到明天、撤销跨天安排使用原任务接口，项目截止日期保持不变', async t => {
  const state = setup(t);
  let menu = taskMenu(state.modal, '/api/tasks/a'); menu.open = true;
  button(menu, '改到明天').click(); await tick();
  assert.equal(menu.open, false); assert.equal(state.modal.isConnected, false);
  assert.equal(state.writes[0].body.planDate, addDays(date, 1)); assert.equal(state.writes[0].body.planPeriod, 'morning');
  button(state.root, '安排任务').click();
  state.modal = findAllByClass(document.body, 'daily-arrange-modal')[0];
  menu = taskMenu(state.modal, '/api/projects/p/tasks/root/subtasks/child');
  button(menu, '撤销这段安排').click(); await tick();
  assert.deepEqual(state.writes[1], { url: '/api/projects/p/tasks/root/subtasks/child', body: { planDate: null } });
  assert.equal(state.entries.find(e => e.id === 'child').dueDate, future);
  assert.equal(state.modal.isConnected, false);
});

test('真实 HTTP 从安排列表的菜单编辑深层项目任务，保存的日期范围和时段可从磁盘重读', async t => {
  const nativeFetch = globalThis.fetch, nativeDocument = globalThis.document, fixture = await apiFixture(t);
  const project = (await fixture.request('POST', '/api/projects', { name: '测试项目' })).body;
  const parent = (await fixture.request('POST', `/api/projects/${project.id}/tasks`, { title: '父任务' })).body;
  const created = await fixture.request('POST', `/api/projects/${project.id}/tasks/${parent.id}/subtasks`, { title: '资料调研', dueDate: future, dueTime: '17:00' });
  assert.equal(created.status, 201);
  const child = created.body;
  const base = `/api/projects/${project.id}/tasks/${parent.id}/subtasks/${child.id}`;
  globalThis.document = makeDocument(); globalThis.fetch = (url, options) => nativeFetch(fixture.base + url, options);
  t.after(() => { globalThis.fetch = nativeFetch; globalThis.document = nativeDocument; });
  const root = buildDailyBoard(dailyEntries([], fixture.server.store.get().projects), date, async () => {});
  document.body.append(root); button(root, '安排任务').click();
  const modal = findAllByClass(document.body, 'daily-arrange-modal')[0];
  button(taskMenu(modal, base), '调整日期或时间').click();
  const form = editor(), dates = findAllByTag(form, 'input').filter(e => e.type === 'date');
  dates[0].value = date; dates[1].value = future;
  findAllByTag(form, 'select')[0].value = 'afternoon'; findAllByTag(form, 'form')[0].fire('submit');
  for (let i = 0; i < 100 && modal.isConnected; i++) await tick();
  assert.equal(modal.isConnected, false); assert.equal(editor(), undefined);
  const saved = JSON.parse(readFileSync(fixture.file, 'utf8')).projects[0].tasks[0].subtasks[0];
  assert.equal(saved.planDate, date); assert.equal(saved.planEndDate, future); assert.equal(saved.planPeriod, 'afternoon');
  assert.equal(saved.dueDate, future); assert.equal(saved.dueTime, '17:00'); assert.equal(saved.done, false);
});

test('安排弹窗菜单参与正常排版，避免被滚动容器和窄屏左侧裁切；看板菜单仍浮动', () => {
  const css = readFileSync(new URL('../public/css/modules.css', import.meta.url), 'utf8');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const popup = rules.find(m => m[1].trim() === '.daily-arrange-modal .daily-task-menu-items')[2];
  assert.match(popup, /position:static/); assert.match(popup, /max-width:100%/);
  const board = rules.find(m => m[1].trim() === '.daily-task-menu-items')[2];
  assert.match(board, /position:absolute/);
});
