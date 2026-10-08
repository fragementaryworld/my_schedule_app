import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/task/p1/t1' };

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({
    url: String(url),
    method: opts.method || 'GET',
    body: opts.body ? JSON.parse(opts.body) : null
  });
  return { ok: true, status: 200, json: async () => ({ ok: true, id: 'newblock' }) };
};

const pageUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'page.js')).href;
const { buildBlocksEditor } = await import(pageUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));
const TASK_BASE = '/api/projects/p1/tasks/t1';

test('问题1：任务内容块编辑器渲染 Markdown 显示层', () => {
  const task = { id: 't1', blocks: [{ id: 'b1', type: 'text', text: '**加粗**' }] };
  const editor = buildBlocksEditor(task, TASK_BASE, () => {});
  const md = findAllByClass(editor, 'block-md')[0];
  assert.ok(md, '任务页应有内容块显示层');
  assert.ok(String(md.innerHTML).includes('<strong>加粗</strong>'));
});

test('问题1：任务内容块保存到任务接口', async () => {
  calls.length = 0;
  const task = { id: 't1', blocks: [{ id: 'b1', type: 'text', text: '旧' }] };
  const editor = buildBlocksEditor(task, TASK_BASE, () => {});
  const edit = findAllByClass(editor, 'block-edit')[0];
  edit.textContent = '新内容';
  edit.dispatchEvent('blur');
  await tick();

  const put = calls.find((c) => c.method === 'PUT' && c.url.includes(`${TASK_BASE}/blocks/b1`));
  assert.ok(put, `应保存到任务块接口，实际调用：${calls.map((c) => c.url).join(', ')}`);
  assert.deepEqual(put.body, { text: '新内容' });
});

test('问题1：任务内容块回车新建走任务接口', async () => {
  calls.length = 0;
  const task = { id: 't1', blocks: [{ id: 'b1', type: 'bullet', text: 'x' }] };
  const editor = buildBlocksEditor(task, TASK_BASE, () => {});
  findAllByClass(editor, 'block-edit')[0].dispatchEvent('keydown', { key: 'Enter', shiftKey: false });
  await tick();
  const post = calls.find((c) => c.method === 'POST' && c.url.includes(`${TASK_BASE}/blocks`));
  assert.ok(post, '应在任务块接口新建');
  assert.equal(post.body.afterId, 'b1');
  assert.equal(post.body.type, 'bullet');
});

test('问题1：空任务显示添加内容提示', () => {
  const editor = buildBlocksEditor({ id: 't1', blocks: [] }, TASK_BASE, () => {});
  assert.equal(findAllByClass(editor, 'block-add-hint').length, 1);
});
