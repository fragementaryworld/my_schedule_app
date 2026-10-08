import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeDocument, findAllByTag, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/projects' };

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({
    url: String(url),
    method: opts.method || 'GET',
    body: opts.body ? JSON.parse(opts.body) : null
  });
  return { ok: true, status: 200, json: async () => ({ id: 'newtask1' }) };
};

const projectsUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href;
const taskUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'task.js')).href;
const projects = await import(projectsUrl);
const taskMod = await import(taskUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));

test('问题1：新增任务改为独立按钮，去掉回车输入栏', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js'), 'utf8');
  assert.ok(!src.includes('回车添加'), '不应再有回车输入栏');
  assert.ok(src.includes('＋ 新增任务'), '应有「＋ 新增任务」按钮');
});

test('问题1：任务区「＋ 新增任务」按钮直接创建并跳转任务页面', async () => {
  calls.length = 0;
  globalThis.location.hash = '#/projects';
  const section = projects.buildProjectTasksSection({ id: 'p7', name: 'P', tasks: [] }, () => {});
  const btn = findAllByTag(section, 'button').find((b) => textOf(b).includes('新增任务'));
  assert.ok(btn, '任务区应有新增任务按钮');

  btn.click();
  await tick();
  const post = calls.find((c) => c.method === 'POST' && c.url.includes('/api/projects/p7/tasks'));
  assert.ok(post, '应创建任务');
  assert.equal(post.body.title, projects.DEFAULT_TASK_NAME);
  assert.equal(globalThis.location.hash, '#/task/p7/newtask1', '应跳转到任务页面');
});

test('问题1：表格中的任务标题跳转到任务页面', () => {
  globalThis.location.hash = '#/projects';
  const section = projects.buildProjectTasksSection(
    { id: 'p1', name: 'P', tasks: [{ id: 't1', title: '任务A', done: false, subtasks: [] }] },
    () => {}
  );
  const link = findAllByClass(section, 'row-link')[0];
  assert.ok(link, '任务标题应可点击');
  link.click();
  assert.equal(globalThis.location.hash, '#/task/p1/t1');
});

test('问题1：任务页面导出 render/add', () => {
  assert.equal(typeof taskMod.render, 'function');
  assert.equal(typeof taskMod.add, 'function');
});

test('问题1：isFreshTask 判定新建任务', () => {
  assert.equal(taskMod.isFreshTask({ title: taskMod.DEFAULT_TASK_NAME, subtasks: [], dueDate: null }), true);
  assert.equal(taskMod.isFreshTask({ title: '有名字', subtasks: [], dueDate: null }), false);
  assert.equal(taskMod.isFreshTask({ title: taskMod.DEFAULT_TASK_NAME, subtasks: [{ id: 's' }] }), false);
  assert.equal(taskMod.isFreshTask({ title: taskMod.DEFAULT_TASK_NAME, dueDate: '2024-01-01' }), false);
  assert.equal(taskMod.isFreshTask(null), false);
});
