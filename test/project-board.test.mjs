import { test } from 'node:test';
import assert from 'node:assert';
import { groupProjectsByStatus } from '../public/js/views/projects.js';

test('问题3：groupProjectsByStatus 按状态分列', () => {
  const cols = groupProjectsByStatus([
    { id: '1', status: 'active' },
    { id: '2', status: 'paused' },
    { id: '3', status: 'done' },
    { id: '4', status: 'weird' }
  ]);
  assert.deepEqual(cols.map((c) => c.status), ['active', 'paused', 'done']);
  assert.deepEqual(cols[0].items.map((p) => p.id), ['1', '4']);
  assert.deepEqual(cols[1].items.map((p) => p.id), ['2']);
  assert.deepEqual(cols[2].items.map((p) => p.id), ['3']);
  assert.equal(cols[0].label, '进行中');
  assert.equal(cols[0].cls, 'active');
});

test('问题3：groupProjectsByStatus 空列表返回三列', () => {
  const cols = groupProjectsByStatus([]);
  assert.equal(cols.length, 3);
  assert.ok(cols.every((c) => c.items.length === 0));
});
