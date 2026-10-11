import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { buildDailyFilters, filterDailyEntries } from '../public/js/daily.js';
import { todayStr } from '../public/js/utils.js';
import * as today from '../public/js/views/today.js';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/today' };
const projects = [{ id: 'paper', name: '论文项目', tasks: [] }];
const entries = [
  { title: '工作回复', ownerKey: 'list:work' },
  { title: '生活回复', ownerKey: 'list:personal' },
  { title: '论文回复', ownerKey: 'project:paper' },
  { title: '收集想法', ownerKey: 'list:inbox' },
  { title: '报发票', ownerKey: 'list:work' }
];
const button = (root, label) => findAllByTag(root, 'button').find(b => textOf(b) === label);
const checkbox = (root, owner) => findAllByTag(root, 'input').find(c => c.value === owner);
const select = (root, owner, checked = true) => {
  const ctrl = checkbox(root, owner);
  assert.ok(ctrl, `清单选项 ${owner}`);
  ctrl.checked = checked;
  ctrl.fire('change');
};

test('多清单取合集并叠加搜索，空选择显示全部，兼容单选且不重复或修改原数据', () => {
  const before = JSON.stringify(entries);
  const filters = { owners: ['list:work', 'list:personal', 'list:work'], search: '回复' };
  assert.deepEqual(filterDailyEntries(entries, filters).map(e => e.title), ['工作回复', '生活回复']);
  assert.deepEqual(filterDailyEntries(entries, { owners: ['project:paper', 'list:inbox'] }).map(e => e.title), ['论文回复', '收集想法']);
  assert.deepEqual(filterDailyEntries(entries, { owners: [] }), entries);
  assert.deepEqual(filterDailyEntries(entries, { owner: 'list:personal' }).map(e => e.title), ['生活回复']);
  assert.deepEqual(filterDailyEntries(entries, { owners: [], owner: 'list:personal' }), entries);
  assert.deepEqual(filterDailyEntries(entries, { owners: ['project:deleted'] }), []);
  assert.equal(JSON.stringify(entries), before);
  assert.deepEqual(filters.owners, ['list:work', 'list:personal', 'list:work']);
});

test('勾选、取消、重建和重置保留正确状态与搜索焦点，筛选不请求网络', () => {
  globalThis.fetch = () => { throw new Error('筛选不应请求网络'); };
  const filters = { owner: 'list:work', search: '回复' };
  let shown = filterDailyEntries(entries, filters);
  const build = () => buildDailyFilters(filters, () => { shown = filterDailyEntries(entries, filters); }, projects);
  const root = build();
  const caption = () => textOf(findAllByClass(root, 'daily-owner-caption')[0]);
  const search = findAllByTag(root, 'input')[0];
  search.focus();
  assert.equal(checkbox(root, 'list:work').checked, true);
  select(root, 'list:personal');
  assert.deepEqual(shown.map(e => e.title), ['工作回复', '生活回复']);
  assert.deepEqual(filters, { owners: ['list:work', 'list:personal'], search: '回复' });
  assert.equal(caption(), '工作事务、生活事务');
  assert.equal(document.activeElement, search);
  select(root, 'project:paper');
  assert.equal(caption(), '已选 3 个清单');
  assert.equal(shown.length, 3);
  const rebuilt = build();
  for (const owner of filters.owners) assert.equal(checkbox(rebuilt, owner).checked, true);
  assert.equal(findAllByTag(rebuilt, 'input')[0].value, '回复');
  select(root, 'list:work', false);
  assert.deepEqual(shown.map(e => e.title), ['生活回复', '论文回复']);
  button(root, '全部清单').click();
  assert.deepEqual(filters, { search: '回复' });
  assert.deepEqual(shown.map(e => e.title), ['工作回复', '生活回复', '论文回复']);
  select(root, 'list:personal');
  select(root, 'list:personal', false);
  assert.equal(shown.length, 3, '取消最后一个勾选恢复全部清单，搜索仍生效');
  button(root, '清除筛选').click();
  assert.deepEqual(filters, {});
  assert.deepEqual(shown, entries);
  assert.equal(search.value, '');
  assert.equal(caption(), '全部清单');
  assert.ok(findAllByTag(root, 'input').filter(c => c.getAttribute('type') === 'checkbox').every(c => !c.checked));
});

