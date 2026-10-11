import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { buildDailyBoard, dailyEntries } from '../public/js/daily.js';
import { todayStr, addDays } from '../public/js/utils.js';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
const { apiFixture } = createRequire(import.meta.url)('../test-helpers/api-fixture.js');
const date = todayStr(), past = addDays(date, -1), future = addDays(date, 1);
const button = (root, label) => findAllByTag(root, 'button').find(e => textOf(e) === label);
const control = (root, label, tag = 'input') => findAllByTag(root, tag).find(e => e.getAttribute('aria-label') === label);
const row = (modal, base) => findAllByClass(modal, 'daily-task').find(e => e.dataset.entry === base);
const status = item => findAllByClass(item, 'daily-plan-status').map(textOf);
const tick = () => new Promise(r => setTimeout(r, 15));

function setup(t) {
  const nativeFetch = globalThis.fetch, nativeDocument = globalThis.document;
  globalThis.document = makeDocument();
  const tasks = [
    { id: 'invoice', title: '整理发票', date: past, endDate: past, planDate: date, planPeriod: 'morning' },
    { id: 'legacy', title: '回复消息', date, time: '09:00', endTime: '10:00' },
    { id: 'plain', title: '咨询问题', date },
    { id: 'ongoing', title: '文献调研', date: past, endDate: future },
    { id: 'same', title: '未来事项', date: past, planDate: future },
    { id: 'done', title: '已完成任务', date, done: true }
  ];
  const projects = [{ id: 'p', name: '工作项目', tasks: [
    { id: 'same', title: '今日截止', dueDate: date },
    { id: 'range', title: '连续安排', planDate: past, planEndDate: future, planPeriod: 'afternoon', subtasks: [
      { id: 'child', title: '尚未安排子任务' }
    ] }
  ] }];
  const entries = dailyEntries(tasks, projects), writes = [];
  globalThis.fetch = async (url, options) => { writes.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({}) }; };
  t.after(() => { globalThis.fetch = nativeFetch; globalThis.document = nativeDocument; });
  const root = buildDailyBoard(entries, date, async () => {}); document.body.append(root);
  button(root, '安排任务').click();
  return { entries, root, modal: findAllByClass(document.body, 'daily-arrange-modal')[0], writes };
}

test('弹窗标明全部当天待办及其时段，未安排、未来安排和子任务不会被误标', t => {
  const { modal } = setup(t);
  const expected = [
    ['/api/tasks/invoice', '已在当天待办 · 上午'],
    ['/api/tasks/legacy', '已在当天待办 · 09:00–10:00'],
    ['/api/tasks/plain', '已在当天待办 · 当天待安排'],
    ['/api/projects/p/tasks/same', '已在当天待办 · 当天待安排'],
    ['/api/projects/p/tasks/range', '已在当天待办 · 下午']
  ];
  for (const [base, label] of expected) {
    const item = row(modal, base); assert.ok(item);
    assert.deepEqual(status(item), [label]);
    assert.equal(findAllByClass(item, 'daily-plan-add').length, 0, '已在待办无需重复加入');
  }
  assert.equal(textOf(row(modal, '/api/tasks/legacy')).split('09:00–10:00').length - 1, 1, '时间不重复显示');
  for (const base of ['/api/tasks/ongoing', '/api/tasks/same', '/api/projects/p/tasks/range/subtasks/child']) {
    const item = row(modal, base); assert.ok(item, base); assert.deepEqual(status(item), []);
    assert.equal(findAllByClass(item, 'daily-plan-add').length, 1);
  }
  assert.equal(row(modal, '/api/tasks/done'), undefined);
});

test('标识以正在查看的日期为准，同 ID 的独立任务和项目任务分别判断', t => {
  const { entries } = setup(t);
  const root = buildDailyBoard(entries, future, async () => {}); document.body.append(root);
  button(root, '安排任务').click(); const modal = findAllByClass(document.body, 'daily-arrange-modal').at(-1);
  assert.deepEqual(status(row(modal, '/api/tasks/invoice')), []);
  assert.deepEqual(status(row(modal, '/api/tasks/same')), ['已在当天待办 · 当天待安排']);
  assert.deepEqual(status(row(modal, '/api/projects/p/tasks/same')), []);
  assert.deepEqual(status(row(modal, '/api/projects/p/tasks/range')), ['已在当天待办 · 下午']);
});

