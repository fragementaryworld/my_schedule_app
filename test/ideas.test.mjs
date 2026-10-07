import { test } from 'node:test';
import assert from 'node:assert';
import { groupIdeasByStatus } from '../public/js/views/ideas.js';

test('groupIdeasByStatus 按固定顺序分组', () => {
  const ideas = [
    { id: '1', status: 'done' },
    { id: '2', status: 'idea' },
    { id: '3', status: 'doing' },
    { id: '4', status: 'planning' },
    { id: '5', status: 'dropped' },
    { id: '6', status: 'weird' }
  ];
  const cols = groupIdeasByStatus(ideas);
  assert.deepEqual(cols.map((c) => c.status), ['idea', 'planning', 'doing', 'done', 'dropped']);
  assert.deepEqual(cols[0].items.map((i) => i.id), ['2', '6']); // 未知状态归入「灵感」
  assert.deepEqual(cols[1].items.map((i) => i.id), ['4']);
  assert.deepEqual(cols[3].items.map((i) => i.id), ['1']);
  assert.deepEqual(cols[4].items.map((i) => i.id), ['5']);
});

test('groupIdeasByStatus 空列表返回空列', () => {
  const cols = groupIdeasByStatus([]);
  assert.equal(cols.length, 5);
  assert.ok(cols.every((c) => c.items.length === 0));
});
