import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const CSS_DIR = path.join(process.cwd(), 'public', 'css');
const FILES = ['base.css', 'shell.css', 'modules.css'];

test('问题3：CSS 文件存在且大括号配对（无语法错误）', () => {
  for (const f of FILES) {
    const text = fs.readFileSync(path.join(CSS_DIR, f), 'utf8');
    const open = (text.match(/\{/g) || []).length;
    const close = (text.match(/\}/g) || []).length;
    assert.equal(open, close, `${f} 大括号不配对：{=${open} }=${close}`);
  }
});

test('问题3：四个展示视图的美化样式存在（圆角/阴影/悬浮）', () => {
  const text = fs.readFileSync(path.join(CSS_DIR, 'modules.css'), 'utf8');
  for (const sel of ['.toolbar .tabbar', '.project-table', '.kanban-col', '.kanban-card', '.timeline-bar', '.feed-post']) {
    assert.ok(text.includes(sel), `缺少样式：${sel}`);
  }
  assert.ok(text.includes('border-radius'), '应有圆角美化');
  assert.ok(text.includes('box-shadow'), '应有阴影美化');
});
