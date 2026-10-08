import { test } from 'node:test';
import assert from 'node:assert';
import { timelineTicks, todayPct, pxToDays, shiftDates } from '../public/js/views/projects.js';

test('问题4：timelineTicks 生成顶部日期刻度', () => {
  const ticks = timelineTicks('2024-05-01', '2024-05-21', 7);
  assert.equal(ticks.length, 7);
  assert.deepEqual(ticks[0], { pct: 0, date: '2024-05-01' });
  assert.deepEqual(ticks[6], { pct: 100, date: '2024-05-21' });
});

test('问题4：todayPct 计算今日红线位置（范围外为 null）', () => {
  assert.equal(todayPct('2024-05-01', '2024-05-21', '2024-05-11'), 50);
  assert.equal(todayPct('2024-05-01', '2024-05-21', '2024-06-01'), null);
  assert.equal(todayPct('2024-05-01', '2024-05-21', '2024-04-01'), null);
});

test('问题4：pxToDays 像素换算天数', () => {
  assert.equal(pxToDays(50, 100, 20), 10);
  assert.equal(pxToDays(-50, 100, 20), -10);
  assert.equal(pxToDays(10, 0, 20), 0);
});

test('问题4：shiftDates 平移项目起止日期', () => {
  assert.deepEqual(
    shiftDates({ startDate: '2024-05-01', dueDate: '2024-05-11' }, 3),
    { startDate: '2024-05-04', dueDate: '2024-05-14' }
  );
  assert.deepEqual(
    shiftDates({ dueDate: '2024-05-11' }, -2),
    { startDate: '2024-05-09', dueDate: '2024-05-09' }
  );
});
