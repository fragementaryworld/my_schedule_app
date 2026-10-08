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
const subtaskUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'subtask.js')).href;
const taskUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'task.js')).href;
const projects = await import(projectsUrl);
const subtaskMod = await import(subtaskUrl);
const taskModule = await import(taskUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));

test('问题6：子任务新增改为按钮，去掉回车添加栏', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'public', 'js', 'views', 'task.js'), 'utf8');
  assert.ok(!src.includes('回车确认'), '不应再有回车添加栏');
  assert.ok(!src.includes('添加子任务，回车'), '不应再有回车输入框');
  assert.ok(src.includes('＋ 新增子任务'), '应有「＋ 新增子任务」按钮');
});

test('问题6：点击新增子任务会创建并跳转子任务页面', async () => {
  calls.length = 0;
  globalThis.location.hash = '#/task/p1/t1';
  const created = await projects.createSubtask('p1', 't1');
  const post = calls.find((c) => c.method === 'POST' && c.url.includes('/api/projects/p1/tasks/t1/subtasks'));
  assert.ok(post, '应创建子任务');
  assert.equal(post.body.title, projects.DEFAULT_SUBTASK_NAME);
  assert.equal(created.id, 'newsub1');
  assert.equal(globalThis.location.hash, '#/subtask/p1/t1/newsub1', '应跳转到子任务页面');
});

test('问题6：subtaskHref 指向子任务页面', () => {
  assert.equal(
    projects.subtaskHref({ id: 'p1' }, { id: 't1' }, { id: 's1' }),
    '#/subtask/p1/t1/s1'
  );
});

test('问题6：子任务页面导出 render/add 并与任务页一致（含内容模块）', () => {
  assert.equal(typeof subtaskMod.render, 'function');
  assert.equal(typeof subtaskMod.add, 'function');
  const src = fs.readFileSync(path.join(process.cwd(), 'public', 'js', 'views', 'subtask.js'), 'utf8');
  assert.ok(src.includes('buildBlocksEditor'), '子任务页应有内容模块');
  assert.ok(src.includes('isFreshSubtask'), '应有新建聚焦判断');
  assert.ok(src.includes('删除子任务'), '应有删除入口');
});

test('问题6：isFreshSubtask 判定新建子任务', () => {
  assert.equal(subtaskMod.isFreshSubtask({ title: projects.DEFAULT_SUBTASK_NAME, blocks: [], startDate: null, dueDate: null }), true);
  assert.equal(subtaskMod.isFreshSubtask({ title: '有名字', blocks: [] }), false);
  assert.equal(subtaskMod.isFreshSubtask({ title: projects.DEFAULT_SUBTASK_NAME, blocks: [{ id: 'b' }] }), false);
  assert.equal(subtaskMod.isFreshSubtask({ title: projects.DEFAULT_SUBTASK_NAME, dueDate: '2024-05-01' }), false);
  assert.equal(subtaskMod.isFreshSubtask(null), false);
});

test('问题6：任务页子任务区无回车输入框、有新增按钮、标题可跳转', () => {
  const taskMod = fs.readFileSync(path.join(process.cwd(), 'public', 'js', 'views', 'task.js'), 'utf8');
  assert.ok(taskMod.includes('export function buildSubtasks'), '子任务区应可测试');

  const project = { id: 'p1', name: 'P' };
  const task = { id: 't1', title: '任务', subtasks: [{ id: 's1', title: '子任务A', done: false }] };
  const section = taskModule.buildSubtasks(project, task);

  assert.equal(
    findAllByTag(section, 'input').filter((i) => i.getAttribute('type') !== 'checkbox').length,
    0,
    '不应再有回车输入框'
  );
  const btn = findAllByTag(section, 'button').find((b) => textOf(b).includes('新增子任务'));
  assert.ok(btn, '应有「＋ 新增子任务」按钮');

  globalThis.location.hash = '#/task/p1/t1';
  findAllByClass(section, 'row-link')[0].click();
  assert.equal(globalThis.location.hash, '#/subtask/p1/t1/s1', '子任务标题应进入子任务页面');
});

test('问题6：任务页新增子任务按钮直接创建并跳转', async () => {
  calls.length = 0;
  globalThis.location.hash = '#/task/p1/t1';
  const project = { id: 'p1', name: 'P' };
  const task = { id: 't1', title: '任务', subtasks: [] };
  const section = taskModule.buildSubtasks(project, task);
  const btn = findAllByTag(section, 'button').find((b) => textOf(b).includes('新增子任务'));
  btn.click();
  await tick();

  const post = calls.find((c) => c.method === 'POST' && c.url.includes('/api/projects/p1/tasks/t1/subtasks'));
  assert.ok(post, '应创建子任务');
  assert.equal(globalThis.location.hash, '#/subtask/p1/t1/newsub1');
});
