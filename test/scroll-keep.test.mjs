import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/projects' };

const scrollCalls = [];
globalThis.window = {
  scrollX: 0,
  scrollY: 0,
  scrollTo(x, y) {
    this.scrollX = x;
    this.scrollY = y;
    scrollCalls.push([x, y]);
  }
};

const PROJECTS = [
  {
    id: 'p1', name: 'A', icon: '📁', status: 'active', priority: 'medium', progress: 0,
    startDate: '2024-05-01', dueDate: '2024-05-31', dateFormat: 'iso', blocks: [],
    tasks: [{ id: 't1', title: 'T', done: false, dueDate: '2024-05-10', dateFormat: 'iso', subtasks: [], blocks: [] }]
  },
  { id: 'p2', name: 'B', icon: '📁', status: 'done', priority: 'low', progress: 0, dateFormat: 'iso', blocks: [], tasks: [] }
];

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const method = opts.method || 'GET';
  calls.push({ url: String(url), method, body: opts.body ? JSON.parse(opts.body) : null });
  if (method === 'GET') return { ok: true, status: 200, json: async () => PROJECTS };
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const uiUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'ui.js')).href;
const projectsUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href;
const pageUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'page.js')).href;
const ui = await import(uiUrl);
const projects = await import(projectsUrl);
const pageMod = await import(pageUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));

// 模拟浏览器行为：清空 innerHTML 会让页面变短，滚动条被弹回顶部
function clampingDiv() {
  const div = document.createElement('div');
  let inner = '';
  Object.defineProperty(div, 'innerHTML', {
    get() { return inner; },
    set(v) { inner = String(v); div.children = []; globalThis.window.scrollY = 0; }
  });
  return div;
}

test('问题2：scrollPos/restoreScroll 在没有 window 时安全降级', () => {
  const saved = globalThis.window;
  delete globalThis.window;
  assert.equal(ui.scrollPos(), null);
  ui.restoreScroll(null);
  ui.restoreScroll({ x: 0, y: 10 });
  globalThis.window = saved;
});

test('问题2：项目列表重绘后回到原来的滚动位置', async () => {
  scrollCalls.length = 0;
  globalThis.window.scrollY = 640;
  const container = clampingDiv();
  await projects.render(container, {});
  assert.equal(globalThis.window.scrollY, 640, '刷新后应停在原位置，而不是顶部');
  assert.deepEqual(scrollCalls[scrollCalls.length - 1], [0, 640]);
});

test('问题2：看板拖动改状态后停留在原滚动位置', async () => {
  calls.length = 0;
  scrollCalls.length = 0;
  globalThis.window.scrollY = 900;
  const container = clampingDiv();
  await projects.render(container, {});

  findAllByTag(container, 'button').find((b) => textOf(b) === '看板').click();
  await tick();
  assert.equal(globalThis.window.scrollY, 900, '切换视图也不应跳顶');

  const cols = findAllByClass(container, 'kanban-col');
  const card = findAllByClass(cols[0], 'kanban-card')[0];
  assert.ok(card, '待办列应有卡片');
  const data = {};
  card.fire('dragstart', { dataTransfer: { setData: (k, v) => { data[k] = v; } } });
  assert.equal(data['text/plain'], 'p1');

  globalThis.window.scrollY = 900; // 拖动前用户就在这个位置
  cols[1].fire('drop', { preventDefault() {}, dataTransfer: { getData: () => 'p1' } });
  await tick();

  const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/api/projects/p1'));
  assert.ok(put, '应更新项目状态');
  assert.equal(globalThis.window.scrollY, 900, '拖动后仍应停在原位置');
});

test('问题2：项目页面（任务看板）拖动后也停留在原位置', async () => {
  calls.length = 0;
  globalThis.window.scrollY = 1200;
  const container = clampingDiv();
  await pageMod.render(container, { id: 'p1' });
  assert.equal(globalThis.window.scrollY, 1200, '打开页面后保持位置');

  // 任务看板视图
  const boardTab = findAllByTag(container, 'button').find((b) => textOf(b) === '看板');
  assert.ok(boardTab, '任务区应有看板视图按钮');
  boardTab.click();
  await tick();

  const cols = findAllByClass(container, 'kanban-col');
  assert.ok(cols.length >= 2, '任务看板应有待办/已完成两列');
  globalThis.window.scrollY = 1200;
  cols[1].fire('drop', { preventDefault() {}, dataTransfer: { getData: () => 't1' } });
  await tick();

  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/tasks/t1'));
  assert.ok(put, '应更新任务完成状态');
  assert.equal(globalThis.window.scrollY, 1200, '拖动后项目页面仍停在原位置');
});
