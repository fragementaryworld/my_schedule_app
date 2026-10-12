import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTaskDocument, taskSection } from '../public/js/task-page.js';
import { h } from '../public/js/ui.js';
import * as item from '../public/js/views/item.js';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';

const tick = () => new Promise(r => setTimeout(r, 20));
const button = (root, label) => findAllByTag(root, 'button').find(e => textOf(e) === label);

function dom(t) {
  const original = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
  globalThis.document = makeDocument(); globalThis.location = { hash: '#/today' };
  t.after(() => Object.assign(globalThis, original));
  const root = document.createElement('div'); document.body.append(root); return root;
}

async function feed(t) {
  const root = dom(t), writes = [];
  const child = { id: 'a', title: '调研任务', desc: '调研内容', subtasks: [{ id: 'leaf', title: '检索文献', desc: '检索内容' }] };
  const sibling = { id: 'b', title: '实验任务', desc: '实验内容', subtasks: [] };
  const parent = { id: 'parent', title: '主任务', desc: '主任务内容', subtasks: [child, sibling] };
  const project = { id: 'p', name: '项目', status: 'active', tasks: [parent] };
  const base = '/api/projects/p/tasks/parent';
  const nodes = new Map([[base, parent], [base + '/subtasks/a', child], [base + '/subtasks/a/subtasks/leaf', child.subtasks[0]], [base + '/subtasks/b', sibling]]);
  let fail = false;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') {
      const patch = JSON.parse(options.body); writes.push({ url, patch });
      if (fail) return { ok: false, json: async () => ({ error: '模拟写盘失败' }) };
      assert.ok(nodes.has(url), `保存必须指向正确层级：${url}`); Object.assign(nodes.get(url), patch);
    }
    return { ok: true, json: async () => [structuredClone(project)] };
  };
  await item.render(root, { id: 'p', chain: ['parent'] });
  button(root, '信息流').click();
  for (let i = 0; i < 100 && !findAllByClass(root, 'task-feed-post').length; i++) await tick();
  const reset = async () => { button(root, '表格').click(); await tick(); };
  return { root, writes, parent, child, reset, fail: value => { fail = value; } };
}

test('任务属性、正文和下级任务有独立标识与标题，普通事务备注使用同一正文分区', t => {
  const root = dom(t);
  for (const title of ['内容', '备注']) {
    const doc = buildTaskDocument({ breadcrumb: h('nav'), heading: h('h1', {}, '任务'), properties: h('div'), label: '任务',
      sections: [taskSection(title, h('div')), taskSection('子任务', h('div'), { children: true, count: 2 })] });
    root.append(doc);
    const zones = findAllByClass(doc, 'task-region');
    assert.equal(zones.length, 3);
    assert.deepEqual(zones.map(e => e.getAttribute('aria-label')), ['任务属性', title, '子任务']);
    assert.ok(zones[0].classList.contains('task-properties-section'));
    assert.ok(zones[1].classList.contains('task-content-section'));
    assert.ok(zones[2].classList.contains('task-children-section'));
    assert.equal(findAllByClass(doc, 'task-section-title').length, 3);
  }
});

test('信息流每张卡有独立的标题、内容与下级区域，主任务正文和深层路径不会混入卡片', async t => {
  const state = await feed(t), root = state.root;
  const contentZone = findAllByClass(root, 'task-content-section')[0];
  assert.match(findAllByClass(contentZone, 'md-content-view')[0].innerHTML, /主任务内容/);
  const childrenZone = findAllByClass(root, 'task-children-section')[0];
  const posts = findAllByClass(childrenZone, 'task-feed-post');
  assert.equal(posts.length, 3); assert.equal(findAllByClass(contentZone, 'task-feed-post').length, 0);
  assert.deepEqual(new Set(posts.map(e => e.dataset.entry)), new Set([
    '/api/projects/p/tasks/parent/subtasks/a', '/api/projects/p/tasks/parent/subtasks/b', '/api/projects/p/tasks/parent/subtasks/a/subtasks/leaf'
  ]));
  for (const post of posts) {
    assert.equal(post.tagName, 'ARTICLE');
    assert.equal(findAllByClass(post, 'task-feed-header').length, 1);
    assert.equal(findAllByClass(post, 'task-feed-content').length, 1);
    assert.equal(findAllByClass(post, 'task-feed-children').length, 1);
    assert.equal(findAllByClass(post, 'feed-goal-md').length, 1);
    assert.equal(findAllByClass(post, 'kanban').length, 1);
  }
  assert.equal(state.writes.length, 0, '切换视图不写入任务内容');
  await state.reset();
});

