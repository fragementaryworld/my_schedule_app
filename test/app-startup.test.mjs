import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Element, makeDocument } from '../test-helpers/dom-shim.mjs';

test('无 hash 启动时首页只渲染一次，不重复问候和卡片', async () => {
  const document = makeDocument();
  for (const id of ['fab', 'saveBtn', 'pageTitle', 'content']) {
    const node = new Element(id === 'content' ? 'div' : 'button');
    node.id = id;
    document.body.append(node);
  }
  const listeners = {};
  let hash = '';
  globalThis.document = document;
  globalThis.window = { addEventListener(type, fn) { listeners[type] = fn; }, scrollTo() {} };
  globalThis.location = {
    get hash() { return hash; },
    set hash(value) { hash = value; setTimeout(() => listeners.hashchange?.(), 0); }
  };
  let homeReads = 0;
  globalThis.fetch = async (url) => {
    // 延迟接口，让重复的 navigate 重叠，复现真实浏览器中的重复渲染。
    await new Promise((resolve) => setTimeout(resolve, 5));
    let data = [];
    if (url === '/api/preferences') data = { theme: 'light', defaultHome: 'home' };
    if (url === '/api/memos') homeReads++;
    if (url === '/api/workouts') data = { schedule: {}, logs: [], exercises: [] };
    return { ok: true, json: async () => data };
  };
  await import('../public/js/app.js');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(hash, '#/home');
  assert.equal(homeReads, 1);
  assert.equal(document.getElementById('content').children.length, 3);
});
