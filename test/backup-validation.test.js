'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { apiFixture } = require('../test-helpers/api-fixture');
const { defaultData } = require('../store');

test('任意 JSON、未知版本及损坏的嵌套备份均拒绝，内存和数据文件不变', async t => {
  const { server, file, request } = await apiFixture(t);
  await request('POST', '/api/memos', { text: '保留的数据' });
  const before = server.store.snapshot();
  for (const body of [
    {}, { unrelated: 'value' }, { version: 1 }, { ...defaultData(), version: 2 },
    { ...defaultData(), tasks: [null] }, { ...defaultData(), memos: '错误数组' },
    { ...defaultData(), projects: [{ id: 'p', name: '项目', tasks: [{ id: 't', title: '任务', subtasks: {} }] }] },
    { ...defaultData(), books: [{ id: 'b', title: '书', notes: [null] }] },
    { ...defaultData(), tasks: [{ id: 'duplicate', title: 'A' }, { id: 'duplicate', title: 'B' }] }
  ]) {
    assert.equal((await request('POST', '/api/backup/import', body)).status, 400);
    assert.equal(server.store.snapshot(), before);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
});

test('合法旧备份在导入时立即迁移，不需重启；重复导入不重复合并内容', async t => {
  const { request } = await apiFixture(t);
  const legacy = {
    tasks: [], projects: [{ id: 'p', name: '旧项目', dateFormat: 'full', desc: '已有说明',
      blocks: [{ id: 'block', type: 'text', text: '旧内容' }],
      tasks: [{ id: 't', title: '旧任务', blocks: [{ id: 'tb', type: 'h1', text: '旧标题' }] }] }],
    extraField: { retained: true }
  };
  assert.equal((await request('POST', '/api/backup/import', legacy)).status, 200);
  const project = (await request('GET', '/api/projects')).body[0];
  assert.equal(project.dateFormat, 'ymd');
  assert.equal(project.desc, '已有说明\n\n旧内容');
  assert.equal(project.tasks[0].desc, '# 旧标题');
  const backup = (await request('GET', '/api/backup/export')).body;
  assert.equal(backup.extraField.retained, true);
  assert.equal((await request('POST', '/api/backup/import', backup)).status, 200);
  assert.equal((await request('GET', '/api/projects')).body[0].desc, project.desc);
});

test('当前完整备份包含日志、笔记和扩展字段时可以无损往返', async t => {
  const { request } = await apiFixture(t);
  const backup = defaultData();
  backup.books.push({ id: 'b', title: '书', notes: [{ id: 'n', content: '笔记' }] });
  backup.workouts.logs.push({ id: 'l', exercises: [{ exerciseId: 'missing', sets: 2 }], note: '历史' });
  backup.tasks.push({ id: 't', title: '任务', repeatSkippedDates: ['2026-10-01'], note: '备注' });
  assert.equal((await request('POST', '/api/backup/import', backup)).status, 200);
  const exported = (await request('GET', '/api/backup/export')).body;
  assert.deepEqual(exported.books, backup.books);
  assert.deepEqual(exported.workouts, backup.workouts);
  assert.deepEqual(exported.tasks, backup.tasks);
});
