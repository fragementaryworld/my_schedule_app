import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { buildDailyBoard, dailyEntries, groupEntriesByOwner } from '../public/js/daily.js';
import { timelineColor } from '../public/js/task-model.js';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr, addDays } from '../public/js/utils.js';
const { apiFixture } = createRequire(import.meta.url)('../test-helpers/api-fixture.js');
const date = todayStr(), tick = () => new Promise(r => setTimeout(r, 15));
const button = (root, label) => findAllByTag(root, 'button').find(e => textOf(e) === label);
const control = (root, label, tag = 'input') => findAllByTag(root, tag).find(e => e.getAttribute('aria-label') === label);

function fixtureData() {
  return {
    tasks: [
      { id: 'same', title: '报发票', date, listId: 'work', category: 'temporary', tags: ['生活'], projectId: null, source: { type: 'project', id: 'p' } },
      { id: 'personal', title: '买日用品', date: addDays(date, -2), listId: 'personal' },
      { id: 'inbox', title: '待归档想法', date, listId: 'inbox', source: { type: 'idea', id: 'idea' } },
      { id: 'linked', title: '项目中的独立任务', date, projectId: 'p' },
      { id: 'finished', title: '已完成事项', date, listId: 'work', done: true }
    ],
    projects: [
      { id: 'p', name: '研究项目', tasks: [{ id: 'same', title: '提交材料', dueDate: date, dueTime: '17:00', subtasks: [{ id: 'child', title: '核对引文' }] }] },
      { id: 'p2', name: '研究项目', tasks: [{ id: 't', title: '另一个项目任务' }] }
    ]
  };
}
function setup(t) {
  const nativeFetch = globalThis.fetch;
  globalThis.document = makeDocument(); globalThis.location = { hash: '#/today' };
  const data = fixtureData(), entries = dailyEntries(data.tasks, data.projects), writes = [];
  globalThis.fetch = async (url, options) => { writes.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({}) }; };
  t.after(() => { globalThis.fetch = nativeFetch; });
  const root = buildDailyBoard(entries, date, async () => {}); document.body.append(root);
  button(root, '安排任务').click();
  const modal = findAllByClass(document.body, 'daily-arrange-modal')[0];
  return { ...data, entries, root, modal, writes };
}

test('按清单身份分组，忽略历史分类与来源，同名项目不合并，输入数据不变', () => {
  const { tasks, projects } = fixtureData(), entries = dailyEntries(tasks, projects), snapshot = structuredClone(entries);
  const groups = groupEntriesByOwner(entries);
  assert.deepEqual(groups.map(g => g.key), ['list:inbox', 'list:work', 'list:personal', 'project:p', 'project:p2']);
  assert.equal(groups[1].entries.find(e => e.id === 'same').kind, 'day');
  assert.equal(groups[3].entries.find(e => e.id === 'same').kind, 'project');
  assert.equal(groups[3].entries.length, 3, '项目内独立任务、项目任务与子任务集中显示');
  assert.equal(groups[3].color, timelineColor('p')); assert.equal(groups[4].color, timelineColor('p2'));
  assert.equal(new Set(groups.slice(0, 3).map(g => g.color)).size, 3);
  assert.equal(groups[3].label, groups[4].label); assert.notEqual(groups[3].key, groups[4].key);
  assert.deepEqual(entries, snapshot);
  assert.deepEqual(groupEntriesByOwner([]), []);
});

