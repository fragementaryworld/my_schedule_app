import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { itemBase, itemHref, timelineColor, TIMELINE_COLORS } from '../public/js/task-model.js';
import * as projectView from '../public/js/views/projects.js';
const require = createRequire(import.meta.url);
const { apiFixture } = require('../test-helpers/api-fixture');

test('纯任务模型生成的深层路径可由真实 API 解析，详情链接保留层级', async t => {
  const { request } = await apiFixture(t);
  const project = (await request('POST', '/api/projects', { name: '路径测试' })).body;
  const task = (await request('POST', `/api/projects/${project.id}/tasks`, { title: '父任务' })).body;
  const child = (await request('POST', itemBase(project.id, [task.id]) + '/subtasks', { title: '子任务' })).body;
  const path = [task.id, child.id];
  assert.equal((await request('GET', itemBase(project.id, path))).body.id, child.id);
  assert.equal(itemHref(project.id, path), `#/task/${project.id}/${task.id}/${child.id}`);
  assert.equal(projectView.itemBase, itemBase);
  assert.equal(projectView.timelineColor, timelineColor);
});

test('项目配色由稳定 id 决定，列表重排不改变颜色', () => {
  const ids = ['project-a', 'project-b', '中文项目'];
  const original = new Map(ids.map(id => [id, timelineColor(id)]));
  for (const id of ids.reverse()) {
    assert.equal(timelineColor(id), original.get(id));
    assert.ok(TIMELINE_COLORS.includes(timelineColor(id)));
  }
});

test('日历与每日任务模型不再依赖任何视图模块', () => {
  for (const module of ['calendar', 'daily', 'task-model']) {
    const source = fs.readFileSync(new URL(`../public/js/${module}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"][^'"]*views\//);
  }
});
