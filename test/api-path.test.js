'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { apiFixture } = require('../test-helpers/api-fixture');
const { todayStr, addDays } = require('../lib/dates');

test('详情、编辑、批量安排和删除均识别 encodeURIComponent 编码的重复实例 id', async t => {
  const { request } = await apiFixture(t);
  await request('POST', '/api/tasks', { title: '重复', date: addDays(todayStr(), -1), repeat: 'daily' });
  const instance = (await request('GET', `/api/tasks?date=${todayStr()}`)).body[0];
  const base = `/api/tasks/${encodeURIComponent(instance.id)}`;
  assert.equal((await request('GET', base)).body.id, instance.id);
  assert.equal((await request('PUT', base, { note: '详情中的备注' })).status, 200);
  assert.equal((await request('POST', '/api/planning/batch', { items: [{ base, patch: { planDate: todayStr(), planPeriod: 'morning' } }] })).status, 200);
  assert.equal((await request('GET', base)).body.planPeriod, 'morning');
  assert.equal((await request('DELETE', base)).status, 200);
  assert.equal((await request('GET', base)).status, 404);
});

test('非法百分号和编码分隔符以 400 拒绝，不能改变路由层级', async t => {
  const { request } = await apiFixture(t);
  for (const suffix of ['bad%zz', '%E0%A4%A', 'id%2Fsubtasks', 'id%5Cother', '%00']) {
    assert.equal((await request('GET', `/api/tasks/${suffix}`)).status, 400);
  }
});
