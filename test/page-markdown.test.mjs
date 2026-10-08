import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/page/p1' };

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({
    url: String(url),
    method: opts.method || 'GET',
    body: opts.body ? JSON.parse(opts.body) : null
  });
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const pageUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'page.js')).href;
const projectsUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href;
const { buildBlocksEditor } = await import(pageUrl);
const { buildProjectFeed } = await import(projectsUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));

test('问题2：页面块显示层渲染 Markdown', () => {
  const page = { id: 'p1', name: 'P', blocks: [{ id: 'b1', type: 'text', text: '**粗体** 和 `代码`' }] };
  const editor = buildBlocksEditor(page);
  const md = findAllByClass(editor, 'block-md')[0];
  assert.ok(md, '应有 Markdown 显示层');
  assert.ok(String(md.innerHTML).includes('<strong>粗体</strong>'));
  assert.ok(String(md.innerHTML).includes('<code>代码</code>'));
});

test('问题2：块级 Markdown（标题/待办）在显示层生效', () => {
  const page = { id: 'p1', name: 'P', blocks: [
    { id: 'b1', type: 'text', text: '# 大标题' },
    { id: 'b2', type: 'text', text: '- [x] 完成项' }
  ] };
  const editor = buildBlocksEditor(page);
  const md = findAllByClass(editor, 'block-md');
  assert.ok(String(md[0].innerHTML).includes('<h1>大标题</h1>'));
  assert.ok(String(md[1].innerHTML).includes('☑'));
});

test('问题2：点击显示层进入编辑（显示原文）', () => {
  const page = { id: 'p1', name: 'P', blocks: [{ id: 'b1', type: 'text', text: '**粗体**' }] };
  const editor = buildBlocksEditor(page);
  const md = findAllByClass(editor, 'block-md')[0];
  md.click();
  const edit = findAllByClass(editor, 'block-edit')[0];
  assert.equal(md.style.display, 'none', '显示层应隐藏');
  assert.equal(edit.style.display, '', '编辑层应显示');
  assert.equal(edit.textContent, '**粗体**', '编辑时应看到 Markdown 原文');
});

test('问题2：编辑失焦后保存并重新渲染 Markdown', async () => {
  calls.length = 0;
  const page = { id: 'p1', name: 'P', blocks: [{ id: 'b1', type: 'text', text: '旧' }] };
  const editor = buildBlocksEditor(page);
  const md = findAllByClass(editor, 'block-md')[0];
  const edit = findAllByClass(editor, 'block-edit')[0];
  edit.textContent = '## 新标题';
  edit.dispatchEvent('blur');
  await tick();

  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/blocks/b1'));
  assert.ok(put, '应保存原文');
  assert.deepEqual(put.body, { text: '## 新标题' });
  assert.ok(String(md.innerHTML).includes('<h2>新标题</h2>'), '失焦后应按 Markdown 重新渲染');
});

test('问题2：信息流描述渲染 Markdown', () => {
  const feed = buildProjectFeed([{
    id: 'p1',
    name: '项目A',
    status: 'active',
    goal: '**重点**\n- [ ] 待办',
    tasks: []
  }]);
  const md = findAllByClass(feed, 'feed-goal-md')[0];
  assert.ok(md, '信息流应有 Markdown 显示层');
  assert.ok(String(md.innerHTML).includes('<strong>重点</strong>'));
  assert.ok(String(md.innerHTML).includes('☐'));
});

test('问题2：信息流描述仍可点击就地编辑', () => {
  const feed = buildProjectFeed([{ id: 'p1', name: 'A', status: 'active', goal: '原文', tasks: [] }]);
  const md = findAllByClass(feed, 'feed-goal-md')[0];
  md.click();
  const edit = findAllByClass(feed, 'feed-goal')[0];
  assert.equal(md.style.display, 'none');
  assert.equal(edit.style.display, '');
  assert.equal(edit.textContent, '原文');
});
