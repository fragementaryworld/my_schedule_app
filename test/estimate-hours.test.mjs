import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr, estimateHours, hoursToMinutes, parseEstimateInput } from '../public/js/utils.js';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/plan/t1' };

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const estimateMod = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'estimate.js')).href);
const itemMod = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'item.js')).href);
const planMod = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'plan.js')).href);

const tick = () => new Promise((r) => setTimeout(r, 10));

function makeField(value) {
  const saved = [];
  const el = estimateMod.buildEstimateField({ value, onSave: (m) => saved.push(m) });
  document.body.append(el);
  return { el, saved, num: findAllByClass(el, 'estimate-hours')[0] };
}
const type = (num, text) => { num.value = text; num.fire('change'); };

// ══════════ 纯函数 ══════════

test('问题2：estimateHours 把分钟换成小时', () => {
  assert.equal(estimateHours(120), 2);
  assert.equal(estimateHours(30), 0.5);
  assert.equal(estimateHours(15), 0.25);
  assert.equal(estimateHours(90), 1.5);
  assert.equal(estimateHours(480), 8);
  assert.equal(estimateHours(0), 0);
  assert.equal(estimateHours(null), 0);
  assert.equal(estimateHours('abc'), 0);
});

test('问题2：hoursToMinutes 把小时换成分钟', () => {
  assert.equal(hoursToMinutes(2), 120);
  assert.equal(hoursToMinutes(0.5), 30);
  assert.equal(hoursToMinutes(2.5), 150);
  assert.equal(hoursToMinutes(0.3), 18);
  assert.equal(hoursToMinutes(0), null);
  assert.equal(hoursToMinutes(''), null);
  assert.equal(hoursToMinutes(-1), null);
});

test('问题2：小时与分钟可以来回换算', () => {
  for (const minutes of [15, 30, 45, 60, 90, 120, 240, 480]) {
    assert.equal(hoursToMinutes(estimateHours(minutes)), minutes, `${minutes} 分钟往返一致`);
  }
});

test('问题2【回归】：中文输入法的全角数字也能识别', () => {
  // 这正是"手动输入无法输入数字"的原因：type=number 会把全角数字整段丢掉
  assert.equal(parseEstimateInput('３'), 180);
  assert.equal(parseEstimateInput('３．５'), 210);
  assert.equal(parseEstimateInput('０．５'), 30);
  assert.equal(parseEstimateInput('１２'), 720);
});

test('问题2：解析容忍空格与 h／小时后缀', () => {
  assert.equal(parseEstimateInput('3'), 180);
  assert.equal(parseEstimateInput(' 3 '), 180);
  assert.equal(parseEstimateInput('3h'), 180);
  assert.equal(parseEstimateInput('3H'), 180);
  assert.equal(parseEstimateInput('3 小时'), 180);
  assert.equal(parseEstimateInput('2.5小时'), 150);
});

test('问题2：空 = 清空，非法 = 交给调用方还原', () => {
  assert.equal(parseEstimateInput(''), null);
  assert.equal(parseEstimateInput('   '), null);
  assert.equal(parseEstimateInput(null), null);
  assert.equal(parseEstimateInput('0'), null);
  assert.equal(parseEstimateInput('abc'), undefined, '非法输入用 undefined 区分');
  assert.equal(parseEstimateInput('-3'), undefined);
  assert.equal(parseEstimateInput('3.5.5'), undefined);
});

// ══════════ 输入控件 ══════════

test('问题2：预计用时只保留手动输入框（没有下拉框）', () => {
  const { el, num } = makeField(null);
  assert.ok(num, '应有手填输入框');
  assert.equal(findAllByClass(el, 'estimate-select').length, 0, '下拉框应已移除');
  assert.equal(el.children.length, 2, '只剩输入框与单位');
  assert.equal(textOf(findAllByClass(el, 'estimate-unit')[0]), 'h', '单位标为 h');
});

test('问题2【回归】：输入框不是 type=number（否则全角数字输不进去）', () => {
  const { num } = makeField(null);
  assert.equal(num.getAttribute('type'), 'text');
  assert.equal(num.getAttribute('inputmode'), 'decimal', '移动端弹数字键盘');
  assert.equal(num.getAttribute('autocomplete'), 'off');
});

test('问题2：手填框回填已存的预计用时（小时）', () => {
  assert.equal(makeField(120).num.value, '2');
  assert.equal(makeField(30).num.value, '0.5');
  assert.equal(makeField(90).num.value, '1.5');
  assert.equal(makeField(null).num.value, '');
});

test('问题2：手动输入 3 小时 → 存 180 分钟', async () => {
  const { saved, num } = makeField(null);
  type(num, '3');
  await tick();
  assert.deepEqual(saved, [180]);
  assert.equal(num.value, '3', '输入框保留用户输入');
});

test('问题2：手动输入小数小时也对', async () => {
  const { saved, num } = makeField(null);
  type(num, '0.5');
  await tick();
  type(num, '2.5');
  await tick();
  assert.deepEqual(saved, [30, 150]);
});

test('问题2：手打全角数字同样生效（真机回归）', async () => {
  const { saved, num } = makeField(null);
  type(num, '３');
  await tick();
  assert.deepEqual(saved, [180]);
  assert.equal(num.value, '3', '存完归一成半角显示');
});

test('问题2：回车也能提交', async () => {
  const { saved, num } = makeField(null);
  num.value = '2';
  num.fire('keydown', { key: 'Enter' });
  await tick();
  assert.deepEqual(saved, [120]);
});

test('问题2：清空输入框 = 取消预计用时', async () => {
  const { saved, num } = makeField(120);
  type(num, '');
  await tick();
  assert.deepEqual(saved, [null]);
  assert.equal(num.value, '');
});

test('问题2：乱输不会写坏数据，会自动还原', async () => {
  const { saved, num } = makeField(120);
  type(num, 'abc');
  await tick();
  assert.deepEqual(saved, [], '不应提交');
  assert.equal(num.value, '2', '还原成原来的 2 小时');
});

// ══════════ 页面接入 ══════════

test('问题2：任务页面可以用手填小时保存', async () => {
  calls.length = 0;
  const props = itemMod.buildItemProperties({ id: 'p1' }, { id: 't1', title: 'A', estimate: 60, subtasks: [] }, ['t1']);
  const row = findAllByClass(props, 'prop-row').find((r) => textOf(r).startsWith('预计用时'));
  assert.equal(findAllByClass(row, 'estimate-select').length, 0, '任务页面也不再有下拉框');
  const num = findAllByClass(row, 'estimate-hours')[0];
  assert.equal(num.value, '1', '回填 1 小时');

  type(num, '3');
  await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, '/api/projects/p1/tasks/t1');
  assert.deepEqual(put.body, { estimate: 180 });
});

test('问题2：每日任务页面可以用手填小时保存', async () => {
  const backup = globalThis.fetch;
  const task = { id: 't1', title: '每日任务', date: todayStr(), estimate: 90, dateFormat: 'ymd' };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('/api/tasks/t1')) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(task)) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  const el = document.createElement('div');
  await planMod.render(el, { id: 't1' });
  const row = findAllByClass(el, 'prop-row').find((r) => textOf(r).startsWith('预计用时'));
  assert.equal(findAllByClass(row, 'estimate-select').length, 0);
  const num = findAllByClass(row, 'estimate-hours')[0];
  assert.equal(num.value, '1.5', '回填 1.5 小时');

  calls.length = 0;
  type(num, '0.5');
  await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, '/api/tasks/t1');
  assert.deepEqual(put.body, { estimate: 30 });
  globalThis.fetch = backup;
});
