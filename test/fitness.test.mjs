import { test } from 'node:test';
import assert from 'node:assert';
import { todayExerciseIds, exerciseNames } from '../public/js/views/fitness.js';

test('todayExerciseIds 读取当天训练安排', () => {
  const schedule = { mon: ['e1'], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
  assert.deepEqual(todayExerciseIds(schedule, 'mon'), ['e1']);
  assert.deepEqual(todayExerciseIds(schedule, 'tue'), []);
  assert.deepEqual(todayExerciseIds(null, 'mon'), []);
});

test('exerciseNames 将动作 id 映射为名称并跳过缺失', () => {
  const exercises = [{ id: 'e1', name: '深蹲' }, { id: 'e2', name: '卧推' }];
  assert.deepEqual(exerciseNames(exercises, ['e1', 'missing', 'e2']), ['深蹲', '卧推']);
  assert.deepEqual(exerciseNames(exercises, []), []);
});
