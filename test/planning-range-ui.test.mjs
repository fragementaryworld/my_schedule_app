import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, findAllByTag, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';
import { dailyEntries, dailySections, withPlannedCalendarEntries, buildDailyBoard } from '../public/js/daily.js';
import { planningFor, timeConflicts, editPlan } from '../public/js/planning.js';
import { dragRangePatch, dragSinglePatch, calendarRangeAfterPatch } from '../public/js/calendar.js';

const task = { id: 'invoice', title: '整理发票', date: '2026-09-01', planDate: '2026-10-10', planEndDate: '2026-10-14',
  planTime: '09:00', planEndTime: '10:00', planPeriod: 'morning' };
const entries = () => dailyEntries([task], []);
const calendarEntry = () => withPlannedCalendarEntries([{ ...entries()[0] }], entries())[0];

test('跨天安排每天进入看板与具体时间轴，范围外不残留，日历只保留一条新安排', () => {
  const entry = entries()[0];
  for (const date of ['2026-10-10', '2026-10-12', '2026-10-14']) {
    assert.equal(dailySections([entry], date).planned.length, 1);
    assert.equal(planningFor(entry, date).time, '09:00');
  }
  for (const date of ['2026-10-09', '2026-10-15', task.date]) {
    assert.equal(dailySections([entry], date).planned.length, 0);
    assert.equal(planningFor(entry, date).time, '');
  }
  const event = calendarEntry();
  assert.equal(event.planOnly, true); assert.equal(event.spanDays, 5);
  assert.equal(event.spanFrom, task.planDate); assert.equal(event.spanTo, task.planEndDate);
});

test('明确安排的拉伸、平移、缩回单日和高亮只修改安排日期，原日期及截止日期独立', () => {
  const event = { ...calendarEntry(), kind: 'project', startDate: '2026-10-01', dueDate: '2026-11-01' };
  assert.deepEqual(dragRangePatch(event, 3, 'end'), { planDate: task.planDate, planEndDate: '2026-10-17' });
  assert.deepEqual(dragRangePatch(event, -2, 'start'), { planDate: '2026-10-08', planEndDate: task.planEndDate });
  assert.deepEqual(dragSinglePatch(event, 7), { planDate: '2026-10-17', planEndDate: '2026-10-21' });
  assert.deepEqual(dragRangePatch(event, -20, 'end'), { planDate: task.planDate, planEndDate: null });
  const single = { ...event, planEndDate: null, spanFrom: task.planDate, spanTo: task.planDate, spanDays: 1 };
  assert.deepEqual(calendarRangeAfterPatch(single, dragRangePatch(single, 4, 'end')), { from: task.planDate, to: task.planEndDate });
  assert.deepEqual(calendarRangeAfterPatch(single, dragSinglePatch(single, 2)), { from: '2026-10-12', to: '2026-10-12' });
  assert.deepEqual(calendarRangeAfterPatch(event, dragRangePatch(event, -2, 'start')), { from: '2026-10-08', to: task.planEndDate });
  const projects = [{ id: 'p', name: '研究', tasks: [{ id: 't', title: '同日截止并安排', dueDate: task.planDate, planDate: task.planDate }] }];
  const projectEntry = dailyEntries([], projects)[0];
  const coincident = withPlannedCalendarEntries([projectEntry], [projectEntry]);
  assert.equal(coincident.length, 1);
  assert.equal(coincident[0].planOnly, true, '原截止日与安排日重合时仍保护截止日期');
  assert.deepEqual(dragRangePatch(coincident[0], 2, 'end'), { planDate: task.planDate, planEndDate: '2026-10-12' });
});

test('只有开始日期的项目改期正确高亮，起止同日的事务改期同时平移两端', () => {
  const project = { kind: 'project', startDate: '2026-10-10', spanFrom: '2026-10-10', spanTo: '2026-10-10', spanDays: 1 };
  assert.deepEqual(calendarRangeAfterPatch(project, dragSinglePatch(project, 2)), { from: '2026-10-12', to: '2026-10-12' });
  const day = { kind: 'day', date: '2026-10-10', endDate: '2026-10-10', spanFrom: '2026-10-10', spanTo: '2026-10-10', spanDays: 1 };
  const patch = dragSinglePatch(day, 2);
  assert.deepEqual(patch, { date: '2026-10-12', endDate: '2026-10-12' });
  assert.deepEqual(calendarRangeAfterPatch(day, patch), { from: '2026-10-12', to: '2026-10-12' });
});

test('从安排中间日期调整时段和撤销，不截断区间，界面解释整个安排范围', async () => {
  globalThis.document = makeDocument();
  const writes = [];
  globalThis.fetch = async (url, options) => { writes.push(JSON.parse(options.body)); return { ok: true, json: async () => ({}) }; };
  const root = buildDailyBoard(entries(), '2026-10-12', async () => {});
  assert.ok(textOf(root).includes('安排 2026-10-10 → 2026-10-14'));
  const period = findAllByTag(root, 'select').find(e => e.getAttribute('aria-label') === '安排时段：整理发票');
  period.value = 'afternoon'; period.fire('change');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(writes[0].planDate, task.planDate, '只改时段保留区间起点');
  findAllByTag(root, 'button').find(b => textOf(b) === '撤销这段安排').click();
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(writes[1], { planDate: null });
});

test('区间中任一天的时间冲突都会提示，日期编辑可拉长或缩回单日', async () => {
  globalThis.document = makeDocument();
  const others = dailyEntries([{ id: 'meeting', title: '中间日会议', date: '2026-10-12', time: '09:30', endTime: '10:30' }], []);
  assert.equal(timeConflicts(others, '2026-10-10', '/api/tasks/invoice', '09:00', '10:00', '2026-10-14').length, 1);
  const saved = [];
  editPlan(entries()[0], '2026-10-12', async (_, patch) => { saved.push(patch); return true; }, others);
  const modal = findAllByClass(document.body, 'modal')[0];
  const dates = findAllByTag(modal, 'input').filter(i => i.type === 'date');
  assert.equal(dates[0].value, task.planDate); assert.equal(dates[1].value, task.planEndDate);
  const form = findAllByTag(modal, 'form')[0];
  dates[1].value = '2026-10-09'; form.fire('submit'); await new Promise(r => setTimeout(r, 0));
  assert.equal(saved.length, 0); assert.ok(textOf(modal).includes('结束日期不能早于'));
  dates[1].value = '2026-10-14'; form.fire('submit'); await new Promise(r => setTimeout(r, 0));
  assert.equal(saved.length, 0); assert.ok(textOf(modal).includes('中间日会议'));
  dates[1].value = ''; form.fire('submit'); await new Promise(r => setTimeout(r, 0));
  assert.equal(saved.length, 1); assert.equal(saved[0].planEndDate, null);
});
