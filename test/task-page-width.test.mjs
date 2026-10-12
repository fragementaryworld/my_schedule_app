import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { navigate } from '../public/js/app.js';
import { makeDocument, findAllByClass } from '../test-helpers/dom-shim.mjs';

test('任务详情铺满内容画布，宽屏和窄屏均不恢复固定宽度、外框或圆角', () => {
  const css = readFileSync(new URL('../public/css/task-page.css', import.meta.url), 'utf8');
  const canvas = /#content:has\(> \.task-document\) \{([^}]+)\}/.exec(css)[1];
  assert.match(canvas, /padding:0/); assert.match(canvas, /background:var\(--panel\)/);
  const rules = [...css.matchAll(/(?:^|\n)\s*\.task-document \{([^}]+)\}/g)].map(m => m[1]);
  const main = rules[0];
  for (const declaration of ['width:100%', 'max-width:none', 'margin:0', 'border:0', 'border-radius:0', 'min-height:100%']) assert.ok(main.includes(declaration), declaration);
  for (const rule of rules) {
    assert.doesNotMatch(rule, /max-width:\s*\d+px|min-height:\s*\d+px|border-radius:\s*[1-9]/);
  }
  assert.doesNotMatch(css, /(?:^|\n)#content\s*\{/,'全宽样式只针对任务详情');
});

test('导航在普通事务、项目任务和首页之间切换，只有任务详情拥有全宽触发节点', async t => {
  const original = { document: globalThis.document, window: globalThis.window, location: globalThis.location, fetch: globalThis.fetch };
  globalThis.document = makeDocument(); globalThis.window = { scrollTo() {} }; globalThis.location = { hash: '#/plan/day' };
  t.after(() => Object.assign(globalThis, original));
  for (const id of ['content', 'pageTitle']) { const element = document.createElement('div'); element.id = id; document.body.append(element); }
  const task = { id: 'day', title: '整理发票', date: '2026-10-12' };
  const project = { id: 'p', name: '项目', status: 'active', tasks: [{ id: 'task', title: '文献调研', subtasks: [] }] };
  globalThis.fetch = async url => ({ ok: true, json: async () => {
    if (url === '/api/tasks/day') return task;
    if (url === '/api/projects') return [project];
    if (url === '/api/preferences') return {};
    if (url === '/api/workouts') return {};
    return [];
  } });
  for (const hash of ['#/plan/day', '#/home', '#/task/p/task', '#/home']) {
    location.hash = hash; await navigate();
    const content = document.getElementById('content');
    const tasks = findAllByClass(content, 'task-document');
    assert.equal(tasks.length, hash === '#/home' ? 0 : 1);
    if (tasks.length) assert.equal(tasks[0].parentNode, content, '任务文档直接占据内容容器');
    else assert.equal(findAllByClass(content, 'home-grid').length, 1);
  }
});
