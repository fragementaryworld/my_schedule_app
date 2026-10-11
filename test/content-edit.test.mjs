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
  if (method === 'PUT' && body && u.endsWith('/api/projects/p1')) Object.assign(project, body);
  if (method === 'PUT' && body && u === `/api/projects/${project.id}/tasks/${project.tasks[0].id}`) Object.assign(project.tasks[0], body);
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
    desc: '原来的内容', blocks: [],
    tasks: [{ id: 't1', title: '任务', done: false, desc: '任务原内容', subtasks: [] }]
  };
}

function mount() {
  const el = document.createElement('div');
  document.body.append(el);
  return el;
}

const view = (el) => findAllByClass(el, 'md-content-view')[0];
const input = (el) => findAllByClass(el, 'md-content-input')[0];
const descWrites = () => calls.filter((c) => c.method === 'PUT' && c.body && typeof c.body.desc === 'string');

async function renderPage() {
  const el = mount();
  await pageMod.render(el, { id: 'p1' });
  return el;
}

test('问题1：点进内容就开始编辑', async () => {
  reset();
  const el = await renderPage();
  assert.ok(view(el) && input(el), '应有显示层与编辑层');
  assert.equal(input(el).style.display, 'none', '默认是显示态');

  view(el).click();
  assert.equal(view(el).style.display, 'none');
  assert.equal(input(el).style.display, '', '进入编辑态');
  assert.equal(document.activeElement, input(el), '光标落在编辑层');
});

test('问题1【回归】：边打字边自动保存，不再依赖失焦', async () => {
  reset();
  const el = await renderPage();
  view(el).click();

  const edit = input(el);
  edit.textContent = '原来的内容加了一句';
  edit.fire('input');
  await wait(850); // 等自动保存的防抖

  const w = descWrites();
  assert.equal(w.length, 1, '应自动保存一次');
  assert.equal(w[0].url, '/api/projects/p1');
  assert.deepEqual(w[0].body, { desc: '原来的内容加了一句' });
  assert.equal(edit.style.display, '', '保存不该把用户踢出编辑态');
  assert.equal(edit.isConnected, true, '保存不该重绘掉编辑框');
});

test('问题1【回归】：写内容时页面因别的保存重绘，内容不丢且继续在编辑态', async () => {
  reset();
  const el = await renderPage();
  view(el).click();
  const edit = input(el);
  edit.textContent = '正在写的字';
  edit.fire('input');
  await wait(850); // 先让它自动保存

  // 改一个属性 → 会整页重绘（这就是以前把字丢掉的操作）
  const statusSel = findAllByClass(el, 'inline-select')
    .find((s) => findAllByTag(s, 'option').some((o) => o.getAttribute('value') === 'paused'));
  statusSel.value = 'paused';
  statusSel.fire('change');
  await wait(60);

  assert.notEqual(input(el), edit, '页面确实重绘过');
  assert.equal(input(el).textContent, '正在写的字', '重绘后内容还在');
  assert.equal(view(el).style.display, 'none', '重绘后仍处于编辑态');
  assert.equal(input(el).style.display, '', '编辑框可见');
  assert.equal(document.activeElement, input(el), '光标回到内容编辑框');
});

test('问题1：重绘前没来得及保存的字，也会在离开时保存', async () => {
  reset();
  const el = await renderPage();
  view(el).click();
  input(el).textContent = '刚要保存';
  input(el).fire('input');

  input(el).fire('blur'); // 失焦立即提交
  await wait(20);
  const w = descWrites();
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].body, { desc: '刚要保存' });
  assert.equal(input(el).style.display, 'none', '失焦后回到显示态');
});

test('问题1：内容没变就不重复写库', async () => {
  reset();
  const el = await renderPage();
  view(el).click();
  input(el).fire('input');
  await wait(850);
  input(el).fire('blur');
  await wait(20);
  assert.equal(descWrites().length, 0, '没改动就不该提交');
});

test('问题1：项目任务页的内容同样自动保存', async () => {
  reset();
  calls.length = 0;
  globalThis.location.hash = '#/task/p1/t1';
  const el = mount();
  await itemMod.render(el, { id: 'p1', chain: ['t1'] });

  assert.equal(input(el).textContent, '任务原内容');
  view(el).click();
  input(el).textContent = '任务内容改了';
  input(el).fire('input');
  await wait(850);

  const w = descWrites();
  assert.equal(w.length, 1, '任务页也要自动保存');
  assert.equal(w[0].url, '/api/projects/p1/tasks/t1');
  assert.deepEqual(w[0].body, { desc: '任务内容改了' });
});

test('切换项目任务后，旧编辑框的延迟保存仍写入原任务', async () => {
  reset();
  const original = project;
  const el = mount();
  await itemMod.render(el, { id: 'p1', chain: ['t1'] });
  view(el).click();
  const oldEditor = input(el);
  oldEditor.textContent = '属于第一个任务的草稿';
  oldEditor.fire('input');

  project = { ...original, id: 'p2', tasks: [{ ...original.tasks[0], id: 't2', desc: '第二个任务' }] };
  await itemMod.render(el, { id: 'p2', chain: ['t2'] });
  await wait(850);

  assert.deepEqual(descWrites().map(({ url, body }) => ({ url, body })), [
    { url: '/api/projects/p1/tasks/t1', body: { desc: '属于第一个任务的草稿' } }
  ]);
  assert.equal(project.tasks[0].desc, '第二个任务');
});
