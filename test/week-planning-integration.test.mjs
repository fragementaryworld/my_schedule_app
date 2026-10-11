import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr, addDays } from '../public/js/utils.js';
import { weekDates } from '../public/js/calendar.js';
import { render } from '../public/js/views/today.js';
import { cancelCalendarDrag } from '../public/js/calendar-drag.js';
const { apiFixture } = createRequire(import.meta.url)('../test-helpers/api-fixture.js');
const { createApp } = createRequire(import.meta.url)('../lib/api.js');
const buttons = root => findAllByTag(root, 'button');
const button = (root, title) => buttons(root).find(e => textOf(e) === title);

async function setup(t) {
  const nativeFetch = globalThis.fetch, fixture = await apiFixture(t);
  const dates = weekDates(todayStr()), from = dates[1], to = dates[2];
  const project = (await fixture.request('POST', '/api/projects', { name: '项目' })).body;
  const planned = (await fixture.request('POST', `/api/projects/${project.id}/tasks`, { title: '两日调研', dueDate: dates[6], dueTime: '17:00', planDate: from, planEndDate: to, planPeriod: 'morning' })).body;
  const context = (await fixture.request('POST', `/api/projects/${project.id}/tasks`, { title: '未安排的调研范围', startDate: dates[0], dueDate: dates[3], dueTime: '17:00' })).body;
  const timed = (await fixture.request('POST', '/api/tasks', { title: '整理发票', date: addDays(from, -20), planDate: from, planTime: '09:00', planEndTime: '10:00' })).body;
  const peer = (await fixture.request('POST', '/api/tasks', { title: '约定会议', date: to, planDate: to, planTime: '09:30', planEndTime: '10:30' })).body;
  globalThis.document = makeDocument(); globalThis.location = { hash: '#/today' };
  globalThis.fetch = (url, options) => nativeFetch(fixture.base + url, options);
  t.after(() => { cancelCalendarDrag(); globalThis.fetch = nativeFetch; });
  const root = document.createElement('div'); document.body.append(root); await render(root);
  button(root, '周视图').click();
  const waitFor = async predicate => {
    const until = Date.now() + 2500;
    while (!predicate()) { if (Date.now() > until) assert.fail(`等待页面或持久化更新超时：${JSON.stringify(fixture.server.store.get().tasks.map(e => ({ title: e.title, planDate: e.planDate, planPeriod: e.planPeriod })))}`); await new Promise(r => setTimeout(r, 5)); }
  };
  await new Promise(r => setTimeout(r, 15));
  const row = () => findAllByClass(root, 'cal-row')[0];
  const geometry = () => {
    row().getBoundingClientRect = () => ({ left: 0, top: 0, width: 700, height: 500 });
    for (const cell of findAllByClass(root, 'week-period-cell')) {
      const col = dates.indexOf(cell.dataset.date), period = ['morning', 'afternoon', 'evening', ''].indexOf(cell.dataset.period);
      cell.getBoundingClientRect = () => ({ left: col * 100, top: 100 + period * 100, width: 100, height: 100 });
    }
    for (const [col, cell] of findAllByClass(root, 'week-date-context').entries()) cell.getBoundingClientRect = () => ({ left: col * 100, top: 30, width: 100, height: 70 });
  };
  const point = (date, period, fraction = .5) => ({ clientX: (dates.indexOf(date) + fraction) * 100, clientY: 150 + ['morning', 'afternoon', 'evening', ''].indexOf(period) * 100 });
  const event = title => findAllByClass(root, 'cal-span').find(e => e.getAttribute('title')?.startsWith(title))
    || findAllByClass(root, 'cal-event').find(e => e.getAttribute('title')?.startsWith(title));
  const drag = (handle, start, end, cancel = false) => {
    geometry(); handle.fire('mousedown', { button: 0, ...start });
    document.dispatchEvent('mousemove', end);
    if (cancel) document.dispatchEvent('keydown', { key: 'Escape' });
    else document.dispatchEvent('mouseup', end);
  };
  const task = () => fixture.server.store.get().tasks.find(e => e.id === timed.id);
  const item = () => fixture.server.store.get().projects.find(e => e.id === project.id).tasks.find(e => e.id === planned.id);
  return { ...fixture, root, dates, from, to, planned, context, timed, peer, task, item, geometry, point, event, drag, waitFor, nativeFetch };
}

