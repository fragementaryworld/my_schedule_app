import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByTag, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr } from '../public/js/utils.js';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/plan/t1' };

const TASK = {
  id: 't1', title: '写周报', date: todayStr(), time: '09:30', priority: 'high',
  repeat: 'weekly', source: { type: 'project', id: null }, note: '**重点**', done: false, order: 0
};

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
  if (u.includes('/api/preferences')) return { ok: true, status: 200, json: async () => ({ weekStart: 'mon' }) };
  if (method === 'GET' && u.includes('/api/projects')) return { ok: true, status: 200, json: async () => [] };
  if (method === 'GET' && u.includes('/api/tasks?from=')) {
    return { ok: true, status: 200, json: async () => [JSON.parse(JSON.stringify(TASK))] };
  }
  if (method === 'GET' && /\/api\/tasks\/[^/?]+$/.test(u)) {
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(TASK)) };
  }
  if (method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 'newday1' }) };
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const daytaskUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'daytask.js')).href;
const planUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'plan.js')).href;
const todayUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'today.js')).href;
const daytask = await import(daytaskUrl);
const planMod = await import(planUrl);
const todayMod = await import(todayUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));
const dayBtn = (root, date) => findAllByClass(root, 'dp-day').find((d) => d.dataset.date === date);

async function renderPlan() {
  calls.length = 0;
  const el = document.createElement('div');
  await planMod.render(el, { id: 't1' });
  return el;
}

test('问题2：新建任务跳到任务页面（不弹窗）', async () => {
  calls.length = 0;
  globalThis.location.hash = '#/today';
  const created = await daytask.createDayTask('2024-05-20');
  const post = calls.find((c) => c.method === 'POST' && c.url === '/api/tasks');
  assert.ok(post, '应创建任务');
  assert.equal(post.body.title, daytask.DEFAULT_DAY_TASK_TITLE);
  assert.equal(post.body.date, '2024-05-20');
  assert.equal(created.id, 'newday1');
  assert.equal(globalThis.location.hash, '#/plan/newday1', '应跳到任务页面');
  assert.equal(daytask.dayTaskHref('x'), '#/plan/x');
});

test('问题2：isFreshDayTask 判定刚新建的任务', () => {
  assert.equal(daytask.isFreshDayTask({ title: daytask.DEFAULT_DAY_TASK_TITLE, priority: 'medium' }), true);
  assert.equal(daytask.isFreshDayTask({ title: '有名字', priority: 'medium' }), false);
  assert.equal(daytask.isFreshDayTask({ title: daytask.DEFAULT_DAY_TASK_TITLE, time: '09:00' }), false);
  assert.equal(daytask.isFreshDayTask({ title: daytask.DEFAULT_DAY_TASK_TITLE, note: 'x' }), false);
  assert.equal(daytask.isFreshDayTask({ title: daytask.DEFAULT_DAY_TASK_TITLE, repeat: 'daily' }), false);
  assert.equal(daytask.isFreshDayTask(null), false);
});

test('问题2：任务页面导出 render/add 并带完整属性', async () => {
  assert.equal(typeof planMod.render, 'function');
  assert.equal(typeof planMod.add, 'function');
  const el = await renderPlan();
  assert.equal(findAllByClass(el, 'date-field').length, 1, '有时间字段（日期选择器）');
  assert.equal(findAllByTag(el, 'input').filter((i) => i.getAttribute('type') === 'date').length, 0);
  const text = textOf(el);
  for (const label of ['状态', '时间', '优先级', '重复', '来源']) assert.ok(text.includes(label), `缺少 ${label}`);
  assert.ok(text.includes('🗑 删除任务'));
  assert.ok(findAllByClass(el, 'feed-goal-md').length >= 1, '备注区');
});

