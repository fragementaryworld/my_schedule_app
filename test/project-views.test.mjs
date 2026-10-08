import { test } from 'node:test';
import assert from 'node:assert';
import { groupTasksByDone, ganttRange, ganttBarPct } from '../public/js/views/projects.js';

test('groupTasksByDone 按完成状态分组', () => {
  const { pending, done } = groupTasksByDone([
    { id: '1', done: false },
    { id: '2', done: true },
    { id: '3', done: false }
  ]);
  assert.deepEqual(pending.map((t) => t.id), ['1', '3']);
  assert.deepEqual(done.map((t) => t.id), ['2']);
});

test('ganttRange 计算时间轴范围', () => {
  const tasks = [{ dueDate: '2024-05-10' }, { dueDate: '2024-05-20' }];
  const project = { startDate: '2024-05-01', dueDate: '2024-05-15' };
  const r = ganttRange(tasks, project);
  assert.equal(r.start, '2024-05-01');
  assert.equal(r.end, '2024-05-20');
});

test('ganttRange 无任务日期时使用项目日期', () => {
  const r = ganttRange([], { startDate: '2024-05-01', dueDate: '2024-05-10' });
  assert.deepEqual(r, { start: '2024-05-01', end: '2024-05-10' });
});

test('ganttBarPct 计算条宽百分比', () => {
  assert.equal(ganttBarPct('2024-05-10', '2024-05-01', '2024-05-21'), 45); // 9/20
  assert.equal(ganttBarPct('2024-05-01', '2024-05-01', '2024-05-21'), 0);
  assert.equal(ganttBarPct('2024-05-21', '2024-05-01', '2024-05-21'), 100);
});
