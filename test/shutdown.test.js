'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { createApp } = require('../lib/api');
const { Store } = require('../store');

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shutdown-test-'));
  let closed;
  const ended = new Promise((resolve) => { closed = resolve; });
  const file = path.join(dir, 'data.json');
  const server = createApp({ dataFile: file, onShutdown: closed });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const stop = (options = {}) => fetch(base + '/api/shutdown', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', ...options
  });
  return { server, file, base, stop, ended };
}

test('结束服务先保存最新数据、返回成功，再关闭监听端口', async (t) => {
  const { server, file, base, stop, ended } = await fixture(t);
  server.store.get().memos.push({ id: 'last', text: '关闭前的最后一条编辑' });
  const response = await stop();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  await ended;
  assert.equal(server.listening, false);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).memos[0].id, 'last');
  await assert.rejects(fetch(base + '/api/meta'));
});

test('GET、跨站与表单请求不能关闭服务', async (t) => {
  const { base, stop } = await fixture(t);
  assert.equal((await fetch(base + '/api/shutdown')).status, 405);
  assert.equal((await stop({ headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' } })).status, 403);
  assert.equal((await stop({ headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'shutdown=1' })).status, 415);
  assert.equal((await fetch(base + '/api/meta')).status, 200);
});

test('保存失败不结束服务，处理后可以重试', async (t) => {
  const { server, base, stop, ended } = await fixture(t);
  t.mock.method(server.store, 'save', () => { throw new Error('磁盘不可写'); });
  const failed = await stop();
  assert.equal(failed.status, 500);
  assert.match((await failed.json()).error, /磁盘不可写/);
  assert.equal((await fetch(base + '/api/meta')).status, 200);
  t.mock.restoreAll();
  assert.equal((await stop()).status, 200);
  await ended;
});

test('磁盘被另一实例修改时拒绝保存和结束，保留外部新数据', async (t) => {
  const { server, file, base, stop } = await fixture(t);
  const external = new Store(file);
  external.load();
  external.get().books.push({ id: 'external', title: '外部新增的书' });
  external.save();
  const before = fs.readFileSync(file, 'utf8');
  const response = await stop();
  assert.equal(response.status, 409);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(server.listening, true);
  assert.equal((await fetch(base + '/api/meta')).status, 200);
});

test('结束时等待已接收的写入，并拒绝新的写入和重复结束', { timeout: 10000 }, async (t) => {
  const { server, file, base, stop, ended } = await fixture(t);
  const body = JSON.stringify({ text: '尚未发送完的备忘' });
  const incoming = once(server, 'request');
  let request;
  const written = new Promise((resolve, reject) => {
    request = http.request(base + '/api/memos', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    request.on('error', reject);
    request.write(body.slice(0, 5));
  });
  t.after(() => request.destroy());
  await incoming;
  const stopping = once(server, 'request');
  const response = stop();
  await stopping;
  assert.equal((await fetch(base + '/api/memos', { method: 'POST', body: '{}' })).status, 503);
  assert.equal((await stop()).status, 409);
  request.end(body.slice(5));
  assert.equal(await written, 201);
  assert.equal((await response).status, 200);
  await ended;
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).memos[0].text, '尚未发送完的备忘');
});

test('真实启动脚本收到结束请求后正常退出，释放端口并保存独立数据', { timeout: 10000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shutdown-process-'));
  const file = path.join(dir, 'data.json');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'), windowsHide: true,
    env: { ...process.env, PORT: '0', DATA_FILE: file, NO_BROWSER: '1' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => { if (child.exitCode === null) child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
  const exited = once(child, 'exit');
  const base = await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:(\d+)\//);
      if (match) resolve(`http://127.0.0.1:${match[1]}`);
    });
    child.on('error', reject);
    child.on('exit', () => reject(new Error('服务启动前退出')));
  });
  assert.equal((await fetch(base + '/api/memos', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '进程退出后仍存在' })
  })).status, 201);
  assert.equal((await fetch(base + '/api/shutdown', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  })).status, 200);
  assert.equal((await exited)[0], 0);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).memos[0].text, '进程退出后仍存在');
  await assert.rejects(fetch(base + '/api/meta'));
});
