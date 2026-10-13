import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWebdavSettings } from '../public/js/webdav-settings.js';
import { waitForPendingWrites } from '../public/js/saving.js';
import { makeDocument, findAllByTag, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, extra = {}) {
  const original = { document: globalThis.document, fetch: globalThis.fetch };
  t.after(() => Object.assign(globalThis, original)); globalThis.document = makeDocument();
  const config = { configured: true, enabled: true, url: 'https://dav.example/data/', username: 'tester', hasPassword: true, fileName: 'schedule-app.json', intervalMinutes: 5, backups: [], ...extra };
  const requests = [], syncs = [];
  globalThis.fetch = async (url, options) => { requests.push({ url, ...options }); return { ok: true, json: async () => config }; };
  let listener;
  const controller = { state: { phase: 'ready', config, message: '两端数据一致', running: false }, start: async () => {},
    sync: async (...args) => { syncs.push(args); }, subscribe: fn => { listener = fn; fn(controller.state); return () => { listener = null; }; } };
  const view = buildWebdavSettings(config, controller); document.body.append(view.element); view.connect(() => true);
  return { view, config, controller, requests, syncs, emit(state) { controller.state = { ...controller.state, ...state }; listener(controller.state); },
    field: name => document.getElementById('webdav-' + name), button: text => findAllByTag(view.element, 'button').find(node => textOf(node) === text) };
}

test('配置密码不回显，保存时空密码省略，自动同步选项保留', async t => {
  const f = fixture(t); assert.equal(f.field('password').value, ''); assert.match(f.field('password').placeholder, /已保存/);
  f.field('interval').value = '10'; f.field('interval').fire('change'); assert.equal(f.button('立即同步').disabled, true);
  findAllByTag(f.view.element, 'form')[0].fire('submit'); await tick();
  const request = f.requests[0], body = JSON.parse(request.body); assert.equal(request.method, 'PUT'); assert.equal('password' in body, false);
  assert.equal(body.enabled, true); assert.equal(body.intervalMinutes, 10); assert.equal(f.button('立即同步').disabled, false);
});

test('未配置时默认勾选自动同步，运行期间禁用连接和动作', t => {
  const f = fixture(t, { configured: false, enabled: false }); assert.equal(f.field('enabled').checked, true); assert.equal(f.button('立即同步').disabled, true);
  f.emit({ running: true }); assert.equal(f.field('url').disabled, true); assert.equal(f.button('保存同步设置').disabled, true);
});

test('连接失败和保存错误在界面保留，不影响本机保存队列', async t => {
  const f = fixture(t); globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({ error: '证书无效' }) });
  await f.button('测试连接').onclick(); assert.match(textOf(findAllByClass(f.view.element, 'webdav-message')[0]), /证书无效/);
  findAllByTag(f.view.element, 'form')[0].fire('submit'); await tick();
  assert.match(textOf(findAllByClass(f.view.element, 'webdav-message')[0]), /证书无效/); await waitForPendingWrites();
});

test('冲突显示两端数量，取消不操作，确认后传递方向及令牌', async t => {
  const f = fixture(t); f.emit({ result: { status: 'conflict', token: 'token-1', local: { tasks: 2, projects: 1, books: 0, ideas: 0, memos: 0 }, remote: { tasks: 3, projects: 2, books: 0, ideas: 0, memos: 0 } } });
  assert.match(textOf(findAllByClass(f.view.element, 'webdav-conflict')[0]), /任务 2/);
  const cancelled = f.button('保留本机并上传').onclick(); findAllByTag(document.body, 'button').find(node => textOf(node) === '取消').click(); await cancelled; assert.equal(f.syncs.length, 0);
  const confirmed = f.button('使用远端替换本机').onclick(); findAllByTag(document.body, 'button').find(node => textOf(node) === '确认').click(); await confirmed;
  assert.deepEqual(f.syncs, [['download', 'token-1']]);
});

test('恢复备份提供导出入口，远端不存在时只提供本机上传', t => {
  const f = fixture(t, { backups: [{ id: 'backup-id', kind: 'local', createdAt: '2026-10-14T01:00:00Z' }] });
  const link = findAllByTag(f.view.element, 'a')[0]; assert.equal(link.getAttribute('href'), '/api/webdav/backups/backup-id');
  f.emit({ result: { status: 'conflict', token: 'token-2', local: { tasks: 1 }, remote: null } });
  assert.ok(f.button('保留本机并上传')); assert.equal(f.button('使用远端替换本机'), undefined);
});
