import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { dailyEntries, dailySections, filterDailyEntries, entryForest, buildDailyList, buildDailyFilters } from '../public/js/daily.js';
import { todayStr, addDays } from '../public/js/utils.js';
import * as today from '../public/js/views/today.js';
import * as plan from '../public/js/views/plan.js';
import { buildPageProperties } from '../public/js/views/page.js';
import * as ideas from '../public/js/views/ideas.js';

const date = todayStr();
const future = addDays(date, 4);
const projects = [
  { id: 'paper', name: '论文项目', tasks: [
    { id: 'parent', title: '修改论文', planDate: date, dueDate: future, subtasks: [{ id: 'child', title: '修改图表', planDate: date, estimate: 10 }] },
    { id: 'due', title: '提交摘要', dueDate: date },
    { id: 'span', title: '实验分析', startDate: addDays(date, -3), dueDate: future },
    { id: 'pool', title: '检查模型' },
    { id: 'done', title: '完成实验', done: true, planDate: date }
  ] },
  { id: 'files', name: '历史资料整理', category: 'temporary', sourceIdeaId: 'idea1', tasks: [{ id: 'catalog', title: '建立目录', planDate: date }] },
  { id: 'paused', name: '暂停项目', status: 'paused', tasks: [{ id: 'hidden', title: '暂停工作', dueDate: date }] }
];
const tasks = [
  { id: 'invoice', title: '报发票', date, routineTag: 'admin', estimate: 10 },
  { id: 'idea', title: '尝试新方法', date, source: { type: 'idea', id: 'idea1' }, projectId: 'paper', estimate: 20 },
  { id: 'legacy', title: '旧任务', date, source: { type: 'project', id: 'files' } }
];
const entries = () => dailyEntries(tasks, projects);
const tick = () => new Promise(r => setTimeout(r, 15));
const button = (root, text) => findAllByTag(root, 'button').find(b => textOf(b) === text);
globalThis.document = makeDocument();
globalThis.location = { hash: '#/today' };

test('归属与灵感来源独立，兼容旧任务且不修改原数据', () => {
  const before = JSON.stringify([tasks, projects]);
  const all = entries();
  const idea = all.find(e => e.id === 'idea');
  assert.equal(idea.category, 'work');
  assert.equal(idea.sourceType, 'idea');
  assert.equal(idea.raw.source.id, 'idea1');
  assert.equal(all.find(e => e.id === 'legacy').category, 'temporary');
  assert.equal(all.find(e => e.id === 'invoice').category, 'routine');
  assert.equal(all.find(e => e.id === 'catalog').sourceType, 'idea');
  assert.ok(!all.some(e => e.id === 'hidden'));
  assert.equal(JSON.stringify([tasks, projects]), before);
});

test('显式移回日常事务不被历史项目来源重新归类', () => {
  assert.equal(dailyEntries([{ ...tasks[2], projectId: null }], projects)[0].category, 'routine');
  assert.equal(dailyEntries([{ ...tasks[2], projectId: 'deleted' }], projects)[0].category, 'routine');
});

test('当天安排、截止、跨天、完成和候选任务互不重复', () => {
  const s = dailySections(entries(), date);
  assert.deepEqual(s.due.map(e => e.id), ['due']);
  assert.deepEqual(s.ongoing.map(e => e.id), ['span']);
  assert.deepEqual(s.done.map(e => e.id), ['done']);
  assert.deepEqual(s.candidates.map(e => e.id), ['pool']);
  assert.ok(s.planned.some(e => e.id === 'parent'));
  const ids = Object.values(s).flat().map(e => `${e.kind}:${e.id}`);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(dailySections(entries(), addDays(date, 1)).planned.length, 0);
});

test('父子任务按路径折叠；单独安排子任务保留祖先路径和深层链接', () => {
  const s = dailySections(entries(), date);
  const forest = entryForest(s.planned);
  assert.deepEqual(forest.find(n => n.entry.id === 'parent').children.map(n => n.entry.id), ['child']);
  const child = entries().find(e => e.id === 'child');
  assert.deepEqual(entryForest([child])[0].children, []);
  assert.deepEqual(child.ancestors, ['修改论文']);
  assert.equal(child.base, '/api/projects/paper/tasks/parent/subtasks/child');
});

test('归属与路径搜索可组合，废弃的来源/项目/快速筛选不会隐藏任务', () => {
  assert.deepEqual(filterDailyEntries(entries(), { category: 'work', search: '新方法' }).map(e => e.id), ['idea']);
  assert.deepEqual(filterDailyEntries(entries(), { category: 'temporary', search: '目录' }).map(e => e.id), ['catalog']);
  assert.deepEqual(filterDailyEntries(entries(), { projectId: 'missing', source: 'book', quick: true }), entries());
  assert.ok(filterDailyEntries(entries(), { search: '修改论文' }).some(e => e.id === 'child'));
});

test('完成和持续区块默认折叠，三类归属可见，来源不再显示', () => {
  const root = buildDailyList(entries(), date, async () => {});
  assert.equal(findAllByClass(root, 'daily-done')[0].hasAttribute('open'), false);
  assert.equal(findAllByClass(root, 'daily-ongoing')[0].hasAttribute('open'), false);
  assert.equal(findAllByClass(root, 'daily-subtasks')[0].hasAttribute('open'), false);
  for (const label of ['工作项目', '临时专题', '日常事务', '行政']) assert.ok(textOf(root).includes(label));
  assert.ok(!textOf(root).includes('来源：'));
});

