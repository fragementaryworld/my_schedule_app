import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { makeDocument, findAllByTag, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr, addDays } from '../public/js/utils.js';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/plan/t1' };

// 真 fetch 先存下来，后面给页面测试装 mock
const nodeFetch = globalThis.fetch;

const daytaskUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'daytask.js')).href;
const pickerUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'datepicker.js')).href;
const planUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'plan.js')).href;
const todayUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'today.js')).href;

const daytask = await import(daytaskUrl);
const picker = await import(pickerUrl);
const planMod = await import(planUrl);
const todayMod = await import(todayUrl);
const cal = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'calendar.js')).href);

const { taskDateValue, taskDatePatch, timeRangeLabel } = daytask;
const tick = () => new Promise((r) => setTimeout(r, 10));

// ══════════ 纯函数：区间映射 ══════════

test('问题1：单日任务 → 选择器的值（不是区间）', () => {
  assert.deepEqual(
    taskDateValue({ date: '2024-05-10', time: '09:00', dateFormat: 'full' }),
    { dueDate: '2024-05-10', dueTime: '09:00', dateFormat: 'full' }
  );
});

test('问题1：区间任务 → 选择器的值（带起止）', () => {
  assert.deepEqual(
    taskDateValue({ date: '2024-05-10', time: '09:00', endDate: '2024-05-12', endTime: '18:00', dateFormat: 'iso' }),
    {
      startDate: '2024-05-10', dueDate: '2024-05-12',
      startTime: '09:00', dueTime: '18:00', dateFormat: 'iso'
    }
  );
});

test('问题1：选择器结果 → 任务字段（区间保留起止）', () => {
  const patch = { startDate: '2024-05-10', dueDate: '2024-05-12', startTime: '09:00', dueTime: '18:00', dateFormat: 'full' };
  assert.deepEqual(taskDatePatch(patch, { date: '2024-05-01' }), {
    date: '2024-05-10', time: '09:00', endDate: '2024-05-12', endTime: '18:00', dateFormat: 'full'
  });
});

test('问题1：关掉区间后结束日期要清掉', () => {
  const patch = { startDate: null, dueDate: '2024-05-20', dueTime: '10:00', dateFormat: 'full' };
  const cur = { date: '2024-05-10', endDate: '2024-05-12', time: '09:00', endTime: '18:00', dateFormat: 'full' };
  assert.deepEqual(taskDatePatch(patch, cur), {
    date: '2024-05-20', time: '10:00', endDate: null, endTime: null, dateFormat: 'full'
  });
});

test('问题1：只有日期没有时间时，时间字段留空', () => {
  const patch = { startDate: '2024-05-10', dueDate: '2024-05-12', startTime: null, dueTime: null, dateFormat: 'full' };
  const next = taskDatePatch(patch, {});
  assert.equal(next.time, null);
  assert.equal(next.endTime, null);
  assert.equal(next.endDate, '2024-05-12');
});

test('问题1：timeRangeLabel 展示起止时间', () => {
  assert.equal(timeRangeLabel('09:00', '18:00'), '09:00–18:00');
  assert.equal(timeRangeLabel('09:00', '09:00'), '09:00');
  assert.equal(timeRangeLabel('09:00', null), '09:00');
  assert.equal(timeRangeLabel(null, '18:00'), '–18:00');
  assert.equal(timeRangeLabel(null, null), '');
});

test('问题1【回归】：选了区间 → 保存 → 再打开，仍然是区间', () => {
  // 用户在界面上选了 5/10 09:00 → 5/12 18:00
  const picked = { startDate: '2024-05-10', dueDate: '2024-05-12', startTime: '09:00', dueTime: '18:00', dateFormat: 'full' };
  const saved = taskDatePatch(picker.toApiPatch(picker.toPickerState(picked)), {});

  // 重新打开页面：把保存后的任务喂回选择器
  const reopened = picker.toPickerState(taskDateValue(saved));
  assert.equal(reopened.hasEnd, true, '重开必须还是区间');
  assert.equal(reopened.start, '2024-05-10');
  assert.equal(reopened.end, '2024-05-12');
  assert.equal(reopened.startTime, '09:00');
  assert.equal(reopened.endTime, '18:00');
  assert.equal(reopened.includeTime, true);

  // 展示文案也带起止
  assert.ok(picker.formatStateDisplay(reopened).includes('→'), '文案应显示区间');
  assert.ok(picker.formatStateDisplay(reopened).includes('09:00'));
  assert.ok(picker.formatStateDisplay(reopened).includes('18:00'));

  // 再存一次不丢
  assert.deepEqual(taskDatePatch(picker.toApiPatch(reopened), saved), saved);
});

