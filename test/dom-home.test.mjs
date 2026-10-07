import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { Element, makeDocument } from '../test-helpers/dom-shim.mjs';

// 安装极简 DOM 与 fetch 模拟
const document = makeDocument();
globalThis.document = document;

globalThis.fetch = async (url) => {
  const u = String(url);
  let data;
  if (u.includes('/api/preferences')) data = { theme: 'light', weekStart: 'mon', defaultHome: 'home' };
  else if (u.includes('/api/tasks')) data = [];
  else if (u.includes('/api/memos')) data = [];
  else if (u.includes('/api/projects')) data = [];
  else if (u.includes('/api/books')) data = [];
  else if (u.includes('/api/workouts')) data = { exercises: [], schedule: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }, logs: [], bodyData: [] };
  else if (u.includes('/api/ideas')) data = [];
  else data = {};
  return { ok: true, status: 200, json: async () => data };
};

const homeUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'home.js')).href;
const home = await import(homeUrl);

test('问题1：home.render 连续调用不重复渲染（修改后内容不叠加）', async () => {
  const container = new Element('div');
  await home.render(container);
  assert.equal(container.children.length, 3, '首次渲染应有 3 个顶层节点（问候 / 备忘输入 / 卡片网格）');
  await home.render(container);
  assert.equal(container.children.length, 3, '再次渲染（如快速备忘修改后 refresh）不应累积重复内容');
});
