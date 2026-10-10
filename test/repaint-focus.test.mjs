import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass, findAllByTag } from '../test-helpers/dom-shim.mjs';
import { todayStr } from '../public/js/utils.js';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/plan/t1' };

const ui = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'ui.js')).href);
const planMod = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'plan.js')).href);
const itemMod = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'item.js')).href);

const TODAY = todayStr();
const tick = () => new Promise((r) => setTimeout(r, 10));
const twice = async () => { await tick(); await tick(); };

// 视图容器要挂到文档上：恢复焦点靠 document.querySelector 找控件（真实应用里 #content 一直在文档里）
function mount() {
  const el = document.createElement('div');
  document.body.append(el);
  return el;
}

const calls = [];
let task = null;
let project = null;

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ url: u, method, body });
  // 模拟落库，重绘后能读到新值
  if (method === 'PUT' && body) {
    if (/\/api\/projects\/p1\/tasks/.test(u)) Object.assign(project.tasks[0], body);
    else Object.assign(task, body);
  }
  if (u.includes('/api/projects')) return { ok: true, status: 200, json: async () => [JSON.parse(JSON.stringify(project))] };
  if (/\/api\/tasks\/[^/?]+$/.test(u)) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(task)) };
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

function reset() {
  calls.length = 0;
  // 清掉上一个用例挂载的页面：同键元素若还留在文档里会互相干扰（真实应用同时只有一个页面）
  document.body.children = [];
  document.activeElement = null;
  task = { id: 't1', title: '原来的标题', date: TODAY, estimate: 120, dateFormat: 'ymd' };
  project = {
    id: 'p1', name: '项目', tasks: [
      { id: 't1', title: '原来的标题', done: false, estimate: 60, subtasks: [] }
    ]
  };
}

// ══════════ 焦点快照/恢复 ══════════

test('问题1：focusSnapshot 只记住带焦点键的控件', () => {
  reset();
  assert.equal(ui.focusSnapshot(), null, '没焦点时为 null');

  const plain = document.createElement('input');
  document.body.append(plain);
  plain.focus();
  assert.equal(ui.focusSnapshot(), null, '没带键的控件不记');

  const keyed = document.createElement('input');
  keyed.setAttribute('data-focus-key', 'k:estimate');
  document.body.append(keyed);
  keyed.focus();
  assert.deepEqual(ui.focusSnapshot(), { key: 'k:estimate' });
});

test('问题1：focusRestore 能在重绘后的新 DOM 里找回同一个控件', () => {
  reset();
  const old = document.createElement('input');
  old.setAttribute('data-focus-key', 'k:estimate');
  document.body.append(old);
  old.focus();
  const snap = ui.focusSnapshot();

  // 模拟整页重绘：旧节点被移除，换成新节点
  document.body.children = [];
  const fresh = document.createElement('input');
  fresh.setAttribute('data-focus-key', 'k:estimate');
  document.body.append(fresh);

  ui.focusRestore(snap);
  assert.equal(document.activeElement, fresh, '焦点应落到新控件上');
});

test('问题1：目标已不存在时不报错', () => {
  reset();
  assert.doesNotThrow(() => ui.focusRestore({ key: '不存在的键' }));
  assert.doesNotThrow(() => ui.focusRestore(null));
});

// ══════════ 真机场景：每日任务页 ══════════

test('问题1：属性控件都带焦点恢复键', async () => {
  reset();
  const el = mount();
  await planMod.render(el, { id: 't1' });

  const all = findAllByTag(el, 'input')
    .concat(findAllByTag(el, 'select'), findAllByTag(el, 'h1'), findAllByTag(el, 'button'));
  const keys = new Set(all.map((n) => n.getAttribute('data-focus-key')).filter(Boolean));
  assert.ok(keys.has('/api/tasks/t1:estimate'), '用时输入框要有键');
  assert.ok(keys.has('/api/tasks/t1:title'), '标题要有键');
  assert.ok(keys.has('/api/tasks/t1:date'), '时间字段要有键');
  assert.ok(keys.has('/api/tasks/t1:done'), '状态下拉要有键');
});

test('问题1【回归】：改完标题再点「用时」输入框，重绘后焦点不丢、能接着输入', async () => {
  reset();
  const el = mount();
  await planMod.render(el, { id: 't1' });

  const title = findAllByClass(el, 'page-title')[0];
  const est = findAllByClass(el, 'estimate-hours')[0];
  assert.ok(title && est, '应有标题与用时输入框');
  assert.equal(est.value, '2', '120 分钟 = 2 小时');

  // 1) 用户改标题
  title.focus();
  title.textContent = '改过的标题';
  // 2) 用户点进「预计用时」——标题失焦会触发保存 + 整页重绘
  est.focus();
  await twice();

  const est2 = findAllByClass(el, 'estimate-hours')[0];
  assert.notEqual(est2, est, '页面确实重绘过（旧输入框被替换）');
  assert.equal(document.activeElement, est2, '新输入框必须重新拿到焦点，否则敲键盘会落空');

  // 3) 接着输入就能进去，并能正常保存
  calls.length = 0;
  est2.value = '3';
  est2.fire('change');
  await twice();
  const put = calls.filter((c) => c.method === 'PUT').pop();
  assert.deepEqual(put.body, { estimate: 180 });
});

test('问题1【回归】：改完标题再点时间字段，焦点同样能恢复', async () => {
  reset();
  const el = mount();
  await planMod.render(el, { id: 't1' });

  const title = findAllByClass(el, 'page-title')[0];
  const trigger = findAllByClass(el, 'date-trigger')[0];
  title.focus();
  title.textContent = '又一个新标题';
  trigger.focus();
  await twice();

  const newTrigger = findAllByClass(el, 'date-trigger')[0];
  assert.notEqual(newTrigger, trigger, '页面重绘过');
  assert.equal(document.activeElement, newTrigger, '时间字段也要恢复焦点');
});

// ══════════ 真机场景：项目任务页 ══════════

test('问题1【回归】：项目任务页的用时输入框同样不会因重绘丢焦点', async () => {
  reset();
  globalThis.location.hash = '#/task/p1/t1';
  const el = mount();
  await itemMod.render(el, { id: 'p1', chain: ['t1'] });

  const title = findAllByClass(el, 'page-title')[0];
  const est = findAllByClass(el, 'estimate-hours')[0];
  assert.ok(title && est, '应有标题与用时输入框');
  assert.equal(est.getAttribute('data-focus-key'), '/api/projects/p1/tasks/t1:estimate');
  assert.equal(est.value, '1', '60 分钟 = 1 小时');

  title.focus();
  title.textContent = '改过的项目任务';
  est.focus();
  await twice();

  const est2 = findAllByClass(el, 'estimate-hours')[0];
  assert.notEqual(est2, est, '页面重绘过');
  assert.equal(document.activeElement, est2, '焦点要回到用时输入框');

  calls.length = 0;
  est2.value = '2';
  est2.fire('change');
  await twice();
  const put = calls.filter((c) => c.method === 'PUT').pop();
  assert.equal(put.url, '/api/projects/p1/tasks/t1');
  assert.deepEqual(put.body, { estimate: 120 });
});
