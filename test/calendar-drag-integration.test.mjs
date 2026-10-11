import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr, addDays } from '../public/js/utils.js';
import { weekDates } from '../public/js/calendar.js';
import { render } from '../public/js/views/today.js';
import { cancelCalendarDrag } from '../public/js/calendar-drag.js';
const { createApp } = createRequire(import.meta.url)('../lib/api.js');

test('实际页面及 HTTP 服务：月视图跨行改期持久化，计划标记保留项目截止时间，失败还原区间', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-drag-integration-'));
  const file = path.join(dir, 'data.json'); const server = createApp({ dataFile: file });
  const nativeFetch = globalThis.fetch;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  globalThis.document = makeDocument(); globalThis.location = { hash: '#/today' };
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0); globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.fetch = (url, options) => nativeFetch(base + url, options);
  const waitFor = async check => {
    const until = Date.now() + 2500;
    while (!check()) { if (Date.now() > until) assert.fail('等待页面刷新超时'); await new Promise(r => setTimeout(r, 10)); }
  };
  try {
    const post = async (url, body) => (await globalThis.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    const source = weekDates(todayStr(), 'mon')[1], target = addDays(source, 7), due = addDays(source, 12);
    const day = await post('/api/tasks', { title: '整理文件', date: source });
    const project = await post('/api/projects', { name: '研究' });
    const planned = await post(`/api/projects/${project.id}/tasks`, { title: '调研安排', dueDate: due, dueTime: '17:00',
      planDate: source, planTime: '09:00', planEndTime: '10:00' });
    const span = await post('/api/tasks', { title: '多日准备', date: source, endDate: addDays(source, 2) });
    const root = document.createElement('div'); document.body.append(root); await render(root);
    findAllByTag(root, 'button').find(e => textOf(e) === '月视图').click();
    await waitFor(() => findAllByClass(root, 'cal-month').length);
    const geometry = () => findAllByClass(root, 'cal-row').forEach((row, i) => {
      row.getBoundingClientRect = () => ({ left: 0, top: i * 150, width: 700, height: 150 });
    });
    const cardAt = (date, title) => {
      const cell = findAllByClass(root, 'cal-cell').find(c => c.dataset.date === date);
      return cell && findAllByClass(cell, 'cal-card').find(c => textOf(c).includes(title));
    };
    const dragAcross = title => {
      geometry();
      const card = cardAt(source, title); assert.ok(card);
      const rows = findAllByClass(root, 'cal-row');
      const rowIndex = rows.findIndex(row => row.children.some(c => c.dataset.date === source));
      const col = rows[rowIndex].children.findIndex(c => c.dataset.date === source);
      const grip = findAllByClass(card, 'cal-card-move')[0], x = col * 100 + 50;
      grip.fire('mousedown', { button: 0, clientX: x, clientY: rowIndex * 150 + 50 });
      document.dispatchEvent('mousemove', { clientX: x, clientY: (rowIndex + 1) * 150 + 50 });
      document.dispatchEvent('mouseup', { clientX: x, clientY: (rowIndex + 1) * 150 + 50 });
    };
    dragAcross('整理文件'); await waitFor(() => cardAt(target, '整理文件'));
    assert.equal(createApp({ dataFile: file }).store.get().tasks.find(t => t.id === day.id).date, target);
    dragAcross('调研安排'); await waitFor(() => cardAt(target, '调研安排'));
    const saved = createApp({ dataFile: file }).store.get().projects.find(p => p.id === project.id).tasks.find(t => t.id === planned.id);
    assert.equal(saved.planDate, target); assert.equal(saved.planTime, '09:00'); assert.equal(saved.planEndTime, '10:00');
    assert.equal(saved.dueDate, due); assert.equal(saved.dueTime, '17:00');

    geometry();
    const toast = document.createElement('div'); toast.id = 'toast'; document.body.append(toast);
    globalThis.fetch = (url, options) => options?.method === 'PUT'
      ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: '磁盘不可写' }) }) : nativeFetch(base + url, options);
    const bar = findAllByClass(root, 'cal-span').find(e => textOf(e).includes('多日准备'));
    const originalLeft = /left:([^;]+)/.exec(bar.getAttribute('style'))[1];
    const originalWidth = /width:([^;]+)/.exec(bar.getAttribute('style'))[1];
    findAllByClass(bar, 'cal-span-handle')[1].fire('mousedown', { button: 0, clientX: 350 });
    document.dispatchEvent('mousemove', { clientX: 410 });
    document.dispatchEvent('mouseup');
    await waitFor(() => textOf(toast).includes('磁盘不可写'));
    assert.equal(bar.style.left, originalLeft); assert.equal(bar.style.width, originalWidth);
    assert.equal(findAllByClass(document.body, 'cal-drag-hint').length, 0);
    assert.equal(createApp({ dataFile: file }).store.get().tasks.find(t => t.id === span.id).endDate, addDays(source, 2));
  } finally {
    cancelCalendarDrag(); globalThis.fetch = nativeFetch;
    delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame;
    await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true });
  }
});
