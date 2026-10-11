import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, textOf, findAllByTag } from '../test-helpers/dom-shim.mjs';
import * as home from '../public/js/views/home.js';
import * as reading from '../public/js/views/reading.js';
import * as item from '../public/js/views/item.js';
import * as ideas from '../public/js/views/ideas.js';
import * as today from '../public/js/views/today.js';
import { todayStr } from '../public/js/utils.js';

const literal = 'A & B <img src=x onerror=alert(1)> "标题"';
function setup() {
  globalThis.document = makeDocument();
  globalThis.location = { hash: '#/home' };
  const project = { id: 'p', name: literal, status: 'active', tasks: [{ id: 't', title: literal, dueDate: todayStr(), subtasks: [] }] };
  globalThis.fetch = async url => {
    let data = [];
    if (url === '/api/projects') data = [project];
    else if (url === '/api/books') data = [{ id: 'b', title: literal, status: 'reading', notes: [{ id: 'n', excerpt: literal, thought: literal, createdAt: '2026-10-11T00:00:00Z' }] }];
    else if (url.startsWith('/api/tasks')) data = [{ id: 'd', title: literal, date: todayStr(), done: false }];
    else if (url === '/api/memos') data = [{ id: 'm', text: literal }];
    else if (url === '/api/ideas') data = [{ id: 'i', title: literal, desc: literal, status: 'idea', tags: [literal] }];
    else if (url === '/api/workouts') data = { exercises: [], schedule: {}, logs: [] };
    else if (url === '/api/preferences') data = { weekStart: 'mon' };
    return { ok: true, json: async () => data };
  };
  const container = document.createElement('div'); document.body.append(container);
  return container;
}

for (const [name, view, params] of [
  ['首页标题与备忘', home, {}], ['书籍标题与笔记', reading, { id: 'b' }],
  ['项目任务面包屑', item, { id: 'p', chain: ['t'] }],
  ['灵感标题与标签', ideas, {}], ['日历和每日看板', today, {}]
]) {
  test(`${name}按原文显示特殊字符，用户文本不会创建 HTML 元素`, async () => {
    const container = setup();
    await view.render(container, params);
    const text = textOf(container);
    assert.ok(text.includes(literal), text);
    assert.equal(text.includes('&amp;'), false);
    assert.equal(text.includes('&lt;img'), false);
    assert.equal(findAllByTag(container, 'img').length, 0);
    assert.equal(findAllByTag(container, 'script').length, 0);
  });
}

test('旧书籍笔记缺失时间戳时仍能阅读，显示未记录日期', async () => {
  const container = setup();
  globalThis.fetch = async () => ({ ok: true, json: async () => [
    { id: 'b', title: '旧书', status: 'reading', notes: [{ id: 'n', thought: '保留的历史笔记' }] }
  ] });
  await reading.render(container, { id: 'b' });
  assert.ok(textOf(container).includes('保留的历史笔记'));
  assert.ok(textOf(container).includes('未记录日期'));
});
