import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || 'GET' });
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const appUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'app.js')).href;
const app = await import(appUrl);

test('问题4：saveNow 调用手动保存接口', async () => {
  await app.saveNow();
  const save = calls.find((c) => c.url.includes('/api/save'));
  assert.ok(save, '应调用 /api/save 接口');
  assert.equal(save.method, 'POST');
});
