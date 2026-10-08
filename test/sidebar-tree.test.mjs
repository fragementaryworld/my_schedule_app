import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

test('问题3：左下角页面树已移除', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(!html.includes('pageTree'), 'index.html 不应再有页面树容器');
  assert.ok(!fs.existsSync(path.join(ROOT, 'public', 'js', 'sidebar.js')), 'sidebar.js 应已删除');

  const app = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  assert.ok(!app.includes("./sidebar.js"), 'app.js 不应再引用 sidebar 模块');
  assert.ok(!app.includes('renderPageTree'), 'app.js 不应再调用页面树渲染');

  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'modules.css'), 'utf8');
  assert.ok(!css.includes('.page-tree'), 'CSS 不应再有页面树样式');
  assert.ok(!css.includes('.tree-link'), 'CSS 不应再有树链接样式');
});
