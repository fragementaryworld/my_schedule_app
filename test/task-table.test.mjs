import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/page/p1' };
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });

const projectsUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href;
const projects = await import(projectsUrl);

const P = {
  id: 'p1',
  name: 'P',
  tasks: [{
    id: 't1',
    title: '任务A',
    done: false,
    startDate: '2024-05-01',
    dueDate: '2024-05-10',
    subtasks: [{ id: 's1', title: '子任务1', done: false }, { id: 's2', title: '子任务2', done: true }]
  }]
};

test('问题2：formatTaskDates 展示时间区间', () => {
  assert.equal(projects.formatTaskDates({ startDate: '2024-05-01', dueDate: '2024-05-10' }), '2024-05-01 → 2024-05-10');
  assert.equal(projects.formatTaskDates({ dueDate: '2024-05-10' }), '2024-05-10');
  assert.equal(projects.formatTaskDates({ startDate: '2024-05-01' }), '2024-05-01');
  assert.equal(projects.formatTaskDates({}), '—');
});

test('问题2：表格时间列显示区间', () => {
  const table = projects.buildTaskTable(P);
  assert.ok(textOf(table).includes('2024-05-01 → 2024-05-10'), '时间列应显示起止区间');
});

test('问题2：表格默认收起子任务', () => {
  const table = projects.buildTaskTable(P);
  assert.equal(findAllByClass(table, 'subtask-row').length, 0);
  const toggle = findAllByTag(table, 'button').find((b) => String(b.getAttribute('title')).includes('展开/收起'));
  assert.ok(toggle, '应有子任务展开箭头');
  assert.equal(textOf(toggle), '▸', '收起时应显示 ▸');
});

test('问题2：点击箭头展开子任务下拉', () => {
  const box = document.createElement('div');
  const refresh = () => {
    box.innerHTML = '';
    box.append(projects.buildTaskTable(P));
  };
  projects.buildProjectTasksSection(P, refresh);
  refresh();

  assert.equal(findAllByClass(box, 'subtask-row').length, 0, '默认收起');
  findAllByTag(box, 'button').find((b) => String(b.getAttribute('title')).includes('展开/收起')).click();

  assert.equal(findAllByClass(box, 'subtask-row').length, 1, '展开后应出现子任务行');
  assert.ok(textOf(box).includes('子任务1'), '应显示子任务内容');
  assert.ok(textOf(box).includes('☑'), '已完成子任务应有勾选标记');

  findAllByTag(box, 'button').find((b) => String(b.getAttribute('title')).includes('展开/收起')).click();
  assert.equal(findAllByClass(box, 'subtask-row').length, 0, '再次点击应收起');
});

test('问题2：无子任务的任务箭头不可展开', () => {
  const p = { id: 'p1', name: 'P', tasks: [{ id: 't1', title: '无子任务', done: false, dueDate: '2024-05-10', subtasks: [] }] };
  const table = projects.buildTaskTable(p);
  const toggle = findAllByTag(table, 'button')[0];
  assert.equal(textOf(toggle), '·');
  toggle.click();
  assert.equal(findAllByClass(table, 'subtask-row').length, 0);
});
