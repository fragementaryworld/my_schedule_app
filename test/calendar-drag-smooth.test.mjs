import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, findAllByClass } from '../test-helpers/dom-shim.mjs';
import { attachCalendarDrag, cancelCalendarDrag } from '../public/js/calendar-drag.js';
import { clampColDelta, dragSinglePatch, dragRangePatch } from '../public/js/calendar.js';
import { addDays } from '../public/js/utils.js';

afterEach(() => {
  cancelCalendarDrag();
  delete globalThis.PointerEvent; delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame;
});
const tick = () => new Promise(r => setTimeout(r, 0));
function setup({ pointer = false, range = false, resize = false, planOnly = false, save } = {}) {
  globalThis.document = makeDocument();
  if (pointer) globalThis.PointerEvent = function() {};
  let frameId = 0; const frames = new Map();
  globalThis.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  const calendar = document.createElement('div'); calendar.className = 'cal'; document.body.append(calendar);
  const rows = [];
  for (let i = 0; i < 2; i++) {
    const row = document.createElement('div'); row.className = 'cal-row'; calendar.append(row); rows.push(row);
    row.getBoundingClientRect = () => ({ left: 0, top: i * 150, width: 700, height: 150 });
    for (let j = 0; j < 7; j++) {
      const cell = document.createElement('div'); cell.className = 'cal-cell'; cell.dataset.date = addDays('2026-10-05', i * 7 + j); row.append(cell);
    }
  }
  const handle = document.createElement('span'); rows[0].children[1].append(handle);
  const captures = []; handle.setPointerCapture = id => captures.push(['set', id]); handle.releasePointerCapture = id => captures.push(['release', id]);
  const entry = { id: 'task', kind: 'day', date: '2026-10-06', spanFrom: '2026-10-06', spanTo: range ? '2026-10-08' : '2026-10-06',
    ...(planOnly ? { planOnly: true, planDate: '2026-10-06' } : {}) };
  const previews = [], writes = [], errors = []; let ends = 0;
  attachCalendarDrag(handle, {
    entry, row: rows[0], dates: rows[0].children.map(c => c.dataset.date), crossRows: !resize,
    clamp: delta => clampColDelta(resize ? 'end' : 'move', 1, range ? 3 : 1, delta, 7),
    onPreview: (visual, width, position) => previews.push({ visual, width, position }), onEnd: () => ends++,
    patchOf: delta => range || resize ? dragRangePatch(entry, delta, resize ? 'end' : 'move') : dragSinglePatch(entry, delta),
    savePatch: async (_, patch) => { writes.push(patch); await save?.(); }, onError: error => errors.push(error.message)
  });
  const down = (extra = {}) => handle.fire(pointer ? 'pointerdown' : 'mousedown', { clientX: 150, clientY: 50, button: 0, pointerId: 1, ...extra });
  const move = (clientX, clientY = 50, pointerId = 1) => document.dispatchEvent(pointer ? 'pointermove' : 'mousemove', { clientX, clientY, pointerId });
  const up = (extra = {}) => document.dispatchEvent(pointer ? 'pointerup' : 'mouseup', { pointerId: 1, ...extra });
  const frame = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); };
  return { handle, rows, calendar, previews, writes, errors, captures, down, move, up, frame, frames, ends: () => ends };
}

test('连续移动按动画帧合并，预览保留小数像素，松手才按天保存一次', async () => {
  const s = setup(); s.down(); s.move(180); s.move(205); s.move(213);
  assert.equal(s.frames.size, 1); assert.equal(s.previews.length, 0); assert.equal(s.writes.length, 0);
  s.frame(); assert.equal(s.previews.length, 1);
  assert.equal(s.previews[0].position.dx, 63); assert.equal(s.previews[0].visual, .63);
  assert.equal(findAllByClass(document.body, 'cal-drop-target')[0].dataset.date, '2026-10-07');
  s.up(); await tick(); assert.deepEqual(s.writes, [{ date: '2026-10-07' }]);
  assert.equal(document.listenerCount('mousemove'), 0); assert.equal(s.ends(), 1);
  assert.equal(findAllByClass(document.body, 'cal-drag-hint').length, 0);
});

test('松手时冲刷最后一帧和最终鼠标位置，不丢失快速拖动', async () => {
  const s = setup(); s.down(); s.move(180); s.up({ clientX: 355, clientY: 50 }); await tick();
  assert.deepEqual(s.writes, [{ date: '2026-10-08' }]); assert.equal(s.frames.size, 0);
});

