'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../lib/api');
const { todayStr, addDays } = require('../lib/dates');

let server;
let base;
let tmpDir;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-test-'));
  server = createApp({ dataFile: path.join(tmpDir, 'data.json') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function api(method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    /* 非 JSON 响应 */
  }
  return { status: res.status, json };
}

test('静态服务：GET / 返回首页 HTML', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('工作生活专属 App'));
});

test('meta 返回数据文件路径与大小', async () => {
  const { status, json } = await api('GET', '/api/meta');
  assert.equal(status, 200);
  assert.ok(json.filePath.endsWith('data.json'));
  assert.equal(typeof json.sizeBytes, 'number');
});

test('preferences 默认值与更新', async () => {
  const g = await api('GET', '/api/preferences');
  assert.equal(g.status, 200);
  assert.equal(g.json.theme, 'light');
  const put = await api('PUT', '/api/preferences', { theme: 'dark', defaultHome: 'today' });
  assert.equal(put.status, 200);
  assert.equal(put.json.theme, 'dark');
  const g2 = await api('GET', '/api/preferences');
  assert.equal(g2.json.defaultHome, 'today');
});

test('memos 增删改查', async () => {
  const c = await api('POST', '/api/memos', { text: '  记住买牛奶  ' });
  assert.equal(c.status, 201);
  assert.equal(c.json.text, '记住买牛奶');
  const id = c.json.id;

  const upd = await api('PUT', `/api/memos/${id}`, { text: '买鸡蛋' });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.text, '买鸡蛋');

  const list = await api('GET', '/api/memos');
  assert.ok(list.json.some((m) => m.id === id));

  const del = await api('DELETE', `/api/memos/${id}`);
  assert.equal(del.status, 200);
  assert.ok(!(await api('GET', '/api/memos')).json.some((m) => m.id === id));
});

test('memos 空文本被拒绝', async () => {
  const r = await api('POST', '/api/memos', { text: '   ' });
  assert.equal(r.status, 400);
});

test('tasks 新增与按日期查询、时间排序', async () => {
  const today = todayStr();
  const t1 = await api('POST', '/api/tasks', { title: 'A-无时间', date: today, priority: 'low', order: 2 });
  const t2 = await api('POST', '/api/tasks', { title: 'B-九点', date: today, time: '09:00' });
  const t3 = await api('POST', '/api/tasks', { title: 'C-八点', date: today, time: '08:00' });
  assert.equal(t1.status, 201);
  assert.equal(t2.status, 201);
  assert.equal(t3.status, 201);

  const list = (await api('GET', `/api/tasks?date=${today}`)).json;
  const idx = (title) => list.findIndex((t) => t.title === title);
  assert.ok(idx('C-八点') < idx('B-九点'), '有时间按时间升序');
  assert.ok(idx('B-九点') < idx('A-无时间'), '无时间排在有时间之后');
});

test('tasks 无标题或日期非法被拒绝', async () => {
  assert.equal((await api('POST', '/api/tasks', { title: '', date: todayStr() })).status, 400);
  assert.equal((await api('POST', '/api/tasks', { title: 'x', date: 'bad' })).status, 400);
  assert.equal((await api('GET', '/api/tasks?date=bad')).status, 400);
});

test('tasks 每日重复：按需生成当天及过去实例', async () => {
  const start = addDays(todayStr(), -5);
  const c = await api('POST', '/api/tasks', { title: '每日喝水', date: start, repeat: 'daily' });
  assert.equal(c.status, 201);
  const id = c.json.id;

  const todayList = (await api('GET', `/api/tasks?date=${todayStr()}`)).json;
  const instToday = todayList.find((t) => t.repeatOf === id);
  assert.ok(instToday, '今天应有实例');

  const past = addDays(todayStr(), -2);
  const pastList = (await api('GET', `/api/tasks?date=${past}`)).json;
  assert.ok(pastList.find((t) => t.repeatOf === id), '过去日期应有实例');
});

