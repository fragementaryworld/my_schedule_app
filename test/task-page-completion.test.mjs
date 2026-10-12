import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr } from '../public/js/utils.js';
import * as plan from '../public/js/views/plan.js';
import * as item from '../public/js/views/item.js';
const { apiFixture } = createRequire(import.meta.url)('../test-helpers/api-fixture.js');
const tick = () => new Promise(r => setTimeout(r, 10));

function mount(t, fixture) {
  const original = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
  globalThis.document = makeDocument(); globalThis.location = { hash: '#/today' };
  globalThis.fetch = (url, options) => original.fetch(fixture.base + url, options);
  t.after(() => Object.assign(globalThis, original));
  const root = document.createElement('div'); document.body.append(root);
  return { root, read: async route => (await original.fetch(fixture.base + route)).json() };
}

function checkHeading(root) {
  const head = findAllByClass(root, 'page-head')[0];
  assert.equal(findAllByTag(head, 'input').length, 0, '标题区域不再创建勾选框');
  assert.equal(findAllByTag(head, 'h1')[0].getAttribute('contenteditable'), 'true');
}

async function setStatus(root, value) {
  const select = findAllByClass(root, 'task-status-select')[0]; select.value = value; select.fire('change');
  const label = value === 'yes' ? '已完成' : '未完成';
  for (let i = 0; i < 100 && textOf(findAllByClass(root, 'task-page-status')[0]) !== label; i++) await tick();
  assert.equal(textOf(findAllByClass(root, 'task-page-status')[0]), label); checkHeading(root);
}

test('普通事务标题没有勾选框，属性状态仍可完成和重新打开任务，备注保持不变', async t => {
  const fixture = await apiFixture(t);
  const task = (await fixture.request('POST', '/api/tasks', { title: '整理发票', date: todayStr(), note: '保留备注' })).body;
  const { root, read } = mount(t, fixture), base = `/api/tasks/${task.id}`;
  await plan.render(root, { id: task.id }); checkHeading(root);
  for (const value of ['yes', 'no']) {
    await setStatus(root, value);
    const saved = await read(base); assert.equal(saved.done, value === 'yes'); assert.equal(saved.note, '保留备注');
  }
});

test('项目子任务标题没有勾选框，下级列表仍可勾选完成且不替代当前任务的状态', async t => {
  const fixture = await apiFixture(t);
  const project = (await fixture.request('POST', '/api/projects', { name: '研究项目' })).body;
  const parent = (await fixture.request('POST', `/api/projects/${project.id}/tasks`, { title: '父任务' })).body;
  const baseParent = `/api/projects/${project.id}/tasks/${parent.id}`;
  const child = (await fixture.request('POST', baseParent + '/subtasks', { title: '子任务' })).body;
  const base = baseParent + `/subtasks/${child.id}`;
  const leaf = (await fixture.request('POST', base + '/subtasks', { title: '文献检索' })).body;
  const { root, read } = mount(t, fixture);
  await item.render(root, { id: project.id, chain: [parent.id, child.id] }); checkHeading(root);
  await setStatus(root, 'yes');
  const check = findAllByClass(root, 'item-check')[0]; assert.ok(check); check.click();
  for (let i = 0; i < 100 && !(await read(base)).subtasks[0].done; i++) await tick();
  await setStatus(root, 'no');
  const saved = await read(base);
  assert.equal(saved.done, false); assert.equal(saved.subtasks[0].id, leaf.id); assert.equal(saved.subtasks[0].done, true);
});
