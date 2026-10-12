import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as page from '../public/js/views/page.js';
import * as projects from '../public/js/views/projects.js';
import { todayStr, addDays } from '../public/js/utils.js';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
const { apiFixture } = createRequire(import.meta.url)('../test-helpers/api-fixture.js');
const button = (root, label) => findAllByTag(root, 'button').find(e => textOf(e) === label);
const control = (root, label, tag = 'select') => findAllByTag(root, tag).find(e => e.getAttribute('aria-label') === label);
const tick = () => new Promise(r => setTimeout(r, 15));
async function until(check) { for (let i = 0; i < 100 && !check(); i++) await tick(); assert.ok(check()); }

function dom(t) {
  const original = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
  globalThis.document = makeDocument(); globalThis.location = { hash: '#/projects' };
  const root = document.createElement('div'); root.id = 'content'; document.body.append(root);
  t.after(() => Object.assign(globalThis, original)); return root;
}
function samples() {
  return ['active', 'paused', 'done'].map((status, i) => ({ id: `p${i}`, name: ['研究项目', '整理项目', '已完成项目'][i], icon: '🧪', status,
    startDate: todayStr(), dueDate: addDays(todayStr(), 3), priority: 'medium', goal: '项目概述', desc: '详细内容', tasks: [] }));
}
async function resetList(root) {
  const filter = control(root, '筛选项目状态'); filter.value = 'all'; filter.fire('change'); await tick();
  button(root, '表格').click(); await tick();
}

test('项目详情沿用全宽任务文档，属性、内容和任务分区清晰，路径与图标可编辑', async t => {
  const root = dom(t), data = samples(), writes = [];
  globalThis.fetch = async (url, options = {}) => { if (options.method && options.method !== 'GET') writes.push(url); return { ok: true, json: async () => structuredClone(data) }; };
  await page.render(root, { id: 'p1' });
  const doc = findAllByClass(root, 'project-document')[0]; assert.ok(doc.classList.contains('task-document')); assert.equal(doc.parentNode, root);
  assert.equal(doc.getAttribute('aria-label'), '项目详情');
  assert.deepEqual(findAllByClass(doc, 'task-region').map(e => e.getAttribute('aria-label')), ['项目属性', '内容', '项目任务']);
  assert.deepEqual(findAllByClass(findAllByClass(doc, 'task-property-basics')[0], 'prop-label').map(textOf), ['状态', '优先级', '负责人', '阻塞']);
  assert.deepEqual(findAllByClass(findAllByClass(doc, 'task-property-schedule')[0], 'prop-label').map(textOf), ['时间']);
  assert.equal(textOf(findAllByClass(doc, 'task-page-status')[0]), '暂停');
  assert.ok(findAllByTag(doc, 'nav').some(e => e.getAttribute('aria-label') === '项目路径'));
  assert.equal(findAllByTag(doc, 'a')[0].getAttribute('href'), '#/projects');
  assert.equal(findAllByClass(doc, 'page-title')[0].getAttribute('data-focus-key'), '/api/projects/p1:title');
  findAllByClass(doc, 'page-icon')[0].click(); assert.equal(findAllByClass(doc, 'icon-picker').length, 1);
  assert.equal(writes.length, 0);
});

test('真实 HTTP：项目状态和属性重绘保存未失焦正文，标题、负责人及图标仍可写回', async t => {
  const fixture = await apiFixture(t), nativeFetch = globalThis.fetch;
  const project = (await fixture.request('POST', '/api/projects', { name: '研究项目', owner: '原负责人', goal: '独立概述', dueDate: addDays(todayStr(), 5) })).body;
  const root = dom(t), base = `/api/projects/${project.id}`;
  globalThis.fetch = (url, options) => nativeFetch(fixture.base + url, options);
  await page.render(root, { id: project.id });
  findAllByClass(root, 'md-content-view')[0].click(); const edit = findAllByClass(root, 'md-content-input')[0]; edit.textContent = '未失焦的研究记录';
  const state = control(root, '状态'); state.value = 'paused'; state.fire('change');
  await until(() => textOf(findAllByClass(root, 'task-page-status')[0]) === '暂停');
  const owner = control(root, '负责人', 'input'); assert.equal(owner.value, '原负责人'); owner.value = '新负责人'; owner.fire('blur');
  await until(() => control(root, '负责人', 'input') !== owner);
  const title = findAllByClass(root, 'page-title')[0]; title.textContent = '文献研究'; title.fire('blur');
  await until(() => textOf(findAllByClass(root, 'task-path-name').at(-1)) === '文献研究');
  findAllByClass(root, 'page-icon')[0].click(); findAllByClass(root, 'icon-choice').find(e => textOf(e) === '🚀').click();
  await until(() => textOf(findAllByClass(root, 'page-icon')[0]) === '🚀');
  const saved = JSON.parse(readFileSync(fixture.file, 'utf8')).projects[0];
  assert.equal(saved.desc, '未失焦的研究记录'); assert.equal(saved.goal, '独立概述');
  assert.equal(saved.status, 'paused'); assert.equal(saved.owner, '新负责人'); assert.equal(saved.name, '文献研究'); assert.equal(saved.icon, '🚀');
  assert.equal(saved.dueDate, project.dueDate);
  findAllByClass(root, 'md-content-input')[0].blur(); await tick();
});