test('tasks 每周重复：仅同星期生成', async () => {
  const start = addDays(todayStr(), -7);
  const c = await api('POST', '/api/tasks', { title: '每周复盘', date: start, repeat: 'weekly' });
  const list = (await api('GET', `/api/tasks?date=${todayStr()}`)).json;
  assert.ok(list.find((t) => t.repeatOf === c.json.id), '同星期应生成实例');
});

test('tasks 自定义间隔（每2天）', async () => {
  const start = addDays(todayStr(), -4);
  const c = await api('POST', '/api/tasks', { title: '隔天锻炼', date: start, repeat: { interval: 2, unit: 'day' } });
  const list = (await api('GET', `/api/tasks?date=${todayStr()}`)).json;
  assert.ok(list.find((t) => t.repeatOf === c.json.id), '相隔4天应生成实例');
});

test('tasks 完成整个系列', async () => {
  const start = addDays(todayStr(), -3);
  const c = await api('POST', '/api/tasks', { title: '系列任务', date: start, repeat: 'daily' });
  const today = todayStr();
  const list = (await api('GET', `/api/tasks?date=${today}`)).json;
  const inst = list.find((t) => t.repeatOf === c.json.id);
  assert.ok(inst);

  const done = await api('PUT', `/api/tasks/${inst.id}`, { done: true, finishSeries: true });
  assert.equal(done.status, 200);
  assert.equal(done.json.done, true);

  const startList = (await api('GET', `/api/tasks?date=${start}`)).json;
  const tmpl = startList.find((t) => t.id === c.json.id);
  assert.equal(tmpl.done, true, '系列模板应标记完成');
});

test('tasks 删除重复模板连带删除实例', async () => {
  const start = addDays(todayStr(), -3);
  const c = await api('POST', '/api/tasks', { title: '待删除系列', date: start, repeat: 'daily' });
  await api('GET', `/api/tasks?date=${todayStr()}`); // 触发实例生成
  const del = await api('DELETE', `/api/tasks/${c.json.id}`);
  assert.equal(del.status, 200);
  const list = (await api('GET', `/api/tasks?date=${todayStr()}`)).json;
  assert.ok(!list.some((t) => t.id === c.json.id || t.repeatOf === c.json.id));
});

test('projects 增删改与任务（含时间、子任务）', async () => {
  const c = await api('POST', '/api/projects', { name: '项目X', goal: '目标', status: 'active' });
  assert.equal(c.status, 201);
  const pid = c.json.id;

  const upd = await api('PUT', `/api/projects/${pid}`, { status: 'paused' });
  assert.equal(upd.json.status, 'paused');

  const pt = await api('POST', `/api/projects/${pid}/tasks`, { title: '任务A', dueDate: '2024-05-01' });
  assert.equal(pt.status, 201);
  assert.equal(pt.json.dueDate, '2024-05-01');

  const ptUpd = await api('PUT', `/api/projects/${pid}/tasks/${pt.json.id}`, { done: true, dueDate: '2024-05-02' });
  assert.equal(ptUpd.json.done, true);
  assert.equal(ptUpd.json.dueDate, '2024-05-02');

  const st = await api('POST', `/api/projects/${pid}/tasks/${pt.json.id}/subtasks`, { title: '子任务' });
  assert.equal(st.status, 201);
  const stUpd = await api('PUT', `/api/projects/${pid}/tasks/${pt.json.id}/subtasks/${st.json.id}`, { done: true });
  assert.equal(stUpd.json.done, true);

  const filtered = await api('GET', '/api/projects?status=paused');
  assert.ok(filtered.json.some((p) => p.id === pid));

  const del = await api('DELETE', `/api/projects/${pid}`);
  assert.equal(del.status, 200);
  assert.ok(!(await api('GET', '/api/projects')).json.some((p) => p.id === pid));
});

