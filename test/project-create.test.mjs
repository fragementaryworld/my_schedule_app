import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/projects' };

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({
    url: String(url),
    method: opts.method || 'GET',
    body: opts.body ? JSON.parse(opts.body) : null
  });
  return { ok: true, status: 200, json: async () => ({ id: 'newpage1', name: '未命名页面' }) };
};

const projectsUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href;
const pageUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'page.js')).href;
const { createProject, DEFAULT_PAGE_NAME } = await import(projectsUrl);
const { isFreshPage } = await import(pageUrl);

test('问题2：新增项目直接创建并跳转到页面（不弹窗）', async () => {
  calls.length = 0;
  globalThis.location.hash = '#/projects';
  const created = await createProject();

  const post = calls.find((c) => c.method === 'POST' && c.url.includes('/api/projects'));
  assert.ok(post, '应直接创建项目');
  assert.equal(post.body.name, DEFAULT_PAGE_NAME);
  assert.equal(created.id, 'newpage1');
  assert.equal(globalThis.location.hash, '#/page/newpage1', '应跳转到新项目页面');
});

test('问题2：新建页面无需打开任何弹窗', () => {
  const backdrops = document.body.children.filter((c) => String(c.className).includes('modal-backdrop'));
  assert.equal(backdrops.length, 0, '不应出现弹窗');
});

test('问题2：isFreshPage 判定未填写内容的新页面', () => {
  assert.equal(isFreshPage({ name: DEFAULT_PAGE_NAME, blocks: [], goal: '' }), true);
  assert.equal(isFreshPage({ name: '已命名', blocks: [], goal: '' }), false);
  assert.equal(isFreshPage({ name: DEFAULT_PAGE_NAME, blocks: [{ id: 'b1' }], goal: '' }), false);
  assert.equal(isFreshPage({ name: DEFAULT_PAGE_NAME, blocks: [], goal: '有描述' }), false);
  assert.equal(isFreshPage(null), false);
});
