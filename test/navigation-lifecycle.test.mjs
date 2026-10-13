import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';
import { navigate, views } from '../public/js/app.js';
import { buildContentEditor } from '../public/js/views/page.js';
import { api } from '../public/js/api.js';
import { waitForPendingWrites } from '../public/js/saving.js';

function setup(responder = async () => []) {
  globalThis.document = makeDocument();
  globalThis.window = { scrollTo() {} };
  globalThis.requestAnimationFrame = callback => callback();
  globalThis.location = { hash: '#/home' };
  globalThis.history = { replaceState(_state, _title, hash) { location.hash = hash; } };
  for (const id of ['content', 'pageTitle', 'toast']) {
    const node = document.createElement('div'); node.id = id; document.body.append(node);
  }
  globalThis.fetch = async (url, options = {}) => {
    const body = await responder(url, options);
    return { ok: !body?.error, status: body?.error ? 500 : 200, json: async () => body };
  };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test('首页迟到的数据不能追加到已经打开的设置页', async () => {
  let release, started;
  const reading = new Promise(resolve => { started = resolve; });
  setup(async url => {
    if (url.startsWith('/api/tasks')) { started(); return new Promise(resolve => { release = () => resolve([]); }); }
    if (url === '/api/preferences') return { theme: 'light' };
    if (url === '/api/workouts') return { schedule: {}, logs: [], exercises: [] };
    return [];
  });
  const home = navigate();
  await reading;
  location.hash = '#/settings';
  await navigate();
  const current = document.getElementById('content');
  release(); await home;
  assert.equal(document.getElementById('content'), current);
  assert.equal(findAllByClass(current, 'settings-group').length, 4);
  assert.equal(findAllByClass(current, 'home-grid').length, 0);
  assert.equal(document.getElementById('pageTitle').textContent, '数据与设置');
});

test('切换页面立即提交尚在防抖中的草稿，再拆除原页面', async () => {
  const writes = [];
  setup(async (url, options) => { if (options.method === 'PUT') writes.push({ url, body: JSON.parse(options.body) }); return {}; });
  const content = document.getElementById('content');
  const editor = buildContentEditor({ value: '', key: 'navigation-draft', debounceMs: 60000,
    onSave: desc => api.put('/api/projects/original', { desc }) });
  content.append(editor);
  editor.children[1].textContent = '未失焦草稿'; editor.children[1].fire('input');
  location.hash = '#/settings';
  await navigate();
  assert.deepEqual(writes, [{ url: '/api/projects/original', body: { desc: '未失焦草稿' } }]);
  assert.equal(content.isConnected, false);
});

test('保存失败时保留原编辑器及草稿，修复后可重试离开', async () => {
  let fail = true;
  setup(async (_url, options) => options.method === 'PUT' && fail ? { error: '磁盘不可写' } : {});
  location.hash = '#/settings'; await navigate();
  const content = document.getElementById('content');
  const editor = buildContentEditor({ value: '', key: 'failed-navigation', debounceMs: 60000,
    onSave: desc => api.put('/api/projects/original', { desc }) });
  content.append(editor);
  const input = editor.children[1]; input.textContent = '保留的草稿'; input.fire('input');
  location.hash = '#/home'; await navigate();
  assert.equal(document.getElementById('content'), content);
  assert.equal(input.textContent, '保留的草稿');
  assert.equal(location.hash, '#/settings');
  fail = false;
  location.hash = '#/settings'; await navigate();
  assert.equal(content.isConnected, false);
  await waitForPendingWrites();
});

test('同一路由重叠请求只允许最后一次渲染提交，加载失败提供重试入口', async () => {
  setup();
  let release, ready;
  const entered = new Promise(resolve => { ready = resolve; });
  const original = views.settings;
  let calls = 0;
  views.settings = { render: async container => {
    if (++calls === 1) { ready(); await new Promise(resolve => { release = resolve; }); throw new Error('旧请求失败'); }
    const node = document.createElement('p'); node.textContent = '当前页面'; container.append(node);
  } };
  try {
    location.hash = '#/settings'; const old = navigate(); await entered;
    await navigate(); release(); await old;
    assert.ok(textOf(document.getElementById('content')).includes('当前页面'));
    views.settings = { render: async () => { throw new Error('网络异常'); } };
    await navigate();
    assert.ok(textOf(document.getElementById('content')).includes('重新加载'));
  } finally { views.settings = original; }
  await tick();
});
