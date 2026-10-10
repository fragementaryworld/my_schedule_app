import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/page/p1' };

const calls = [];
let project = null;

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ url: u, method, body });
  // 模拟落库：重绘后要能读到刚保存的内容
  if (method === 'PUT' && body && /\/blocks\/b1$/.test(u)) project.blocks[0].text = body.text;
  if (method === 'PUT' && body && /\/blocks\/b1\/?$/.test(u) && body.type) project.blocks[0].type = body.type;
  if (method === 'PUT' && body && u.endsWith('/api/projects/p1')) Object.assign(project, body);
  if (u.includes('/api/projects')) return { ok: true, status: 200, json: async () => [JSON.parse(JSON.stringify(project))] };
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const pageMod = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'page.js')).href);
const itemMod = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'item.js')).href);

const tick = () => new Promise((r) => setTimeout(r, 10));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function reset() {
  calls.length = 0;
  document.body.children = [];
  document.activeElement = null;
  project = {
    id: 'p1', name: '项目页', icon: '📁', status: 'active', priority: 'medium', dateFormat: 'ymd',
    blocks: [{ id: 'b1', type: 'text', text: '原文' }],
    tasks: []
  };
}

function mount() {
  const el = document.createElement('div');
  document.body.append(el);
  return el;
}

const blockPair = (el) => ({
  display: findAllByClass(el, 'block-md')[0],
  editable: findAllByClass(el, 'block-edit')[0]
});
const writes = () => calls.filter((c) => c.method === 'PUT' && /\/blocks\/b1$/.test(c.url));

async function renderPage() {
  const el = mount();
  await pageMod.render(el, { id: 'p1' });
  return el;
}

test('问题1：点进内容块就开始编辑', async () => {
  reset();
  const el = await renderPage();
  const { display, editable } = blockPair(el);
  assert.ok(display && editable, '应有显示层与编辑层');
  assert.equal(editable.style.display, 'none', '默认是显示态');

  display.click();
  assert.equal(display.style.display, 'none');
  assert.equal(editable.style.display, '', '进入编辑态');
  assert.equal(document.activeElement, editable, '光标落在编辑层');
});

test('问题1【回归】：边打字边自动保存，不再依赖失焦', async () => {
  reset();
  const el = await renderPage();
  const { display, editable } = blockPair(el);
  display.click();

  editable.textContent = '原文加了一句';
  editable.fire('input');
  await wait(850); // 等自动保存的防抖

  const w = writes();
  assert.equal(w.length, 1, '应自动保存一次');
  assert.deepEqual(w[0].body, { text: '原文加了一句' });
  assert.equal(editable.style.display, '', '保存不该把用户踢出编辑态');
  assert.equal(editable.isConnected, true, '保存不该重绘掉编辑框');
});

test('问题1【回归】：编辑内容时页面因别的保存重绘，内容不丢且继续在编辑态', async () => {
  reset();
  const el = await renderPage();
  const { display, editable } = blockPair(el);
  display.click();
  editable.textContent = '正在写的字';
  editable.fire('input');
  await wait(850); // 先让它自动保存

  // 改一个属性 → 会整页重绘（这就是以前把字丢掉的操作）
  const statusSel = findAllByClass(el, 'inline-select')
    .find((s) => findAllByTag(s, 'option').some((o) => o.getAttribute('value') === 'paused'));
  statusSel.value = 'paused';
  statusSel.fire('change');
  await wait(60);

  const after = blockPair(el);
  assert.notEqual(after.editable, editable, '页面确实重绘过');
  assert.equal(after.editable.textContent, '正在写的字', '重绘后内容还在');
  assert.equal(after.display.style.display, 'none', '重绘后仍处于编辑态');
  assert.equal(after.editable.style.display, '', '编辑框可见');
  assert.equal(document.activeElement, after.editable, '光标回到原来的内容块');
});

test('问题1：重绘前没来得及保存的字，也会在离开时保存', async () => {
  reset();
  const el = await renderPage();
  const { display, editable } = blockPair(el);
  display.click();
  editable.textContent = '刚要保存';
  editable.fire('input');

  editable.fire('blur'); // 失焦立即提交
  await wait(20);
  const w = writes();
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].body, { text: '刚要保存' });
  assert.equal(blockPair(el).editable.style.display, 'none', '失焦后回到显示态');
});

test('问题1：内容没变就不重复写库', async () => {
  reset();
  const el = await renderPage();
  const { display, editable } = blockPair(el);
  display.click();
  editable.fire('input');
  await wait(850);
  editable.fire('blur');
  await wait(20);
  assert.equal(writes().length, 0, '没改动就不该提交');
});

test('问题1：项目任务页的内容块同样自动保存', async () => {
  reset();
  project = {
    id: 'p1', name: '项目页', icon: '📁', dateFormat: 'ymd',
    blocks: [{ id: 'b1', type: 'text', text: '任务内容' }],
    tasks: [{ id: 't1', title: '任务', done: false, blocks: [{ id: 'b1', type: 'text', text: '任务内容' }], subtasks: [] }]
  };
  calls.length = 0;
  globalThis.location.hash = '#/task/p1/t1';
  const el = mount();
  await itemMod.render(el, { id: 'p1', chain: ['t1'] });
  const { display, editable } = blockPair(el);
  display.click();
  editable.textContent = '任务内容改了';
  editable.fire('input');
  await wait(850);
  const w = calls.filter((c) => c.method === 'PUT' && /\/blocks\/b1$/.test(c.url));
  assert.equal(w.length, 1, '任务页也要自动保存');
  assert.deepEqual(w[0].body, { text: '任务内容改了' });
  assert.equal(w[0].url, '/api/projects/p1/tasks/t1/blocks/b1');
});
