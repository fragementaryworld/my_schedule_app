import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr, estimateHours, hoursToMinutes } from '../public/js/utils.js';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/plan/t1' };

const nodeFetchUnused = globalThis.fetch;
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
  return { el, saved, num: findAllByClass(el, 'estimate-hours')[0], sel: findAllByClass(el, 'estimate-select')[0] };
}
const customOption = (sel) => findAllByTag(sel, 'option').find((o) => o.getAttribute('value') === 'custom');

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
  assert.equal(hoursToMinutes(3), 180);
  assert.equal(hoursToMinutes(2.5), 150);
  assert.equal(hoursToMinutes(0.3), 18);
  assert.equal(hoursToMinutes(0), null);
  assert.equal(hoursToMinutes(''), null);
  assert.equal(hoursToMinutes('abc'), null);
  assert.equal(hoursToMinutes(-1), null);
});

test('问题2：小时与分钟可以来回换算', () => {
  for (const minutes of [15, 30, 45, 60, 90, 120, 240, 480]) {
    assert.equal(hoursToMinutes(estimateHours(minutes)), minutes, `${minutes} 分钟往返一致`);
  }
});

// ══════════ 输入控件 ══════════

test('问题2：预计用时行有手动输入框，单位是 h', () => {
  const { el, num } = makeField(null);
  assert.ok(num, '应有手填输入框');
  assert.equal(num.getAttribute('type'), 'number');
  assert.equal(num.getAttribute('step'), '0.5');
  assert.equal(num.getAttribute('min'), '0');
  assert.equal(textOf(findAllByClass(el, 'estimate-unit')[0]), 'h', '单位标为 h');
  assert.ok(findAllByClass(el, 'estimate-select')[0], '预设下拉仍在');
});

test('问题2：手填框回填已存的预计用时（小时）', () => {
  assert.equal(makeField(120).num.value, '2');
  assert.equal(makeField(30).num.value, '0.5');
  assert.equal(makeField(90).num.value, '1.5');
  assert.equal(makeField(null).num.value, '');
});

test('问题2：手动输入 3 小时 → 存 180 分钟', async () => {
  const { saved, num } = makeField(null);
  num.value = '3';
  num.fire('change');
  await tick();
  assert.deepEqual(saved, [180]);
  assert.equal(num.value, '3', '输入框保留用户输入');
});

test('问题2：手动输入小数小时也对', async () => {
  const { saved, num } = makeField(null);
  num.value = '0.5';
  num.fire('change');
  await tick();
  num.value = '2.5';
  num.fire('change');
  await tick();
  assert.deepEqual(saved, [30, 150]);
});

test('问题2：清空手填框 = 取消预计用时', async () => {
  const { saved, num, sel } = makeField(120);
  num.value = '';
  num.fire('change');
  await tick();
  assert.deepEqual(saved, [null]);
  assert.equal(sel.value, '0', '下拉回到未设置');
});

test('问题2：填非预设值时，下拉显示实际值而不是瞎标', async () => {
  const { sel, num } = makeField(null);
  num.value = '3';
  num.fire('change');
  await tick();
  assert.equal(sel.value, 'custom', '下拉切到自定义项');
  assert.equal(textOf(customOption(sel)), '3 小时');
  assert.equal(customOption(sel).hasAttribute('hidden'), false, '自定义项要可见');
});

test('问题2：填的值正好是预设档位时，下拉选中该档位', async () => {
  const { sel, num } = makeField(180);
  num.value = '2';
  num.fire('change');
  await tick();
  assert.equal(sel.value, '120', '2 小时对应预设 120');
  assert.equal(customOption(sel).hasAttribute('hidden'), true, '自定义项应隐藏');
});

test('问题2：从下拉选预设会同步到手填框', async () => {
  const { saved, sel, num } = makeField(null);
  sel.value = '240';
  sel.fire('change');
  await tick();
  assert.deepEqual(saved, [240]);
  assert.equal(num.value, '4', '半天 = 4 小时');

  sel.value = '0';
  sel.fire('change');
  await tick();
  assert.deepEqual(saved, [240, null]);
  assert.equal(num.value, '', '未设置清空输入框');
});

test('问题2：下拉停在自定义项时不再重复提交', async () => {
  const { saved, sel, num } = makeField(null);
  num.value = '3';
  num.fire('change');
  await tick();
  saved.length = 0;
  sel.fire('change');
  await tick();
  assert.deepEqual(saved, [], '自定义值不会被下拉再次写一遍');
});

// ══════════ 页面接入 ══════════

test('问题2：任务页面可以用手填小时保存', async () => {
  calls.length = 0;
  const props = itemMod.buildItemProperties({ id: 'p1' }, { id: 't1', title: 'A', estimate: 60, subtasks: [] }, ['t1']);
  const row = findAllByClass(props, 'prop-row').find((r) => textOf(r).startsWith('预计用时'));
  const num = findAllByClass(row, 'estimate-hours')[0];
  assert.equal(num.value, '1', '回填 1 小时');

  num.value = '3';
  num.fire('change');
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
  const num = findAllByClass(row, 'estimate-hours')[0];
  assert.equal(num.value, '1.5', '回填 1.5 小时');

  calls.length = 0;
  num.value = '0.5';
  num.fire('change');
  await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, '/api/tasks/t1');
  assert.deepEqual(put.body, { estimate: 30 });
  globalThis.fetch = backup;
});