test('真实 HTTP：周内跨日期和时段移动整段安排，保留项目截止，拉伸只调整执行日期', async t => {
  const s = await setup(t);
  s.drag(s.event('两日调研'), s.point(s.from, 'morning'), s.point(s.to, 'afternoon'));
  await s.waitFor(() => s.item().planDate === s.to && s.item().planPeriod === 'afternoon' && s.event('两日调研')?.parentNode.getAttribute('style').includes('grid-row:4'));
  assert.equal(s.item().planEndDate, s.dates[3]);
  assert.equal(s.item().dueDate, s.dates[6]); assert.equal(s.item().dueTime, '17:00');
  const span = s.event('两日调研');
  assert.equal(span.parentNode.getAttribute('style'), 'grid-column:1 / -1;grid-row:4', '连续条进入下午行');
  s.drag(findAllByClass(span, 'cal-resize-handle').find(h => h.classList.contains('right')), s.point(s.dates[3], 'afternoon', .95), s.point(s.dates[4], 'evening'));
  await s.waitFor(() => s.item().planEndDate === s.dates[4] && s.event('两日调研')?.getAttribute('title').includes(s.dates[4]));
  assert.equal(s.item().planPeriod, 'afternoon', '拉伸忽略纵向时段变化');
  assert.equal(s.item().dueDate, s.dates[6]);
  const disk = createApp({ dataFile: s.file }).store.get().projects[0].tasks.find(e => e.id === s.planned.id);
  assert.equal(disk.planPeriod, 'afternoon'); assert.equal(disk.planEndDate, s.dates[4]);
  assert.equal(findAllByClass(document.body, 'cal-range-preview').length, 0);
});

test('真实 HTTP：带具体时间的跨时段拖动先复核，取消不保存，确认后替换时间', async t => {
  const s = await setup(t), original = structuredClone(s.task());
  s.drag(s.event('整理发票'), s.point(s.from, 'morning'), s.point(s.from, 'afternoon'));
  await s.waitFor(() => button(document.body, '保存安排'));
  assert.deepEqual(s.task(), original, '拖动不静默清除09:00–10:00');
  button(document.body, '取消').click(); await new Promise(r => setTimeout(r, 5)); assert.deepEqual(s.task(), original);
  s.drag(s.event('整理发票'), s.point(s.from, 'morning'), s.point(s.to, 'afternoon'));
  await s.waitFor(() => button(document.body, '保存安排'));
  const form = findAllByTag(document.body, 'form')[0];
  const times = findAllByTag(form, 'input').filter(e => e.getAttribute('type') === 'time');
  assert.equal(findAllByTag(form, 'select')[0].value, 'afternoon');
  assert.equal(times[0].value, ''); assert.equal(times[1].value, '');
  form.fire('submit');
  await s.waitFor(() => s.task().planDate === s.to && s.task().planPeriod === 'afternoon' && !button(document.body, '保存安排'));
  assert.equal(s.task().planTime, null); assert.equal(s.task().planEndTime, null);
  assert.equal(s.task().date, original.date);
});

test('真实 HTTP：同一时段改日期保留具体时间，发现冲突必须复核，允许重叠才保存', async t => {
  const s = await setup(t);
  s.drag(s.event('整理发票'), s.point(s.from, 'morning'), s.point(s.to, 'morning'));
  await s.waitFor(() => button(document.body, '保存安排'));
  assert.equal(s.task().planDate, s.from);
  const form = findAllByTag(document.body, 'form')[0];
  const inputs = findAllByTag(form, 'input'), times = inputs.filter(e => e.getAttribute('type') === 'time');
  assert.equal(times[0].value, '09:00'); assert.equal(times[1].value, '10:00');
  form.fire('submit'); await new Promise(r => setTimeout(r, 15));
  assert.match(textOf(findAllByClass(form, 'field-error')[0]), /约定会议/);
  assert.equal(s.task().planDate, s.from);
  inputs.find(e => e.getAttribute('type') === 'checkbox').checked = true; form.fire('submit');
  await s.waitFor(() => s.task().planDate === s.to && !button(document.body, '保存安排'));
  assert.equal(s.task().planTime, '09:00'); assert.equal(s.task().planEndTime, '10:00');
});

