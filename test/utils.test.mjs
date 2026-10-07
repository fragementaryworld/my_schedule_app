import { test } from 'node:test';
import assert from 'node:assert';
import {
  todayStr, addDays, weekdayIndex, weekStartDate, fmtDate, escapeHtml,
  priorityLabel, priorityClass, isOverdue, IDEA_ORDER
} from '../public/js/utils.js';

test('todayStr 返回 YYYY-MM-DD 格式', () => {
  assert.match(todayStr(), /^\d{4}-\d{2}-\d{2}$/);
});

test('addDays 正确处理跨月', () => {
  assert.equal(addDays('2024-01-31', 1), '2024-02-01');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
});

test('weekdayIndex 周一为 0', () => {
  assert.equal(weekdayIndex('2024-01-01'), 0); // 周一
  assert.equal(weekdayIndex('2024-01-07'), 6); // 周日
});

test('fmtDate 输出中文日期与星期', () => {
  assert.equal(fmtDate('2024-01-01'), '1月1日 周一');
});

test('escapeHtml 转义特殊字符', () => {
  assert.equal(escapeHtml('<b>&"'), '&lt;b&gt;&amp;&quot;');
});

test('priority 映射', () => {
  assert.equal(priorityLabel('high'), '高');
  assert.equal(priorityLabel('medium'), '中');
  assert.equal(priorityLabel('low'), '低');
  assert.equal(priorityClass('low'), 'low');
});

test('isOverdue 判断逾期', () => {
  const today = todayStr();
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  assert.equal(isOverdue({ date: yesterday, done: false }, today), true);
  assert.equal(isOverdue({ date: yesterday, done: true }, today), false);
  assert.equal(isOverdue({ date: tomorrow, done: false }, today), false);
  // 今天已过时间 → 逾期；未来时间 → 未逾期
  const now = new Date();
  const past = `${String(now.getHours()).padStart(2, '0')}:00`;
  assert.equal(isOverdue({ date: today, time: past, done: false }, today), true);
  assert.equal(isOverdue({ date: today, time: '23:59', done: false }, today), false);
});

test('IDEA_ORDER 状态顺序', () => {
  assert.deepEqual(IDEA_ORDER, ['idea', 'planning', 'doing', 'done', 'dropped']);
});

test('weekStartDate 周一/周日起始', () => {
  assert.equal(weekStartDate('2024-01-01', 'mon'), '2024-01-01'); // 周一
  assert.equal(weekStartDate('2024-01-07', 'mon'), '2024-01-01'); // 周日按周一起始
  assert.equal(weekStartDate('2024-01-07', 'sun'), '2024-01-07'); // 周日按周日起始
});
