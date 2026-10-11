'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../lib/api');
const { todayStr, addDays } = require('../lib/dates');
let server, base, dir, file;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'day-planning-'));
  file = path.join(dir, 'data.json'); server = createApp({ dataFile: file });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
async function call(method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}
const date = todayStr();
async function task(body = {}) { return (await call('POST', '/api/tasks', { title: '日内任务', date, ...body })).data; }

test('独立任务的灵活时段持久化，不虚构具体时间', async () => {
  const t = await task({ planPeriod: 'morning' });
  assert.equal(t.planDate, date); assert.equal(t.planPeriod, 'morning'); assert.equal(t.planTime, null);
  await call('PUT', `/api/tasks/${t.id}`, { planPeriod: 'afternoon', planOrder: 2 });
  const stored = createApp({ dataFile: file }).store.get().tasks.find(x => x.id === t.id);
  assert.equal(stored.planPeriod, 'afternoon'); assert.equal(stored.planOrder, 2); assert.equal(stored.time, null);
});

test('具体时间自动确定时段，切换时段清除时间但保留预计耗时', async () => {
  const t = await task({ estimate: 60 }); const url = `/api/tasks/${t.id}`;
  const exact = (await call('PUT', url, { planDate: date, planPeriod: 'morning', planTime: '14:00', planEndTime: '15:00' })).data;
  assert.equal(exact.planPeriod, 'afternoon');
  const flexible = (await call('PUT', url, { planPeriod: 'morning' })).data;
  assert.equal(flexible.planTime, null); assert.equal(flexible.planEndTime, null); assert.equal(flexible.estimate, 60);
});

test('任意深度项目任务安排与截止日期和时间相互独立', async () => {
  const p = (await call('POST', '/api/projects', { name: '论文' })).data;
  const parent = (await call('POST', `/api/projects/${p.id}/tasks`, { title: '研究' })).data;
  const child = (await call('POST', `/api/projects/${p.id}/tasks/${parent.id}/subtasks`, { title: '查文献', startDate: date, dueDate: addDays(date, 7), dueTime: '17:00' })).data;
  const url = `/api/projects/${p.id}/tasks/${parent.id}/subtasks/${child.id}`;
  const changed = (await call('PUT', url, { planDate: date, planTime: '09:00', planEndTime: '10:00' })).data;
  assert.equal(changed.planPeriod, 'morning'); assert.equal(changed.dueTime, '17:00'); assert.equal(changed.dueDate, child.dueDate);
  const removed = (await call('PUT', url, { planDate: null })).data;
  for (const k of ['planDate', 'planPeriod', 'planTime', 'planEndTime', 'planOrder']) assert.equal(removed[k], null);
  assert.equal(removed.dueDate, child.dueDate); assert.equal(removed.startDate, date);
});

test('非法安排在修改任何属性前拒绝，项目任务必须先选日期', async () => {
  const t = await task(); const url = `/api/tasks/${t.id}`;
  const before = (await call('GET', url)).data;
  for (const patch of [
    { planDate: '2026-02-30' }, { planPeriod: 'noon' }, { planTime: '24:00' }, { planTime: 9 },
    { planEndTime: '12:00' }, { planTime: '12:00', planEndTime: '11:00' }, { planOrder: -1 }, { planOrder: '2' }
  ]) {
    assert.equal((await call('PUT', url, { title: '错误修改', ...patch })).status, 400);
    assert.deepEqual((await call('GET', url)).data, before);
  }
  const p = (await call('POST', '/api/projects', { name: '未安排项目' })).data;
  assert.equal((await call('POST', `/api/projects/${p.id}/tasks`, { title: '无日期', planPeriod: 'evening' })).status, 400);
});

test('批量安排验证全部引用和字段后一次保存，错误批次不修改任何任务', async () => {
  const a = await task(), b = await task();
  const item = (t, patch) => ({ base: `/api/tasks/${t.id}`, patch });
  const good = item(a, { planDate: date, planPeriod: 'morning', planOrder: 0 });
  for (const bad of [item(b, { planPeriod: 'bad' }), { base: '/api/tasks/missing', patch: { planDate: date } }, item(b, { done: true }), good]) {
    assert.ok((await call('POST', '/api/planning/batch', { items: [good, bad] })).status >= 400);
    assert.equal((await call('GET', `/api/tasks/${a.id}`)).data.planPeriod, undefined);
  }
  const result = await call('POST', '/api/planning/batch', { items: [good, item(b, { planDate: date, planPeriod: 'morning', planOrder: 1 })] });
  assert.equal(result.status, 200); assert.equal(result.data.updated, 2);
  const stored = createApp({ dataFile: file }).store.get().tasks;
  assert.equal(stored.find(x => x.id === b.id).planOrder, 1);
});

test('日历区间能找到改期的重复实例，安排面板能找到区间外的零散任务', async () => {
  const root = await task({ date: addDays(date, -2), repeat: 'daily', planPeriod: 'morning' });
  const instance = (await call('GET', `/api/tasks?date=${date}`)).data.find(t => t.repeatOf === root.id);
  assert.equal(instance.planDate, date); assert.equal(instance.planPeriod, 'morning');
  await call('PUT', `/api/tasks/${instance.id}`, { planDate: addDays(date, 14), planPeriod: 'afternoon' });
  const future = (await call('GET', `/api/tasks?from=${addDays(date, 14)}&to=${addDays(date, 14)}`)).data;
  assert.ok(future.some(t => t.id === instance.id));
  const outside = await task({ date: addDays(date, -30), listId: 'work' });
  const pool = (await call('GET', `/api/tasks?from=${date}&to=${date}&includePool=1`)).data;
  assert.ok(pool.some(t => t.id === outside.id));
});

test('批量安排允许同 id 的独立任务和项目任务，关闭后重开顺序仍保留', async () => {
  const t = await task();
  const p = (await call('POST', '/api/projects', { name: '同名 ID 项目' })).data;
  const child = (await call('POST', `/api/projects/${p.id}/tasks`, { title: '项目任务' })).data;
  server.store.get().projects.find(x => x.id === p.id).tasks[0].id = t.id;
  server.store.save();
  const body = { items: [
    { base: `/api/tasks/${t.id}`, patch: { planDate: date, planPeriod: 'afternoon', planOrder: 1 } },
    { base: `/api/projects/${p.id}/tasks/${t.id}`, patch: { planDate: date, planPeriod: 'afternoon', planOrder: 0 } }
  ] };
  assert.equal((await call('POST', '/api/planning/batch', body)).status, 200);
  assert.equal((await call('GET', body.items[1].base)).data.planOrder, 0);
  assert.equal((await call('GET', body.items[0].base)).data.planOrder, 1);
});
