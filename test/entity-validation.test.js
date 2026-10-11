'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { apiFixture } = require('../test-helpers/api-fixture');
const { todayStr } = require('../lib/dates');

test('独立任务的修改不能写入非法日期、时间、类型或重复规则', async t => {
  const { server, request } = await apiFixture(t);
  const task = (await request('POST', '/api/tasks', { title: '原任务', date: todayStr() })).body;
  const before = server.store.snapshot();
  for (const patch of [
    { date: 'bad' }, { date: null }, { date: '2025-02-29' }, { time: '24:00' },
    { endTime: '12:60' }, { title: [] }, { title: '   ' }, { done: 'false' },
    { priority: 'unknown' }, { repeat: { interval: 0, unit: 'day' } }, { repeat: 'monthly' }, { note: {} }
  ]) {
    assert.equal((await request('PUT', `/api/tasks/${task.id}`, { ...patch, order: 99 })).status, 400);
    assert.equal(server.store.snapshot(), before);
  }
  assert.equal((await request('PUT', `/api/tasks/${task.id}`, { date: '2024-02-29', time: '23:59', endDate: '', endTime: '' })).status, 200);
  const saved = (await request('GET', `/api/tasks/${task.id}`)).body;
  assert.equal(saved.endDate, null);
  assert.equal(saved.endTime, null);
});

test('项目与各级任务在创建和更新时使用相同的日期时间校验', async t => {
  const { request } = await apiFixture(t);
  assert.equal((await request('POST', '/api/projects', { name: '错误项目', dueDate: 'bad' })).status, 400);
  const project = (await request('POST', '/api/projects', { name: '项目' })).body;
  assert.equal((await request('POST', `/api/projects/${project.id}/tasks`, { title: '错误任务', dueTime: '88:00' })).status, 400);
  const task = (await request('POST', `/api/projects/${project.id}/tasks`, { title: '任务' })).body;
  const base = `/api/projects/${project.id}/tasks/${task.id}`;
  assert.equal((await request('PUT', base, { startDate: 'bad' })).status, 400);
  const child = (await request('POST', base + '/subtasks', { title: '子任务' })).body;
  assert.equal((await request('PUT', `${base}/subtasks/${child.id}`, { dueDate: '2026-02-30' })).status, 400);
  assert.equal((await request('POST', base + '/subtasks', { title: '错误子任务', startTime: '9:00' })).status, 400);
});

test('禁止把项目移到自己或任意后代之下，拒绝时其他字段也不变', async t => {
  const { server, request } = await apiFixture(t);
  const a = (await request('POST', '/api/projects', { name: 'A' })).body;
  const b = (await request('POST', '/api/projects', { name: 'B', parentId: a.id })).body;
  const c = (await request('POST', '/api/projects', { name: 'C', parentId: b.id })).body;
  const before = server.store.snapshot();
  for (const parentId of [a.id, b.id, c.id]) {
    assert.equal((await request('PUT', `/api/projects/${a.id}`, { name: '不应保存', parentId })).status, 400);
    assert.equal(server.store.snapshot(), before);
  }
  assert.equal((await request('PUT', `/api/projects/${c.id}`, { parentId: a.id })).status, 200);
  assert.equal((await request('PUT', `/api/projects/${b.id}`, { parentId: null })).status, 200);
});

test('其他资源拒绝会破坏界面结构的字段，允许合法补丁', async t => {
  const { request } = await apiFixture(t);
  assert.equal((await request('PUT', '/api/preferences', { theme: 'invalid' })).status, 400);
  assert.equal((await request('POST', '/api/books', { title: '书', current: -1 })).status, 400);
  assert.equal((await request('POST', '/api/ideas', { title: '灵感', tags: [null] })).status, 400);
  assert.equal((await request('POST', '/api/workouts/logs', { date: 'wrong' })).status, 400);
  assert.equal((await request('POST', '/api/workouts/body', { date: '2026-13-01' })).status, 400);
  assert.equal((await request('PUT', '/api/preferences', { theme: 'dark', weekStart: 'sun' })).status, 200);
});
