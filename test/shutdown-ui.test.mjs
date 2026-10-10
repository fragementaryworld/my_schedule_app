import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Element, makeDocument, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { shutdownNow, endService, saveNow } from '../public/js/app.js';
import { api } from '../public/js/api.js';
import { waitForPendingWrites } from '../public/js/saving.js';
import { buildContentEditor } from '../public/js/views/page.js';
import { buildEstimateField } from '../public/js/estimate.js';
import * as home from '../public/js/views/home.js';

let calls;
function setup(responder = async () => ({ ok: true })) {
  calls = [];
  globalThis.document = makeDocument();
  globalThis.window = { removeEventListener() {}, scrollTo() {} };
  globalThis.requestAnimationFrame = (callback) => callback();
  const shell = new Element('div');
  shell.id = 'app';
  document.body.append(shell);
  for (const id of ['shutdownBtn', 'saveBtn', 'fab', 'content']) {
    const element = new Element(id === 'content' ? 'div' : 'button');
    element.id = id;
    shell.append(element);
  }
  globalThis.fetch = async (url, options = {}) => {
    const call = { url, method: options.method, body: options.body && JSON.parse(options.body) };
    calls.push(call);
    const data = await responder(call);
    return { ok: !data.error, status: data.error ? 500 : 200, json: async () => data };
  };
}

function editor() {
  const wrap = buildContentEditor({ value: '', key: 'test-content', debounceMs: 60000,
    onSave: (desc) => api.put('/api/projects/example', { desc }) });
  document.getElementById('content').append(wrap);
  const editable = wrap.children[1];
  editable.textContent = '刚刚输入，还没等到自动保存';
  editable.fire('input');
  return editable;
}

function confirmButton(text) {
  return findAllByTag(document.body, 'button').find((button) => textOf(button) === text);
}

test('结束服务立即提交防抖编辑与预计用时，并在所有写入完成后请求结束', async () => {
  let complete;
  setup(async (call) => {
    if (call.url === '/api/projects/example') await new Promise((resolve) => { complete = resolve; });
    return { ok: true };
  });
  editor();
  const estimate = buildEstimateField({ value: null, key: 'estimate', debounceMs: 60000,
    onSave: (value) => api.put('/api/tasks/example', { estimate: value }) });
  document.getElementById('content').append(estimate);
  const input = estimate.children[0];
  input.value = '1.5';
  input.fire('input');
  const ending = shutdownNow();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.some((call) => call.url === '/api/shutdown'), false);
  assert.equal(calls.find((call) => call.url === '/api/tasks/example').body.estimate, 90);
  complete();
  await ending;
  assert.equal(calls.at(-1).url, '/api/shutdown');
  assert.equal(calls.find((call) => call.url === '/api/projects/example').body.desc, '刚刚输入，还没等到自动保存');
});

test('手动保存也提交尚未失焦的内容，内容失败时不结束服务且可重试', async () => {
  let fail = true;
  setup(async (call) => call.url === '/api/projects/example' && fail ? { error: '保存失败' } : { ok: true });
  editor();
  await assert.rejects(shutdownNow(), /保存失败/);
  assert.equal(calls.some((call) => call.url === '/api/shutdown'), false);
  fail = false;
  await saveNow();
  assert.equal(calls.at(-1).url, '/api/save');
  await shutdownNow();
  assert.equal(calls.at(-1).url, '/api/shutdown');
});

test('已发出的失焦写入失败时，不能跳过错误直接结束服务', async () => {
  setup(async () => ({ error: '失焦保存失败' }));
  await api.put('/api/tasks/failed', { title: '新标题' }).catch(() => {});
  await assert.rejects(shutdownNow(), /失焦保存失败/);
  assert.equal(calls.some((call) => call.url === '/api/shutdown'), false);
  await waitForPendingWrites();
});

test('结束按钮可以取消；确认后重复点击只发一次请求，成功显示结束提示', async () => {
  setup();
  let ending = endService();
  confirmButton('取消').click();
  await ending;
  assert.equal(calls.length, 0);
  ending = endService();
  await endService();
  assert.equal(document.querySelectorAll('.modal-backdrop').length, 1);
  confirmButton('保存并结束').click();
  await ending;
  assert.equal(calls.filter((call) => call.url === '/api/shutdown').length, 1);
  assert.match(textOf(document.getElementById('content')), /已保存，服务已结束/);
  assert.equal(document.getElementById('saveBtn').disabled, true);
  assert.equal(document.getElementById('shutdownBtn').disabled, true);
  assert.equal(document.getElementById('fab').style.display, 'none');
});

test('服务端保存失败时恢复按钮和界面，显示失败提示', async () => {
  let failed = true;
  setup(async () => failed ? { error: '磁盘不可写' } : { ok: true });
  const ending = endService();
  confirmButton('保存并结束').click();
  await ending;
  assert.equal(document.getElementById('shutdownBtn').disabled, false);
  assert.equal(document.getElementById('app').inert, false);
  assert.equal(document.getElementById('fab').disabled, false);
  failed = false;
  const retry = endService();
  confirmButton('保存并结束').click();
  await retry;
  assert.match(textOf(document.getElementById('content')), /已保存，服务已结束/);
  assert.equal(calls.filter((call) => call.url === '/api/shutdown').length, 2);
});

test('快速备忘尚未按回车也会保存；回车与结束同时触发不会重复新增', async () => {
  setup(async (call) => {
    if (call.method !== 'GET') return { ok: true };
    if (call.url === '/api/preferences') return { defaultHome: 'home' };
    if (call.url === '/api/workouts') return { exercises: [], schedule: {}, logs: [] };
    return [];
  });
  await home.render(document.getElementById('content'));
  const input = findAllByTag(document.getElementById('content'), 'input')[0];
  input.value = '关闭前记下的备忘';
  input.fire('keydown', { key: 'Enter' });
  await shutdownNow();
  const memos = calls.filter((call) => call.url === '/api/memos' && call.method === 'POST');
  assert.equal(memos.length, 1);
  assert.equal(memos[0].body.text, '关闭前记下的备忘');
  assert.equal(calls.at(-1).url, '/api/shutdown');
});
