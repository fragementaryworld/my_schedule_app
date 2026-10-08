import { test } from 'node:test';
import assert from 'node:assert';
import { dragDeltaPct, pctToDays, pxToDays } from '../public/js/views/projects.js';

test('问题1：dragDeltaPct 与鼠标位移成正比（1:1 跟随）', () => {
  assert.equal(dragDeltaPct(50, 500), 10);
  assert.equal(dragDeltaPct(100, 500), 20);
  assert.equal(dragDeltaPct(-50, 500), -10);
  assert.equal(dragDeltaPct(25, 500), 5);
});

test('问题1：轨道宽度为 0 时不产生位移（避免失真失控）', () => {
  assert.equal(dragDeltaPct(50, 0), 0);
  assert.equal(pxToDays(50, 0, 20), 0);
});

test('问题1：小位移不再跳整天（降低敏感度）', () => {
  // 500px 轨道 / 20 天范围：2px 仅 0.08 天 → 取整为 0，不应跳动
  assert.equal(pctToDays(dragDeltaPct(2, 500), 20), 0);
  // 25px = 5% → 1 天
  assert.equal(pctToDays(dragDeltaPct(25, 500), 20), 1);
});

test('问题1：位移比例换算天数正确（含负向）', () => {
  assert.equal(pctToDays(10, 20), 2);
  assert.equal(pctToDays(-10, 20), -2);
  assert.equal(pctToDays(0, 20), 0);
  assert.equal(pctToDays(10, 0), 0);
});

test('问题1：pxToDays 与 dragDeltaPct+pctToDays 等价', () => {
  assert.equal(pxToDays(60, 480, 30), pctToDays(dragDeltaPct(60, 480), 30));
});
