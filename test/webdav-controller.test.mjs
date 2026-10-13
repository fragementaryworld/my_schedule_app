import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebdavController, editingNow, lockSyncInterface } from '../public/js/webdav.js';
import { api } from '../public/js/api.js';
import { waitForPendingWrites } from '../public/js/saving.js';
import { makeDocument, findAllByClass } from '../test-helpers/dom-shim.mjs';

function fixture(options = {}) {
  const timers = new Map(), events = []; let sequence = 0;
  const config = { configured: true, enabled: true, intervalMinutes: 5 };
  const controller = createWebdavController({ getConfig: async () => config,
    request: async body => { events.push(['request', body]); return { status: 'unchanged' }; },
    flush: async () => { events.push('flush'); }, wait: async () => { events.push('wait'); }, isEditing: () => false,
    lock: () => { events.push('lock'); return () => events.push('unlock'); },
    setTimer: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimer: id => timers.delete(id), ...options });
  return { controller, config, events, timers, async fire() { const [id, timer] = [...timers][0]; timers.delete(id); timer.callback(); await new Promise(resolve => setImmediate(resolve)); } };
}

test('开启同步后启动立即执行，先保存再传输，按配置定时重复', async () => {
  const f = fixture(); await f.controller.start();
  assert.deepEqual(f.events.slice(0, 4), ['lock', 'flush', 'wait', ['request', { direction: 'auto' }]]);
  assert.equal(f.events.at(-1), 'unlock'); assert.equal(f.controller.state.running, false);
  assert.equal([...f.timers.values()][0].delay, 300000);
  await f.fire(); assert.equal(f.events.filter(Array.isArray).length, 2);
  f.controller.stop(); assert.equal(f.timers.size, 0);
});

test('自动同步关闭不发请求、不启动定时器，但允许手动同步', async () => {
  const f = fixture(); f.config.enabled = false; await f.controller.start();
  assert.equal(f.events.length, 0); assert.equal(f.timers.size, 0);
  assert.equal((await f.controller.sync()).status, 'unchanged'); assert.equal(f.timers.size, 0);
});

test('无连接配置时不触发同步，配置损坏显示错误', async () => {
  const f = fixture(); f.config.configured = false; await f.controller.start();
  assert.equal((await f.controller.sync()).status, 'disabled'); assert.equal(f.events.length, 0);
  f.config.configurationError = '配置损坏'; await f.controller.start(); assert.equal(f.controller.state.phase, 'error');
});

test('正在编辑时自动延后，手动同步先失焦提交再等待', async () => {
  let editing = true, blurred = false;
  const f = fixture({ isEditing: () => editing, blur: () => { blurred = true; editing = false; } });
  await f.controller.start(); assert.equal(f.controller.state.phase, 'waiting'); assert.equal(f.events.length, 0);
  assert.equal([...f.timers.values()][0].delay, 60000);
  await f.controller.sync(); assert.equal(blurred, true); assert.equal(f.events[1], 'flush');
});

test('冲突暂停自动计时，确认方向和令牌传入后恢复计时', async () => {
  let response = { status: 'conflict', token: 'confirmation' }; const bodies = [];
  const f = fixture({ request: async body => { bodies.push(body); return response; } });
  await f.controller.start(); assert.equal(f.controller.state.phase, 'conflict'); assert.equal(f.timers.size, 0);
  response = { status: 'uploaded' }; await f.controller.sync('upload', 'confirmation');
  assert.deepEqual(bodies[1], { direction: 'upload', token: 'confirmation' }); assert.equal(f.timers.size, 1);
});

test('下载后刷新在解锁前执行，错误亦会释放编辑锁并按周期重试', async () => {
  let fail = false, locked = false, refreshes = 0;
  const f = fixture({ lock: () => { locked = true; return () => { locked = false; }; },
    request: async () => { if (fail) throw new Error('连接失败'); return { status: 'downloaded' }; },
    onDownloaded: async () => { assert.equal(locked, true); refreshes++; } });
  await f.controller.start(); assert.equal(refreshes, 1); assert.equal(locked, false);
  fail = true; await f.fire(); assert.equal(f.controller.state.phase, 'error'); assert.equal(locked, false); assert.equal(f.timers.size, 1);
});