test('清单菜单内点击保持展开，外部点击和 Esc 收起且保留勾选', () => {
  document.body.innerHTML = '';
  const filters = {};
  const root = buildDailyFilters(filters, () => {}, projects);
  document.body.append(root);
  const menu = findAllByClass(root, 'daily-owner-filter')[0];
  menu.open = true;
  checkbox(root, 'list:work').click();
  select(root, 'list:work');
  assert.equal(menu.open, true);
  findAllByTag(root, 'input')[0].click();
  assert.equal(menu.open, false);
  assert.deepEqual(filters.owners, ['list:work']);
  menu.open = true;
  document.dispatchEvent('keydown', { key: 'Escape' });
  assert.equal(menu.open, false);
  assert.equal(document.activeElement, findAllByTag(menu, 'summary')[0]);
  assert.equal(checkbox(root, 'list:work').checked, true);
  document.body.innerHTML = '';
});

test('工作与生活多选同步筛选周/月日历和当天看板，切换视图保留选择，清除显示全部', async () => {
  const date = todayStr();
  const tasks = [
    { id: 'work', title: '工作回复', listId: 'work', date },
    { id: 'personal', title: '生活回复', listId: 'personal', date },
    { id: 'inbox', title: '收集想法', listId: 'inbox', date },
    { id: 'invoice', title: '报发票', listId: 'work', date }
  ];
  const plannedProjects = [{ ...projects[0], tasks: [{ id: 'paper-task', title: '论文回复', planDate: date }] }];
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    assert.ok(!options.method || options.method === 'GET', '筛选不能写入任务');
    calls.push(String(url));
    return { ok: true, json: async () => String(url).includes('preferences') ? {} : String(url).includes('projects') ? plannedProjects : tasks };
  };
  const root = document.createElement('div');
  await today.render(root);
  const titles = cls => findAllByClass(root, cls).map(textOf).sort();
  const assertShown = expected => {
    assert.deepEqual(titles('cal-card-title'), [...expected].sort());
    assert.deepEqual(titles('daily-task-title'), [...expected].sort());
  };
  const initialRequests = calls.length;
  select(root, 'list:work');
  select(root, 'list:personal');
  assertShown(['工作回复', '生活回复', '报发票']);
  const search = findAllByTag(root, 'input').find(c => c.getAttribute('type') === 'search');
  search.value = '回复'; search.fire('input');
  assertShown(['工作回复', '生活回复']);
  assert.equal(calls.length, initialRequests);
  const switchView = async label => {
    const requests = calls.length;
    const previousSearch = findAllByTag(root, 'input')[0];
    button(root, label).click();
    // 等待异步读取和重绘，不依赖固定计时延迟。
    for (let i = 0; i < 30 && (calls.length < requests + 2 || previousSearch === findAllByTag(root, 'input')[0]); i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.ok(calls.length >= requests + 2);
  };
  await switchView('月视图');
  assert.equal(findAllByClass(root, 'cal-cell').length, 42);
  assertShown(['工作回复', '生活回复']);
  assert.equal(checkbox(root, 'list:work').checked, true);
  assert.equal(checkbox(root, 'list:personal').checked, true);
  assert.equal(checkbox(root, 'list:inbox').checked, false);
  select(root, 'project:paper');
  assertShown(['工作回复', '生活回复', '论文回复']);
  await switchView('周视图');
  assert.equal(findAllByClass(root, 'cal-col').length, 7);
  assert.equal(checkbox(root, 'project:paper').checked, true);
  assertShown(['工作回复', '生活回复', '论文回复']);
  const beforeClear = calls.length;
  button(root, '清除筛选').click();
  assertShown(tasks.map(t => t.title).concat('论文回复'));
  assert.equal(calls.length, beforeClear);
});
