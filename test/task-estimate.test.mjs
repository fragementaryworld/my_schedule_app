import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr, ESTIMATE_OPTIONS, estimateLabel, normalizeEstimate, estimateText } from '../public/js/utils.js';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/page/p1' };

// 真 fetch 先存下来，后面给视图测试装 mock
const nodeFetch = globalThis.fetch;

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
  if (u.includes('/api/preferences')) return { ok: true, status: 200, json: async () => ({ weekStart: 'mon' }) };
  if (u.includes('/api/projects')) return { ok: true, status: 200, json: async () => [] };
  if (u.includes('/api/tasks?from=')) return { ok: true, status: 200, json: async () => [] };
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const tick = () => new Promise((r) => setTimeout(r, 10));
const projects = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href);
const itemMod = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'item.js')).href);
const planMod = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'plan.js')).href);
const todayMod = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'today.js')).href);
const cal = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'calendar.js')).href);

const TODAY = todayStr();

const P = {
  id: 'p1',
  name: 'P',
  tasks: [
    {
      id: 't1', title: '任务A', done: false, startDate: TODAY, dueDate: TODAY,
      estimate: 240, subtasks: []
    },
    { id: 't2', title: '任务B', done: false, dueDate: TODAY, subtasks: [] }
  ]
};

// ══════════ 纯函数 ══════════

test('问题1：预计用时选项是常用档位', () => {
  const values = ESTIMATE_OPTIONS.map((o) => o.value);
  assert.deepEqual(values, [0, 15, 30, 60, 120, 240, 480]);
  assert.equal(ESTIMATE_OPTIONS[0].label, '未设置');
  assert.equal(ESTIMATE_OPTIONS.find((o) => o.value === 240).label, '半天');
  assert.equal(ESTIMATE_OPTIONS.find((o) => o.value === 480).label, '1 天');
});

test('问题1：estimateLabel 把分钟转成可读文案', () => {
  assert.equal(estimateLabel(15), '15 分钟');
  assert.equal(estimateLabel(30), '30 分钟');
  assert.equal(estimateLabel(60), '1 小时');
  assert.equal(estimateLabel(120), '2 小时');
  assert.equal(estimateLabel(240), '半天');
  assert.equal(estimateLabel(480), '1 天');
  assert.equal(estimateLabel(45), '45 分钟', '非档位也能量化');
  assert.equal(estimateLabel(90), '1.5 小时');
  assert.equal(estimateLabel(0), '');
  assert.equal(estimateLabel(null), '');
  assert.equal(estimateLabel('abc'), '');
  assert.equal(estimateLabel(-10), '');
});

test('问题1：normalizeEstimate 把输入收敛成分钟数或 null', () => {
  assert.equal(normalizeEstimate(120), 120);
  assert.equal(normalizeEstimate('60'), 60);
  assert.equal(normalizeEstimate(90.6), 91);
  assert.equal(normalizeEstimate(0), null);
  assert.equal(normalizeEstimate(''), null);
  assert.equal(normalizeEstimate(null), null);
  assert.equal(normalizeEstimate(undefined), null);
  assert.equal(normalizeEstimate(-5), null);
  assert.equal(normalizeEstimate('abc'), null);
});

test('问题1：estimateText 没设置就不显示', () => {
  assert.equal(estimateText({ estimate: 120 }), '⏱ 2 小时');
  assert.equal(estimateText({ estimate: 240 }), '⏱ 半天');
  assert.equal(estimateText({}), '');
  assert.equal(estimateText({ estimate: 0 }), '');
  assert.equal(estimateText(null), '');
});

// ══════════ 接口 ══════════

const { createApp } = (await import(pathToFileURL(path.join(process.cwd(), 'lib', 'api.js')).href)).default;

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-est-'));
  const app = createApp({ dataFile: path.join(dir, 'data.json') });
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

