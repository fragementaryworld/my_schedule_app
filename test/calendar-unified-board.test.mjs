import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr, addDays } from '../public/js/utils.js';
import { weekDates, dragSinglePatch, projectEntriesByDate } from '../public/js/calendar.js';
import { dailyEntries, withPlannedCalendarEntries } from '../public/js/daily.js';
import * as today from '../public/js/views/today.js';

const date = todayStr();
const otherDate = weekDates(date).find(d => d !== date);
const tick = () => new Promise(r => setTimeout(r, 15));
const buttons = root => findAllByTag(root, 'button');
const button = (root, text) => buttons(root).find(b => textOf(b) === text);
const cell = (root, date) => [...findAllByClass(root, 'cal-col'), ...findAllByClass(root, 'cal-cell')].find(c => c.dataset.date === date);
const board = root => findAllByClass(root, 'cal-board')[0];
const card = (root, base) => findAllByClass(board(root), 'daily-task').find(c => c.dataset.entry === base);
let projects, tasks, writes;
async function setup() {
  globalThis.document = makeDocument();
  globalThis.location = { hash: '#/today' };
  writes = [];
  projects = [
    { id: 'work', name: '论文', tasks: [
      { id: 'manual', title: '手动安排', planDate: date, dueDate: addDays(date, 10), subtasks: [] },
      { id: 'pool', title: '未安排的资料核对', subtasks: [] },
      { id: 'due', title: '当天截止工作', dueDate: date, subtasks: [] },
      { id: 'span', title: '持续调研', startDate: addDays(date, -2), dueDate: addDays(date, 3), subtasks: [] }
    ] },
    { id: 'topic', name: '文件整理', category: 'temporary', tasks: [{ id: 'child', title: '临时工作', planDate: date, subtasks: [] }] }
  ];
  tasks = [{ id: 'due', title: '报发票', date }, { id: 'other', title: '其他日事务', date: otherDate }];
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'PUT') {
      const patch = JSON.parse(options.body);
      writes.push({ url, patch });
      const parts = String(url).split('/');
      const target = parts[2] === 'projects' ? projects.find(p => p.id === parts[3]).tasks.find(t => t.id === parts[5]) : tasks.find(t => t.id === parts[3]);
      Object.assign(target, patch);
      return { ok: true, json: async () => target };
    }
    if (method === 'POST') { writes.push({ url, patch: JSON.parse(options.body) }); return { ok: true, json: async () => ({ id: 'new' }) }; }
    let data;
    if (String(url).includes('preferences')) data = { weekStart: 'mon' };
    else if (String(url) === '/api/projects') data = projects;
    else {
      const query = new URL(String(url), 'http://localhost').searchParams;
      data = tasks.filter(t => t.date >= query.get('from') && t.date <= query.get('to'));
    }
    return { ok: true, json: async () => structuredClone(data) };
  };
  const root = document.createElement('div');
  await today.render(root);
  button(root, '清除筛选').click();
  button(root, '周视图').click(); await tick();
  return root;
}

test('只保留周/月两个入口，一处日期看板包含三种归属和当天安排', async () => {
  const root = await setup();
  assert.deepEqual(findAllByClass(root, 'tab').map(textOf), ['周视图', '月视图']);
  assert.equal(findAllByClass(root, 'daily-list').length, 0);
  assert.equal(findAllByClass(root, 'cal-board').length, 1);
  assert.equal(findAllByClass(root, 'daily-board').length, 1);
  for (const text of ['工作项目', '临时专题', '日常事务', '当天安排', '当天截止']) assert.ok(textOf(board(root)).includes(text));
  assert.equal(findAllByClass(board(root), 'daily-done')[0].hasAttribute('open'), false);
  assert.equal(findAllByClass(board(root), 'daily-ongoing')[0].hasAttribute('open'), false);
});

