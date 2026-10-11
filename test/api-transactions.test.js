'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { once } = require('node:events');
const { apiFixture } = require('../test-helpers/api-fixture');
const { defaultData } = require('../store');
const { todayStr, addDays } = require('../lib/dates');

test('验证失败不会发布部分字段；后续成功保存也不能持久化失败请求', async t => {
  const { server, file, request } = await apiFixture(t);
  const task = (await request('POST', '/api/tasks', { title: '原任务', date: todayStr() })).body;
  const before = server.store.snapshot();
  assert.equal((await request('PUT', `/api/tasks/${task.id}`, { title: '错误标题', estimate: -1 })).status, 400);
  assert.equal(server.store.snapshot(), before);
  await request('POST', '/api/memos', { text: '正常操作' });
  assert.equal(JSON.parse(fs.readFileSync(file)).tasks[0].title, '原任务');
});

test('写盘失败返回错误，并回滚内存；读取和重试仍使用正确状态', async t => {
  const { server, file, request } = await apiFixture(t);
  const task = (await request('POST', '/api/tasks', { title: '原任务', date: todayStr() })).body;
  const before = server.store.snapshot();
  t.mock.method(fs, 'renameSync', () => { throw new Error('模拟磁盘写入失败'); });
  assert.equal((await request('PUT', `/api/tasks/${task.id}`, { title: '未提交' })).status, 500);
  assert.equal(server.store.snapshot(), before);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal((await request('GET', `/api/tasks/${task.id}`)).body.title, '原任务');
  t.mock.restoreAll();
  assert.equal((await request('PUT', `/api/tasks/${task.id}`, { title: '已提交' })).status, 200);
});

test('未发送完整的旧请求在导入后重新查找实体，不会返回虚假的保存成功', async t => {
  const { server, base, request } = await apiFixture(t);
  const task = (await request('POST', '/api/tasks', { title: '导入前', date: todayStr() })).body;
  const body = JSON.stringify({ title: '迟到的编辑' });
  const incoming = once(server, 'request');
  let upload;
  const response = new Promise((resolve, reject) => {
    upload = http.request(base + `/api/tasks/${task.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    upload.on('error', reject);
    upload.write(body.slice(0, 3));
  });
  t.after(() => upload.destroy());
  await incoming;
  assert.equal((await request('POST', '/api/backup/import', defaultData())).status, 200);
  upload.end(body.slice(3));
  assert.equal(await response, 404);
  assert.deepEqual(server.store.get().tasks, []);
});

test('重复任务范围查询只提交一次，且重载后包含全部生成结果', async t => {
  const { server, file, request } = await apiFixture(t);
  const start = addDays(todayStr(), -5);
  await request('POST', '/api/tasks', { title: '系列', date: start, repeat: 'daily' });
  const rename = fs.renameSync;
  let commits = 0;
  t.mock.method(fs, 'renameSync', (...args) => { if (args[1] === file) commits++; return rename(...args); });
  assert.equal((await request('GET', `/api/tasks?from=${start}&to=${todayStr()}`)).status, 200);
  assert.equal(commits, 1);
  assert.equal(JSON.parse(fs.readFileSync(file)).tasks.length, 6);
  assert.equal(server.store.get().tasks.length, 6);
});

test('拒绝非对象请求体，不影响后续队列操作', async t => {
  const { request } = await apiFixture(t);
  assert.equal((await request('PUT', '/api/preferences', null)).status, 400);
  assert.equal((await request('PUT', '/api/preferences', [])).status, 400);
  assert.equal((await request('POST', '/api/memos', { text: '仍可使用' })).status, 201);
});
