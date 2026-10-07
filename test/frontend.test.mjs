import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import apiMod from '../lib/api.js';

const { createApp } = apiMod;

let server;
let base;
let tmpDir;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-test-'));
  server = createApp({ dataFile: path.join(tmpDir, 'data.json') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const NAV_LABELS = ['首页总览', '今日计划', '工作项目', '阅读计划', '健身计划', '待实施灵感', '数据与设置'];
const ASSETS = [
  '/css/base.css', '/css/shell.css', '/css/modules.css',
  '/js/utils.js', '/js/api.js', '/js/ui.js', '/js/app.js',
  '/js/views/home.js', '/js/views/today.js', '/js/views/projects.js',
  '/js/views/reading.js', '/js/views/fitness.js', '/js/views/ideas.js', '/js/views/settings.js'
];

test('首页 HTML 包含 7 个模块导航、路由与容器', async () => {
  const res = await fetch(base + '/');
  const text = await res.text();
  for (const label of NAV_LABELS) assert.ok(text.includes(label), `缺少导航：${label}`);
  for (const route of ['home', 'today', 'projects', 'reading', 'fitness', 'ideas', 'settings']) {
    assert.ok(text.includes(`#/${route}`), `缺少路由：#/${route}`);
  }
  assert.ok(text.includes('id="content"'));
  assert.ok(text.includes('id="fab"'));
});

test('所有前端资源可访问', async () => {
  for (const a of ASSETS) {
    const res = await fetch(base + a);
    assert.equal(res.status, 200, `资源 404：${a}`);
  }
});

test('app.js 可导入且 7 个视图都导出 render/add', async () => {
  const appUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'app.js')).href;
  const app = await import(appUrl);
  const viewNames = Object.keys(app.views);
  assert.equal(viewNames.length, 7);
  for (const name of ['home', 'today', 'projects', 'reading', 'fitness', 'ideas', 'settings']) {
    assert.ok(viewNames.includes(name), `缺少视图：${name}`);
    assert.equal(typeof app.views[name].render, 'function', `${name} 缺少 render`);
    assert.equal(typeof app.views[name].add, 'function', `${name} 缺少 add`);
  }
});
