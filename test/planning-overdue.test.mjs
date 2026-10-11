import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOverdue, rangeEnd, addDays } from '../public/js/utils.js';
import { dailyEntries } from '../public/js/daily.js';
import { summarize } from '../public/js/views/home.js';
import { render } from '../public/js/views/today.js';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';

const date = '2026-10-12';
const at = (day, hour = 23, minute = 59) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute);
};
const invoice = () => ({ id: 'invoice', title: '整理发票', listId: 'work', date: '2026-10-10',
  endDate: '2026-10-11', planDate: date, planPeriod: 'morning', done: false });

function clock(t) {
  const NativeDate = globalThis.Date;
  const timestamp = at(date).getTime();
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [timestamp])); }
    static now() { return timestamp; }
  };
  t.after(() => { globalThis.Date = NativeDate; });
}

test('整理发票改到今天后按新安排判断，上午已过不逾期，次日零点才逾期', () => {
  const task = invoice(), snapshot = structuredClone(task);
  assert.deepEqual(rangeEnd(task), { date, time: null });
  assert.equal(isOverdue(task, date, at(date)), false);
  assert.equal(isOverdue(task, addDays(date, 1), at(addDays(date, 1), 0, 0)), true);
  assert.equal(isOverdue({ ...task, done: true }, addDays(date, 1)), false);
  assert.deepEqual(task, snapshot, '只计算展示状态，不修改历史日期或个人数据');
});

test('跨天安排在最后一天结束前不逾期，具体执行时间也不变成截止时间', () => {
  const task = { ...invoice(), planEndDate: addDays(date, 2), planTime: '09:00', planEndTime: '10:00' };
  for (const day of [date, addDays(date, 1), addDays(date, 2)]) assert.equal(isOverdue(task, day, at(day)), false);
  assert.equal(isOverdue(task, addDays(date, 3), at(addDays(date, 3), 0, 0)), true);
  assert.equal(isOverdue({ ...task, planDate: null, planEndDate: null }, date, at(date)), true, '取消新安排后仍保留原日期');
});

test('重新安排不会覆盖项目的明确截止日期和时间', () => {
  const task = { dueDate: date, dueTime: '17:00', planDate: addDays(date, 2), done: false };
  assert.equal(isOverdue(task, date, at(date, 17, 0)), false);
  assert.equal(isOverdue(task, date, at(date, 17, 1)), true);
  assert.equal(isOverdue({ ...task, dueTime: null }, date, at(date)), false);
  assert.equal(isOverdue({ ...task, dueTime: null }, addDays(date, 1)), true);
});

test('首页对展示条目使用原始日期和截止时间，与今日看板判断一致', t => {
  clock(t);
  const tasks = [invoice(), { id: 'timed', title: '仅开始时间', date, time: '09:00', done: false }];
  const summary = summarize({ tasks }, date);
  assert.equal(summary.pending.length, 2);
  assert.equal(summary.overdue.length, 0);
  const projects = [{ id: 'p', tasks: [{ id: 't', title: '明确截止', dueDate: date, dueTime: '17:00', done: false }] }];
  const entry = dailyEntries([], projects)[0];
  assert.equal(isOverdue(entry, date, at(date)), true);
  assert.equal(isOverdue({ ...entry, done: true }, date, at(date)), false);
  assert.equal(summarize({ tasks, projects }, date).overdue.length, 1);
});

test('整理发票在今日看板、安排弹窗和周月日历均不显示逾期', async t => {
  clock(t);
  const nativeFetch = globalThis.fetch, nativeDocument = globalThis.document, nativeLocation = globalThis.location;
  globalThis.document = makeDocument(); globalThis.location = { hash: '#/today' };
  const tasks = [invoice()];
  globalThis.fetch = async url => ({ ok: true, status: 200, json: async () =>
    String(url).includes('/api/preferences') ? { weekStart: 'mon' } : String(url).includes('/api/projects') ? [] : tasks });
  t.after(() => { globalThis.fetch = nativeFetch; globalThis.document = nativeDocument; globalThis.location = nativeLocation; });
  const root = document.createElement('div'); document.body.append(root);
  await render(root);
  const card = findAllByClass(root, 'cal-board-card').find(e => textOf(e).includes('整理发票'));
  assert.ok(card); assert.ok(!textOf(card).includes('逾期'));
  assert.ok(!textOf(card).includes('截止 2026-10-11'), '已调整执行日期的普通事务不显示旧截止提示');
  for (const mode of ['周视图', '月视图']) {
    findAllByTag(root, 'button').find(e => textOf(e) === mode).click();
    await new Promise(r => setTimeout(r, 20));
    const events = [...findAllByClass(root, 'cal-event'), ...findAllByClass(root, 'cal-span')]
      .filter(e => (e.getAttribute('aria-label') || '').includes('整理发票'));
    assert.ok(events.length, `${mode} 应显示安排`);
    assert.ok(events.every(e => !e.getAttribute('aria-label').includes('逾期')));
  }
  findAllByTag(root, 'button').find(e => textOf(e) === '安排任务').click();
  const candidate = findAllByClass(document.body, 'daily-task').find(e =>
    !e.classList.contains('cal-board-card') && textOf(e).includes('整理发票'));
  assert.ok(candidate); assert.ok(!textOf(candidate).includes('逾期'));
});