test('真实 HTTP：待安排为空值也能落位，拖出、Esc 和保存失败均保留原安排并清理预览', async t => {
  const s = await setup(t);
  const original = structuredClone(s.item());
  s.drag(s.event('两日调研'), s.point(s.from, 'morning'), s.point(s.from, 'afternoon'), true);
  assert.deepEqual(s.item(), original);
  s.drag(s.event('两日调研'), s.point(s.from, 'morning'), { clientX: 50, clientY: 20 });
  assert.deepEqual(s.item(), original, '日期标题不是时段落点');
  const writes = [];
  globalThis.fetch = (url, options) => options?.method === 'PUT'
    ? (writes.push(url), Promise.resolve({ ok: false, status: 500, json: async () => ({ error: '测试写盘失败' }) })) : s.nativeFetch(s.base + url, options);
  const event = s.event('两日调研');
  s.drag(event, s.point(s.from, 'morning'), s.point(s.from, 'afternoon'));
  await s.waitFor(() => writes.length === 1); await new Promise(r => setTimeout(r, 15));
  assert.deepEqual(s.item(), original); assert.equal(event.style.transform, '');
  assert.equal(findAllByClass(document.body, 'cal-drag-hint').length, 0);
  assert.equal(findAllByClass(s.root, 'cal-drop-target').length, 0);
  globalThis.fetch = (url, options) => s.nativeFetch(s.base + url, options);
  s.drag(s.event('两日调研'), s.point(s.from, 'morning'), s.point(s.from, ''));
  await s.waitFor(() => s.item().planPeriod === null && s.event('两日调研')?.parentNode.getAttribute('style').includes('grid-row:6'));
  assert.equal(s.item().planDate, s.from); assert.equal(s.item().planEndDate, s.to);
});

test('真实 HTTP：原日期范围拖入待安排或时段创建执行段，保留原始项目范围', async t => {
  const s = await setup(t);
  const source = { clientX: 50, clientY: 60 };
  s.drag(s.event('未安排的调研范围'), source, s.point(s.dates[0], ''));
  const current = () => s.server.store.get().projects[0].tasks.find(e => e.id === s.context.id);
  await s.waitFor(() => current().planDate === s.dates[0] && s.event('未安排的调研范围')?.parentNode.getAttribute('style').includes('grid-row:5'));
  assert.equal(current().planEndDate, s.dates[3]); assert.equal(current().planPeriod, null);
  assert.equal(current().startDate, s.dates[0]); assert.equal(current().dueDate, s.dates[3]); assert.equal(current().dueTime, '17:00');
  s.drag(s.event('未安排的调研范围'), s.point(s.dates[0], ''), s.point(s.dates[1], 'afternoon'));
  await s.waitFor(() => current().planDate === s.dates[1] && current().planPeriod === 'afternoon');
  assert.equal(current().planEndDate, s.dates[4]);
  assert.equal(current().startDate, s.dates[0]); assert.equal(current().dueDate, s.dates[3]);
});

test('真实 HTTP：从截止提醒重新安排已有计划时，必须复核后才能替换原安排段', async t => {
  const s = await setup(t), before = structuredClone(s.item());
  const reminder = findAllByClass(s.root, 'cal-card').find(e => e.getAttribute('title')?.startsWith('两日调研'));
  assert.ok(textOf(reminder).includes('截止'));
  s.drag(reminder, s.point(s.dates[6], ''), s.point(s.dates[6], 'afternoon'));
  await s.waitFor(() => button(document.body, '保存安排'));
  assert.deepEqual(s.item(), before);
  button(document.body, '取消').click(); await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(s.item(), before);
});