test('加入当天/移出当天/完成子任务只更新原始任务', async () => {
  const calls = [];
  let refreshes = 0;
  globalThis.fetch = async (url, options) => { calls.push([url, JSON.parse(options.body)]); return { ok: true, json: async () => ({}) }; };
  const root = buildDailyList(entries(), date, async () => { refreshes++; });
  const add = findAllByTag(root, 'button').find(b => b.getAttribute('aria-label') === '加入当天：提交摘要');
  add.click(); await tick();
  assert.deepEqual(calls.pop(), ['/api/projects/paper/tasks/due', { planDate: date }]);
  const remove = findAllByTag(root, 'button').find(b => b.getAttribute('aria-label') === '移出当天：修改论文');
  remove.click(); await tick();
  assert.deepEqual(calls.pop(), ['/api/projects/paper/tasks/parent', { planDate: null }]);
  const childCheck = findAllByTag(root, 'input').find(c => c.getAttribute('aria-label') === '完成任务：修改图表');
  childCheck.checked = true; childCheck.fire('change'); await tick();
  assert.deepEqual(calls.pop(), ['/api/projects/paper/tasks/parent/subtasks/child', { done: true }]);
  assert.equal(refreshes, 3);
});

test('筛选输入和清除筛选不丢失焦点控件，不请求网络', () => {
  const filters = { category: 'work', quick: true };
  let updates = 0;
  const root = buildDailyFilters(filters, () => updates++);
  const search = findAllByTag(root, 'input')[0];
  search.value = '发票'; search.fire('input');
  assert.equal(filters.search, '发票');
  button(root, '清除筛选').click();
  assert.deepEqual(filters, {});
  assert.equal(search.value, '');
  assert.equal(updates, 2);
});

test('今日计划默认清单，周/月保留，搜索同时影响日历', async () => {
  globalThis.fetch = async url => ({ ok: true, json: async () => String(url).includes('preferences') ? {} : String(url).includes('projects') ? projects : tasks });
  const root = document.createElement('div');
  await today.render(root);
  assert.ok(findAllByClass(root, 'daily-list').length);
  const search = findAllByTag(root, 'input').find(e => e.getAttribute('type') === 'search');
  search.value = '报发票'; search.fire('input');
  assert.equal(findAllByClass(root, 'daily-task-title').length, 1);
  button(root, '周视图').click(); await tick();
  assert.equal(findAllByClass(root, 'cal-card-title').length, 1);
  assert.equal(textOf(findAllByClass(root, 'cal-card-title')[0]), '报发票');
  button(root, '清除筛选').click();
  button(root, '月视图').click(); await tick();
  assert.equal(findAllByClass(root, 'cal-cell').length, 42);
  button(root, '今日清单').click(); await tick();
});

test('任务页切换归属不会覆写灵感来源；项目页可设为临时专题', async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') calls.push([url, JSON.parse(options.body)]);
    return { ok: true, json: async () => String(url).endsWith('/projects') ? projects : tasks[1] };
  };
  const root = document.createElement('div');
  await plan.render(root, { id: 'idea' });
  const owner = findAllByTag(root, 'select').find(e => e.getAttribute('aria-label') === '任务归属');
  owner.value = 'files'; owner.fire('change'); await tick();
  assert.deepEqual(calls.pop(), ['/api/tasks/idea', { projectId: 'files' }]);
  assert.deepEqual(tasks[1].source, { type: 'idea', id: 'idea1' });
  const props = buildPageProperties(projects, projects[0]);
  const category = findAllByTag(props, 'select').find(e => e.getAttribute('aria-label') === '项目归属');
  category.value = 'temporary'; category.fire('change'); await tick();
  assert.deepEqual(calls.pop(), ['/api/projects/paper', { category: 'temporary' }]);
});

test('灵感转换弹窗可选择任务归属，临时专题按钮发送分类', async () => {
  document.body.innerHTML = '';
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') calls.push([url, JSON.parse(options.body || '{}')]);
    return { ok: true, json: async () => String(url) === '/api/projects' ? projects : String(url) === '/api/ideas' ? [{ id: 'i1', title: '新方法', status: 'idea' }] : {} };
  };
  const root = document.createElement('div');
  await ideas.render(root);
  findAllByTag(root, 'button').find(b => b.getAttribute('title') === '加入今日计划').click();
  await tick();
  const modal = findAllByClass(document.body, 'modal')[0];
  const owner = findAllByTag(modal, 'select')[0];
  assert.ok(textOf(owner).includes('临时专题 · 历史资料整理'));
  owner.value = 'files';
  findAllByTag(modal, 'form')[0].fire('submit');
  await tick();
  assert.deepEqual(calls.pop(), ['/api/ideas/i1/to-task', { date, time: null, projectId: 'files' }]);
  findAllByTag(root, 'button').find(b => b.getAttribute('title') === '转成临时专题').click();
  await tick();
  assert.deepEqual(calls.pop(), ['/api/ideas/i1/to-project', { category: 'temporary' }]);
});

test('完成任务保存失败后还原勾选状态并保持原任务', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: '保存失败' }) });
  let refreshes = 0;
  const root = buildDailyList(entries(), date, async () => refreshes++);
  const cb = findAllByTag(root, 'input').find(c => c.getAttribute('aria-label') === '完成任务：报发票');
  cb.checked = true; cb.fire('change'); await tick();
  assert.equal(cb.checked, false);
  assert.equal(cb.disabled, false);
  assert.equal(refreshes, 0);
  assert.equal(tasks[0].done, undefined);
});