test('问题2：标题就地编辑保存', async () => {
  const el = await renderPlan();
  const title = findAllByClass(el, 'page-title')[0];
  assert.equal(title.getAttribute('contenteditable'), 'true');
  assert.equal(title.textContent, '写周报');
  title.textContent = '写月报';
  title.dispatchEvent('blur');
  await tick();
  const put = calls.find((c) => c.method === 'PUT' && c.body && c.body.title);
  assert.deepEqual(put.body, { title: '写月报' });
  assert.equal(put.url, '/api/tasks/t1');
});

test('问题2：日期选择器写回 date/time/dateFormat', async () => {
  calls.length = 0;
  const el = await renderPlan();
  const target = `${todayStr().slice(0, 8)}15`; // 当月 15 号，保证落在展开的日历里
  findAllByClass(el, 'date-trigger')[0].click();
  dayBtn(el, target).click();
  await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.deepEqual(put.body, { date: target, time: '09:30', dateFormat: 'full' });
});

test('问题2：状态/优先级/重复/来源 都能改', async () => {
  const el = await renderPlan();
  const selects = findAllByClass(el, 'inline-select');
  assert.equal(selects.length, 4, '状态 / 优先级 / 重复 / 来源');

  calls.length = 0;
  selects[0].value = 'yes';
  selects[0].fire('change');
  await tick();
  assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { done: true });

  calls.length = 0;
  selects[2].value = 'd2';
  selects[2].fire('change');
  await tick();
  assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { repeat: { interval: 2, unit: 'day' } });

  calls.length = 0;
  selects[3].value = '';
  selects[3].fire('change');
  await tick();
  assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { source: null });
});

test('问题2：备注按 Markdown 渲染并可编辑', async () => {
  calls.length = 0;
  const el = await renderPlan();
  const md = findAllByClass(el, 'feed-goal-md')[0];
  assert.ok(String(md.innerHTML).includes('<strong>重点</strong>'), '备注按 Markdown 渲染');

  const edit = findAllByClass(el, 'feed-goal')[0];
  edit.textContent = '改后的备注';
  edit.dispatchEvent('blur');
  await tick();
  assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { note: '改后的备注' });
});

test('问题2：删除需要确认并回到今日计划', async () => {
  calls.length = 0;
  globalThis.location.hash = '#/plan/t1';
  const el = await renderPlan();
  const del = findAllByTag(el, 'button').find((b) => textOf(b).includes('删除任务'));
  del.click();
  await tick();

  const ok = findAllByTag(document.body, 'button').find((b) => textOf(b) === '确认');
  assert.ok(ok, '应弹出确认框');
  ok.click();
  await tick();

  const req = calls.find((c) => c.method === 'DELETE');
  assert.equal(req.url, '/api/tasks/t1');
  assert.equal(globalThis.location.hash, '#/today');
});

test('问题2：今日计划的「＋ 新增任务」直接建任务并跳页面', async () => {
  calls.length = 0;
  globalThis.location.hash = '#/today';
  const el = document.createElement('div');
  await todayMod.render(el);
  const addBtn = findAllByTag(el, 'button').find((b) => textOf(b).includes('新增任务'));
  assert.ok(addBtn, '日历应有新增任务按钮');
  addBtn.click();
  await tick();

  const post = calls.find((c) => c.method === 'POST' && c.url === '/api/tasks');
  assert.ok(post, '应创建任务');
  assert.equal(globalThis.location.hash, '#/plan/newday1');
});

test('问题2：点日历卡片标题进入任务页面', async () => {
  globalThis.location.hash = '#/today';
  const el = document.createElement('div');
  await todayMod.render(el);
  const title = findAllByClass(el, 'cal-card-title')[0];
  assert.ok(title, '日历里应有条目');
  title.click();
  assert.ok(globalThis.location.hash.startsWith('#/plan/'), '应跳到任务页面');
});

test('问题2：今日计划不再使用弹窗式新增/编辑', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'public', 'js', 'views', 'today.js'), 'utf8');
  assert.ok(!src.includes('openModal'), '不应再引入弹窗');
  assert.ok(src.includes('createDayTask'), '应使用页面式新增');
  assert.ok(src.includes('dayTaskHref'), '应跳到任务页面');
});
