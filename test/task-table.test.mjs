import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';

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

const tick = () => new Promise((r) => setTimeout(r, 10));

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

test('问题2：formatTaskDates 按选定格式展示时间区间', () => {
  assert.equal(projects.formatTaskDates({ startDate: '2024-05-01', dueDate: '2024-05-10' }), '2024年5月1日 周三 → 2024年5月10日 周五');
  assert.equal(projects.formatTaskDates({ dueDate: '2024-05-10' }), '2024年5月10日 周五');
  assert.equal(projects.formatTaskDates({ startDate: '2024-05-01' }), '2024年5月1日 周三');
  assert.equal(projects.formatTaskDates({ startDate: '2024-05-01', dueDate: '2024-05-10', dateFormat: 'short' }), '2024年5月1日 → 2024年5月10日');
  assert.equal(projects.formatTaskDates({ dueDate: '2024-05-10', dueTime: '09:30' }), '2024年5月10日 周五 09:30');
  assert.equal(projects.formatTaskDates({}), '—');
});

test('问题2：表格时间列显示区间', () => {
  const table = projects.buildTaskTable(P);
  assert.ok(textOf(table).includes('2024年5月1日 周三 → 2024年5月10日 周五'), '时间列应显示起止区间');
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
  const subChecks = findAllByClass(box, 'subtask-check');
  assert.equal(subChecks.length, 2, '每个子任务一个 checkbox');
  assert.deepEqual(subChecks.map((c) => c.checked), [false, true], '勾选状态与数据一致');

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

// ——— 问题2：子任务 checkbox 可点击 ———

function expandBox(p) {
  const box = document.createElement('div');
  const refresh = () => {
    box.innerHTML = '';
    box.append(projects.buildTaskTable(p));
  };
  projects.buildProjectTasksSection(p, refresh);
  refresh();
  findAllByTag(box, 'button').find((b) => String(b.getAttribute('title')).includes('展开/收起')).click();
  return { box, refresh };
}

// 展开状态按任务 id 记忆，所以每个用例用独立 id，避免互相影响
const mkP = (tid) => ({
  id: 'p1',
  name: 'P',
  tasks: [{
    id: tid, title: '任务A', done: false, dueDate: '2024-05-10',
    subtasks: [{ id: 's1', title: '子任务1', done: false }, { id: 's2', title: '子任务2', done: true }]
  }]
});

test('问题2：子任务是真正的 checkbox（不是文字符号）', () => {
  const { box } = expandBox(mkP('t2'));
  const checks = findAllByClass(box, 'subtask-check');
  assert.equal(checks.length, 2);
  for (const c of checks) {
    assert.equal(c.getAttribute('type'), 'checkbox');
    assert.equal(c.tagName, 'INPUT');
  }
  assert.ok(!textOf(box).includes('☐') && !textOf(box).includes('☑'), '不应再用文字符号代替复选框');
});

test('问题2：点击子任务 checkbox 可切换完成并保存', async () => {
  calls.length = 0;
  const { box } = expandBox(mkP('t3'));
  findAllByClass(box, 'subtask-check')[0].click();
  await tick();

  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/api/projects/p1/tasks/t3/subtasks/s1'));
  assert.ok(put, '应调用子任务接口');
  assert.deepEqual(put.body, { done: true });
  assert.equal(findAllByClass(box, 'subtask-check')[0].checked, true, '重渲染后保持勾选');
});

test('问题2：再次点击可取消完成', async () => {
  calls.length = 0;
  const { box } = expandBox(mkP('t4'));
  findAllByClass(box, 'subtask-check')[1].click();
  await tick();
  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/subtasks/s2'));
  assert.ok(put, '应更新第二个子任务');
  assert.deepEqual(put.body, { done: false }, '已完成的子任务点一下变未完成');
  assert.equal(findAllByClass(box, 'subtask-check')[1].checked, false);
});

test('问题2：子任务行显示自己的时间', () => {
  const p = mkP('t5');
  p.tasks[0].subtasks[0].dueDate = '2024-05-08';
  p.tasks[0].subtasks[0].dateFormat = 'iso';
  const { box } = expandBox(p);
  assert.ok(textOf(box).includes('2024-05-08'), '子任务应显示其时间');
});
