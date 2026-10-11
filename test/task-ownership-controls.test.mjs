import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, findAllByTag, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';
import { buildDailyFilters, filterDailyEntries, dailyEntries } from '../public/js/daily.js';
import { render } from '../public/js/views/plan.js';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/plan/task' };
const projects = [{ id: 'topic', name: '整理文献', category: 'temporary', tasks: [] }];
const tick = () => new Promise(r => setTimeout(r, 10));

test('任务分类只剩归属选择，改归属保存成功且不触碰历史来源', async () => {
  const task = { id: 'task', title: '文献任务', date: '2026-10-11', source: { type: 'idea', id: 'idea' } };
  const writes = [];
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') {
      const patch = JSON.parse(options.body);
      writes.push(patch); Object.assign(task, patch);
    }
    return { ok: true, json: async () => String(url) === '/api/projects' ? projects : { ...task } };
  };
  const root = document.createElement('div');
  await render(root, { id: 'task' });
  assert.ok(!findAllByClass(root, 'prop-row').some(r => /来源|事务标签/.test(textOf(r))));
  const owner = findAllByTag(root, 'select').find(s => s.getAttribute('aria-label') === '所属清单');
  owner.value = 'project:topic'; owner.fire('change'); await tick();
  assert.deepEqual(writes, [{ projectId: 'topic', listId: null }]);
  assert.deepEqual(task.source, { type: 'idea', id: 'idea' });
  assert.equal(dailyEntries([task], projects)[0].category, 'temporary');
  assert.equal(findAllByTag(root, 'select').find(s => s.getAttribute('aria-label') === '所属清单').value, 'project:topic');
});

test('仅一个归属筛选，切换和清除能返回正确结果，没有项目/来源/15分钟控件', () => {
  const filters = {};
  const entries = [{ title: '论文', ownerKey: 'project:paper' }, { title: '资料', ownerKey: 'project:files' }, { title: '发票', ownerKey: 'list:work' }];
  let shown = entries;
  const root = buildDailyFilters(filters, () => { shown = filterDailyEntries(entries, filters); });
  const selects = findAllByTag(root, 'select');
  assert.equal(selects.length, 1);
  assert.equal(selects[0].getAttribute('aria-label'), '全部清单');
  assert.ok(!/全部项目|全部来源|15 分钟/.test(textOf(root)));
  selects[0].value = 'list:work'; selects[0].fire('change');
  assert.deepEqual(shown.map(e => e.title), ['发票']);
  findAllByTag(root, 'button').find(b => textOf(b) === '清除筛选').click();
  assert.deepEqual(shown, entries);
  assert.equal(selects[0].value, '');
});

test('生活事务、收集箱和项目用同一选择器，旧任务兼容工作事务', async () => {
  const task = { id: 'task', title: '预约', date: '2026-10-11', source: { type: 'idea', id: 'idea' }, routineTag: 'communication' };
  const writes = [];
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') { const patch = JSON.parse(options.body); writes.push(patch); Object.assign(task, patch); }
    return { ok: true, json: async () => String(url) === '/api/projects' ? projects : { ...task } };
  };
  const root = document.createElement('div');
  await render(root, { id: 'task' });
  const select = () => findAllByTag(root, 'select').find(s => s.getAttribute('aria-label') === '所属清单');
  assert.equal(select().value, 'list:work');
  assert.ok(!textOf(root).includes('事务标签'));
  select().value = 'list:personal'; select().fire('change'); await tick();
  assert.deepEqual(writes.pop(), { projectId: null, listId: 'personal' });
  assert.equal(select().value, 'list:personal');
  const entries = dailyEntries([task], projects);
  assert.equal(entries[0].ownerLabel, '生活事务');
  assert.equal(filterDailyEntries(entries, { owner: 'list:work' }).length, 0);
  assert.equal(task.routineTag, 'communication');
  assert.equal(task.source.id, 'idea');
});
