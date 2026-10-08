import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/page/p1' };

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

test('增量4：块渲染为可编辑元素并显示前缀标记', () => {
  const page = { id: 'p1', name: 'P', blocks: [
    { id: 'b1', type: 'h1', text: '标题' },
    { id: 'b2', type: 'bullet', text: '列表项' },
    { id: 'b3', type: 'todo', text: '待办', checked: false },
    { id: 'b4', type: 'divider' }
  ] };
  const editor = buildBlocksEditor(page);
  const blocks = findAllByClass(editor, 'block');
  assert.equal(blocks.length, 3, '分割线不是可编辑块');
  assert.equal(blocks[0].getAttribute('contenteditable'), 'true');
  assert.equal(blocks[0].textContent, '标题');
  assert.equal(blocks[0].className.includes('block-h1'), true);

  const markers = findAllByClass(editor, 'block-marker').map((m) => textOf(m));
  assert.deepEqual(markers, ['•', '☐']);
});

test('增量4：编辑后失焦自动保存', async () => {
  calls.length = 0;
  const page = { id: 'p1', name: 'P', blocks: [{ id: 'b1', type: 'text', text: '旧' }] };
  const editor = buildBlocksEditor(page);
  const block = findAllByClass(editor, 'block')[0];
  block.textContent = '新内容';
  block.dispatchEvent('blur');
  await tick();
  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/blocks/b1'));
  assert.ok(put, '应 PUT 保存块文本');
  assert.deepEqual(put.body, { text: '新内容' });
});

test('增量4：内容未变则不保存', async () => {
  calls.length = 0;
  const page = { id: 'p1', name: 'P', blocks: [{ id: 'b1', type: 'text', text: '一样' }] };
  const editor = buildBlocksEditor(page);
  findAllByClass(editor, 'block')[0].dispatchEvent('blur');
  await tick();
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
});

test('增量4：回车在下方新建同类型块', async () => {
  calls.length = 0;
  const page = { id: 'p1', name: 'P', blocks: [{ id: 'b1', type: 'bullet', text: 'x' }] };
  const editor = buildBlocksEditor(page);
  findAllByClass(editor, 'block')[0].dispatchEvent('keydown', { key: 'Enter', shiftKey: false });
  await tick();
  const post = calls.find((c) => c.method === 'POST' && c.url.includes('/blocks'));
  assert.ok(post, '应新建块');
  assert.equal(post.body.afterId, 'b1');
  assert.equal(post.body.type, 'bullet', '列表回车延续同类型');
});

test('增量4：普通文本回车新建 text 块', async () => {
  calls.length = 0;
  const page = { id: 'p1', name: 'P', blocks: [{ id: 'b1', type: 'h2', text: 'x' }] };
  const editor = buildBlocksEditor(page);
  findAllByClass(editor, 'block')[0].dispatchEvent('keydown', { key: 'Enter', shiftKey: false });
  await tick();
  const post = calls.find((c) => c.method === 'POST' && c.url.includes('/blocks'));
  assert.equal(post.body.type, 'text', '标题回车新建正文');
});

test('增量4：空块按退格删除', async () => {
  calls.length = 0;
  const page = { id: 'p1', name: 'P', blocks: [
    { id: 'b1', type: 'text', text: 'a' },
    { id: 'b2', type: 'text', text: '' }
  ] };
  const editor = buildBlocksEditor(page);
  const blocks = findAllByClass(editor, 'block');
  blocks[1].dispatchEvent('keydown', { key: 'Backspace' });
  await tick();
  const del = calls.find((c) => c.method === 'DELETE' && c.url.includes('/blocks/b2'));
  assert.ok(del, '空块退格应删除该块');
});

test('增量4：空页面显示添加提示', () => {
  const editor = buildBlocksEditor({ id: 'p1', name: 'P', blocks: [] });
  const hint = findAllByClass(editor, 'block-add-hint');
  assert.equal(hint.length, 1);
  assert.ok(textOf(hint[0]).includes('添加内容'));
});
