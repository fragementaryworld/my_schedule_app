import { test } from 'node:test';
import assert from 'node:assert';
import { bookPercent, bookProgressLabel } from '../public/js/views/reading.js';

test('bookPercent 页数模式', () => {
  assert.equal(bookPercent({ current: 150, total: 300, unit: 'page' }), 50);
  assert.equal(bookPercent({ current: 0, total: 300, unit: 'page' }), 0);
});

test('bookPercent 百分比模式', () => {
  assert.equal(bookPercent({ current: 60, unit: 'percent' }), 60);
  assert.equal(bookPercent({ current: 150, unit: 'percent' }), 100); // 封顶 100
});

test('bookPercent 无总页数时为 0', () => {
  assert.equal(bookPercent({ current: 50, total: null, unit: 'page' }), 0);
});

test('bookProgressLabel 展示进度', () => {
  assert.equal(bookProgressLabel({ current: 150, total: 300, unit: 'page' }), '150/300 页');
  assert.equal(bookProgressLabel({ current: 60, unit: 'percent' }), '60%');
});