test('本机保存失败不访问远端，仍保留失败提示', async () => {
  const f = fixture({ flush: async () => { throw new Error('本机磁盘错误'); } }); await f.controller.start();
  assert.equal(f.events.some(Array.isArray), false); assert.equal(f.controller.state.message, '本机磁盘错误'); assert.equal(f.events.at(-1), 'unlock');
});

test('下载已生效后即使同步元数据读取失败，仍刷新旧页面', async () => {
  let reads = 0, refreshed = 0;
  const f = fixture({ getConfig: async () => { if (++reads > 1) throw new Error('元数据读取失败'); return { configured: true, enabled: true, intervalMinutes: 5 }; },
    request: async () => ({ status: 'downloaded' }), onDownloaded: async () => { refreshed++; } });
  await f.controller.start(); assert.equal(refreshed, 1); assert.equal(f.controller.state.phase, 'error'); assert.equal(f.events.at(-1), 'unlock');
});

test('并发手动请求只发一次，停止后迟到下载不刷新也不恢复计时', async () => {
  let release, enter, refreshes = 0;
  const entered = new Promise(resolve => { enter = resolve; });
  const f = fixture({ request: () => { enter(); return new Promise(resolve => { release = resolve; }); }, onDownloaded: async () => { refreshes++; } });
  f.config.enabled = false; await f.controller.start();
  const pending = f.controller.sync(); await entered;
  assert.equal((await f.controller.sync()).status, 'busy'); f.controller.stop(); release({ status: 'downloaded' }); await pending;
  assert.equal(refreshes, 0); assert.equal(f.timers.size, 0); assert.equal(f.events.at(-1), 'unlock');
});

test('编辑检测涵盖属性、正文和下拉输入，复选框不延后同步', () => {
  const doc = makeDocument();
  for (const tag of ['input', 'textarea', 'select']) { doc.activeElement = doc.createElement(tag); assert.equal(editingNow(doc), true); }
  doc.activeElement = doc.createElement('div'); doc.activeElement.setAttribute('contenteditable', 'true'); assert.equal(editingNow(doc), true);
  doc.activeElement = doc.createElement('input'); doc.activeElement.type = 'checkbox'; assert.equal(editingNow(doc), false);
});

test('打开的表单或确认弹窗会延后自动同步，防止旧表单覆盖下载结果', async () => {
  const doc = makeDocument(), modal = doc.createElement('div'); modal.className = 'modal-backdrop'; doc.body.append(modal);
  const f = fixture({ isEditing: () => editingNow(doc) }); await f.controller.start();
  assert.equal(f.controller.state.phase, 'waiting'); assert.equal(f.events.length, 0);
  modal.remove(); await f.fire(); assert.equal(f.controller.state.phase, 'ready');
});

test('同步锁覆盖主界面和弹窗，解除时恢复原先 inert 状态', () => {
  const doc = makeDocument();
  for (const id of ['app', 'fab']) { const node = doc.createElement('div'); node.id = id; doc.body.append(node); }
  const modal = doc.createElement('div'); modal.className = 'modal-backdrop'; modal.inert = true; doc.body.append(modal);
  const unlock = lockSyncInterface(doc); assert.equal(doc.getElementById('app').inert, true); assert.equal(findAllByClass(doc.body, 'modal-backdrop')[0].inert, true);
  unlock(); assert.equal(!!doc.getElementById('app').inert, false); assert.equal(modal.inert, true);
});

test('远端连接操作失败不会被视为未保存的本机数据', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({ error: 'WebDAV 离线' }) });
  await assert.rejects(api.action('/api/webdav/sync', {}), /离线/);
  await assert.rejects(api.action('/api/webdav/config', {}, 'PUT'), /离线/);
  await waitForPendingWrites();
});