test('projects 完成度由任务完成数量计算', async () => {
  const c = await api('POST', '/api/projects', { name: '进度项目' });
  const pid = c.json.id;
  const t1 = await api('POST', `/api/projects/${pid}/tasks`, { title: '任务一' });
  const t2 = await api('POST', `/api/projects/${pid}/tasks`, { title: '任务二' });

  let p = (await api('GET', '/api/projects')).json.find((x) => x.id === pid);
  assert.equal(p.progress, 0, '未完成任务时进度为 0');

  await api('PUT', `/api/projects/${pid}/tasks/${t1.json.id}`, { done: true });
  p = (await api('GET', '/api/projects')).json.find((x) => x.id === pid);
  assert.equal(p.progress, 50, '完成 1/2 任务进度为 50');

  await api('PUT', `/api/projects/${pid}/tasks/${t2.json.id}`, { done: true });
  p = (await api('GET', '/api/projects')).json.find((x) => x.id === pid);
  assert.equal(p.progress, 100, '全部完成进度为 100');
});

test('projects 手动 progress 不再生效（完成度由任务决定）', async () => {
  const c = await api('POST', '/api/projects', { name: '手动进度项目' });
  await api('POST', `/api/projects/${c.json.id}/tasks`, { title: '任务' });
  await api('PUT', `/api/projects/${c.json.id}`, { progress: 90 });
  const p = (await api('GET', '/api/projects')).json.find((x) => x.id === c.json.id);
  assert.equal(p.progress, 0, '手动 progress 应被忽略');
});

test('books 增改、进度、读完记日期、笔记', async () => {
  const c = await api('POST', '/api/books', { title: '一本书', author: '作者', current: 0, total: 300, unit: 'page' });
  assert.equal(c.status, 201);
  const bid = c.json.id;

  const upd = await api('PUT', `/api/books/${bid}`, { current: 150 });
  assert.equal(upd.json.current, 150);

  const done = await api('PUT', `/api/books/${bid}`, { status: 'done' });
  assert.equal(done.json.doneDate, todayStr());

  const n = await api('POST', `/api/books/${bid}/notes`, { excerpt: '摘录', thought: '想法' });
  assert.equal(n.status, 201);
  assert.equal(n.json.excerpt, '摘录');

  const list = await api('GET', '/api/books?status=done');
  assert.ok(list.json.some((b) => b.id === bid && b.notes.length === 1));
});

test('workouts 动作库、周日程、日志、身体数据', async () => {
  const ex = await api('POST', '/api/workouts/exercises', { name: '深蹲', part: '腿', sets: 4, reps: 10, weight: '60kg' });
  assert.equal(ex.status, 201);

  const sch = await api('PUT', '/api/workouts/schedule', { mon: [ex.json.id] });
  assert.equal(sch.status, 200);
  assert.deepEqual(sch.json.mon, [ex.json.id]);

  const log = await api('POST', '/api/workouts/logs', { date: todayStr(), exercises: [{ exerciseId: ex.json.id, sets: 4, reps: 10, weight: '60kg' }], duration: '40分钟', note: '状态不错' });
  assert.equal(log.status, 201);

  const body = await api('POST', '/api/workouts/body', { date: todayStr(), weight: '70', measurements: { 腰围: '80' } });
  assert.equal(body.status, 201);

  const all = await api('GET', '/api/workouts');
  assert.equal(all.json.exercises.length, 1);
  assert.equal(all.json.logs.length, 1);
  assert.equal(all.json.bodyData.length, 1);
  assert.ok(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(all.json.todayKey));
});

test('ideas 增删改、转项目、加计划', async () => {
  const c = await api('POST', '/api/ideas', { title: '做个网站', desc: '描述', tags: ['a', 'b'] });
  assert.equal(c.status, 201);
  const iid = c.json.id;

  const p = await api('POST', `/api/ideas/${iid}/to-project`);
  assert.equal(p.status, 201);
  assert.equal(p.json.sourceIdeaId, iid);
  assert.equal((await api('GET', '/api/ideas')).json.find((i) => i.id === iid).projectId, p.json.id);

  const t = await api('POST', `/api/ideas/${iid}/to-task`, { date: todayStr() });
  assert.equal(t.status, 201);
  assert.equal(t.json.source.type, 'idea');

  const del = await api('DELETE', `/api/ideas/${iid}`);
  assert.equal(del.status, 200);
});

