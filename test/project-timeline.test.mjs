import { test } from 'node:test';
import assert from 'node:assert';
import { timelineRange, timelineBar } from '../public/js/views/projects.js';

test('问题4：timelineRange 计算整体时间轴范围', () => {
  const r = timelineRange([
    { startDate: '2024-05-01', dueDate: '2024-05-11' },
    { startDate: '2024-05-05', dueDate: '2024-05-21' }
  ]);
  assert.equal(r.start, '2024-05-01');
  assert.equal(r.end, '2024-05-21');
  assert.equal(r.days, 20);
});

test('问题4：timelineRange 空列表回退到今天', () => {
  const r = timelineRange([]);
  assert.equal(r.start, r.end);
  assert.equal(r.days, 1);
});

test('问题4：timelineBar 计算起始位置与宽度', () => {
  const start = '2024-05-01';
  const end = '2024-05-21';
  assert.deepEqual(timelineBar({ startDate: '2024-05-01', dueDate: '2024-05-11' }, start, end), { left: 0, width: 50 });
  assert.deepEqual(timelineBar({ startDate: '2024-05-11', dueDate: '2024-05-21' }, start, end), { left: 50, width: 50 });
  assert.deepEqual(timelineBar({ dueDate: '2024-05-05' }, start, end), { left: 0, width: 20 });
});