test('问题1：每日任务能存下/改掉/清空预计用时', async () => {
  await withServer(async (call) => {
    const t = (await call('POST', '/api/tasks', { title: '任务', date: todayStr(), estimate: 120 })).json;
    assert.equal(t.estimate, 120);
    assert.equal((await call('GET', `/api/tasks/${t.id}`)).json.estimate, 120, '读回来还在');

    assert.equal((await call('PUT', `/api/tasks/${t.id}`, { estimate: 240 })).json.estimate, 240, '可以改');
    assert.equal((await call('PUT', `/api/tasks/${t.id}`, { estimate: null })).json.estimate, null, '可以清空');

    assert.equal((await call('POST', '/api/tasks', { title: 'x', date: todayStr(), estimate: 'abc' })).status, 400);
    assert.equal((await call('PUT', `/api/tasks/${t.id}`, { estimate: -5 })).status, 400);
  });
});

test('问题2：重复任务生成的实例要带上预计用时与日期格式', async () => {
  await withServer(async (call) => {
    const root = (await call('POST', '/api/tasks', {
      title: '每天的任务', date: '2024-05-01', repeat: 'daily',
      estimate: 90, dateFormat: 'iso', endDate: '2024-05-01', endTime: '18:00'
    })).json;

    const list = await call('GET', '/api/tasks?from=2024-05-02&to=2024-05-02');
    const inst = list.json.find((t) => t.repeatOf === root.id);
    assert.ok(inst, '应生成重复实例');
    assert.equal(inst.estimate, 90, '实例要继承预计用时');
    assert.equal(inst.dateFormat, 'iso', '实例要继承日期格式');
    assert.equal(inst.endTime, '18:00', '实例要继承结束时间');
  });
});

test('问题1：项目任务与任意层级子任务都能存预计用时', async () => {
  await withServer(async (call) => {
    const p = (await call('POST', '/api/projects', { name: 'P' })).json;
    const t = (await call('POST', `/api/projects/${p.id}/tasks`, { title: '任务', estimate: 60 })).json;
    assert.equal(t.estimate, 60);

    const s = (await call('POST', `/api/projects/${p.id}/tasks/${t.id}/subtasks`, { title: '子', estimate: 30 })).json;
    assert.equal(s.estimate, 30);

    const deep = (await call('POST', `/api/projects/${p.id}/tasks/${t.id}/subtasks/${s.id}/subtasks`, { title: '孙', estimate: 480 })).json;
    assert.equal(deep.estimate, 480, '第 3 层也有');

    const upd = await call('PUT', `/api/projects/${p.id}/tasks/${t.id}/subtasks/${s.id}/subtasks/${deep.id}`, { estimate: 15 });
    assert.equal(upd.json.estimate, 15, '可以改');

    const after = (await call('GET', `/api/projects/${p.id}/tasks/${t.id}`)).json;
    assert.equal(after.subtasks[0].subtasks[0].estimate, 15, '改完真的落库');
  });
});

// ══════════ 各个展示 ══════════

test('问题1：任务表格有「预计」列', () => {
  const table = projects.buildTaskTable(P);
  const heads = findAllByTag(table, 'thead')[0];
  assert.ok(textOf(heads).includes('预计'), '表头应有预计列');

  const cells = findAllByClass(table, 'estimate-cell').map((c) => textOf(c));
  assert.deepEqual(cells, ['⏱ 半天', '—'], '有值显示用处，没值显示占位');
});

test('问题1：看板上显示预计用时', () => {
  const board = projects.buildTaskBoard(P);
  const chips = findAllByClass(board, 'estimate-chip').map((c) => textOf(c));
  assert.deepEqual(chips, ['⏱ 半天']);
});

test('问题1：信息流里显示预计用时', () => {
  const feed = projects.buildTaskFeed(P);
  const chips = findAllByClass(feed, 'estimate-chip').map((c) => textOf(c));
  assert.deepEqual(chips, ['⏱ 半天']);
});