test('backup 导出为 JSON、导入恢复', async () => {
  await api('POST', '/api/memos', { text: '备份前' });
  const res = await fetch(base + '/api/backup/export');
  assert.equal(res.status, 200);
  const backup = await res.json();
  assert.equal(backup.version, 1);

  // 改动后再导入，应恢复到备份内容
  await api('POST', '/api/memos', { text: '备份后新增' });
  const imp = await api('POST', '/api/backup/import', backup);
  assert.equal(imp.status, 200);
  const memos = (await api('GET', '/api/memos')).json;
  assert.ok(memos.some((m) => m.text === '备份前'));
  assert.ok(!memos.some((m) => m.text === '备份后新增'));
});

test('tasks 只完成本次不波及整个系列', async () => {
  const start = addDays(todayStr(), -3);
  const c = await api('POST', '/api/tasks', { title: '只完成本次系列', date: start, repeat: 'daily' });
  const today = todayStr();
  const list = (await api('GET', `/api/tasks?date=${today}`)).json;
  const inst = list.find((t) => t.repeatOf === c.json.id);
  assert.ok(inst);

  const r = await api('PUT', `/api/tasks/${inst.id}`, { done: true });
  assert.equal(r.status, 200);
  assert.equal(r.json.done, true);

  const startList = (await api('GET', `/api/tasks?date=${start}`)).json;
  const tmpl = startList.find((t) => t.id === c.json.id);
  assert.equal(tmpl.done, false, '模板/其他实例不应被标记完成');
});

test('projects 任务与子任务可独立删除', async () => {
  const c = await api('POST', '/api/projects', { name: '独立删除项目' });
  const pid = c.json.id;
  const t = await api('POST', `/api/projects/${pid}/tasks`, { title: '任务A' });
  const st = await api('POST', `/api/projects/${pid}/tasks/${t.json.id}/subtasks`, { title: '子任务A' });

  const delSub = await api('DELETE', `/api/projects/${pid}/tasks/${t.json.id}/subtasks/${st.json.id}`);
  assert.equal(delSub.status, 200);
  const delTask = await api('DELETE', `/api/projects/${pid}/tasks/${t.json.id}`);
  assert.equal(delTask.status, 200);

  const p = (await api('GET', '/api/projects')).json.find((x) => x.id === pid);
  assert.ok(p, '项目本体不应被误删');
  assert.equal(p.tasks.length, 0);
});

test('projects 里程碑接口已移除', async () => {
  const c = await api('POST', '/api/projects', { name: '无里程碑项目' });
  const r = await api('POST', `/api/projects/${c.json.id}/milestones`, { name: '里程碑' });
  assert.equal(r.status, 405, '里程碑接口应已移除');
});

test('页面数据层：图标/父页面/顶层过滤', async () => {
  const parent = await api('POST', '/api/projects', { name: '父页面', icon: '📘' });
  assert.equal(parent.json.icon, '📘');
  assert.equal(parent.json.parentId, null);
  assert.deepEqual(parent.json.blocks, []);

  const child = await api('POST', '/api/projects', { name: '子页面', parentId: parent.json.id });
  assert.equal(child.status, 201);
  assert.equal(child.json.parentId, parent.json.id);

  const roots = (await api('GET', '/api/projects?roots=1')).json;
  assert.ok(roots.some((p) => p.id === parent.json.id), '顶层应含父页面');
  assert.ok(!roots.some((p) => p.id === child.json.id), '顶层不应含子页面');

  const all = (await api('GET', '/api/projects')).json;
  assert.ok(all.some((p) => p.id === child.json.id), '全部列表应含子页面');

  const badParent = await api('POST', '/api/projects', { name: '坏父', parentId: 'not-exist' });
  assert.equal(badParent.status, 400, '父页面不存在应报错');

  const selfParent = await api('PUT', `/api/projects/${parent.json.id}`, { parentId: parent.json.id });
  assert.equal(selfParent.status, 400, '父页面不能是自己');
});

