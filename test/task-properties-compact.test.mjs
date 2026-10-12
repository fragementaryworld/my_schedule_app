import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { taskProperty, taskProperties } from '../public/js/task-page.js';
import { h } from '../public/js/ui.js';
import * as plan from '../public/js/views/plan.js';
import * as item from '../public/js/views/item.js';
import { todayStr, addDays } from '../public/js/utils.js';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
const { apiFixture } = createRequire(import.meta.url)('../test-helpers/api-fixture.js');
const tick = () => new Promise(r => setTimeout(r, 15));
const labels = root => findAllByClass(root, 'prop-label').map(textOf);
const control = (root, label) => findAllByTag(root, 'select').find(e => e.getAttribute('aria-label') === label);

function dom(t) {
  const original = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
  globalThis.document = makeDocument(); globalThis.location = { hash: '#/today' };
  t.after(() => Object.assign(globalThis, original));
  const root = document.createElement('div'); document.body.append(root);
  return root;
}

test('属性分组移动原控件，焦点键和事件保持有效，不复制或隐藏字段', t => {
  dom(t); let calls = 0;
  const select = h('select'); select.value = 'no'; select.onchange = () => calls++;
  const date = h('button', {}, '2026-10-12 → 2026-10-20');
  const rows = [taskProperty('时间', date, 'task:date'), taskProperty('状态', select, 'task:done')];
  const originalRows = [...rows], grid = taskProperties(rows);
  assert.deepEqual(rows, originalRows);
  const basic = findAllByClass(grid, 'task-property-basics')[0], schedule = findAllByClass(grid, 'task-property-schedule')[0];
  assert.deepEqual(labels(basic), ['状态']); assert.deepEqual(labels(schedule), ['时间']);
  assert.equal(findAllByTag(grid, 'select')[0], select); assert.equal(findAllByTag(grid, 'button')[0], date);
  assert.equal(select.getAttribute('data-focus-key'), 'task:done'); assert.equal(date.getAttribute('data-focus-key'), 'task:date');
  select.fire('change'); assert.equal(calls, 1); assert.equal(findAllByClass(grid, 'prop-row').length, 2);
});

test('普通事务的短属性集中排布，跨天日期与安排保留在宽属性组，所有字段只出现一次', async t => {
  const root = dom(t), until = addDays(todayStr(), 4);
  const task = { id: 'day', title: '文件整理', date: todayStr(), endDate: until, planDate: todayStr(), planEndDate: until, planPeriod: 'afternoon', estimate: 60 };
  globalThis.fetch = async url => ({ ok: true, json: async () => url === '/api/projects' ? [] : task });
  await plan.render(root, { id: task.id });
  const basic = findAllByClass(root, 'task-property-basics')[0], schedule = findAllByClass(root, 'task-property-schedule')[0];
  assert.deepEqual(labels(basic), ['所属清单', '状态', '预计用时', '优先级', '重复']);
  assert.deepEqual(labels(schedule), ['时间', '当天安排']);
  assert.equal(findAllByClass(root, 'prop-row').length, 7); assert.equal(findAllByClass(schedule, 'date-field').length, 1);
  assert.ok(textOf(schedule).includes(until)); assert.ok(textOf(schedule).includes('下午'));
  assert.equal(findAllByClass(root, 'task-region').length, 2, '属性保持一个区域，没有新增重复分区');
});

for (const kind of ['day', 'project']) test(`${kind === 'day' ? '普通事务' : '项目任务'}紧凑属性通过真实 HTTP 保存，截止和安排不受影响`, async t => {
  const fixture = await apiFixture(t), nativeFetch = globalThis.fetch;
  const date = todayStr(), until = addDays(date, 3);
  let id, projectId, base;
  if (kind === 'day') {
    const response = await fixture.request('POST', '/api/tasks', { title: '整理发票', date, endDate: until, listId: 'work', planDate: date, planPeriod: 'morning' });
    assert.equal(response.status, 201); id = response.body.id; base = `/api/tasks/${id}`;
  } else {
    const project = (await fixture.request('POST', '/api/projects', { name: '调研项目' })).body; projectId = project.id;
    const task = (await fixture.request('POST', `/api/projects/${projectId}/tasks`, { title: '资料调研', dueDate: until, dueTime: '17:00', planDate: date, planPeriod: 'afternoon' })).body;
    id = task.id; base = `/api/projects/${projectId}/tasks/${id}`;
  }
  const root = dom(t); globalThis.fetch = (url, options) => nativeFetch(fixture.base + url, options);
  const render = () => kind === 'day' ? plan.render(root, { id }) : item.render(root, { id: projectId, chain: [id] });
  await render();
  const basic = findAllByClass(root, 'task-property-basics')[0];
  assert.equal(labels(basic).includes('时间'), false); assert.equal(labels(basic).includes('当天安排'), false);
  const estimate = findAllByClass(basic, 'estimate-hours')[0]; estimate.value = '1.5'; estimate.fire('blur');
  const read = async () => (await nativeFetch(fixture.base + base)).json();
  for (let i = 0; i < 100 && (await read()).estimate !== 90; i++) await tick();
  if (kind === 'day') {
    const owner = control(root, '所属清单'); owner.value = 'list:personal'; owner.fire('change');
    for (let i = 0; i < 100 && control(root, '所属清单') === owner; i++) await tick();
    assert.equal((await read()).listId, 'personal');
  }
  const done = control(root, '状态'); done.value = 'yes'; done.fire('change');
  for (let i = 0; i < 100 && control(root, '状态') === done; i++) await tick();
  await render();
  const saved = await read(); assert.equal(saved.estimate, 90); assert.equal(saved.done, true);
  assert.equal(saved.planDate, date); assert.equal(saved.planPeriod, kind === 'day' ? 'morning' : 'afternoon');
  assert.equal(kind === 'day' ? saved.endDate : saved.dueDate, until);
  if (kind === 'project') assert.equal(saved.dueTime, '17:00');
  assert.equal(control(root, '状态').value, 'yes');
  assert.equal(findAllByClass(root, 'estimate-hours')[0].value, '1.5');
});

test('属性网格按可用宽度换列，时间组更宽，窄屏不产生隐式列或裁切日期弹窗', () => {
  const css = readFileSync(new URL('../public/css/task-page.css', import.meta.url), 'utf8');
  const basic = /\.task-document \.task-property-basics \{([^}]+)\}/.exec(css)[1];
  const schedule = /\.task-document \.task-property-schedule \{([^}]+)\}/.exec(css)[1];
  assert.match(basic, /repeat\(auto-fit,minmax\(min\(100%,260px\),1fr\)\)/);
  assert.match(schedule, /repeat\(auto-fit,minmax\(min\(100%,380px\),1fr\)\)/);
  assert.doesNotMatch(css, /grid-auto-flow:\s*dense|grid-column:\s*span/, '视觉顺序与键盘顺序保持一致，单列时不生成额外列');
  assert.doesNotMatch(basic + schedule, /overflow:\s*(hidden|clip|auto)/);
  assert.match(css, /@media \(max-width:480px\)[\s\S]*\.task-document \.prop-row \{ grid-template-columns:minmax\(0,1fr\)/);
});
