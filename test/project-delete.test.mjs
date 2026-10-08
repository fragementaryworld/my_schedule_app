import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/projects' };

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({
    url: String(url),
    method: opts.method || 'GET',
    body: opts.body ? JSON.parse(opts.body) : null
  });
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const projectsUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href;
const { buildProjectTable } = await import(projectsUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));

test('问题1：表格行提供删除按钮', () => {
  const table = buildProjectTable([{ id: 'p1', name: '要删的项目', status: 'active', tasks: [] }]);
  const delBtn = findAllByTag(table, 'button').find((b) => b.getAttribute('title') === '删除');
  assert.ok(delBtn, '每行应有删除按钮');
});

test('问题1：点击删除 → 二次确认 → 调用删除接口', async () => {
  calls.length = 0;
  const table = buildProjectTable([{ id: 'p1', name: '要删的项目', status: 'active', tasks: [] }]);
  const delBtn = findAllByTag(table, 'button').find((b) => b.getAttribute('title') === '删除');
  delBtn.click();

  const backdrops = document.body.children.filter((c) => String(c.className).includes('modal-backdrop'));
  assert.ok(backdrops.length >= 1, '应弹出二次确认框');
  const dialog = backdrops[backdrops.length - 1];
  const ok = findAllByTag(dialog, 'button').find((b) => textOf(b) === '确认');
  assert.ok(ok, '确认框应有「确认」按钮');

  ok.click();
  await tick();
  const del = calls.find((c) => c.method === 'DELETE' && c.url.includes('/api/projects/p1'));
  assert.ok(del, '确认后应发起删除请求');
});

test('问题1：取消确认不删除', async () => {
  calls.length = 0;
  const table = buildProjectTable([{ id: 'p2', name: '保留项目', status: 'active', tasks: [] }]);
  const delBtn = findAllByTag(table, 'button').find((b) => b.getAttribute('title') === '删除');
  delBtn.click();

  const backdrops = document.body.children.filter((c) => String(c.className).includes('modal-backdrop'));
  const dialog = backdrops[backdrops.length - 1];
  const cancel = findAllByTag(dialog, 'button').find((b) => textOf(b) === '取消');
  cancel.click();
  await tick();
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0, '取消不应删除');
});
