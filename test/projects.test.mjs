import { test } from 'node:test';
import assert from 'node:assert';
import { projectSummary } from '../public/js/views/projects.js';

test('projectSummary 统计任务完成数量', () => {
  const p = {
    tasks: [
      { id: 't1', done: false },
      { id: 't2', done: true },
      { id: 't3', done: false }
    ]
  };
  const s = projectSummary(p);
  assert.equal(s.total, 3);
  assert.equal(s.done, 1);
  assert.equal(s.nextActions, 2);
});

test('projectSummary 处理空数据', () => {
  const s = projectSummary({ tasks: [] });
  assert.deepEqual(s, { total: 0, done: 0, nextActions: 0 });
});
