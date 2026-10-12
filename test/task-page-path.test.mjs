import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { taskBreadcrumb } from '../public/js/task-page.js';
import { render as renderPlan } from '../public/js/views/plan.js';
import { buildBreadcrumb } from '../public/js/views/item.js';
import { itemBase, itemHref } from '../public/js/task-model.js';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
const tick = () => new Promise(r => setTimeout(r, 15));

function dom(t) {
  const original = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
  globalThis.document = makeDocument(); globalThis.location = { hash: '#/task/p/t1/t2/t3/t4/t5' };
  t.after(() => Object.assign(globalThis, original));
}

test('文件夹式路径使用有序导航，上级可点击，当前任务是文档且图标不干扰阅读', t => {
  dom(t);
  const root = taskBreadcrumb([{ label: '今日计划', href: '#/today' }, { label: '父任务', href: '#/task/p/t' }, { label: '整理发票' }]);
  const nav = findAllByTag(root, 'nav')[0]; assert.equal(nav.getAttribute('aria-label'), '任务路径');
  assert.equal(findAllByTag(nav, 'ol').length, 1); assert.equal(findAllByTag(nav, 'li').length, 3);
  assert.deepEqual(findAllByTag(nav, 'a').map(e => e.getAttribute('href')), ['#/today', '#/task/p/t']);
  assert.equal(findAllByClass(nav, 'task-path-folder').length, 2);
  const current = findAllByClass(nav, 'current')[0];
  assert.equal(current.tagName, 'SPAN'); assert.equal(current.getAttribute('aria-current'), 'page');
  assert.equal(current.getAttribute('href'), undefined); assert.equal(textOf(current), '整理发票');
  assert.ok(findAllByClass(nav, 'task-path-icon').every(e => e.getAttribute('aria-hidden') === 'true'));
  assert.ok(findAllByClass(nav, 'task-path-separator').every(e => e.getAttribute('aria-hidden') === 'true'));
});

test('普通事务采用今日计划文件夹和任务名称，长名称完整保留且不注入 HTML', async t => {
  dom(t);
  const title = '整理发票'.repeat(20) + '<img src=x onerror=alert(1)>';
  globalThis.fetch = async url => ({ ok: true, json: async () => url === '/api/projects' ? [] : { id: 'day', title, date: '2026-10-12' } });
  const root = document.createElement('div'); document.body.append(root); await renderPlan(root, { id: 'day' });
  const path = findAllByClass(root, 'task-path-nav')[0];
  assert.equal(findAllByTag(path, 'a')[0].getAttribute('href'), '#/today');
  const current = findAllByClass(path, 'current')[0];
  assert.equal(textOf(findAllByClass(current, 'task-path-name')[0]), title); assert.equal(current.getAttribute('title'), title);
  assert.equal(textOf(findAllByClass(current, 'task-path-kind')[0]), '任务：');
  assert.equal(findAllByTag(current, 'img').length, 0);
  assert.equal(findAllByTag(path, 'button').length, 0, '删除操作与路径导航分开');
  assert.equal(findAllByTag(findAllByClass(root, 'task-path-bar')[0], 'button').length, 1);
});

test('五层路径保留项目图标和所有祖先链接，删除仍确认并返回直接父级', async t => {
  dom(t);
  const project = { id: 'p', name: '研究项目', icon: '🔬' };
  const nodes = Array.from({ length: 5 }, (_, i) => ({ id: `t${i + 1}`, title: `第 ${i + 1} 层任务` }));
  const ids = nodes.map(n => n.id), writes = [];
  globalThis.fetch = async (url, options) => { writes.push({ url, method: options.method }); return { ok: true, json: async () => ({}) }; };
  const root = buildBreadcrumb(project, nodes); document.body.append(root);
  const nav = findAllByTag(root, 'nav')[0];
  assert.equal(findAllByTag(nav, 'li').length, 7);
  assert.deepEqual(findAllByTag(nav, 'a').map(e => e.getAttribute('href')), ['#/projects', '#/page/p', ...ids.slice(0, -1).map((_, i) => itemHref('p', ids.slice(0, i + 1)))]);
  assert.ok(textOf(nav).includes('🔬'));
  const current = findAllByClass(nav, 'current')[0];
  assert.equal(textOf(findAllByClass(current, 'task-path-name')[0]), '第 5 层任务');
  assert.equal(textOf(findAllByClass(current, 'task-path-kind')[0]), '第 5 层：');
  const remove = findAllByTag(root, 'button')[0]; remove.click();
  findAllByTag(document.body, 'button').find(e => textOf(e) === '取消').click(); await tick();
  assert.equal(writes.length, 0);
  remove.click(); findAllByTag(document.body, 'button').find(e => textOf(e) === '确认').click(); await tick();
  assert.deepEqual(writes, [{ url: itemBase('p', ids), method: 'DELETE' }]);
  assert.equal(location.hash, itemHref('p', ids.slice(0, -1)));
});

test('路径标签有文件夹页签、键盘焦点和长名称省略，窄屏可换行而不隐藏祖先', () => {
  const css = readFileSync(new URL('../public/css/task-page.css', import.meta.url), 'utf8');
  assert.match(css, /\.task-path-list \{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.task-path-folder::before \{[^}]*top:-5px/);
  assert.match(css, /\.task-path-name \{[^}]*text-overflow:ellipsis/);
  assert.match(css, /\.task-document \.task-path-node:focus-visible \{[^}]*outline:2px solid var\(--focus-ring\)/);
  assert.match(css, /@media \(max-width:760px\)[\s\S]*\.task-path-nav \{ flex-basis:100%/);
  assert.doesNotMatch(css, /\.task-path-segment[^}]*display:none/);
});

test('文件夹和当前任务标签在两种主题下保持可读', () => {
  const theme = readFileSync(new URL('../public/css/base.css', import.meta.url), 'utf8');
  const rgb = hex => hex.slice(1).match(/../g).map(x => parseInt(x, 16));
  const lum = values => values.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
    .reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
  for (const selector of [':root', '[data-theme="dark"]']) {
    const rule = [...theme.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(m => m[1].trim() === selector)[2];
    const colors = Object.fromEntries([...rule.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map(m => [m[1], rgb(m[2])]));
    const surfaces = [colors['primary-soft'], colors.warning.map((x, i) => x * .09 + colors.panel[i] * .91)];
    for (const surface of surfaces) {
      const a = lum(colors.text), b = lum(surface);
      assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, selector);
    }
  }
});