test('搜索后已加入标识仍可区分，现有待办可与新任务一起批量调整时段', async t => {
  const { entries, modal, writes } = setup(t), snapshot = structuredClone(entries);
  const choice = control(modal, '选择安排：整理发票'); assert.equal(choice.disabled, false);
  choice.checked = true; choice.fire('change');
  const search = control(modal, '搜索待安排任务'); search.value = '文献调研'; search.fire('input');
  assert.equal(findAllByClass(modal, 'daily-plan-status').length, 0);
  const fresh = control(modal, '选择安排：文献调研'); fresh.checked = true; fresh.fire('change');
  search.value = ''; search.fire('input');
  assert.deepEqual(status(row(modal, '/api/tasks/invoice')), ['已在当天待办 · 上午']);
  assert.equal(control(modal, '选择安排：整理发票').checked, true);
  control(modal, '批量安排时段', 'select').value = 'evening';
  button(modal, '安排选中 2 项').click(); await tick();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body.items.map(e => e.base), ['/api/tasks/invoice', '/api/tasks/ongoing']);
  assert.ok(writes[0].body.items.every(e => e.patch.planDate === date && e.patch.planPeriod === 'evening'));
  assert.deepEqual(entries, snapshot, '展示标识和选择操作不改动原始数据');
});

test('真实 HTTP 加入待办后重开弹窗显示标识，改期及撤销后标识消失', async t => {
  const nativeFetch = globalThis.fetch, nativeDocument = globalThis.document, fixture = await apiFixture(t);
  const project = (await fixture.request('POST', '/api/projects', { name: '研究' })).body;
  const task = (await fixture.request('POST', `/api/projects/${project.id}/tasks`, { title: '提交材料', dueDate: future })).body;
  const base = `/api/projects/${project.id}/tasks/${task.id}`;
  globalThis.document = makeDocument();
  globalThis.fetch = (url, options) => nativeFetch(fixture.base + url, options);
  t.after(() => { globalThis.fetch = nativeFetch; globalThis.document = nativeDocument; });
  const root = document.createElement('div'); document.body.append(root);
  const draw = async () => {
    const tasks = await (await nativeFetch(fixture.base + `/api/tasks?from=${date}&to=${date}&includePool=1`)).json();
    const projects = await (await nativeFetch(fixture.base + '/api/projects')).json();
    root.innerHTML = ''; root.append(buildDailyBoard(dailyEntries(tasks, projects), date, draw));
  };
  const open = () => { button(root, '安排任务').click(); return findAllByClass(document.body, 'daily-arrange-modal').at(-1); };
  await draw(); let modal = open();
  assert.deepEqual(status(row(modal, base)), []);
  button(row(modal, base), '＋ 加入当天').click();
  for (let i = 0; i < 100 && findAllByClass(document.body, 'daily-arrange-modal').length; i++) await tick();
  assert.equal(findAllByClass(document.body, 'daily-arrange-modal').length, 0);
  modal = open(); assert.deepEqual(status(row(modal, base)), ['已在当天待办 · 当天待安排']);
  assert.equal(findAllByClass(root, 'cal-board-card').filter(e => e.dataset.entry === base).length, 1);
  button(modal, '关闭').click();
  for (const planDate of [future, null]) {
    const response = await nativeFetch(fixture.base + base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planDate }) });
    assert.equal(response.status, 200); await draw(); modal = open();
    assert.deepEqual(status(row(modal, base)), []); button(modal, '关闭').click();
  }
  const saved = JSON.parse(readFileSync(fixture.file, 'utf8')).projects[0].tasks[0];
  assert.equal(saved.dueDate, future); assert.equal(saved.planDate, null);
});