test('分区后的信息流编辑失败保留文本，重试写入自己的层级且不覆盖主任务内容', async t => {
  const state = await feed(t);
  const post = findAllByClass(state.root, 'task-feed-post').find(e => e.dataset.entry.endsWith('/subtasks/a'));
  findAllByClass(post, 'feed-goal-md')[0].click();
  const edit = findAllByClass(post, 'feed-goal')[0]; edit.textContent = '更新后的调研内容';
  state.fail(true); edit.fire('blur'); await tick();
  assert.equal(edit.style.display, ''); assert.equal(edit.textContent, '更新后的调研内容');
  assert.equal(state.child.desc, '调研内容'); assert.equal(state.parent.desc, '主任务内容');
  state.fail(false); edit.fire('blur');
  for (let i = 0; i < 100 && state.child.desc !== '更新后的调研内容'; i++) await tick();
  await tick();
  assert.equal(state.child.desc, '更新后的调研内容'); assert.equal(state.parent.desc, '主任务内容');
  assert.ok(state.writes.every(e => e.url === '/api/projects/p/tasks/parent/subtasks/a'));
  const updated = findAllByClass(state.root, 'task-feed-post').find(e => e.dataset.entry.endsWith('/subtasks/a'));
  assert.match(findAllByClass(updated, 'feed-goal-md')[0].innerHTML, /更新后的调研内容/);
  await state.reset();
});

test('三种区域的配色在两个主题下互不相同，标签和正文对比度达标', () => {
  const css = readFileSync(new URL('../public/css/task-page.css', import.meta.url), 'utf8');
  const theme = readFileSync(new URL('../public/css/base.css', import.meta.url), 'utf8');
  const accents = [...css.matchAll(/--task-(?:properties|content|children)-accent:(#[0-9a-f]{6})/g)].map(m => m[1]);
  assert.equal(new Set(accents).size, 3);
  const rgb = hex => hex.slice(1).match(/../g).map(x => parseInt(x, 16));
  const mix = (a, b, alpha) => a.map((x, i) => x * alpha + b[i] * (1 - alpha));
  const lum = values => values.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
    .reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
  const alpha = Number(/\.task-document \.task-region \{[^}]*background:color-mix\(in srgb,var\(--region-accent\) (\d+)%/.exec(css)[1]) / 100;
  for (const selector of [':root', '[data-theme="dark"]']) {
    const rule = [...theme.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(m => m[1].trim() === selector)[2];
    const colors = Object.fromEntries([...rule.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map(m => [m[1], rgb(m[2])]));
    const surfaces = accents.map(hex => mix(rgb(hex), colors.panel, alpha));
    assert.equal(new Set(surfaces.map(s => s.map(Math.round).join(','))).size, 3);
    for (const surface of [...surfaces, colors.panel, colors['panel-2']]) {
      const a = lum(colors.text), b = lum(surface);
      assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, selector);
    }
  }
});

test('区域边框、色带和信息流分隔线均有实际样式，区域不裁切日期弹窗', () => {
  const css = readFileSync(new URL('../public/css/task-page.css', import.meta.url), 'utf8');
  const region = /\.task-document \.task-region \{([^}]+)\}/.exec(css)[1];
  assert.match(region, /border:1px solid/); assert.match(region, /border-left:4px solid/);
  assert.doesNotMatch(region, /overflow:\s*(hidden|clip|auto)/);
  assert.match(css, /\.task-children-section \.feed \{[^}]*gap:20px/);
  assert.match(css, /\.task-children-section \.task-feed-header \{[^}]*border-bottom:1px solid/);
  assert.match(css, /\.task-children-section \.task-feed-children \{[^}]*border-top:1px solid/);
  assert.match(css, /@media \(max-width:760px\)[\s\S]*\.task-document \.task-region \{ padding:14px 12px/);
});
