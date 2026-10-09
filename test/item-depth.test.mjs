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
  return { ok: true, status: 200, json: async () => ({ id: 'new5' }) };
};

const projectsUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href;
const itemUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'item.js')).href;
const projects = await import(projectsUrl);
const itemMod = await import(itemUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));

// 5 层数据：任务 → 子任务 → 子子任务 → 第 4 层 → 第 5 层
const PROJECT = {
  id: 'p1',
  name: 'P',
  icon: '📁',
  dateFormat: 'iso',
  blocks: [],
  tasks: [{
    id: 't1', title: 'L1', done: false, subtasks: [{
      id: 's1', title: 'L2', done: false, subtasks: [{
        id: 's2', title: 'L3', done: false, subtasks: [{
          id: 's3', title: 'L4', done: false, subtasks: [{ id: 's4', title: 'L5', done: false, subtasks: [] }]
        }]
      }]
    }]
  }]
};

test('问题3：最多 5 层，层级名称正确', () => {
  assert.equal(itemMod.MAX_ITEM_DEPTH, 5);
  assert.equal(itemMod.levelName(1), '任务');
  assert.equal(itemMod.levelName(2), '子任务');
  assert.equal(itemMod.levelName(3), '子子任务');
  assert.equal(itemMod.levelName(4), '第 4 层');
  assert.equal(itemMod.levelName(5), '第 5 层');
});

test('问题3：chainNodes/resolveChain 能按链取回任意层', () => {
  assert.equal(itemMod.resolveChain(PROJECT, ['t1']).title, 'L1');
  assert.equal(itemMod.resolveChain(PROJECT, ['t1', 's1']).title, 'L2');
  assert.equal(itemMod.resolveChain(PROJECT, ['t1', 's1', 's2']).title, 'L3');
  assert.equal(itemMod.resolveChain(PROJECT, ['t1', 's1', 's2', 's3', 's4']).title, 'L5');
  assert.equal(itemMod.chainNodes(PROJECT, ['t1', 's1', 's2']).length, 3);
  assert.equal(itemMod.resolveChain(PROJECT, ['t1', 'nope']), null);
  assert.deepEqual(itemMod.chainNodes(PROJECT, ['nope']), []);
});

test('问题3：itemBase/itemHref 支持 5 层路径', () => {
  assert.equal(
    projects.itemBase('p1', ['t1', 's1', 's2', 's3', 's4']),
    '/api/projects/p1/tasks/t1/subtasks/s1/subtasks/s2/subtasks/s3/subtasks/s4'
  );
  assert.equal(projects.itemHref('p1', ['t1', 's1', 's2', 's3', 's4']), '#/task/p1/t1/s1/s2/s3/s4');
});

test('问题3：第 4 层可以新增第 5 层', async () => {
  calls.length = 0;
  const chain = ['t1', 's1', 's2', 's3'];
  const section = itemMod.buildChildren(PROJECT, itemMod.resolveChain(PROJECT, chain), chain, 4);
  const btn = findAllByTag(section, 'button').find((b) => textOf(b).includes('新增'));
  assert.ok(btn, '第 4 层应有新增按钮');
  assert.ok(textOf(btn).includes('第 5 层'), '按钮文案应写明要新增的层级');

  globalThis.location.hash = '#/task/p1/t1/s1/s2/s3';
  btn.click();
  await tick();
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.url, '/api/projects/p1/tasks/t1/subtasks/s1/subtasks/s2/subtasks/s3/subtasks');
  assert.equal(globalThis.location.hash, '#/task/p1/t1/s1/s2/s3/new5');
});

test('问题3：第 5 层不能再新增下级', () => {
  const chain = ['t1', 's1', 's2', 's3', 's4'];
  const section = itemMod.buildChildren(PROJECT, itemMod.resolveChain(PROJECT, chain), chain, 5);
  assert.equal(findAllByTag(section, 'button').filter((b) => textOf(b).includes('新增')).length, 0, '不应有新增按钮');
  assert.ok(textOf(section).includes(`已达最大层级（${itemMod.MAX_ITEM_DEPTH} 层）`));
});

test('问题3：每个层级都有面包屑，可回到任意上层', () => {
  globalThis.location.hash = '#/task/p1/t1/s1/s2';
  const bar = itemMod.buildBreadcrumb(PROJECT, itemMod.chainNodes(PROJECT, ['t1', 's1', 's2']));
  const hrefs = findAllByTag(bar, 'a').map((a) => a.getAttribute('href'));
  assert.ok(hrefs.includes('#/projects'));
  assert.ok(hrefs.includes('#/page/p1'));
  assert.ok(hrefs.includes('#/task/p1/t1'));
  assert.ok(hrefs.includes('#/task/p1/t1/s1'));
  assert.ok(textOf(bar).includes('子子任务：L3'), '当前层应标明层级名称');
});

test('问题3：每层下级列表可勾选完成、可进入该层页面', async () => {
  calls.length = 0;
  const section = itemMod.buildChildren(PROJECT, itemMod.resolveChain(PROJECT, ['t1']), ['t1'], 1);
  const cb = findAllByClass(section, 'subtask-check')[0];
  assert.equal(cb.getAttribute('type'), 'checkbox');
  cb.click();
  await tick();
  const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/tasks/t1/subtasks/s1'));
  assert.ok(put, '应走第 2 层接口');
  assert.deepEqual(put.body, { done: true });

  globalThis.location.hash = '#/task/p1/t1';
  findAllByClass(section, 'row-link')[0].click();
  assert.equal(globalThis.location.hash, '#/task/p1/t1/s1');
});

test('问题3：每层都有和任务页一样的功能（内容模块 + 时间字段 + 删除）', () => {
  const chain = ['t1', 's1'];
  const props = itemMod.buildItemProperties(PROJECT, itemMod.resolveChain(PROJECT, chain), chain);
  assert.equal(findAllByClass(props, 'date-field').length, 1, '有时间字段');
  assert.ok(textOf(props).includes('2 / 5'), '显示当前层级');

  const bar = itemMod.buildBreadcrumb(PROJECT, itemMod.chainNodes(PROJECT, chain));
  assert.ok(textOf(bar).includes('删除子任务'), '删除按钮标明当前层级');

  const src = fs.readFileSync(path.join(process.cwd(), 'public', 'js', 'views', 'item.js'), 'utf8');
  assert.ok(src.includes('buildBlocksEditor'), '每层都有内容模块');
  assert.ok(src.includes('buildDateField'), '每层都有时间字段');
  assert.ok(src.includes('buildHead'), '每层都有标题与完成勾选');
  assert.ok(src.includes('buildBreadcrumb'), '每层都有面包屑');
});

test('问题3：渲染第 5 层页面时不再显示新增按钮', async () => {
  const el = document.createElement('div');
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET' });
    return { ok: true, status: 200, json: async () => [PROJECT] };
  };
  await itemMod.render(el, { id: 'p1', chain: ['t1', 's1', 's2', 's3', 's4'] });
  const text = textOf(el);
  assert.ok(text.includes('第 5 层：L5'), '面包屑应标出第 5 层');
  assert.ok(text.includes('已达最大层级'), '第 5 层不能继续新增');
  assert.ok(!text.includes('＋ 新增'), '不应出现新增按钮');
  assert.equal(findAllByClass(el, 'date-field').length, 1, '第 5 层同样有时间字段');
});
