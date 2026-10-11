'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { apiFixture } = require('../test-helpers/api-fixture');
const { defaultData } = require('../store');

test('所有资源写入和备份导入拒绝跨站 Origin，未改动数据', async t => {
  const { server, base } = await apiFixture(t);
  const before = server.store.snapshot();
  for (const [path, method, body] of [
    ['/api/memos', 'POST', { text: '不应创建' }],
    ['/api/preferences', 'PUT', { theme: 'dark' }],
    ['/api/backup/import', 'POST', defaultData()],
    ['/api/save', 'POST', {}]
  ]) {
    const response = await fetch(base + path, { method,
      headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 403);
    assert.equal(server.store.snapshot(), before);
  }
});

test('伪造 Host、跨站 GET 和表单类型均不能访问数据', async t => {
  const { base } = await apiFixture(t);
  const hostStatus = await new Promise((resolve, reject) => {
    http.get(base + '/api/meta', { headers: { Host: 'untrusted.example' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(base + '/api/tasks', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
    assert.equal((await fetch(base + '/api/memos', { method: 'POST', headers: { 'Content-Type': type }, body: '{"text":"伪装 JSON"}' })).status, 415);
  }
});

test('同源浏览器与本机脚本保留正常写入及无请求体接口的兼容性', async t => {
  const { base, request } = await apiFixture(t);
  const response = await fetch(base + '/api/memos', { method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ text: '允许' }) });
  assert.equal(response.status, 201);
  const memo = await response.json();
  assert.equal((await request('DELETE', `/api/memos/${memo.id}`)).status, 200);
  assert.equal((await request('POST', '/api/save')).status, 200);
});