test('页面删除：连同子页面一起删除', async () => {
  const parent = await api('POST', '/api/projects', { name: '待删父页' });
  const child = await api('POST', '/api/projects', { name: '待删子页', parentId: parent.json.id });
  const grand = await api('POST', '/api/projects', { name: '待删孙页', parentId: child.json.id });
  const keep = await api('POST', '/api/projects', { name: '保留页' });

  const del = await api('DELETE', `/api/projects/${parent.json.id}`);
  assert.equal(del.status, 200);
  assert.equal(del.json.deleted, 3, '应删除父+子+孙共 3 个');

  const all = (await api('GET', '/api/projects')).json;
  for (const gone of [parent.json.id, child.json.id, grand.json.id]) {
    assert.ok(!all.some((p) => p.id === gone), '子孙页面应被删除');
  }
  assert.ok(all.some((p) => p.id === keep.json.id), '无关页面应保留');
});

test('任务支持描述字段', async () => {
  const p = await api('POST', '/api/projects', { name: '描述项目' });
  const pid = p.json.id;
  const t = await api('POST', `/api/projects/${pid}/tasks`, { title: '任务', desc: '任务描述' });
  assert.equal(t.json.desc, '任务描述');

  const upd = await api('PUT', `/api/projects/${pid}/tasks/${t.json.id}`, { desc: '改后的描述' });
  assert.equal(upd.json.desc, '改后的描述');

  const task = (await api('GET', '/api/projects')).json.find((x) => x.id === pid).tasks.find((x) => x.id === t.json.id);
  assert.equal(task.desc, '改后的描述');
});

test('任务支持开始/截止时间区间', async () => {
  const p = await api('POST', '/api/projects', { name: '时间区间项目' });
  const pid = p.json.id;
  const t = await api('POST', `/api/projects/${pid}/tasks`, { title: '区间任务', startDate: '2024-05-01', dueDate: '2024-05-10' });
  assert.equal(t.json.startDate, '2024-05-01');
  assert.equal(t.json.dueDate, '2024-05-10');

  const upd = await api('PUT', `/api/projects/${pid}/tasks/${t.json.id}`, { startDate: '2024-05-03' });
  assert.equal(upd.json.startDate, '2024-05-03');

  const task = (await api('GET', '/api/projects')).json.find((x) => x.id === pid).tasks.find((x) => x.id === t.json.id);
  assert.equal(task.startDate, '2024-05-03');
  assert.equal(task.dueDate, '2024-05-10');
});

test('任务内容块：增删改与排序', async () => {
  const p = await api('POST', '/api/projects', { name: '块任务项目' });
  const pid = p.json.id;
  const t = await api('POST', `/api/projects/${pid}/tasks`, { title: '任务' });
  const tid = t.json.id;
  assert.deepEqual(t.json.blocks, [], '任务应带空的 blocks');

  const base = `/api/projects/${pid}/tasks/${tid}/blocks`;
  const b1 = await api('POST', base, { type: 'h1', text: '标题' });
  assert.equal(b1.status, 201);
  const b2 = await api('POST', base, { type: 'text', text: '正文', afterId: b1.json.id });

  let task = (await api('GET', '/api/projects')).json.find((x) => x.id === pid).tasks.find((x) => x.id === tid);
  assert.deepEqual(task.blocks.map((x) => x.id), [b1.json.id, b2.json.id]);

  const upd = await api('PUT', `${base}/${b2.json.id}`, { text: '改' });
  assert.equal(upd.json.text, '改');

  const reorder = await api('PUT', base, { order: [b2.json.id, b1.json.id] });
  assert.deepEqual(reorder.json.map((x) => x.id), [b2.json.id, b1.json.id]);

  const del = await api('DELETE', `${base}/${b1.json.id}`);
  assert.equal(del.status, 200);
  task = (await api('GET', '/api/projects')).json.find((x) => x.id === pid).tasks.find((x) => x.id === tid);
  assert.deepEqual(task.blocks.map((x) => x.id), [b2.json.id]);

  const missing = await api('POST', `/api/projects/${pid}/tasks/nope/blocks`, { type: 'text' });
  assert.equal(missing.status, 404, '任务不存在应报 404');
});

