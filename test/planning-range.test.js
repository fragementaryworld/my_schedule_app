'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { apiFixture } = require('../test-helpers/api-fixture');
const { createApp } = require('../lib/api');
const { todayStr, addDays } = require('../lib/dates');
const { prepareBackup } = require('../lib/backup');

test('安排区间保存、重开、查询中间日期、整体改期与撤销，不改变原日期或截止日期', async t => {
  const { request, file } = await apiFixture(t);
  const date = todayStr(), until = addDays(date, 9);
  const task = (await request('POST', '/api/tasks', { title: '整理发票', date: addDays(date, -20), planDate: date,
    planEndDate: until, planTime: '09:00', planEndTime: '10:00' })).body;
  const project = (await request('POST', '/api/projects', { name: '研究' })).body;
  const item = (await request('POST', `/api/projects/${project.id}/tasks`, { title: '研究安排', startDate: addDays(date, -2),
    dueDate: addDays(date, 30), dueTime: '17:00', planDate: date, planEndDate: until })).body;
  const taskUrl = `/api/tasks/${task.id}`, itemUrl = `/api/projects/${project.id}/tasks/${item.id}`;
  assert.equal(task.planEndDate, until);
  assert.equal(createApp({ dataFile: file }).store.get().tasks.find(x => x.id === task.id).planEndDate, until);
  const middle = addDays(date, 5);
  assert.ok((await request('GET', `/api/tasks?from=${middle}&to=${middle}`)).body.some(x => x.id === task.id));
  assert.ok(!(await request('GET', `/api/tasks?from=${addDays(until, 1)}&to=${addDays(until, 2)}`)).body.some(x => x.id === task.id));
  const moved = (await request('PUT', taskUrl, { planDate: addDays(date, 3) })).body;
  assert.equal(moved.planEndDate, addDays(until, 3));
  assert.equal(moved.date, task.date);
  assert.equal(moved.planTime, '09:00');
  const expanded = (await request('PUT', itemUrl, { planEndDate: addDays(until, 5) })).body;
  assert.equal(expanded.dueDate, item.dueDate); assert.equal(expanded.dueTime, '17:00');
  assert.equal(expanded.startDate, item.startDate);
  const collapsed = (await request('PUT', taskUrl, { planEndDate: moved.planDate })).body;
  assert.equal(collapsed.planEndDate, null);
  const cleared = (await request('PUT', itemUrl, { planDate: null })).body;
  for (const field of ['planDate', 'planEndDate', 'planPeriod', 'planTime', 'planEndTime', 'planOrder']) assert.equal(cleared[field], null);
  assert.equal(cleared.dueDate, item.dueDate);
});

test('无效安排结束日期与反向区间拒绝并回滚，批量安排同样验证区间', async t => {
  const { request } = await apiFixture(t);
  const date = todayStr();
  const task = (await request('POST', '/api/tasks', { title: '有效区间', date, planDate: date, planEndDate: addDays(date, 2) })).body;
  const url = `/api/tasks/${task.id}`;
  for (const planEndDate of ['2026-02-30', '', 123, [], addDays(date, -1)]) {
    assert.equal((await request('PUT', url, { title: '错误修改', planEndDate })).status, 400);
    assert.deepEqual((await request('GET', url)).body, task);
  }
  const badBatch = await request('POST', '/api/planning/batch', { items: [
    { base: url, patch: { planEndDate: addDays(date, 5) } },
    { base: url, patch: { planEndDate: addDays(date, -1) } }
  ] });
  assert.equal(badBatch.status, 400);
  assert.deepEqual((await request('GET', url)).body, task);
  const good = await request('POST', '/api/planning/batch', { items: [{ base: url, patch: { planEndDate: addDays(date, 5) } }] });
  assert.equal(good.status, 200);
  assert.equal((await request('GET', url)).body.planEndDate, addDays(date, 5));
});

test('重复实例继承安排区间长度，不共享日期或完成状态', async t => {
  const { request } = await apiFixture(t);
  const date = todayStr(), rootDate = addDays(date, -3);
  const root = (await request('POST', '/api/tasks', { title: '重复整理', date: rootDate, repeat: 'daily',
    planDate: rootDate, planEndDate: addDays(rootDate, 2), planPeriod: 'afternoon' })).body;
  const instance = (await request('GET', `/api/tasks?date=${date}`)).body.find(x => x.repeatOf === root.id);
  assert.equal(instance.planDate, date); assert.equal(instance.planEndDate, addDays(date, 2));
  const changed = (await request('PUT', `/api/tasks/${encodeURIComponent(instance.id)}`, { planEndDate: addDays(date, 5) })).body;
  assert.equal(changed.planEndDate, addDays(date, 5));
  assert.equal((await request('GET', `/api/tasks/${root.id}`)).body.planEndDate, root.planEndDate);
});

test('备份保留合法安排区间，拒绝独立任务和深层项目任务的无效区间，旧备份仍兼容', () => {
  const task = { id: 't', title: '整理', date: '2026-10-10', planDate: '2026-10-10', planEndDate: '2026-10-14' };
  assert.equal(prepareBackup({ tasks: [task], projects: [] }).tasks[0].planEndDate, task.planEndDate);
  assert.ok(prepareBackup({ tasks: [{ id: 'old', title: '旧任务', date: '2026-10-10' }], projects: [] }));
  assert.throws(() => prepareBackup({ tasks: [{ ...task, planEndDate: '2026-10-09' }], projects: [] }), /结束日期/);
  assert.throws(() => prepareBackup({ tasks: [], projects: [{ id: 'p', name: '研究', tasks: [
    { id: 'parent', title: '父任务', subtasks: [{ ...task, planEndDate: '2026-02-30' }] }
  ] }] }), /结束日期/);
});