test('项目空间汇总所有状态，四种视图与筛选仍能切换，选中按钮有可读状态', async t => {
  const root = dom(t), data = samples();
  globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(data) });
  await projects.render(root); await resetList(root);
  assert.equal(findAllByClass(root, 'project-index')[0].parentNode, root);
  assert.equal(textOf(findAllByClass(root, 'project-summary-total')[0]), '共 3 个项目');
  assert.deepEqual(findAllByClass(root, 'project-summary-count').map(textOf), ['进行中 1', '暂停 1', '完成 1']);
  for (const [label, className] of [['表格', 'project-table'], ['看板', 'kanban'], ['时间线', 'timeline'], ['信息流', 'feed']]) {
    button(root, label).click(); await until(() => findAllByClass(root, className).length > 0);
    assert.equal(button(root, label).getAttribute('aria-pressed'), 'true');
    assert.equal(findAllByClass(root, 'project-view-content')[0].getAttribute('aria-label'), `项目${label}`);
  }
  const filter = control(root, '筛选项目状态'); filter.value = 'paused'; filter.fire('change');
  await until(() => findAllByClass(root, 'project-feed-post').length === 1);
  assert.equal(findAllByClass(root, 'project-feed-post')[0].dataset.projectId, 'p1');
  assert.equal(textOf(findAllByClass(root, 'project-summary-total')[0]), '共 3 个项目');
  await resetList(root);
});

test('项目列表空筛选保留统计与新增入口，空库仍有明确提示', async t => {
  const root = dom(t); let data = [samples()[0]];
  globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(data) });
  await projects.render(root); await resetList(root);
  const filter = control(root, '筛选项目状态'); filter.value = 'done'; filter.fire('change');
  await until(() => textOf(root).includes('没有符合条件的项目')); assert.ok(button(root, '＋ 新增项目'));
  data = []; await projects.render(root); assert.ok(textOf(root).includes('还没有项目')); assert.ok(textOf(root).includes('共 0 个项目'));
  await resetList(root);
});

test('项目的信息流分区保留概述与正文的独立字段，编辑概述只保存当前项目', async t => {
  const root = dom(t), data = samples(), writes = [];
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') { const patch = JSON.parse(options.body); writes.push({ url, patch }); Object.assign(data.find(p => url === `/api/projects/${p.id}`), patch); }
    return { ok: true, json: async () => structuredClone(data) };
  };
  await projects.render(root); await resetList(root); button(root, '信息流').click(); await until(() => findAllByClass(root, 'project-feed-post').length === 3);
  const post = findAllByClass(root, 'project-feed-post').find(e => e.dataset.projectId === 'p0');
  for (const section of ['project-feed-header', 'project-feed-summary', 'project-feed-meta', 'project-feed-tasks']) assert.equal(findAllByClass(post, section).length, 1);
  findAllByClass(post, 'feed-goal-md')[0].click(); const edit = findAllByClass(post, 'feed-goal')[0]; edit.textContent = '新项目概述'; edit.fire('blur');
  await until(() => data[0].goal === '新项目概述'); await tick();
  assert.deepEqual(writes, [{ url: '/api/projects/p0', patch: { goal: '新项目概述' } }]); assert.equal(data[0].desc, '详细内容');
  await resetList(root);
});

test('真实 HTTP：项目看板拖动后更新项目状态和统计，导航仍指向项目详情', async t => {
  const fixture = await apiFixture(t), nativeFetch = globalThis.fetch;
  const project = (await fixture.request('POST', '/api/projects', { name: '研究项目', status: 'active' })).body;
  const root = dom(t); globalThis.fetch = (url, options) => nativeFetch(fixture.base + url, options);
  await projects.render(root); await resetList(root); button(root, '看板').click(); await until(() => findAllByClass(root, 'kanban-card').length === 1);
  const card = findAllByClass(root, 'kanban-card')[0]; card.click(); assert.equal(location.hash, `#/page/${project.id}`);
  const paused = findAllByClass(root, 'board-col-paused')[0];
  paused.fire('drop', { dataTransfer: { getData: () => project.id } });
  await until(() => textOf(findAllByClass(root, 'project-summary-paused')[0]) === '暂停 1');
  assert.equal(JSON.parse(readFileSync(fixture.file, 'utf8')).projects[0].status, 'paused'); await resetList(root);
});

test('项目样式隔离在列表及详情中，窄屏图标选择器换行，四种视图有滚动空间', () => {
  const css = readFileSync(new URL('../public/css/project-page.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('/css/project-page.css') > html.indexOf('/css/task-page.css'));
  assert.match(css, /#content:has\(> \.project-index\) \{ padding:0/);
  assert.match(css, /\.project-document \.icon-picker \{ flex-basis:100%/);
  assert.match(css, /\.project-view-content \{[^}]*overflow-x:auto/);
  assert.match(css, /\.project-index \.feed \{ max-width:none/);
  assert.match(css, /@media \(max-width:760px\)[\s\S]*flex-basis:100%/);
  assert.doesNotMatch(css, /(?:^|\n)\.(?:daily-period|page-head|feed|task-document|kanban-card)\s*\{/);
});

test('项目统计和暂停状态在两种主题下保持正文对比度', () => {
  const theme = readFileSync(new URL('../public/css/base.css', import.meta.url), 'utf8');
  const rgb = hex => hex.slice(1).match(/../g).map(x => parseInt(x, 16));
  const lum = values => values.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((sum, x, i) => sum + x * [.2126,.7152,.0722][i], 0);
  for (const selector of [':root', '[data-theme="dark"]']) {
    const rule = [...theme.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(m => m[1].trim() === selector)[2];
    const c = Object.fromEntries([...rule.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map(m => [m[1], rgb(m[2])]));
    for (const surface of [c['primary-soft'], c['panel-2'], ...['warning','success'].map(key => c[key].map((x,i) => x * .12 + c.panel[i] * .88))]) {
      const a = lum(c.text), b = lum(surface); assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05) >= 4.5, selector);
    }
  }
});
