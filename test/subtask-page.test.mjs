import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
  return { ok: true, status: 200, json: async () => ({ id: 'newsub1' }) };
};

const projectsUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href;
const itemUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'item.js')).href;
const projects = await import(projectsUrl);
const itemMod = await import(itemUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));

test('问题6：子任务新增改为按钮，去掉回车添加栏', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'public', 'js', 'views', 'item.js'), 'utf8');
  assert.ok(!src.includes('回车确认'), '不应再有回车添加栏');
  assert.ok(!src.includes('添加子任务，回车'), '不应再有回车输入框');
  assert.ok(src.includes('＋ 新增'), '应有「＋ 新增」按钮');
});

test('问题6：点击新增子任务会创建并跳转子任务页面', async () => {
  calls.length = 0;
  globalThis.location.hash = '#/task/p1/t1';
  const created = await projects.createSubtask('p1', 't1');
  const post = calls.find((c) => c.method === 'POST' && c.url.includes('/api/projects/p1/tasks/t1/subtasks'));
  assert.ok(post, '应创建子任务');
  assert.equal(post.body.title, projects.DEFAULT_SUBTASK_NAME);
  assert.equal(created.id, 'newsub1');
  assert.equal(globalThis.location.hash, '#/task/p1/t1/newsub1', '应跳转到子任务页面');
});

test('问题6：subtaskHref 指向子任务页面', () => {
  assert.equal(
    projects.subtaskHref({ id: 'p1' }, { id: 't1' }, { id: 's1' }),
    '#/task/p1/t1/s1'
  );
});

test('问题6：子任务页面导出 render/add 并与任务页一致（含内容模块）', () => {
  assert.equal(typeof itemMod.render, 'function');
  assert.equal(typeof itemMod.add, 'function');
  const src = fs.readFileSync(path.join(process.cwd(), 'public', 'js', 'views', 'item.js'), 'utf8');
  assert.ok(src.includes('buildContentEditor'), '子任务页应有内容模块（整篇 Markdown）');
  assert.ok(src.includes('isFreshItem'), '应有新建聚焦判断');
  assert.ok(src.includes('删除'), '应有删除入口');
  assert.ok(src.includes('isFreshItem') && src.includes('buildDateField'), '应有时间字段');
});

test('问题6：子任务页可测的层级区块与属性面板', () => {
  const project = { id: 'p1', name: 'P' };
  const task = { id: 't1', title: '任务', subtasks: [{ id: 's1', title: '子任务A', done: false }] };
  const section = itemMod.buildChildren(project, task, ['t1'], 1);

  assert.equal(
    findAllByTag(section, 'input').filter((i) => i.getAttribute('type') !== 'checkbox').length,
    0,
    '不应再有回车输入框'
  );
  const btn = findAllByTag(section, 'button').find((b) => textOf(b).includes('新增'));
  assert.ok(btn, '应有「＋ 新增」按钮');

  globalThis.location.hash = '#/task/p1/t1';
  findAllByClass(section, 'row-link')[0].click();
  assert.equal(globalThis.location.hash, '#/task/p1/t1/s1', '子任务标题应进入子任务页面');
});

test('问题6：子任务区新增按钮直接创建并跳转', async () => {
  calls.length = 0;
  globalThis.location.hash = '#/task/p1/t1';
  const project = { id: 'p1', name: 'P' };
  const task = { id: 't1', title: '任务', subtasks: [] };
  const section = itemMod.buildChildren(project, task, ['t1'], 1);
  findAllByTag(section, 'button').find((b) => textOf(b).includes('新增')).click();
  await tick();

  const post = calls.find((c) => c.method === 'POST' && c.url.includes('/api/projects/p1/tasks/t1/subtasks'));
  assert.ok(post, '应创建子任务');
  assert.equal(globalThis.location.hash, '#/task/p1/t1/newsub1');
});

test('问题6：子任务页的属性面板写入子任务接口', async () => {
  calls.length = 0;
  const project = { id: 'p1', name: 'P' };
  const subtask = { id: 's1', title: '子任务A', done: false, dateFormat: 'full' };
  const props = itemMod.buildItemProperties(project, subtask, ['t1', 's1']);
  assert.equal(findAllByClass(props, 'date-field').length, 1, '应有时间字段');

  const doneSel = findAllByClass(props, 'inline-select')[0];
  doneSel.value = 'yes';
  doneSel.fire('change');
  await tick();
  const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/tasks/t1/subtasks/s1'));
  assert.ok(put, '应写入子任务接口');
  assert.deepEqual(put.body, { done: true });
});
