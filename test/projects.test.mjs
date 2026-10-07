import { test } from 'node:test';
import assert from 'node:assert';
import { projectSummary } from '../public/js/views/projects.js';

test('projectSummary 统计下一步与里程碑', () => {
  const p = {
    milestones: [
      { id: 'm1', status: 'done' },
      { id: 'm2', status: 'doing' },
      { id: 'm3', status: 'todo' }
    ],
    tasks: [
      { id: 't1', done: false },
      { id: 't2', done: true },
      { id: 't3', done: false }
    ]
  };
  const s = projectSummary(p);
  assert.equal(s.milestonesDone, 1);
  assert.equal(s.milestonesTotal, 3);
  assert.equal(s.nextActions, 2);
});

test('projectSummary 处理空数据', () => {
  const s = projectSummary({ milestones: [], tasks: [] });
  assert.deepEqual(s, { milestonesDone: 0, milestonesTotal: 0, nextActions: 0 });
});
