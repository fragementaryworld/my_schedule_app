import { test } from 'node:test';
import assert from 'node:assert';
import { renderMarkdown, renderInline } from '../public/js/markdown.js';

test('问题2：行内格式（粗体/斜体/删除线/代码）', () => {
  assert.ok(renderInline('**粗**').includes('<strong>粗</strong>'));
  assert.ok(renderInline('__粗__').includes('<strong>粗</strong>'));
  assert.ok(renderInline('*斜*').includes('<em>斜</em>'));
  assert.ok(renderInline('~~删~~').includes('<del>删</del>'));
  assert.ok(renderInline('`code`').includes('<code>code</code>'));
});

test('问题2：链接只允许 http(s)', () => {
  const ok = renderInline('[站点](https://example.com)');
  assert.ok(ok.includes('<a href="https://example.com"'), '应生成链接');
  assert.ok(ok.includes('>站点</a>'));

  const bad = renderInline('[坏](javascript:alert(1))');
  assert.ok(!bad.includes('<a '), 'javascript: 不应生成链接');
});

test('问题2：安全——HTML 被转义（防 XSS）', () => {
  const html = renderMarkdown('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'), '不应输出原始 script 标签');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('问题2：行内代码里的 markdown 不被解析', () => {
  const html = renderInline('`**not bold**`');
  assert.ok(html.includes('**not bold**'), '代码内容应原样保留');
  assert.ok(!html.includes('<strong>'));
});

test('问题2：块级——标题', () => {
  assert.ok(renderMarkdown('# 一级').includes('<h1>一级</h1>'));
  assert.ok(renderMarkdown('## 二级').includes('<h2>二级</h2>'));
  assert.ok(renderMarkdown('### 三级').includes('<h3>三级</h3>'));
});

test('问题2：块级——无序/有序列表', () => {
  assert.ok(renderMarkdown('- a\n- b').includes('<ul><li>a</li><li>b</li></ul>'));
  assert.ok(renderMarkdown('1. a\n2. b').includes('<ol><li>a</li><li>b</li></ol>'));
});

test('问题2：块级——待办清单', () => {
  const html = renderMarkdown('- [ ] 未完成\n- [x] 已完成');
  assert.ok(html.includes('☐'), '未完成应显示空框');
  assert.ok(html.includes('☑'), '已完成应显示勾选');
  assert.ok(html.includes('md-todo done'));
});

test('问题2：块级——引用与分割线', () => {
  assert.ok(renderMarkdown('> 引用').includes('<blockquote>引用</blockquote>'));
  assert.ok(renderMarkdown('---').includes('<hr>'));
});

test('问题2：段落与换行', () => {
  assert.ok(renderMarkdown('第一行\n第二行').includes('<p>第一行<br>第二行</p>'));
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
});
