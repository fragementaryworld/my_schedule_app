import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr, addDays } from '../public/js/utils.js';
import { render } from '../public/js/views/today.js';

test('周/月中的事务、项目、明确安排和跨天任务统一展示，日历查看不会误完成任务', async () => {
  globalThis.document = makeDocument();
  globalThis.location = { hash: '#/today' };
  const date = todayStr();
  const writes = [];
  const tasks = [
    { id: 'invoice', title: '整理发票', date, time: '09:00', listId: 'work' },
    { id: 'plan', title: '明确安排', date: addDays(date, -8), planDate: date, listId: 'personal', done: true },
    { id: 'span', title: '跨天事务', date, endDate: addDays(date, 2), listId: 'work' }
  ];
  const projects = [{ id: 'p', name: '研究项目', tasks: [{ id: 't', title: '项目安排', planDate: date }] }];
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') writes.push([url, JSON.parse(options.body)]);
    return { ok: true, json: async () => String(url).includes('projects') ? projects : String(url).includes('preferences') ? {} : tasks };
  };
  const root = document.createElement('div');
  await render(root);
  const check = () => {
    const calendar = findAllByClass(root, 'cal')[0];
    assert.equal(findAllByTag(calendar, 'input').length, 0, '所有日历事件都没有勾选框');
    const events = findAllByClass(calendar, 'cal-event');
    for (const title of tasks.map(t => t.title).concat('项目安排')) {
      assert.ok(events.some(e => e.getAttribute('title').startsWith(title)), `统一事件样式：${title}`);
    }
    assert.ok(events.every(e => /background:rgba\(/.test(e.getAttribute('style'))));
    assert.ok(events.every(e => /border-left:3px solid #/.test(e.getAttribute('style'))));
    assert.ok(events.every(e => e.getAttribute('role') === 'link' && e.getAttribute('tabindex') === '0'));
    assert.ok(events.some(e => e.classList.contains('done')));
    return events;
  };
  let events = check();
  const invoice = events.find(e => e.getAttribute('title').startsWith('整理发票'));
  assert.ok(invoice.getAttribute('title').includes('工作事务'));
  assert.equal(textOf(findAllByClass(invoice, 'cal-event-time')[0]), '09:00');
  invoice.click();
  assert.equal(location.hash, '#/plan/invoice');
  const project = events.find(e => e.getAttribute('title').startsWith('项目安排'));
  project.fire('keydown', { key: 'Enter' });
  assert.equal(location.hash, '#/task/p/t');
  assert.equal(writes.length, 0, '点击事件只进入详情，不写完成状态');
  const previousCalendar = findAllByClass(root, 'cal')[0];
  findAllByTag(root, 'button').find(b => textOf(b) === '月视图').click();
  for (let i = 0; i < 30 && previousCalendar === findAllByClass(root, 'cal')[0]; i++) await new Promise(r => setTimeout(r, 5));
  events = check();
  assert.ok(findAllByClass(root, 'cal-month').length);
  const board = findAllByClass(root, 'cal-board')[0];
  findAllByTag(board, 'input').find(c => c.getAttribute('aria-label') === '完成任务：整理发票').click();
  await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(writes, [['/api/tasks/invoice', { done: true }]]);
});