test('弹窗每个清单有独立区块、标题、计数与色标；候选任务仅出现一次，深层链接保持正确', t => {
  const { modal } = setup(t), groups = findAllByClass(modal, 'daily-pool-group');
  assert.deepEqual(groups.map(g => g.dataset.owner), ['list:inbox', 'list:work', 'list:personal', 'project:p', 'project:p2']);
  assert.deepEqual(groups.map(g => textOf(findAllByTag(g, 'h3')[0])), ['收集箱', '工作事务', '生活事务', '项目 · 研究项目', '项目 · 研究项目']);
  assert.deepEqual(groups.map(g => textOf(findAllByClass(g, 'daily-pool-group-count')[0])), ['1 项', '1 项', '1 项', '3 项', '1 项']);
  assert.ok(groups.every(g => /--group-color:#[0-9a-f]{6}/.test(g.getAttribute('style'))));
  const rows = findAllByClass(modal, 'daily-task');
  assert.equal(rows.length, 7); assert.equal(new Set(rows.map(r => r.dataset.entry)).size, 7);
  assert.ok(!textOf(modal).includes('已完成事项'));
  assert.equal(control(modal, '选择安排：提交材料').checked, false);
  findAllByTag(modal, 'a').find(e => textOf(e) === '核对引文').click();
  assert.equal(location.hash, '#/task/p/same/child');
});

test('跨清单选择经搜索后保持勾选，提示隐藏选择，批量保存使用正确原任务身份', async t => {
  const { modal, writes, tasks, projects } = setup(t), snapshot = structuredClone({ tasks, projects });
  for (const title of ['报发票', '提交材料']) { const choice = control(modal, `选择安排：${title}`); choice.checked = true; choice.fire('change'); }
  const search = control(modal, '搜索待安排任务'); search.value = '生活事务'; search.fire('input');
  assert.deepEqual(findAllByClass(modal, 'daily-pool-group').map(g => g.dataset.owner), ['list:personal']);
  assert.equal(textOf(findAllByClass(modal, 'daily-pool-selection')[0]), '已选 2 项（2 项被搜索隐藏）');
  const personal = control(modal, '选择安排：买日用品'); personal.checked = true; personal.fire('change');
  search.value = ''; search.fire('input');
  assert.equal(control(modal, '选择安排：报发票').checked, true); assert.equal(control(modal, '选择安排：提交材料').checked, true);
  assert.ok(textOf(findAllByClass(modal, 'daily-pool-group')[1]).includes('已选 1 项'));
  const restored = control(modal, '选择安排：买日用品'); restored.checked = false; restored.fire('change');
  control(modal, '批量安排时段', 'select').value = 'afternoon';
  button(modal, '安排选中 2 项').click(); await tick();
  assert.equal(writes.length, 1); assert.equal(writes[0].url, '/api/planning/batch');
  assert.deepEqual(writes[0].body.items.map(e => e.base), ['/api/tasks/same', '/api/projects/p/tasks/same']);
  assert.ok(writes[0].body.items.every(e => e.patch.planDate === date && e.patch.planPeriod === 'afternoon' && !('dueDate' in e.patch)));
  assert.deepEqual({ tasks, projects }, snapshot);
  assert.equal(findAllByClass(document.body, 'daily-arrange-modal').length, 0);
});

test('搜索支持项目名与祖先路径，空结果不会清除选择；分区标题按纯文本呈现', t => {
  const { modal } = setup(t);
  const pick = control(modal, '选择安排：核对引文'); pick.checked = true; pick.fire('change');
  const search = control(modal, '搜索待安排任务'); search.value = '提交材料'; search.fire('input');
  assert.equal(findAllByClass(modal, 'daily-pool-group').length, 1);
  assert.equal(textOf(findAllByClass(modal, 'daily-pool-group-count')[0]), '显示 2 / 3 项 · 已选 1 项');
  search.value = '找不到的任务'; search.fire('input');
  assert.equal(findAllByClass(modal, 'daily-pool-group').length, 0); assert.ok(textOf(modal).includes('没有匹配的待办任务'));
  assert.ok(button(modal, '安排选中 1 项')); assert.ok(textOf(modal).includes('1 项被搜索隐藏'));
  const entries = dailyEntries([], [{ id: 'text', name: '<img src=x onerror=alert(1)>', tasks: [{ id: 't', title: '安全任务' }] }]);
  const root = buildDailyBoard(entries, date, async () => {}); button(root, '安排任务').click();
  const latest = findAllByClass(document.body, 'daily-arrange-modal').at(-1);
  assert.ok(textOf(latest).includes('<img src=x onerror=alert(1)>')); assert.equal(findAllByTag(latest, 'img').length, 0);
});

test('批量保存期间拒绝重复提交，失败后恢复选项、分区和已选状态供重试', async t => {
  const { modal } = setup(t); let resolveRequest, calls = 0;
  globalThis.fetch = async () => { calls++; return new Promise(resolve => { resolveRequest = resolve; }); };
  const choice = control(modal, '选择安排：报发票'); choice.checked = true; choice.fire('change');
  const apply = button(modal, '安排选中 1 项'); apply.click(); apply.click();
  assert.equal(calls, 1); assert.equal(choice.disabled, true); assert.equal(control(modal, '搜索待安排任务').disabled, true);
  assert.equal(control(modal, '批量安排时段', 'select').disabled, true);
  resolveRequest({ ok: false, json: async () => ({ error: '模拟写盘失败' }) }); await tick();
  assert.equal(findAllByClass(modal, 'daily-pool-group').length, 5);
  assert.equal(choice.disabled, false); assert.equal(choice.checked, true); assert.equal(apply.disabled, false);
  assert.equal(control(modal, '搜索待安排任务').disabled, false);
  assert.equal(textOf(findAllByClass(modal, 'daily-pool-selection')[0]), '已选 1 项');
});

test('真实 HTTP 跨分区批量安排写入并可从磁盘重读，项目截止时间和归属保持不变', async t => {
  const nativeFetch = globalThis.fetch, fixture = await apiFixture(t);
  const work = (await fixture.request('POST', '/api/tasks', { title: '工作事项', date, listId: 'work' })).body;
  const personal = (await fixture.request('POST', '/api/tasks', { title: '生活事项', date, listId: 'personal' })).body;
  const project = (await fixture.request('POST', '/api/projects', { name: '研究' })).body;
  const task = (await fixture.request('POST', `/api/projects/${project.id}/tasks`, { title: '研究安排', dueDate: addDays(date, 4), dueTime: '17:00' })).body;
  globalThis.document = makeDocument();
  globalThis.fetch = (url, options) => nativeFetch(fixture.base + url, options); t.after(() => { globalThis.fetch = nativeFetch; });
  const initial = fixture.server.store.get();
  const root = buildDailyBoard(dailyEntries(initial.tasks, initial.projects), date, async () => {}); document.body.append(root);
  button(root, '安排任务').click(); const modal = findAllByClass(document.body, 'daily-arrange-modal')[0];
  for (const title of ['工作事项', '生活事项', '研究安排']) { const pick = control(modal, `选择安排：${title}`); pick.checked = true; pick.fire('change'); }
  control(modal, '批量安排时段', 'select').value = 'morning'; button(modal, '安排选中 3 项').click();
  for (let i = 0; i < 100 && findAllByClass(document.body, 'daily-arrange-modal').length; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(findAllByClass(document.body, 'daily-arrange-modal').length, 0);
  const { createApp } = createRequire(import.meta.url)('../lib/api.js');
  const saved = createApp({ dataFile: fixture.file }).store.get();
  const a = saved.tasks.find(e => e.id === work.id), b = saved.tasks.find(e => e.id === personal.id), c = saved.projects.find(e => e.id === project.id).tasks.find(e => e.id === task.id);
  for (const entry of [a,b,c]) { assert.equal(entry.planDate, date); assert.equal(entry.planPeriod, 'morning'); }
  assert.equal(a.listId, 'work'); assert.equal(b.listId, 'personal');
  assert.equal(c.dueDate, addDays(date, 4)); assert.equal(c.dueTime, '17:00'); assert.equal(saved.tasks.length, 2);
});

test('清单分区标题在两种主题下保持可读，边界与分区留白不依赖文字颜色', () => {
  const css = readFileSync(new URL('../public/css/modules.css', import.meta.url), 'utf8');
  assert.match(css, /\.daily-pool-group \{[^}]*border-left:4px solid var\(--group-color\)/);
  assert.match(css, /\.daily-pool-list \{[^}]*gap:18px/);
  const theme = readFileSync(new URL('../public/css/base.css', import.meta.url), 'utf8');
  const luminance = rgb => rgb.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((sum,x,i) => sum + x * [.2126,.7152,.0722][i], 0);
  const rgb = hex => hex.slice(1).match(/../g).map(x => parseInt(x,16));
  const groups = groupEntriesByOwner(dailyEntries(fixtureData().tasks, fixtureData().projects));
  for (const selector of [':root', '[data-theme="dark"]']) {
    const rule = [...theme.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(m => m[1].trim() === selector)[2];
    const values = Object.fromEntries([...rule.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map(m => [m[1], rgb(m[2])]));
    for (const group of groups) {
      const ink = luminance(values.text), bg = luminance(rgb(group.color).map((x,i) => x * .12 + values.panel[i] * .88));
      assert.ok((Math.max(ink,bg)+.05)/(Math.min(ink,bg)+.05) >= 4.5, `${selector} ${group.key}`);
    }
  }
});
