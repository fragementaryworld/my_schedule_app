import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import apiMod from '../lib/api.js';

const { createApp } = apiMod;

let server;
let base;
let tmpDir;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-test-'));
  server = createApp({ dataFile: path.join(tmpDir, 'data.json') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('backup 导出带附件响应头', async () => {
  const res = await fetch(base + '/api/backup/export');
  assert.equal(res.status, 200);
  assert.ok((res.headers.get('content-type') || '').includes('application/json'));
  assert.ok((res.headers.get('content-disposition') || '').includes('attachment'));
  const json = await res.json();
  assert.equal(json.version, 1);
});

test('preferences 周起始日与默认首页持久保存', async () => {
  const put = await fetch(base + '/api/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekStart: 'sun', defaultHome: 'today' })
  });
  assert.equal(put.status, 200);
  const get = await (await fetch(base + '/api/preferences')).json();
  assert.equal(get.weekStart, 'sun');
  assert.equal(get.defaultHome, 'today');
});

test('meta 返回数据文件信息', async () => {
  const meta = await (await fetch(base + '/api/meta')).json();
  assert.ok(meta.filePath.endsWith('data.json'));
  assert.equal(typeof meta.sizeBytes, 'number');
});

test('POST /api/save 手动保存', async () => {
  const res = await fetch(base + '/api/save', { method: 'POST' });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(typeof json.sizeBytes, 'number');
});