test('问题1：时间线上显示预计用时', () => {
  const timeline = projects.buildTaskTimeline(P);
  const chips = findAllByClass(timeline, 'estimate-chip').map((c) => textOf(c));
  assert.deepEqual(chips, ['⏱ 半天']);
});

test('问题1：任务页面能设置「预计用时」并保存', async () => {
  calls.length = 0;
  const props = itemMod.buildItemProperties({ id: 'p1' }, { id: 't1', title: 'A', estimate: 60, subtasks: [] }, ['t1']);
  const row = findAllByClass(props, 'prop-row').find((r) => textOf(r).startsWith('预计用时'));
  assert.ok(row, '应有预计用时属性行');

  const num = findAllByClass(row, 'estimate-hours')[0];
  assert.ok(num, '应能设置预计用时');
  assert.equal(num.value, '1', '回填已存的值（60 分钟 = 1 小时）');

  num.value = '4';
  num.fire('change');
  await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, '/api/projects/p1/tasks/t1');
  assert.deepEqual(put.body, { estimate: 240 });
});

test('问题1：每日任务页面能设置「预计用时」并保存', async () => {
  const backup = globalThis.fetch;
  const task = { id: 't1', title: '每日任务', date: TODAY, time: null, estimate: 120, dateFormat: 'ymd' };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('/api/tasks/t1')) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(task)) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  const el = document.createElement('div');
  await planMod.render(el, { id: 't1' });
  const row = findAllByClass(el, 'prop-row').find((r) => textOf(r).startsWith('预计用时'));
  assert.ok(row, '每日任务页也应有预计用时');

  const num = findAllByClass(row, 'estimate-hours')[0];
  assert.equal(num.value, '2', '120 分钟 = 2 小时');
  calls.length = 0;
  num.value = '8';
  num.fire('change');
  await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, '/api/tasks/t1');
  assert.deepEqual(put.body, { estimate: 480 });
  globalThis.fetch = backup;
});

test('问题1：今日计划的日历卡片与看板都显示预计用时', async () => {
  const backup = globalThis.fetch;
  const dayTask = { id: 'd1', title: '带预计的任务', date: TODAY, time: '09:00', estimate: 30, done: false };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/preferences')) return { ok: true, status: 200, json: async () => ({ weekStart: 'mon' }) };
    if (u.includes('/api/projects')) return { ok: true, status: 200, json: async () => [] };
    if (u.includes('/api/tasks?from=')) {
      const from = /from=([\d-]+)/.exec(u)[1];
      const to = /to=([\d-]+)/.exec(u)[1];
      return { ok: true, status: 200, json: async () => (dayTask.date >= from && dayTask.date <= to ? [dayTask] : []) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  const el = document.createElement('div');
  await todayMod.render(el);
  const week = findAllByTag(el, 'button').find((b) => textOf(b) === '周视图');
  if (week) week.click();
  await tick();

  const card = findAllByClass(el, 'cal-card').find((c) => textOf(c).includes('带预计的任务'));
  assert.ok(card, '日历里应有这张卡片');
  assert.ok(textOf(card).includes('⏱ 30 分钟'), `日历卡片应显示预计用时：「${textOf(card)}」`);

  const boardCard = findAllByClass(el, 'cal-board-card').find((c) => textOf(c).includes('带预计的任务'));
  assert.ok(boardCard);
  assert.ok(textOf(boardCard).includes('⏱ 30 分钟'), '看板卡片也应显示');
  globalThis.fetch = backup;
});

test('问题1：项目任务的预计用时也会进今日计划日历', async () => {
  const projects = [{
    id: 'p1', name: '项目一', icon: '📁', status: 'active', dateFormat: 'ymd', blocks: [],
    tasks: [{ id: 't9', title: '项目任务', dueDate: TODAY, estimate: 60, subtasks: [] }]
  }];
  const entries = cal.projectEntriesByDate(projects, TODAY);
  assert.equal(entries[0].estimate, 60, '条目上要带上预计用时，供各视图显示');
});
