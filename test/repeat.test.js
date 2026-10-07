'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { occursOn } = require('../lib/repeat');

// 2024-01-01 是周一
const MON = '2024-01-01';
const TUE = '2024-01-02';
const NEXT_MON = '2024-01-08';
const TWO_WEEKS_MON = '2024-01-15';

test('不重复规则：null/undefined 一律不发生', () => {
  assert.equal(occursOn(null, MON, MON), false);
  assert.equal(occursOn(undefined, MON, MON), false);
});

test('早于开始日期不发生', () => {
  assert.equal(occursOn('daily', '2024-01-05', '2024-01-01'), false);
});

test('daily：每天发生（含开始当天）', () => {
  assert.equal(occursOn('daily', MON, MON), true);
  assert.equal(occursOn('daily', MON, TUE), true);
  assert.equal(occursOn('daily', MON, '2024-02-29'), true);
});

test('weekly：仅每周同一天发生', () => {
  assert.equal(occursOn('weekly', MON, MON), true);
  assert.equal(occursOn('weekly', MON, NEXT_MON), true);
  assert.equal(occursOn('weekly', MON, TUE), false);
  assert.equal(occursOn('weekly', MON, '2024-01-03'), false); // 周三
});

test('自定义间隔（天）：每隔 interval 天发生', () => {
  const rule = { interval: 2, unit: 'day' };
  assert.equal(occursOn(rule, MON, MON), true); // diff 0
  assert.equal(occursOn(rule, MON, '2024-01-03'), true); // diff 2
  assert.equal(occursOn(rule, MON, '2024-01-05'), true); // diff 4
  assert.equal(occursOn(rule, MON, TUE), false); // diff 1
  assert.equal(occursOn(rule, MON, '2024-01-04'), false); // diff 3
});

test('自定义间隔（周）：每隔 interval 周的同一天发生', () => {
  const rule = { interval: 2, unit: 'week' };
  assert.equal(occursOn(rule, MON, MON), true);
  assert.equal(occursOn(rule, MON, TWO_WEEKS_MON), true);
  assert.equal(occursOn(rule, MON, NEXT_MON), false); // 相隔 1 周
  assert.equal(occursOn(rule, MON, '2024-01-09'), false); // 不同星期
});

test('非法 interval 回退为 1', () => {
  assert.equal(occursOn({ interval: 0, unit: 'day' }, MON, TUE), true);
  assert.equal(occursOn({ interval: -2, unit: 'day' }, MON, TUE), true);
});
