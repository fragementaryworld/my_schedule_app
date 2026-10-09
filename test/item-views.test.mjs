import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByTag, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/task/p1/t1/s1' };

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({
    url: String(url),
    method: opts.method || 'GET',
    body: opts.body ? JSON.parse(opts.body) : null
  });
  return { ok: true, status: 200, json: async () => ({ id: 'newchild' }) };
};

const projectsUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href;
const itemUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'item.js')).href;
const projects = await import(projectsUrl);
const itemMod = await import(itemUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));

// 当前页在第 2 层（t1 → s1），下级是第 3 层
const CHAIN = ['t1', 's1'];
const PROJECT = {
  id: 'p1', name: 'P', icon: '📁', dateFormat: 'iso', blocks: [],
  startDate: '2024-05-01', dueDate: '2024-05-31',
  tasks: [{
    id: 't1', title: 'L1', done: false, subtasks: [{
      id: 's1', title: 'L2', done: false, startDate: '2024-05-01', dueDate: '2024-05-10',
      subtasks: [
        { id: 's2', title: 'L3-A', done: false, dueDate: '2024-05-05', subtasks: [{ id: 's4', title: 'L4', done: true, subtasks: [] }] },
        { id: 's2b', title: 'L3-B', done: true, dueDate: '2024-05-08', subtasks: [] }
      ]
    }]
  }]
};

const LAYER = `${'/api/projects/p1/tasks/t1/subtasks/s1'}`;

function layerBox(view, extra = {}) {
  const parent = itemMod.resolveChain(PROJECT, CHAIN);
  const el = document.createElement('div');
  const refresh = () => {
    el.innerHTML = '';
    el.append(projects.buildChildViews({
      projectId: 'p1',
      parentChain: CHAIN,
      items: parent.subtasks,
      rangeNode: parent,
      refresh,
      ...extra
    }));
  };
  refresh();
  if (view) findAllByTag(el, 'button').find((b) => textOf(b) === view).click();
  return { el, refresh };
}

test('问题1：任意层级的下级区块都有标准四视图', () => {
  const { el } = layerBox();
  const tabs = findAllByClass(el, 'tab').map((t) => textOf(t));
  assert.deepEqual(tabs, ['表格', '时间线', '看板', '信息流']);
});

test('问题1：层级 2 的表格视图指向第 3 层路径', async () => {
  calls.length = 0;
  const { el } = layerBox('表格');

  const cb = findAllByClass(el, 'item-check')[0];
  assert.equal(cb.getAttribute('type'), 'checkbox');
  cb.click();
  await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, `${LAYER}/subtasks/s2`, '勾选写到该层自己的地址');
  assert.deepEqual(put.body, { done: true });

  globalThis.location.hash = '#/task/p1/t1/s1';
  findAllByClass(el, 'row-link')[0].click();
  assert.equal(globalThis.location.hash, '#/task/p1/t1/s1/s2', '名称进入该层的下一页');
});

test('问题1：层级 2 的时间线视图有刻度与时间条', () => {
  const { el } = layerBox('时间线');
  assert.equal(findAllByClass(el, 'timeline-axis').length, 1);
  assert.ok(findAllByClass(el, 'timeline-tick-label').length >= 2, '应有日期刻度');
  assert.equal(findAllByClass(el, 'timeline-bar').length, 2, '两个有时间的下级');
  assert.ok(findAllByClass(el, 'timeline-handle').length >= 4, '两端把手');
});

test('问题1：层级 2 的看板视图可拖动且写到第 3 层路径', async () => {
  calls.length = 0;
  const { el } = layerBox('看板');
  const cols = findAllByClass(el, 'kanban-col');
  assert.equal(cols.length, 2, '待办 / 已完成');

  cols[1].fire('drop', { preventDefault() {}, dataTransfer: { getData: () => 's2' } });
  await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, `${LAYER}/subtasks/s2`);
  assert.deepEqual(put.body, { done: true });
});

test('问题1：层级 2 的信息流有卡片、标题可编辑、下级看板可拖动', async () => {
  calls.length = 0;
  const { el } = layerBox('信息流');
  assert.equal(findAllByClass(el, 'feed-post').length, 2, '每个下级一张卡片');

  const title = findAllByClass(el, 'feed-title')[0];
  assert.equal(title.getAttribute('contenteditable'), 'true');
  title.textContent = '改过的名字';
  title.dispatchEvent('blur');
  await tick();
  let put = calls.find((c) => c.method === 'PUT' && c.body && c.body.title);
  assert.equal(put.url, `${LAYER}/subtasks/s2`);
  assert.deepEqual(put.body, { title: '改过的名字' });

  calls.length = 0;
  const boards = findAllByClass(el, 'kanban-col');
  boards[0].fire('drop', { preventDefault() {}, dataTransfer: { getData: () => 's4' } });
  await tick();
  put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, `${LAYER}/subtasks/s2/subtasks/s4`, '下级看板写到第 4 层');
  assert.deepEqual(put.body, { done: false });
});

test('问题1：新增下级按钮写正确的地址并跳到新层', async () => {
  calls.length = 0;
  globalThis.location.hash = '#/task/p1/t1/s1';
  const { el } = layerBox('表格', {
    addLabel: '＋ 新增子子任务',
    onAdd: () => projects.createChild('p1', CHAIN)
  });
  const btn = findAllByTag(el, 'button').find((b) => textOf(b).includes('新增'));
  assert.ok(btn, '应有新增按钮');
  assert.ok(textOf(btn).includes('子子任务'), '按钮文案按层级');

  btn.click();
  await tick();
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.url, `${LAYER}/subtasks`, '创建地址是当前层的下级集合');
  assert.equal(globalThis.location.hash, '#/task/p1/t1/s1/newchild', '跳到新层页面');
});

test('问题1：任务页（第 1 层）也是同一套四视图', () => {
  const page = { id: 'p1', name: 'P', dateFormat: 'iso', blocks: [], startDate: '2024-05-01', dueDate: '2024-05-31', tasks: PROJECT.tasks };
  const section = projects.buildProjectTasksSection(page, () => {});
  assert.deepEqual(findAllByClass(section, 'tab').map((t) => textOf(t)), ['表格', '时间线', '看板', '信息流']);
  assert.ok(textOf(section).includes('＋ 新增任务'));
});

test('问题1：任务页的下级区块与项目页任务区共用同一实现', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'public', 'js', 'views', 'item.js'), 'utf8');
  assert.ok(src.includes('buildChildViews'), '任务页应复用通用下级视图');
  assert.ok(!src.includes("class: 'subtask-list'"), '不应再自造一份列表');
});

test('问题1：最深一层不显示新增按钮但有提示', () => {
  const parent = itemMod.resolveChain(PROJECT, ['t1', 's1', 's2']);
  const el = document.createElement('div');
  el.append(projects.buildChildViews({
    projectId: 'p1',
    parentChain: ['t1', 's1', 's2'],
    items: parent.subtasks,
    rangeNode: parent,
    refresh: () => {},
    canAdd: false,
    hint: '已达最大层级（5 层），不能再添加下级。'
  }));
  assert.equal(findAllByTag(el, 'button').filter((b) => textOf(b).includes('新增')).length, 0);
  assert.ok(textOf(el).includes('已达最大层级'));
});
