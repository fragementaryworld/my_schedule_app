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
const itemUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'item.js')).href;
const projects = await import(projectsUrl);
const itemMod = await import(itemUrl);

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

test('问题1：任务页面（第 1 层）导出 render/add', () => {
  assert.equal(typeof itemMod.render, 'function');
  assert.equal(typeof itemMod.add, 'function');
});

test('问题1：isFreshItem 判定新建任务', () => {
  const NAME = projects.DEFAULT_TASK_NAME;
  assert.equal(itemMod.isFreshItem({ title: NAME, subtasks: [], desc: '', dueDate: null }), true);
  assert.equal(itemMod.isFreshItem({ title: '有名字', subtasks: [], desc: '' }), false);
  assert.equal(itemMod.isFreshItem({ title: NAME, subtasks: [{ id: 's' }] }), false);
  assert.equal(itemMod.isFreshItem({ title: NAME, dueDate: '2024-01-01' }), false);
  assert.equal(itemMod.isFreshItem({ title: NAME, desc: '写了内容' }), false);
  assert.equal(itemMod.isFreshItem({ title: NAME, blocks: [{ id: 'b' }] }), true, '旧内容块不再算内容');
  assert.equal(itemMod.isFreshItem(null), false);
});

test('问题1：任务页面的接口与链接都指向层级路径', () => {
  assert.equal(projects.itemBase('p1', ['t1']), '/api/projects/p1/tasks/t1');
  assert.equal(projects.itemBase('p1', ['t1', 's1']), '/api/projects/p1/tasks/t1/subtasks/s1');
  assert.equal(projects.itemHref('p1', ['t1']), '#/task/p1/t1');
  assert.equal(projects.itemHref('p1', ['t1', 's1', 's2']), '#/task/p1/t1/s1/s2');
  assert.equal(projects.taskHref({ id: 'p1' }, { id: 't1' }), '#/task/p1/t1');
  assert.equal(projects.subtaskHref({ id: 'p1' }, { id: 't1' }, { id: 's1' }), '#/task/p1/t1/s1');
});

test('问题1：已删除的 task.js / subtask.js 不再存在（统一为 item.js）', () => {
  const dir = path.join(process.cwd(), 'public', 'js', 'views');
  assert.ok(!fs.existsSync(path.join(dir, 'task.js')));
  assert.ok(!fs.existsSync(path.join(dir, 'subtask.js')));
  assert.ok(fs.existsSync(path.join(dir, 'item.js')));
});
