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

// 本应用真正的滚动容器是 #content（shell.css: #content { overflow: auto }），不是 window
const order = [];
let dataReady = false;
let inner = '';
const content = document.createElement('div');
content.setAttribute('id', 'content');
content.scrollTop = 0;
Object.defineProperty(content, 'innerHTML', {
  get() { return inner; },
  set(v) {
    inner = String(v);
    content.children = [];
    content.scrollTop = 0; // 模拟浏览器：内容清空后滚动条被弹回顶部
    order.push(dataReady ? 'clear' : 'clear-too-early');
  }
});
document.body.append(content);

const PROJECTS = [
  {
    id: 'p1', name: 'Projects1', icon: '📁', status: 'active', priority: 'medium', progress: 0,
    startDate: '2024-05-01', dueDate: '2024-05-31', dateFormat: 'iso', blocks: [],
    tasks: [{
      id: 't1', title: 'T', done: false, dueDate: '2024-05-10', dateFormat: 'iso', blocks: [],
      subtasks: [{ id: 's1', title: '子任务', done: false, subtasks: [] }]
    }]
  },
  { id: 'p2', name: 'Projects2', icon: '📁', status: 'done', priority: 'low', progress: 0, dateFormat: 'iso', blocks: [], tasks: [] }
];

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const method = opts.method || 'GET';
  calls.push({ url: String(url), method, body: opts.body ? JSON.parse(opts.body) : null });
  if (method === 'GET') {
    order.push('fetch');
    dataReady = true;
    return { ok: true, status: 200, json: async () => PROJECTS };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const uiUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'ui.js')).href;
const projectsUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href;
const pageUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'page.js')).href;
const ui = await import(uiUrl);
const projects = await import(projectsUrl);
const pageMod = await import(pageUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));
const tab = (root, label) => findAllByTag(root, 'button').find((b) => textOf(b) === label);

test('问题2：滚动位置取自真正的滚动容器 #content（不是 window）', () => {
  assert.equal(ui.scrollBox(), content);
  content.scrollTop = 321;
  const pos = ui.scrollPos();
  assert.equal(pos.box, content);
  assert.equal(pos.boxTop, 321, '必须读 #content.scrollTop');

  content.scrollTop = 0; // 模拟被弹回顶部
  ui.restoreScroll(pos);
  assert.equal(content.scrollTop, 321, '恢复的也是 #content 的滚动位置');
});

test('问题2：没有 #content 时回退到 window', () => {
  scrollCalls.length = 0;
  ui.restoreScroll({ box: null, boxTop: 0, win: { x: 0, y: 77 } });
  assert.deepEqual(scrollCalls.pop(), [0, 77]);
});

test('问题2：没有 window 也没有 #content 时安全降级', () => {
  const savedWindow = globalThis.window;
  const savedGet = document.getElementById;
  delete globalThis.window;
  document.getElementById = () => null;
  assert.equal(ui.scrollPos(), null);
  ui.restoreScroll(null);
  ui.restoreScroll({ box: null, boxTop: 0, win: null });
  document.getElementById = savedGet;
  globalThis.window = savedWindow;
});

test('问题2：重绘先取数据再清空（中间不会出现空页面）', async () => {
  order.length = 0;
  dataReady = false;
  content.scrollTop = 500;
  await projects.render(content, {});
  assert.equal(order[0], 'fetch', '第一个动作应该是取数据');
  assert.ok(!order.includes('clear-too-early'), '不能在数据回来之前就清空页面');
  assert.equal(order.filter((e) => e === 'clear').length, 1, '一次重绘只清空一次');
});

test('问题2：项目列表重绘后停在原滚动位置', async () => {
  content.scrollTop = 640;
  await projects.render(content, {});
  assert.equal(content.scrollTop, 640, '刷新后应停在原位置，而不是顶部');
});

test('问题2：项目看板拖动改状态后停留在原滚动位置', async () => {
  calls.length = 0;
  content.scrollTop = 900;
  await projects.render(content, {});

  tab(content, '看板').click();
  await tick();
  assert.equal(content.scrollTop, 900, '切换视图也不应跳顶');

  const cols = findAllByClass(content, 'kanban-col');
  const card = findAllByClass(cols[0], 'kanban-card')[0];
  assert.ok(card, '待办列应有卡片');
  content.scrollTop = 900; // 拖动前用户就在这个位置
  cols[1].fire('drop', { preventDefault() {}, dataTransfer: { getData: () => 'p1' } });
  await tick();

  assert.ok(calls.find((c) => c.method === 'PUT' && c.url.endsWith('/api/projects/p1')), '应更新状态');
  assert.equal(content.scrollTop, 900, '拖动后仍应停在原位置');
});

test('问题2：信息流里拖动子任务状态后停留在原滚动位置（用户报的场景）', async () => {
  calls.length = 0;
  content.scrollTop = 1200;
  await pageMod.render(content, { id: 'p1' });

  tab(content, '信息流').click();
  await tick();
  assert.equal(content.scrollTop, 1200, '切到信息流不应跳顶');

  // 信息流里每条任务带一个子任务看板（未完成 / 已完成）
  const cols = findAllByClass(content, 'kanban-col');
  assert.ok(cols.length >= 2, '信息流应有子任务看板两列');
  content.scrollTop = 1200;
  cols[1].fire('drop', { preventDefault() {}, dataTransfer: { getData: () => 's1' } });
  await tick();

  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/subtasks/s1'));
  assert.ok(put, '应更新子任务状态');
  assert.equal(content.scrollTop, 1200, '拖动子任务后仍应停在原位置');
});

test('问题2：项目页面任务看板拖动后也停在原位置', async () => {
  calls.length = 0;
  content.scrollTop = 1500;
  await pageMod.render(content, { id: 'p1' });

  tab(content, '看板').click();
  await tick();
  const cols = findAllByClass(content, 'kanban-col');
  content.scrollTop = 1500;
  cols[1].fire('drop', { preventDefault() {}, dataTransfer: { getData: () => 't1' } });
  await tick();

  assert.ok(calls.find((c) => c.method === 'PUT' && c.url.includes('/tasks/t1')), '应更新任务状态');
  assert.equal(content.scrollTop, 1500, '拖动后仍应停在原位置');
});
