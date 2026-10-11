import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr, addDays } from '../public/js/utils.js';
import { weekDates } from '../public/js/calendar.js';
import { render } from '../public/js/views/today.js';
import { cancelCalendarDrag } from '../public/js/calendar-drag.js';
const { apiFixture } = createRequire(import.meta.url)('../test-helpers/api-fixture');

async function setup(t) {
  const nativeFetch = globalThis.fetch;
  const fixture = await apiFixture(t);
  globalThis.document = makeDocument(); globalThis.location = { hash: '#/today' };
  const source = weekDates(todayStr())[5];
  const originalDate = addDays(source, -20), due = addDays(source, 20);
  const day = (await fixture.request('POST', '/api/tasks', { title: '整理发票', date: originalDate,
    planDate: source, planTime: '09:00', planEndTime: '10:00' })).body;
  const project = (await fixture.request('POST', '/api/projects', { name: '研究项目' })).body;
  const planned = (await fixture.request('POST', `/api/projects/${project.id}/tasks`, { title: '研究安排',
    dueDate: due, dueTime: '17:00', planDate: source })).body;
  const raw = (await fixture.request('POST', '/api/tasks', { title: '原始日期任务', date: source })).body;
  const root = document.createElement('div'); document.body.append(root);
  globalThis.fetch = (url, options) => nativeFetch(fixture.base + url, options);
  t.after(() => { cancelCalendarDrag(); globalThis.fetch = nativeFetch; delete globalThis.PointerEvent; });
  await render(root);
  const waitFor = async check => {
    const until = Date.now() + 2500;
    while (!check()) { if (Date.now() > until) assert.fail('等待页面或数据更新超时'); await new Promise(r => setTimeout(r, 5)); }
  };
  const previousCalendar = findAllByClass(root, 'cal')[0];
  findAllByTag(root, 'button').find(e => textOf(e) === '月视图').click();
  await waitFor(() => previousCalendar !== findAllByClass(root, 'cal')[0] && findAllByClass(root, 'cal-month').length);
  const rows = () => findAllByClass(root, 'cal-row');
  const geometry = () => rows().forEach((row, i) => {
    row.getBoundingClientRect = () => ({ left: 0, top: i * 150, width: 700, height: 150 });
  });
  const point = (date, fraction = .5) => {
    const i = rows().findIndex(row => row.children.some(c => c.dataset.date === date));
    assert.ok(i >= 0, `日期 ${date} 在可见月网格中`);
    const col = rows()[i].children.findIndex(c => c.dataset.date === date);
    return { clientX: (col + fraction) * 100, clientY: i * 150 + 50 };
  };
  const event = (title, side) => findAllByClass(root, 'cal-event').find(e => e.getAttribute('title')?.startsWith(title)
    && (!side || findAllByClass(e, 'cal-resize-handle').some(h => h.classList.contains(side))));
  const drag = (handle, from, to, { cancel, pointer = false } = {}) => {
    geometry();
    handle.fire(pointer ? 'pointerdown' : 'mousedown', { button: 0, pointerId: 1, ...from });
    document.dispatchEvent(pointer ? 'pointermove' : 'mousemove', { pointerId: 1, ...to });
    if (cancel === 'Escape') document.dispatchEvent('keydown', { key: 'Escape' });
    else document.dispatchEvent(pointer ? 'pointerup' : 'mouseup', { pointerId: 1, ...to });
  };
  const task = () => fixture.server.store.get().tasks.find(x => x.id === day.id);
  const item = () => fixture.server.store.get().projects.find(x => x.id === project.id).tasks.find(x => x.id === planned.id);
  return { ...fixture, nativeFetch, root, source, originalDate, due, day, planned, raw, task, item, event, point, drag, geometry, waitFor };
}

