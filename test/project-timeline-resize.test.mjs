import { test } from 'node:test';
import assert from 'node:assert';
import { resizeStart, resizeEnd } from '../public/js/views/projects.js';

test('问题1：resizeStart 只改开始时间', () => {
  assert.deepEqual(
    resizeStart({ startDate: '2024-05-01', dueDate: '2024-05-11' }, 3),
    { startDate: '2024-05-04' }
  );
  assert.deepEqual(
    resizeStart({ startDate: '2024-05-01', dueDate: '2024-05-11' }, -2),
    { startDate: '2024-04-29' }
  );
});

test('问题1：resizeStart 不能超过结束时间', () => {
  assert.deepEqual(
    resizeStart({ startDate: '2024-05-01', dueDate: '2024-05-11' }, 99),
    { startDate: '2024-05-11' }
  );
});

test('问题1：resizeEnd 只改结束时间', () => {
  assert.deepEqual(
    resizeEnd({ startDate: '2024-05-01', dueDate: '2024-05-11' }, 4),
    { dueDate: '2024-05-15' }
  );
  assert.deepEqual(
    resizeEnd({ startDate: '2024-05-01', dueDate: '2024-05-11' }, -3),
    { dueDate: '2024-05-08' }
  );
});

test('问题1：resizeEnd 不能早于开始时间', () => {
  assert.deepEqual(
    resizeEnd({ startDate: '2024-05-01', dueDate: '2024-05-11' }, -99),
    { dueDate: '2024-05-01' }
  );
});

test('问题1：无日期时的兜底', () => {
  assert.equal(typeof resizeStart({}, 1).startDate, 'string');
  assert.equal(typeof resizeEnd({}, 1).dueDate, 'string');
});