test('页面封面：创建与更新', async () => {  const c = await api('POST', '/api/projects', { name: '封面页', cover: 'blue' });
  assert.equal(c.json.cover, 'blue');
  const upd = await api('PUT', `/api/projects/${c.json.id}`, { cover: 'green' });
  assert.equal(upd.json.cover, 'green');
  const p = (await api('GET', '/api/projects')).json.find((x) => x.id === c.json.id);
  assert.equal(p.cover, 'green');
});

test('页面内容块：增删改与排序', async () => {  const c = await api('POST', '/api/projects', { name: '有内容的页面' });
  const pid = c.json.id;

  const b1 = await api('POST', `/api/projects/${pid}/blocks`, { type: 'h1', text: '标题' });
  assert.equal(b1.status, 201);
  assert.equal(b1.json.type, 'h1');
  const b2 = await api('POST', `/api/projects/${pid}/blocks`, { type: 'text', text: '正文', afterId: b1.json.id });
  assert.equal(b2.status, 201);
  const b3 = await api('POST', `/api/projects/${pid}/blocks`, { type: 'todo', text: '待办' });
  assert.equal(b3.json.checked, false);

  let p = (await api('GET', '/api/projects')).json.find((x) => x.id === pid);
  assert.deepEqual(p.blocks.map((x) => x.id), [b1.json.id, b2.json.id, b3.json.id], 'afterId 应插到其后');

  const upd = await api('PUT', `/api/projects/${pid}/blocks/${b3.json.id}`, { checked: true, text: '待办2' });
  assert.equal(upd.json.checked, true);
  assert.equal(upd.json.text, '待办2');

  const invalidType = await api('POST', `/api/projects/${pid}/blocks`, { type: 'nope', text: 'x' });
  assert.equal(invalidType.json.type, 'text', '非法类型回退为 text');

  const reorder = await api('PUT', `/api/projects/${pid}/blocks`, { order: [b3.json.id, b1.json.id, b2.json.id] });
  assert.deepEqual(reorder.json.map((x) => x.id), [b3.json.id, b1.json.id, b2.json.id]);

  const del = await api('DELETE', `/api/projects/${pid}/blocks/${b1.json.id}`);
  assert.equal(del.status, 200);
  p = (await api('GET', '/api/projects')).json.find((x) => x.id === pid);
  assert.deepEqual(p.blocks.map((x) => x.id), [b3.json.id, b2.json.id]);
});

test('projects 支持优先级/负责人/阻塞字段', async () => {
  const c = await api('POST', '/api/projects', { name: '字段项目', priority: 'high', owner: 'jun', blockedBy: '等待审批' });
  assert.equal(c.status, 201);
  assert.equal(c.json.priority, 'high');
  assert.equal(c.json.owner, 'jun');
  assert.equal(c.json.blockedBy, '等待审批');

  const upd = await api('PUT', `/api/projects/${c.json.id}`, { priority: 'low', blockedBy: '' });
  assert.equal(upd.json.priority, 'low');
  assert.equal(upd.json.blockedBy, '');

  const p = (await api('GET', '/api/projects')).json.find((x) => x.id === c.json.id);
  assert.equal(p.priority, 'low');
  assert.equal(p.owner, 'jun');
});

test('books 笔记可独立编辑与删除', async () => {
  const c = await api('POST', '/api/books', { title: '笔记独立书' });
  const bid = c.json.id;
  const n = await api('POST', `/api/books/${bid}/notes`, { excerpt: '原', thought: '原' });

  const upd = await api('PUT', `/api/books/${bid}/notes/${n.json.id}`, { thought: '改' });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.thought, '改');

  const del = await api('DELETE', `/api/books/${bid}/notes/${n.json.id}`);
  assert.equal(del.status, 200);

  const b = (await api('GET', '/api/books')).json.find((x) => x.id === bid);
  assert.ok(b, '书本体不应被误删');
  assert.equal(b.notes.length, 0);
});

test('未知 API 返回 404', async () => {
  const r = await api('GET', '/api/not-exist');
  assert.equal(r.status, 404);
});
