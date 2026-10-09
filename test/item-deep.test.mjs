import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByTag, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/task/p1/t1' };

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({
    url: String(url),
    method: opts.method || 'GET',
    body: opts.body ? JSON.parse(opts.body) : null
  });
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const projectsUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href;
const itemUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'item.js')).href;
const projects = await import(projectsUrl);
const itemMod = await import(itemUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));

// t1 → s1 → { s2a → s3 → s4, s2b }；每次构造全新对象，避免用例之间互相影响
const mkTree = () => ({
  id: 'p1', name: 'P', icon: '📁', dateFormat: 'iso', blocks: [],
  startDate: '2024-05-01', dueDate: '2024-05-31',
  tasks: [{
    id: 't1', title: 'L1', done: false, dueDate: '2024-05-20', subtasks: [{
      id: 's1', title: 'L2', done: false, dueDate: '2024-05-10', subtasks: [
        { id: 's2a', title: 'L3-a', done: false, dueDate: '2024-05-05', subtasks: [
          { id: 's3', title: 'L4', done: false, dueDate: '2024-05-06', subtasks: [
            { id: 's4', title: 'L5', done: true, dueDate: '2024-05-07', subtasks: [] }
          ] }
        ] },
        { id: 's2b', title: 'L3-b', done: true, dueDate: null, subtasks: [] }
      ]
    }]
  }]
});

const DEPTH = '/api/projects/p1/tasks/t1/subtasks/s1';

function layerBox(view, tree = mkTree()) {
  const item = itemMod.resolveChain(tree, ['t1']);
  const el = document.createElement('div');
  const refresh = () => {
    el.innerHTML = '';
    el.append(projects.buildChildViews({
      projectId: 'p1',
      parentChain: ['t1'],
      items: item.subtasks,
      rangeNode: item,
      refresh,
      deep: true,
      defaultExpanded: true,
      canAdd: true,
      addLabel: '＋ 新增子任务',
      onAdd: () => projects.createChild('p1', ['t1'])
    }));
  };
  refresh();
  if (view) findAllByTag(el, 'button').find((b) => textOf(b) === view).click();
  return { el, refresh, tree, item };
}

// ——— 纯函数：子树摊平 ———

test('问题2：flattenSubtree 深度优先摊平并给出路径与层级', () => {
  const nodes = mkTree().tasks[0].subtasks;
  const flat = projects.flattenSubtree(nodes);
  assert.deepEqual(flat.map((e) => e.node.id), ['s1', 's2a', 's3', 's4', 's2b']);
  assert.deepEqual(flat.map((e) => e.depth), [1, 2, 3, 4, 2]);
  assert.deepEqual(flat.find((e) => e.node.id === 's4').path, ['s1', 's2a', 's3', 's4']);
  assert.deepEqual(flat.find((e) => e.node.id === 's2b').path, ['s1', 's2b']);
});

test('问题2：flattenSubtree 可用 isExpanded 控制是否继续往下', () => {
  const nodes = mkTree().tasks[0].subtasks;
  const flat = projects.flattenSubtree(nodes, { isExpanded: (n) => n.id !== 's1' });
  assert.deepEqual(flat.map((e) => e.node.id), ['s1'], 's1 收起后不再展开其下级');
});

// ——— 每级都显示所有更低级任务，checkbox 都可点 ———

test('问题2：任务页表格列出下级及所有更低级任务', () => {
  const { el } = layerBox('表格');
  const checks = findAllByClass(el, 'subtask-check');
  assert.equal(checks.length, 4, 's1 下面 4 个更低级任务都要列出');
  const text = textOf(el);
  for (const title of ['L3-a', 'L3-b', 'L4', 'L5']) {
    assert.ok(text.includes(title), `应显示 ${title}`);
  }
});

test('问题2：最深一级的 checkbox 也能勾选并写到正确地址', async () => {
  calls.length = 0;
  const { el } = layerBox('表格');
  const flat = projects.flattenSubtree(mkTree().tasks[0].subtasks[0].subtasks);
  const idx = ['s2a', 's3', 's4', 's2b'].indexOf('s4');
  assert.equal(flat[idx].node.id, 's4');
  const checks = findAllByClass(el, 'subtask-check');
  assert.equal(checks[2].checked, true, 'L5 数据上是已完成');

  checks[2].click();
  await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, `${DEPTH}/subtasks/s2a/subtasks/s3/subtasks/s4`, '写到第 5 层地址');
  assert.deepEqual(put.body, { done: false });
});