test('月视图单日、跨天和当天安排均可跨周行移动，安排不改写任务日期', async () => {
  for (const options of [{}, { range: true }, { planOnly: true }]) {
    const s = setup(options); s.down(); s.move(253, 200); s.frame();
    assert.equal(s.previews[0].position.dy, 150);
    assert.ok(findAllByClass(document.body, 'cal-drag-hint')[0].textContent.includes('2026-10-14'));
    s.up(); await tick();
    assert.deepEqual(s.writes[0], options.range ? { date: '2026-10-14', endDate: '2026-10-16' }
      : options.planOnly ? { planDate: '2026-10-14' } : { date: '2026-10-14' });
  }
});

test('拖出日历区域松手取消，轻微抖动也不会写入', async () => {
  let s = setup(); s.down(); s.move(850, 200); s.frame(); s.up(); await tick(); assert.equal(s.writes.length, 0);
  s = setup(); s.down(); s.move(152, 51); s.up(); await tick(); assert.equal(s.writes.length, 0);
});

test('Esc 和页面隐藏取消拖动，清理预览、动画帧、提示及所有文档监听器', async () => {
  for (const cancel of ['escape', 'hidden', 'repaint']) {
    const s = setup(); s.down(); s.move(252); s.frame(); s.move(280);
    if (cancel === 'escape') document.dispatchEvent('keydown', { key: 'Escape' });
    else if (cancel === 'hidden') { document.hidden = true; document.dispatchEvent('visibilitychange'); }
    else cancelCalendarDrag();
    s.up(); await tick(); assert.equal(s.writes.length, 0); assert.equal(s.frames.size, 0);
    assert.equal(s.ends(), 1); assert.equal(document.body.classList.contains('calendar-drag-active'), false);
    for (const event of ['mousemove', 'mouseup', 'pointercancel', 'keydown', 'visibilitychange']) assert.equal(document.listenerCount(event), 0);
    assert.equal(findAllByClass(document.body, 'cal-drop-target').length, 0);
  }
});

test('Pointer Events 支持触控捕获，忽略其他手指，pointercancel 后不保存', async () => {
  const s = setup({ pointer: true }); s.down(); s.move(300, 50, 2); s.frame(); assert.equal(s.previews.length, 0);
  s.move(260); s.frame(); document.dispatchEvent('pointercancel', { pointerId: 2 });
  assert.equal(s.ends(), 0);
  document.dispatchEvent('pointercancel', { pointerId: 1 }); s.up(); await tick();
  assert.equal(s.writes.length, 0); assert.deepEqual(s.captures, [['set', 1], ['release', 1]]);
  assert.equal(s.handle._listeners.lostpointercapture.length, 0);
});

test('触控松手正常保存一次，丢失指针捕获则取消', async () => {
  let s = setup({ pointer: true }); s.down(); s.move(250); s.up(); await tick();
  assert.deepEqual(s.writes, [{ date: '2026-10-07' }]);
  s = setup({ pointer: true }); s.down(); s.move(250); s.frame(); s.handle.fire('lostpointercapture', { pointerId: 1 }); s.up(); await tick();
  assert.equal(s.writes.length, 0);
});

test('拉伸连续调整宽度但保留开始日期，不能缩短到零天', async () => {
  const s = setup({ range: true, resize: true }); s.down(); s.move(214); s.frame();
  assert.equal(s.previews[0].visual, .64);
  s.up(); await tick(); assert.deepEqual(s.writes, [{ date: '2026-10-06', endDate: '2026-10-09' }]);
  const shorter = setup({ resize: true }); shorter.down(); shorter.move(-200); shorter.up(); await tick();
  assert.equal(shorter.writes.length, 0);
});

test('拖动时手动滚动页面，预览位置补偿周行位移且目标日期仍准确', async () => {
  const s = setup(); s.down();
  s.rows[0].getBoundingClientRect = () => ({ left: 0, top: -80, width: 700, height: 150 });
  s.rows[1].getBoundingClientRect = () => ({ left: 0, top: 70, width: 700, height: 150 });
  s.move(250, 100); s.frame();
  assert.equal(s.previews[0].position.dy, 130);
  s.up(); await tick(); assert.deepEqual(s.writes, [{ date: '2026-10-14' }]);
});

test('保存失败恢复界面并报告错误，保存期间拒绝重复拖动，随后可以重试', async () => {
  let reject; const s = setup({ save: () => new Promise((_, r) => reject = r) });
  s.down(); s.move(250); s.up(); assert.equal(s.ends(), 1);
  s.down(); s.move(350); s.up(); assert.equal(s.writes.length, 1);
  reject(new Error('磁盘不可写')); await tick(); assert.deepEqual(s.errors, ['磁盘不可写']);
  s.down(); s.move(350); s.up(); assert.equal(s.writes.length, 2);
  reject(new Error('测试结束')); await tick();
});