test('实际页面与服务：明确安排任务可跨周拉伸、从标题拖动、再拉左端，原任务日期和项目截止日期不变', async t => {
  const s = await setup(t), until = addDays(s.source, 4);
  const invoice = s.event('整理发票');
  assert.equal(findAllByClass(invoice, 'cal-resize-handle').length, 2);
  s.drag(findAllByClass(invoice, 'cal-card-stretch')[0], s.point(s.source, .95), s.point(until));
  await s.waitFor(() => s.task().planEndDate === until && s.event('整理发票')?.classList.contains('cal-span'));
  assert.equal(s.task().date, s.originalDate);
  assert.equal(s.task().planTime, '09:00'); assert.equal(s.task().planEndTime, '10:00');
  const bars = findAllByClass(s.root, 'cal-span').filter(e => e.getAttribute('title').startsWith('整理发票'));
  assert.equal(bars.length, 2, '安排连续铺在两周行');
  assert.equal(findAllByClass(bars[0], 'cal-resize-handle').length, 1, '裁切端不冒充实际结束点');
  assert.equal(findAllByClass(bars[1], 'cal-resize-handle').length, 1);
  assert.equal(findAllByClass(document.body, 'cal-range-preview').length, 0);

  const start = addDays(s.source, -3), firstBar = s.event('整理发票', 'left');
  s.drag(findAllByClass(firstBar, 'cal-resize-handle')[0], s.point(s.source, .05), s.point(start));
  await s.waitFor(() => s.task().planDate === start && s.event('整理发票')?.getAttribute('title').includes(start));
  assert.equal(s.task().planEndDate, until);

  const planned = s.event('研究安排');
  s.drag(findAllByClass(planned, 'cal-card-stretch')[0], s.point(s.source, .95), s.point(until));
  await s.waitFor(() => s.item().planEndDate === until && s.event('研究安排')?.classList.contains('cal-span'));
  assert.equal(s.item().dueDate, s.due); assert.equal(s.item().dueTime, '17:00');

  // 明确安排、普通单日任务都可直接从标题区域拖动，不依赖小图标。
  const rawCard = s.event('原始日期任务'), target = addDays(s.source, 7);
  location.hash = '#/today';
  const title = findAllByClass(rawCard, 'cal-card-title')[0];
  s.drag(title, s.point(s.source), s.point(target));
  title.click();
  assert.equal(location.hash, '#/today', '松手产生的点击不能误打开任务详情');
  await s.waitFor(() => s.server.store.get().tasks.find(x => x.id === s.raw.id).date === target
    && s.event('原始日期任务')?.getAttribute('title').includes(target));
});

test('拉伸过程中跨行预览、高亮只显示计划区间；Esc、拖出和保存失败清理预览并保留磁盘数据', async t => {
  const s = await setup(t), until = addDays(s.source, 4);
  const toast = document.createElement('div'); toast.id = 'toast'; document.body.append(toast);
  // toast 的动画使用 RAF；拖动测试仍直接冲刷最终指针位置。
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0); globalThis.cancelAnimationFrame = clearTimeout;
  t.after(() => { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; });
  const handle = findAllByClass(s.event('整理发票'), 'cal-card-stretch')[0];
  s.geometry();
  handle.fire('mousedown', { button: 0, ...s.point(s.source, .95) });
  document.dispatchEvent('mousemove', s.point(until));
  await s.waitFor(() => findAllByClass(document.body, 'cal-range-preview').length === 2);
  const dates = findAllByClass(s.root, 'cal-drop-target').map(c => c.dataset.date);
  assert.equal(dates[0], s.source); assert.equal(dates.at(-1), until); assert.equal(dates.length, 5);
  assert.ok(!dates.includes(s.due));
  document.dispatchEvent('keydown', { key: 'Escape' });
  assert.equal(findAllByClass(document.body, 'cal-range-preview').length, 0);
  assert.equal(findAllByClass(document.body, 'cal-drop-target').length, 0);
  assert.equal(s.task().planEndDate, undefined);
  s.drag(handle, s.point(s.source, .95), { clientX: 820, clientY: 700 });
  assert.equal(s.task().planEndDate, undefined);
  globalThis.fetch = (url, options) => options?.method === 'PUT'
    ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: '测试磁盘不可写' }) }) : s.nativeFetch(s.base + url, options);
  s.drag(handle, s.point(s.source, .95), s.point(until));
  await s.waitFor(() => textOf(toast).includes('测试磁盘不可写'));
  assert.equal(s.task().planEndDate, undefined);
  assert.equal(s.task().planDate, s.source);
  assert.equal(findAllByClass(document.body, 'cal-range-preview').length, 0);
  assert.equal(findAllByClass(document.body, 'cal-drag-hint').length, 0);
  assert.ok(!s.event('整理发票').classList.contains('resizing'));
  assert.equal(document.listenerCount('mousemove'), 0);
});

test('触控左右端点跨行拉伸，缩回单日仍保留可拖动本体与两个端点', async t => {
  globalThis.PointerEvent = function() {};
  const s = await setup(t), until = addDays(s.source, 4);
  const card = s.event('整理发票');
  s.drag(findAllByClass(card, 'cal-card-stretch')[0], s.point(s.source, .95), s.point(until), { pointer: true });
  await s.waitFor(() => s.task().planEndDate === until && s.event('整理发票')?.classList.contains('cal-span'));
  const last = s.event('整理发票', 'right');
  s.drag(findAllByClass(last, 'cal-resize-handle')[0], s.point(until, .95), s.point(s.source), { pointer: true });
  await s.waitFor(() => s.task().planEndDate === null && s.event('整理发票')?.classList.contains('cal-card'));
  assert.equal(findAllByClass(s.event('整理发票'), 'cal-resize-handle').length, 2);
  assert.equal(s.task().planDate, s.source); assert.equal(s.task().date, s.originalDate);
});