test('问题2：每一级的 checkbox 都指向自己那一层', async () => {
  const { el } = layerBox('表格');
  const checks = findAllByClass(el, 'subtask-check');
  const expected = [
    `${DEPTH}/subtasks/s2a`,
    `${DEPTH}/subtasks/s2a/subtasks/s3`,
    `${DEPTH}/subtasks/s2a/subtasks/s3/subtasks/s4`,
    `${DEPTH}/subtasks/s2b`
  ];
  assert.equal(checks.length, expected.length);
  for (let i = 0; i < checks.length; i++) {
    calls.length = 0;
    checks[i].click();
    await tick();
    assert.equal(calls.find((c) => c.method === 'PUT').url, expected[i], `第 ${i + 1} 个 checkbox 的地址`);
  }
});

test('问题2：名称链接指向各自层级页面', () => {
  const { el } = layerBox('表格');
  const hrefs = [];
  for (const l of findAllByClass(el, 'row-link')) {
    globalThis.location.hash = '';
    l.click();
    hrefs.push(globalThis.location.hash);
  }
  assert.deepEqual(hrefs, [
    '#/task/p1/t1/s1',
    '#/task/p1/t1/s1/s2a',
    '#/task/p1/t1/s1/s2a/s3',
    '#/task/p1/t1/s1/s2a/s3/s4',
    '#/task/p1/t1/s1/s2b'
  ]);
});

test('问题2：看板视图包含所有更低级任务', () => {
  const { el } = layerBox('看板');
  const cards = findAllByClass(el, 'kanban-card');
  assert.equal(cards.length, 5, 's1 + 4 个更低级');
  const text = textOf(el);
  for (const title of ['L2', 'L3-a', 'L3-b', 'L4', 'L5']) assert.ok(text.includes(title), `看板应显示 ${title}`);
  const cols = findAllByClass(el, 'kanban-col');
  assert.equal(cols.length, 2);
  assert.equal(findAllByClass(cols[1], 'kanban-card').length, 2, '已完成 2 个');
});

test('问题2：看板里最深一级也能拖动切换并写对地址', async () => {
  calls.length = 0;
  const { el } = layerBox('看板');
  const cols = findAllByClass(el, 'kanban-col');
  cols[0].fire('drop', { preventDefault() {}, dataTransfer: { getData: () => 's4' } });
  await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, `${DEPTH}/subtasks/s2a/subtasks/s3/subtasks/s4`);
  assert.deepEqual(put.body, { done: false });
});

test('问题2：时间线视图包含所有更低级任务', () => {
  const { el } = layerBox('时间线');
  assert.equal(findAllByClass(el, 'timeline-bar').length, 4, 's1/s2a/s3/s4 有时间');
  assert.ok(textOf(el).includes('L5'));
});

test('问题2：信息流视图每个层级一张卡片', () => {
  const { el } = layerBox('信息流');
  assert.equal(findAllByClass(el, 'feed-post').length, 5);
  assert.equal(findAllByClass(el, 'feed-title').length, 5);
  assert.ok(textOf(el).includes('第 4 层'), '更深层会标出层级');
});

test('问题2：任务页默认展开，且确实传了 deep', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'public', 'js', 'views', 'item.js'), 'utf8');
  assert.ok(src.includes('deep: true'));
  assert.ok(src.includes('defaultExpanded: true'));

  layerBox('表格'); // 视图选择是全局状态，先切回表格
  const tree = mkTree();
  const section = itemMod.buildChildren(tree, itemMod.resolveChain(tree, ['t1']), ['t1'], 1);
  assert.ok(findAllByClass(section, 'subtask-row').length >= 1, '默认就展开，直接看到更低级任务');
  assert.equal(findAllByClass(section, 'subtask-check').length, 4);
});

test('问题2：项目页任务区保持只列本级任务（不铺开整棵子树）', () => {
  const tree = mkTree();
  const page = { ...tree, tasks: tree.tasks };
  const section = projects.buildProjectTasksSection(page, () => {});
  assert.equal(findAllByClass(section, 'item-check').length, 1, '任务行只有 t1');
  assert.equal(findAllByClass(section, 'subtask-row').length, 0, '默认收起，子任务不铺开');
});
