'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../lib/api');
const { todayStr, addDays } = require('../lib/dates');
let server, base, dir, file;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-organization-'));
  file = path.join(dir, 'data.json');
  server = createApp({ dataFile: file });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
async function call(method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}
test('临时专题与日常标签持久化，任务归属切换保留灵感出处', async () => {
  const p = (await call('POST', '/api/projects', { name: '文件整理', category: 'temporary' })).data;
  const idea = (await call('POST', '/api/ideas', { title: '整理资料' })).data;
  const t = (await call('POST', `/api/ideas/${idea.id}/to-task`, { projectId: p.id, date: todayStr() })).data;
  assert.equal(t.projectId, p.id);
  assert.deepEqual(t.source, { type: 'idea', id: idea.id });
  const changed = await call('PUT', `/api/tasks/${t.id}`, { projectId: null, routineTag: 'organizing' });
  assert.equal(changed.data.projectId, null);
  assert.equal(changed.data.routineTag, 'organizing');
  assert.deepEqual(changed.data.source, t.source);
  const reopened = createApp({ dataFile: file });
  assert.equal(reopened.store.get().projects.find(x => x.id === p.id).category, 'temporary');
  assert.equal(reopened.store.get().tasks.find(x => x.id === t.id).routineTag, 'organizing');
});
test('任意层级加入当天后日期保持原样，移出不会复制或删除任务', async () => {
  const p = (await call('POST', '/api/projects', { name: '论文' })).data;
  const parent = (await call('POST', `/api/projects/${p.id}/tasks`, { title: '修改论文' })).data;
  const url = `/api/projects/${p.id}/tasks/${parent.id}/subtasks`;
  const due = addDays(todayStr(), 10);
  const child = (await call('POST', url, { title: '图表', dueDate: due })).data;
  const target = `${url}/${child.id}`;
  assert.equal((await call('PUT', target, { planDate: todayStr() })).data.dueDate, due);
  assert.equal((await call('GET', target)).data.planDate, todayStr());
  assert.equal((await call('PUT', target, { planDate: null })).data.planDate, null);
  assert.equal(server.store.get().projects.find(x => x.id === p.id).tasks[0].subtasks.length, 1);
  assert.equal((await call('GET', target)).data.dueDate, due);
});
test('新字段的非法输入被拒绝，不会先修改其他字段', async () => {
  const p = (await call('POST', '/api/projects', { name: '原项目' })).data;
  const t = (await call('POST', '/api/tasks', { title: '原任务', date: todayStr() })).data;
  for (const body of [{ projectId: 'missing' }, { routineTag: 'bad' }, { planDate: '2026-02-30' }]) {
    assert.equal((await call('PUT', `/api/tasks/${t.id}`, { title: '错误修改', ...body })).status, 400);
    assert.equal((await call('GET', `/api/tasks/${t.id}`)).data.title, '原任务');
  }
  assert.equal((await call('PUT', `/api/projects/${p.id}`, { name: '错误修改', category: 'bad' })).status, 400);
  assert.equal((await call('GET', '/api/projects')).data.find(x => x.id === p.id).name, '原项目');
  const item = (await call('POST', `/api/projects/${p.id}/tasks`, { title: '原子任务' })).data;
  const url = `/api/projects/${p.id}/tasks/${item.id}`;
  assert.equal((await call('PUT', url, { title: '错误修改', planDate: '' })).status, 400);
  assert.equal((await call('GET', url)).data.title, '原子任务');
  assert.equal((await call('POST', '/api/projects', { name: '新项目', category: 'bad' })).status, 400);
  assert.equal((await call('POST', '/api/tasks', { title: '任务', date: todayStr(), projectId: 'missing' })).status, 400);
});
test('重复任务继承归属/事务标签/来源，显式当天安排可在日期区间查到', async () => {
  const p = (await call('POST', '/api/projects', { name: '工作' })).data;
  const yesterday = addDays(todayStr(), -1);
  const task = (await call('POST', '/api/tasks', { title: '回复消息', date: yesterday, repeat: 'daily', projectId: p.id, routineTag: 'communication', source: { type: 'idea', id: 'idea1' } })).data;
  const instance = (await call('GET', `/api/tasks?date=${todayStr()}`)).data.find(x => x.repeatOf === task.id);
  assert.equal(instance.projectId, p.id);
  assert.equal(instance.routineTag, 'communication');
  assert.deepEqual(instance.source, task.source);
  const span = (await call('POST', '/api/tasks', { title: '旧计划', date: yesterday, planDate: todayStr() })).data;
  const list = (await call('GET', `/api/tasks?from=${todayStr()}&to=${todayStr()}`)).data;
  assert.ok(list.some(x => x.id === span.id));
});
test('灵感可转换为临时专题并保留来源，旧项目按工作项目兼容', async () => {
  const idea = (await call('POST', '/api/ideas', { title: '文献调研' })).data;
  const converted = (await call('POST', `/api/ideas/${idea.id}/to-project`, { category: 'temporary' })).data;
  assert.equal(converted.category, 'temporary');
  assert.equal(converted.sourceIdeaId, idea.id);
  assert.equal((await call('POST', '/api/projects', { name: '默认项目' })).data.category, 'work');
});

test('所属清单可保存并重开，项目与清单切换只有一个归属', async () => {
  const p = (await call('POST', '/api/projects', { name: '研究' })).data;
  const t = (await call('POST', '/api/tasks', { title: '预约', date: todayStr(), listId: 'personal' })).data;
  assert.equal(t.listId, 'personal');
  const url = `/api/tasks/${t.id}`;
  const project = (await call('PUT', url, { projectId: p.id })).data;
  assert.equal(project.listId, null);
  const work = (await call('PUT', url, { listId: 'work' })).data;
  assert.equal(work.projectId, null);
  assert.equal(work.listId, 'work');
  const reopened = createApp({ dataFile: file });
  assert.equal(reopened.store.get().tasks.find(x => x.id === t.id).listId, 'work');
  for (const patch of [{ listId: 'bad' }, { projectId: p.id, listId: 'personal' }]) {
    assert.equal((await call('PUT', url, { title: '不应修改', ...patch })).status, 400);
    assert.equal((await call('GET', url)).data.title, '预约');
  }
});

test('新任务默认收集箱，灵感和重复任务保留所属清单', async () => {
  const t = (await call('POST', '/api/tasks', { title: '随手记录', date: todayStr() })).data;
  assert.equal(t.listId, 'inbox');
  const idea = (await call('POST', '/api/ideas', { title: '个人计划' })).data;
  const converted = (await call('POST', `/api/ideas/${idea.id}/to-task`, { listId: 'personal' })).data;
  assert.equal(converted.listId, 'personal');
  assert.equal(converted.source.id, idea.id);
  const recurring = (await call('POST', '/api/tasks', { title: '买菜', date: addDays(todayStr(), -1), repeat: 'daily', listId: 'personal' })).data;
  const instance = (await call('GET', `/api/tasks?date=${todayStr()}`)).data.find(x => x.repeatOf === recurring.id);
  assert.equal(instance.listId, 'personal');
});
