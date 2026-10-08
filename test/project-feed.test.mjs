import { test } from 'node:test';
import assert from 'node:assert';
import { feedGoalLines, sortFeedProjects } from '../public/js/views/projects.js';

test('问题5：feedGoalLines 把描述拆成要点', () => {
  assert.deepEqual(feedGoalLines('目标1；目标2\n目标3'), ['目标1', '目标2', '目标3']);
  assert.deepEqual(feedGoalLines('单行目标'), ['单行目标']);
  assert.deepEqual(feedGoalLines(''), []);
  assert.deepEqual(feedGoalLines(null), []);
});

test('问题5：sortFeedProjects 按创建时间倒序', () => {
  const sorted = sortFeedProjects([
    { id: 'a', createdAt: '2024-01-01T00:00:00.000Z' },
    { id: 'b', createdAt: '2024-03-01T00:00:00.000Z' },
    { id: 'c', createdAt: '2024-02-01T00:00:00.000Z' }
  ]);
  assert.deepEqual(sorted.map((p) => p.id), ['b', 'c', 'a']);
});
