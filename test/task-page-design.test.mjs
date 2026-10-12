import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { taskProperty, taskSection, buildTaskDocument } from '../public/js/task-page.js';
import { h } from '../public/js/ui.js';
import * as plan from '../public/js/views/plan.js';
import * as item from '../public/js/views/item.js';
import { flushPendingEdits } from '../public/js/saving.js';
import { todayStr, addDays } from '../public/js/utils.js';
const { apiFixture } = createRequire(import.meta.url)('../test-helpers/api-fixture.js');
const tick = () => new Promise(r => setTimeout(r, 20));
const property = (root, label) => findAllByClass(root, 'prop-row').find(e => e.getAttribute('aria-label') === label);

function dom(t) {
  const original = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
  globalThis.document = makeDocument(); globalThis.location = { hash: '#/today' };
  const root = document.createElement('div'); root.id = 'content'; document.body.append(root);
  t.after(() => Object.assign(globalThis, original));
  return root;
}

test('共享任务页面提供标题、属性和语义正文分区，标签安全显示，状态不只依赖颜色', t => {
  dom(t);
  const select = h('select', { 'aria-label': '自定义状态' }); select.value = 'yes';
  const row = taskProperty('状态', select, 'task:done');
  assert.equal(select.getAttribute('aria-label'), '自定义状态'); assert.equal(select.getAttribute('data-focus-key'), 'task:done');
  assert.equal(findAllByClass(row, 'task-property-icon')[0].getAttribute('aria-hidden'), 'true');
  const title = h('h1', {}, '<script>标题</script>');
  const doc = buildTaskDocument({ breadcrumb: h('nav'), heading: title, properties: row,
    label: '<img src=x>', done: true, sections: [taskSection('子任务', h('div'), { count: 3, children: true })] });
  assert.equal(doc.tagName, 'ARTICLE'); assert.equal(findAllByTag(doc, 'header').length, 1);
  assert.equal(findAllByTag(doc, 'h1').length, 1); assert.equal(findAllByTag(doc, 'h2').length, 2);
  assert.ok(textOf(doc).includes('<script>标题</script>')); assert.equal(findAllByTag(doc, 'script').length, 0);
  assert.ok(textOf(doc).includes('<img src=x>')); assert.equal(findAllByTag(doc, 'img').length, 0);
  assert.equal(textOf(findAllByClass(doc, 'task-page-status')[0]), '已完成');
  assert.equal(textOf(findAllByClass(doc, 'task-section-count')[0]), '3');
});

test('普通事务页面保留所有属性和编辑键，新增文档分区不会触发数据写入', async t => {
  const root = dom(t), writes = [], task = { id: 'day', title: '整理发票', date: todayStr(), listId: 'work', note: '**备注**', priority: 'high' };
  globalThis.fetch = async (url, options = {}) => {
    if (options.method && options.method !== 'GET') writes.push({ url, options });
    return { ok: true, json: async () => url === '/api/projects' ? [] : structuredClone(task) };
  };
  await plan.render(root, { id: task.id });
  assert.equal(findAllByClass(root, 'task-document').length, 1);
  assert.deepEqual(findAllByClass(root, 'prop-label').map(textOf), ['所属清单', '状态', '预计用时', '优先级', '重复', '时间', '当天安排']);
  assert.equal(findAllByClass(root, 'task-page-section')[0].getAttribute('aria-label'), '备注');
  assert.equal(findAllByClass(root, 'page-title')[0].getAttribute('data-focus-key'), '/api/tasks/day:title');
  assert.equal(findAllByTag(property(root, '状态'), 'select')[0].getAttribute('aria-label'), '状态');
  assert.match(findAllByClass(root, 'feed-goal-md')[0].innerHTML, /<strong>备注<\/strong>/);
  assert.equal(writes.length, 0);
});

test('项目子任务使用同一文档结构、完整祖先路径和下级计数，保留四种视图', async t => {
  const root = dom(t);
  const project = { id: 'p', name: '项目', status: 'active', tasks: [{ id: 'parent', title: '父任务', subtasks: [
    { id: 'child', title: '子任务', done: true, desc: '# 调研', subtasks: [{ id: 'leaf', title: '文献检索' }] }
  ] }] };
  globalThis.fetch = async () => ({ ok: true, json: async () => [structuredClone(project)] });
  await item.render(root, { id: 'p', chain: ['parent', 'child'] });
  assert.equal(findAllByClass(root, 'task-document').length, 1);
  assert.equal(textOf(findAllByClass(root, 'task-page-status')[0]), '已完成');
  assert.deepEqual(findAllByClass(root, 'prop-label').map(textOf), ['状态', '预计用时', '层级', '下级', '时间', '当天安排']);
  assert.deepEqual(findAllByTag(root, 'h2').map(textOf), ['任务属性', '内容', '子子任务1']);
  assert.equal(textOf(findAllByClass(root, 'task-section-count')[0]), '1');
  assert.equal(findAllByClass(root, 'page-title')[0].getAttribute('data-focus-key'), '/api/projects/p/tasks/parent/subtasks/child:title');
  assert.ok(findAllByTag(root, 'a').some(e => e.getAttribute('href') === '#/task/p/parent'));
  const childLink = findAllByClass(root, 'row-link').find(e => textOf(e) === '文献检索');
  assert.ok(childLink); childLink.click(); assert.equal(location.hash, '#/task/p/parent/child/leaf');
  for (const label of ['表格', '时间线', '看板', '信息流']) assert.ok(textOf(root).includes(label));
});

