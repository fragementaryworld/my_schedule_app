import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { migrateDateFormats, FLAG } = require('../lib/migrate.js');
const { Store } = require('../store.js');

const nodeFetch = globalThis.fetch;

function fakeStore(data) {
  return { get: () => data };
}

function legacyData() {
  return {
    projects: [
      {
        id: 'p1', name: '项目', dateFormat: 'full',
        tasks: [
          { id: 't1', title: '任务', dateFormat: 'full', subtasks: [
            { id: 's1', title: '子任务', dateFormat: 'full', subtasks: [
              { id: 's2', title: '孙任务', dateFormat: 'full', subtasks: [] }
            ] },
            { id: 's3', title: '明确选过短日期', dateFormat: 'short', subtasks: [] }
          ] }
        ]
      },
      { id: 'p2', name: '项目2', dateFormat: 'iso', tasks: [] },
      { id: 'p3', name: '项目3', tasks: [] }
    ],
    tasks: [
      { id: 'd1', title: '每日任务', date: '2024-05-10', dateFormat: 'full' },
      { id: 'd2', title: '每日任务2', date: '2024-05-11', dateFormat: 'relative' },
      { id: 'd3', title: '没有格式的每日任务', date: '2024-05-12' }
    ]
  };
}

test('问题1：迁移把项目/任务/各级子任务的「完整日期」改成「年/月/日」', () => {
  const data = legacyData();
  const r = migrateDateFormats(fakeStore(data));
  assert.equal(r.changed, true);
  assert.equal(r.count, 5, '项目 + 任务 + 两层子任务 + 每日任务');

  assert.equal(data.projects[0].dateFormat, 'ymd');
  assert.equal(data.projects[0].tasks[0].dateFormat, 'ymd');
  assert.equal(data.projects[0].tasks[0].subtasks[0].dateFormat, 'ymd');
  assert.equal(data.projects[0].tasks[0].subtasks[0].subtasks[0].dateFormat, 'ymd', '第 3 层也要改');
  assert.equal(data.tasks[0].dateFormat, 'ymd');
});

test('问题1：用户明确选过的其它格式不动', () => {
  const data = legacyData();
  migrateDateFormats(fakeStore(data));
  assert.equal(data.projects[0].tasks[0].subtasks[0].subtasks[0].dateFormat, 'ymd');
  assert.equal(data.projects[0].tasks[0].subtasks[1].dateFormat, 'short', 'short 保持');
  assert.equal(data.projects[1].dateFormat, 'iso', 'iso 保持');
  assert.equal(data.tasks[1].dateFormat, 'relative', 'relative 保持');
  assert.equal(data.tasks[2].dateFormat, undefined, '原本没设置的不去写值');
  assert.equal(data.projects[2].dateFormat, undefined);
});

test('问题1：迁移只做一次，打过标记就不再改', () => {
  const data = legacyData();
  migrateDateFormats(fakeStore(data));
  assert.equal(data.migrations[FLAG], true, '要留下标记');

  // 用户之后主动选回「完整日期」
  data.tasks[0].dateFormat = 'full';
  const again = migrateDateFormats(fakeStore(data));
  assert.equal(again.changed, false, '第二次不再迁移');
  assert.equal(again.count, 0);
  assert.equal(data.tasks[0].dateFormat, 'full', '用户的选择不会被撤销');
});

test('问题1：空数据/缺字段也安全', () => {
  assert.deepEqual(migrateDateFormats(fakeStore({})).changed, true, '空库也标记完成');
  assert.deepEqual(migrateDateFormats(fakeStore({ projects: null, tasks: null })).count, 0);
  const r = migrateDateFormats(fakeStore({ projects: [{ id: 'x' }] }));
  assert.equal(r.count, 0);
});

// ——— 真实启动流程 ———

function tmpDataFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-mig-'));
  return path.join(dir, 'data.json');
}

async function withServer(dataFile, fn) {
  const { createApp } = require('../lib/api.js');
  const app = createApp({ dataFile });
  await new Promise((r) => app.listen(0, r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = async (method, url, body) => {
    const res = await nodeFetch(`${base}${url}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  try {
    return await fn(call, app);
  } finally {
    await new Promise((r) => app.close(r));
  }
}

test('问题1：启动时自动迁移老数据，之后新选的格式不会被再次改掉', async () => {
  const dataFile = tmpDataFile();
  const store = new Store(dataFile);
  store.load();
  const data = store.get();
  data.projects = [{
    id: 'p1', name: '老项目', dateFormat: 'full',
    tasks: [{ id: 't1', title: '老任务', done: false, dateFormat: 'full', subtasks: [] }]
  }];
  data.tasks = [{ id: 'd1', title: '老每日任务', date: '2024-05-10', dateFormat: 'full' }];
  store.save();

  await withServer(dataFile, async (call) => {
    const projects = await call('GET', '/api/projects');
    assert.equal(projects.json[0].dateFormat, 'ymd', '项目已迁移');
    assert.equal(projects.json[0].tasks[0].dateFormat, 'ymd', '任务已迁移');
    const tasks = await call('GET', '/api/tasks?from=2024-05-10&to=2024-05-10');
    assert.equal(tasks.json[0].dateFormat, 'ymd', '每日任务已迁移');

    // 用户明确改成完整日期
    assert.equal((await call('PUT', '/api/tasks/d1', { dateFormat: 'full' })).json.dateFormat, 'full');
  });

  // 重启：不应把用户选的 full 又改回 ymd
  await withServer(dataFile, async (call) => {
    const tasks = await call('GET', '/api/tasks?from=2024-05-10&to=2024-05-10');
    assert.equal(tasks.json[0].dateFormat, 'full', '重启后仍是用户选择');
  });

  const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.equal(saved.migrations[FLAG], true, '标记落盘');
});