test('问题1：单日任务存两次不会凭空变成区间', () => {
  const picked = { dueDate: '2024-05-10', dueTime: '09:00', dateFormat: 'full' };
  const saved = taskDatePatch(picker.toApiPatch(picker.toPickerState(picked)), {});
  assert.equal(saved.endDate, null);
  const reopened = picker.toPickerState(taskDateValue(saved));
  assert.equal(reopened.hasEnd, false);
  assert.equal(reopened.start, '2024-05-10');
  assert.equal(reopened.startTime, '09:00');
});

// ══════════ 接口：区间要存得住 ══════════

const { createApp } = (await import(pathToFileURL(path.join(process.cwd(), 'lib', 'api.js')).href)).default;

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-range-'));
  return path.join(dir, 'data.json');
}

async function withServer(fn) {
  const app = createApp({ dataFile: tmpFile() });
  await new Promise((r) => app.listen(0, r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = async (method, url, body) => {
    const res = await nodeFetch(`${base}${url}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  try {
    return await fn(call);
  } finally {
    await new Promise((r) => app.close(r));
  }
}

test('问题1：接口能存下并读回区间', async () => {
  await withServer(async (call) => {
    const created = await call('POST', '/api/tasks', {
      title: '区间任务', date: '2024-05-10', time: '09:00', endDate: '2024-05-12', endTime: '18:00'
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.endDate, '2024-05-12');
    assert.equal(created.json.endTime, '18:00');

    const read = await call('GET', `/api/tasks/${created.json.id}`);
    assert.equal(read.json.endDate, '2024-05-12', '按 id 读回来仍是区间');
    assert.equal(read.json.endTime, '18:00');
  });
});

test('问题1：接口可以取消区间，也能拒绝非法结束日期', async () => {
  await withServer(async (call) => {
    const t = (await call('POST', '/api/tasks', { title: 'x', date: '2024-05-10', endDate: '2024-05-12' })).json;

    const cleared = await call('PUT', `/api/tasks/${t.id}`, { endDate: null, endTime: null });
    assert.equal(cleared.json.endDate, null);
    assert.equal(cleared.json.endTime, null);

    assert.equal((await call('PUT', `/api/tasks/${t.id}`, { endDate: 'nope' })).status, 400);
    assert.equal((await call('POST', '/api/tasks', { title: 'y', date: '2024-05-10', endDate: '13/05' })).status, 400);
  });
});

test('问题1：区间查询会带出开始日早于查询范围、但与之相交的任务', async () => {
  await withServer(async (call) => {
    await call('POST', '/api/tasks', { title: '跨越区间', date: '2024-05-01', endDate: '2024-05-31' });
    await call('POST', '/api/tasks', { title: '无关任务', date: '2024-06-20' });

    const range = await call('GET', '/api/tasks?from=2024-05-20&to=2024-05-26');
    assert.deepEqual(range.json.map((x) => x.title), ['跨越区间'], '开始日在范围之前，但区间相交');
  });
});

// ══════════ 页面：任务页面的区间 ══════════

const calls = [];
let serverTask = null;

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
  if (method === 'GET' && /\/api\/tasks\/[^/?]+$/.test(u)) {
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(serverTask)) };
  }
  if (u.includes('/api/preferences')) return { ok: true, status: 200, json: async () => ({ weekStart: 'mon' }) };
  if (u.includes('/api/projects')) return { ok: true, status: 200, json: async () => [] };
  if (u.includes('/api/tasks?from=')) return { ok: true, status: 200, json: async () => [] };
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

async function renderPlan(task) {
  serverTask = task;
  calls.length = 0;
  const el = document.createElement('div');
  await planMod.render(el, { id: task.id });
  return el;
}

test('问题1：页面上选区间会连同结束日期一起保存', async () => {
  const month = todayStr().slice(0, 8);
  const el = await renderPlan({ id: 't1', title: '区间任务', date: `${month}10`, time: '09:00', dateFormat: 'full' });

  findAllByClass(el, 'date-trigger')[0].click();
  findAllByClass(el, 'dp-switch-end')[0].click();      // 开启结束日期
  await tick();
  findAllByClass(el, 'dp-day').find((d) => d.dataset.date === `${month}12`).click();
  await tick();

  const put = calls.filter((c) => c.method === 'PUT').pop();
  assert.equal(put.body.date, `${month}10`, '开始日');
  assert.equal(put.body.endDate, `${month}12`, '结束日必须一起保存');
  assert.equal(put.body.dateFormat, 'full');
});

test('问题1：带区间的任务重新打开，选择器仍显示区间', async () => {
  const month = todayStr().slice(0, 8);
  const el = await renderPlan({
    id: 't1', title: '区间任务', date: `${month}10`, time: '09:00',
    endDate: `${month}12`, endTime: '18:00', dateFormat: 'full'
  });

  const trigger = findAllByClass(el, 'date-trigger')[0];
  assert.ok(textOf(trigger).includes('→'), `触发按钮应显示区间，实际「${textOf(trigger)}」`);

  findAllByClass(el, 'date-trigger')[0].click();
  assert.ok(findAllByClass(el, 'dp-switch-end')[0].classList.contains('on'), '「结束日期」开关应处于开启');
  assert.equal(findAllByClass(el, 'dp-chip-end').length, 1, '应有结束日期按钮');
  assert.ok(findAllByClass(el, 'dp-day').find((d) => d.dataset.date === `${month}10`).classList.contains('is-start'));
  assert.ok(findAllByClass(el, 'dp-day').find((d) => d.dataset.date === `${month}12`).classList.contains('is-end'));
  assert.ok(findAllByClass(el, 'dp-day').find((d) => d.dataset.date === `${month}11`).classList.contains('in-range'));
});

// ══════════ 页面：今日计划里的区间任务 ══════════

const WEEK = cal.weekDates(todayStr(), 'mon');
// 找一个"不是今天、且往后两天仍在同一周"的起点
const R0 = WEEK.filter((d) => d !== todayStr() && addDays(d, 2) <= WEEK[6])[0];
const R1 = addDays(R0, 2);

test('问题1：区间任务在今日计划里是连续 block，且带上起止时间', async () => {
  const backup = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/api/preferences')) return { ok: true, status: 200, json: async () => ({ weekStart: 'mon' }) };
    if (u.includes('/api/projects')) return { ok: true, status: 200, json: async () => [] };
    if (u.includes('/api/tasks?from=')) {
      const from = /from=([\d-]+)/.exec(u)[1];
      const to = /to=([\d-]+)/.exec(u)[1];
      const t = { id: 'd1', title: '区间每日任务', date: R0, time: '09:00', endDate: R1, endTime: '18:00', done: false };
      return { ok: true, status: 200, json: async () => (t.date >= from && t.date <= to ? [t] : []) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  const el = document.createElement('div');
  await todayMod.render(el);
  const week = findAllByTag(el, 'button').find((b) => textOf(b) === '周视图');
  if (week) week.click();
  await tick();

  const span = findAllByClass(el, 'cal-span')[0];
  assert.ok(span, '跨天的每日任务应画成连续 block');
  assert.ok(textOf(span).includes('区间每日任务'));
  assert.ok(textOf(span).includes('3 天'));
  const style = String(span.getAttribute('style'));
  assert.ok(Math.abs(parseFloat(/width:([\d.]+)%/.exec(style)[1]) - (3 / 7) * 100) < 0.01, 'block 横跨三天');

  // 不再在每一天重复成卡片
  const cells = findAllByClass(el, 'cal-col');
  for (const d of [R0, R1]) {
    const cell = cells.find((c) => c.dataset.date === d);
    assert.equal(findAllByClass(cell, 'cal-card-title').some((t) => textOf(t).includes('区间每日任务')), false);
  }

  // 看板（选中区间中的某一天）显示起止时间
  cells.find((c) => c.dataset.date === R0).click();
  await tick();
  const board = findAllByClass(el, 'cal-board')[0];
  assert.ok(textOf(board).includes('09:00–18:00'), `看板应显示时间区间，实际「${textOf(board)}」`);
  assert.ok(textOf(board).includes('跨 3 天'));
  globalThis.fetch = backup;
});