test('真实 HTTP：新布局内键盘编辑备注，切换状态时提交未失焦内容，重开页面保留标题和数据', async t => {
  const fixture = await apiFixture(t), nativeFetch = globalThis.fetch;
  const created = await fixture.request('POST', '/api/tasks', { title: '整理发票', date: todayStr(), listId: 'work' });
  assert.equal(created.status, 201);
  const root = dom(t), base = `/api/tasks/${created.body.id}`;
  globalThis.fetch = (url, options) => nativeFetch(fixture.base + url, options);
  await plan.render(root, { id: created.body.id });
  findAllByClass(root, 'feed-goal-md')[0].fire('keydown', { key: 'Enter' });
  const note = findAllByClass(root, 'feed-goal')[0];
  assert.equal(note.style.display, ''); assert.equal(document.activeElement, note);
  note.textContent = '## 发票整理\n- [ ] 核对金额';
  const done = findAllByTag(property(root, '状态'), 'select')[0]; done.value = 'yes'; done.fire('change');
  for (let i = 0; i < 100 && !findAllByClass(root, 'task-page-status')[0].classList.contains('is-done'); i++) await tick();
  let saved = await (await nativeFetch(fixture.base + base)).json();
  assert.equal(saved.done, true); assert.equal(saved.note, note.textContent); assert.equal(saved.listId, 'work');
  const title = findAllByClass(root, 'page-title')[0]; title.textContent = '发票已核对'; title.fire('blur');
  for (let i = 0; i < 100 && !textOf(findAllByClass(root, 'breadcrumb')[0]).includes('发票已核对'); i++) await tick();
  await flushPendingEdits(); await plan.render(root, { id: created.body.id });
  saved = JSON.parse(readFileSync(fixture.file, 'utf8')).tasks[0];
  assert.equal(saved.title, '发票已核对'); assert.equal(saved.note, '## 发票整理\n- [ ] 核对金额');
  assert.equal(findAllByClass(root, 'page-title')[0].textContent, saved.title);
  assert.equal(textOf(findAllByClass(root, 'task-page-status')[0]), '已完成');
});

test('真实 HTTP：项目详情在属性保存和重绘后保留正文、子任务以及独立的截止与安排', async t => {
  const fixture = await apiFixture(t), nativeFetch = globalThis.fetch;
  const project = (await fixture.request('POST', '/api/projects', { name: '研究项目' })).body;
  const task = (await fixture.request('POST', `/api/projects/${project.id}/tasks`, { title: '文献调研', dueDate: addDays(todayStr(), 3), planDate: todayStr(), planPeriod: 'afternoon' })).body;
  const child = (await fixture.request('POST', `/api/projects/${project.id}/tasks/${task.id}/subtasks`, { title: '检索文献' })).body;
  const root = dom(t), base = `/api/projects/${project.id}/tasks/${task.id}`;
  globalThis.fetch = (url, options) => nativeFetch(fixture.base + url, options);
  await item.render(root, { id: project.id, chain: [task.id] });
  findAllByClass(root, 'md-content-view')[0].click();
  const content = findAllByClass(root, 'md-content-input')[0]; content.textContent = '调研记录与引用';
  const done = findAllByTag(property(root, '状态'), 'select')[0]; done.value = 'yes'; done.fire('change');
  for (let i = 0; i < 100 && !findAllByClass(root, 'task-page-status')[0].classList.contains('is-done'); i++) await tick();
  await flushPendingEdits();
  const saved = await (await nativeFetch(fixture.base + base)).json();
  assert.equal(saved.desc, '调研记录与引用'); assert.equal(saved.done, true);
  assert.equal(saved.planDate, todayStr()); assert.equal(saved.planPeriod, 'afternoon');
  assert.equal(saved.dueDate, task.dueDate); assert.equal(saved.subtasks[0].id, child.id);
  content.blur(); await tick();
});

test('新布局样式隔离在任务页面内，窄屏属性单列且子任务表格可独立滚动', () => {
  const css = readFileSync(new URL('../public/css/task-page.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('/css/task-page.css') > html.indexOf('/css/modules.css'));
  assert.match(css, /\.task-document \.task-property-basics\s*\{[^}]*grid-template-columns:repeat\(auto-fit/);
  assert.match(css, /@media \(max-width:480px\)[\s\S]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.task-children-section > \.card\s*\{[^}]*overflow-x:auto/);
  assert.match(css, /\.task-document \.page-title\s*\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.task-document \.page-title:focus\s*\{[^}]*outline:2px solid var\(--focus-ring\)/);
  assert.doesNotMatch(css, /(?:^|\n)\.(?:daily-period|cal|page-props|prop-row|page-title|breadcrumb)\s*\{/);
});

test('任务页面状态标签在亮色和深色主题下达到正文对比度，状态同时有文字', () => {
  const theme = readFileSync(new URL('../public/css/base.css', import.meta.url), 'utf8');
  const rgb = hex => hex.slice(1).match(/../g).map(x => parseInt(x, 16));
  const lum = values => values.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
    .reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
  for (const selector of [':root', '[data-theme="dark"]']) {
    const rule = [...theme.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(m => m[1].trim() === selector)[2];
    const colors = Object.fromEntries([...rule.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map(m => [m[1], rgb(m[2])]));
    const surfaces = [colors['panel-2'], colors.success.map((x, i) => .12 * x + .88 * colors.panel[i])];
    for (const surface of surfaces) {
      const a = lum(colors.text), b = lum(surface);
      assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, selector);
    }
  }
});
