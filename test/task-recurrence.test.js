'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { apiFixture } = require('../test-helpers/api-fixture');
const { todayStr, addDays } = require('../lib/dates');
const { Store } = require('../store');
const { materializeTasksForDate } = require('../lib/task-recurrence');

test('重复实例首次生成和再次查询均只返回一个相同 id', async t => {
  const { request } = await apiFixture(t);
  const root = (await request('POST', '/api/tasks', { title: '每日', date: addDays(todayStr(), -3), repeat: 'daily' })).body;
  for (let i = 0; i < 2; i++) {
    const tasks = (await request('GET', `/api/tasks?date=${todayStr()}`)).body;
    assert.equal(tasks.filter(task => task.repeatOf === root.id).length, 1);
  }
});

test('完成整个系列后未生成的日期仍完成，持久化重载后保持系列状态', async t => {
  const { request, file } = await apiFixture(t);
  const start = addDays(todayStr(), -3);
  const root = (await request('POST', '/api/tasks', { title: '系列', date: start, repeat: 'daily' })).body;
  await request('PUT', `/api/tasks/${root.id}`, { done: true, finishSeries: true });
  const date = addDays(start, 1);
  const tasks = (await request('GET', `/api/tasks?date=${date}`)).body;
  assert.equal(tasks[0].done, true);
  const store = new Store(file); store.load();
  const future = materializeTasksForDate(store, todayStr());
  assert.equal(future[0].done, true);
  assert.ok(future[0].doneAt);
});

test('只完成一次不会结束系列', async t => {
  const { request } = await apiFixture(t);
  const root = (await request('POST', '/api/tasks', { title: '系列', date: addDays(todayStr(), -2), repeat: 'daily' })).body;
  await request('PUT', `/api/tasks/${root.id}`, { done: true });
  assert.equal((await request('GET', `/api/tasks?date=${todayStr()}`)).body[0].done, false);
});

test('改期后删除重复实例不会重新生成原发生日，其他日期不受影响', async t => {
  const { request, file } = await apiFixture(t);
  const root = (await request('POST', '/api/tasks', { title: '系列', date: addDays(todayStr(), -3), repeat: 'daily' })).body;
  const task = (await request('GET', `/api/tasks?date=${todayStr()}`)).body[0];
  await request('PUT', `/api/tasks/${task.id}`, { date: addDays(todayStr(), 1) });
  await request('DELETE', `/api/tasks/${task.id}`);
  assert.deepEqual((await request('GET', `/api/tasks?date=${todayStr()}`)).body, []);
  const store = new Store(file); store.load();
  assert.deepEqual(materializeTasksForDate(store, todayStr()), []);
  assert.equal((await request('GET', `/api/tasks?date=${addDays(todayStr(), -1)}`)).body[0].repeatOf, root.id);
});

test('跨天重复任务的结束日期随实例移动，持续天数不变', async t => {
  const { request } = await apiFixture(t);
  const start = addDays(todayStr(), -4);
  await request('POST', '/api/tasks', { title: '两天一次', date: start, endDate: addDays(start, 1), repeat: { interval: 2, unit: 'day' } });
  const instance = (await request('GET', `/api/tasks?date=${todayStr()}`)).body[0];
  assert.equal(instance.endDate, addDays(todayStr(), 1));
});
