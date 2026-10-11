'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { apiFixture } = require('../test-helpers/api-fixture');

test('动作库使用界面的真实 URL 编辑和删除动作，训练记录保留', async t => {
  const { request } = await apiFixture(t);
  const exercise = (await request('POST', '/api/workouts/exercises', { name: '深蹲' })).body;
  const route = `/api/workouts/exercises/${exercise.id}`;
  const updated = await request('PUT', route, { name: '负重深蹲', sets: 3 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, '负重深蹲');
  await request('POST', '/api/workouts/logs', { exercises: [{ exerciseId: exercise.id, sets: 3 }] });
  assert.equal((await request('DELETE', route)).status, 200);
  assert.deepEqual((await request('GET', '/api/workouts')).body.exercises, []);
  assert.equal((await request('GET', '/api/workouts/logs')).body.length, 1);
  assert.equal((await request('DELETE', route)).status, 404);
  assert.equal((await request('PUT', route, { name: '不存在' })).status, 404);
});