test('加入选中日后，原任务进入分类看板和日历，截止日期不变，移出可还原', async () => {
  const root = await setup();
  const add = buttons(root).find(b => b.getAttribute('aria-label') === '加入当天：未安排的资料核对');
  add.click(); await tick();
  assert.deepEqual(writes.pop(), { url: '/api/projects/work/tasks/pool', patch: { planDate: date } });
  assert.ok(findAllByClass(findAllByClass(board(root), 'daily-planned')[0], 'daily-task').some(c => c.dataset.entry === '/api/projects/work/tasks/pool'));
  assert.ok(textOf(cell(root, date)).includes('未安排的资料核对'));
  const remove = buttons(root).find(b => b.getAttribute('aria-label') === '移出当天：未安排的资料核对');
  remove.click(); await tick();
  assert.equal(projects[0].tasks[1].planDate, null);
  assert.equal(projects[0].tasks[1].dueDate, undefined);
  assert.ok(!textOf(cell(root, date)).includes('未安排的资料核对'));
});

test('选日后切换周/月仍显示同一日期，新增任务使用所选日期', async () => {
  const root = await setup();
  cell(root, otherDate).click(); await tick();
  assert.ok(textOf(board(root)).includes('其他日事务'));
  assert.ok(!findAllByClass(board(root), 'daily-planned').some(c => textOf(c).includes('报发票')));
  button(root, '月视图').click(); await tick();
  assert.ok(cell(root, otherDate).classList.contains('selected'));
  assert.equal(findAllByClass(root, 'daily-board').length, 1);
  button(root, '周视图').click(); await tick();
  assert.ok(cell(root, otherDate).classList.contains('selected'));
  button(root, '＋ 新增任务').click(); await tick();
  assert.equal(writes.pop().patch.date, otherDate);
});

test('翻页与今天按钮同步看板，归属筛选同时作用于日历和看板', async () => {
  const root = await setup();
  const filter = findAllByTag(root, 'select').find(s => s.getAttribute('aria-label') === '全部归属');
  filter.value = 'temporary'; filter.fire('change');
  assert.deepEqual(findAllByClass(board(root), 'cal-board-card').map(c => c.dataset.entry), ['/api/projects/topic/tasks/child']);
  assert.ok(!textOf(cell(root, date)).includes('报发票'));
  findAllByClass(root, 'cal-next')[0].click(); await tick();
  assert.ok(cell(root, addDays(date, 7)).classList.contains('selected'));
  assert.ok(!findAllByClass(board(root), 'cal-board-card').some(c => textOf(c).includes('临时工作')));
  button(root, '今天').click(); await tick();
  assert.ok(cell(root, date).classList.contains('selected'));
  assert.ok(textOf(board(root)).includes('临时工作'));
});

test('完成后刷新仍保留所选日期，跨来源相同 id 的拖动不会更新错误任务', async () => {
  const root = await setup();
  const daily = card(root, '/api/tasks/due');
  let key;
  daily.fire('dragstart', { dataTransfer: { setData: (_, value) => { key = value; } } });
  const done = findAllByClass(root, 'board-col-done')[0];
  done.fire('dragover', { preventDefault() {} });
  assert.equal(done.open, true);
  done.fire('drop', { preventDefault() {}, dataTransfer: { getData: () => key } }); await tick();
  assert.deepEqual(writes.pop(), { url: '/api/tasks/due', patch: { done: true } });
  assert.equal(projects[0].tasks.find(t => t.id === 'due').done, undefined);
  assert.ok(cell(root, date).classList.contains('selected'));
  assert.ok(findAllByClass(findAllByClass(root, 'board-col-done')[0], 'daily-task').some(c => c.dataset.entry === '/api/tasks/due'));
});

test('独立安排的日历改期只更新计划日期，重叠跨度不生成重复卡片', () => {
  const projects = [{ id: 'p', tasks: [
    { id: 'undated', title: '无日期', planDate: date },
    { id: 'dated', title: '有截止日期', planDate: date, dueDate: addDays(date, 10) },
    { id: 'span', title: '跨天', planDate: date, startDate: addDays(date, -1), dueDate: addDays(date, 1) }
  ] }];
  const entries = withPlannedCalendarEntries(projectEntriesByDate(projects), dailyEntries([], projects));
  assert.equal(entries.filter(e => e.id === 'span').length, 1);
  assert.equal(entries.filter(e => e.id === 'dated').length, 2);
  const planned = entries.find(e => e.id === 'dated' && e.planOnly);
  assert.deepEqual(dragSinglePatch(planned, 2), { planDate: addDays(date, 2) });
  assert.equal(planned.dueDate, addDays(date, 10));
  assert.equal(entries.find(e => e.id === 'undated').date, date);
});
