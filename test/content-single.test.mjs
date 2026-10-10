import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';

const require = createRequire(import.meta.url);
const { migrateBlocksToDesc, blocksToMarkdown, BLOCKS_FLAG } = require('../lib/migrate.js');
const { Store } = require('../store.js');

globalThis.document = makeDocument();
globalThis.location = { hash: '#/page/p1' };

const nodeFetch = globalThis.fetch;
const calls = [];
let project = null;

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ url: u, method, body });
  if (method === 'PUT' && body && u.endsWith('/api/projects/p1')) Object.assign(project, body);
  if (u.includes('/api/projects')) return { ok: true, status: 200, json: async () => [JSON.parse(JSON.stringify(project))] };
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const pageMod = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'page.js')).href);
const itemMod = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'item.js')).href);

const tick = () => new Promise((r) => setTimeout(r, 10));

function reset() {
  calls.length = 0;
  document.body.children = [];
  document.activeElement = null;
  project = {
    id: 'p1', name: '项目页', icon: '📁', status: 'active', dateFormat: 'ymd', desc: '',
    blocks: [{ id: 'b1', type: 'text', text: '旧内容块' }],
    tasks: [{ id: 't1', title: '任务', done: false, desc: '', blocks: [], subtasks: [] }]
  };
}
function mount() {
  const el = document.createElement('div');
  document.body.append(el);
  return el;
}

// ══════════ 页面：整篇一个 Markdown ══════════

test('问题2：内容区只有一个 Markdown 编辑框，不再是一行行内容块', async () => {
  reset();
  const el = mount();
  await pageMod.render(el, { id: 'p1' });

  assert.equal(findAllByClass(el, 'md-content').length, 1, '只有一个内容编辑框');
  assert.equal(findAllByClass(el, 'block').length, 0, '不该再有多行内容块');
  assert.equal(findAllByClass(el, 'block-add-hint').length, 0, '不该再有"点击添加内容"');
  assert.equal(findAllByClass(el, 'block-type-select').length, 0, '不该再有每行的类型选择');
});

test('问题2：占位提示只出现一处，且说明支持 Markdown', async () => {
  reset();
  const el = mount();
  await pageMod.render(el, { id: 'p1' });
  const hints = findAllByTag(el, 'div')
    .map((n) => String(n.getAttribute('data-placeholder') || ''))
    .filter((t) => t.includes('Markdown'));
  assert.equal(hints.length, 1, `占位提示应只有一处，实际 ${hints.length}：${hints.join(' / ')}`);
});

test('问题2：编辑并保存写进 desc', async () => {
  reset();
  const el = mount();
  await pageMod.render(el, { id: 'p1' });

  const view = findAllByClass(el, 'md-content-view')[0];
  const input = findAllByClass(el, 'md-content-input')[0];
  assert.equal(view.textContent.trim(), '', '项目 desc 为空时显示占位');

  view.click();
  input.textContent = '# 标题\n\n- 一条';
  input.fire('blur');
  await tick();

  const put = calls.filter((c) => c.method === 'PUT').pop();
  assert.equal(put.url, '/api/projects/p1');
  assert.deepEqual(put.body, { desc: '# 标题\n\n- 一条' });
  assert.ok(String(view.innerHTML).includes('<h1'), '显示层按 Markdown 渲染标题');
});

test('问题2：任务页/子任务页同样用整篇 Markdown', async () => {
  reset();
  globalThis.location.hash = '#/task/p1/t1';
  const el = mount();
  await itemMod.render(el, { id: 'p1', chain: ['t1'] });
  assert.equal(findAllByClass(el, 'md-content').length, 1);
  assert.equal(findAllByClass(el, 'block').length, 0);

  const input = findAllByClass(el, 'md-content-input')[0];
  findAllByClass(el, 'md-content-view')[0].click();
  input.textContent = '任务的内容';
  input.fire('blur');
  await tick();
  const put = calls.filter((c) => c.method === 'PUT').pop();
  assert.equal(put.url, '/api/projects/p1/tasks/t1');
  assert.deepEqual(put.body, { desc: '任务的内容' });
});

// ══════════ 迁移：旧内容块并进 desc ══════════

test('问题2：内容块按 Markdown 语义转换', () => {
  const md = blocksToMarkdown([
    { type: 'h1', text: '标题' },
    { type: 'text', text: '正文' },
    { type: 'bullet', text: '项目' },
    { type: 'number', text: '第一' },
    { type: 'todo', text: '要做', checked: true },
    { type: 'quote', text: '引用' },
    { type: 'divider' },
    { type: 'text', text: '' }
  ]);
  assert.equal(md, '# 标题\n正文\n- 项目\n1. 第一\n- [x] 要做\n> 引用\n---');
});

test('问题2：迁移把项目/任务/深层子任务的内容块并进 desc，且只做一次', () => {
  const data = {
    projects: [{
      id: 'p1', goal: '目标', blocks: [{ type: 'text', text: '项目内容' }],
      tasks: [{
        id: 't1', desc: '已有描述', blocks: [{ type: 'text', text: '任务内容' }],
        subtasks: [{ id: 's1', blocks: [{ type: 'h2', text: '深层' }], subtasks: [] }]
      }]
    }]
  };
  const store = { get: () => data };
  const r = migrateBlocksToDesc(store);
  assert.equal(r.changed, true);
  assert.equal(r.count, 3);

  assert.equal(data.projects[0].desc, '项目内容', '项目的内容进 desc');
  assert.equal(data.projects[0].goal, '目标', '目标字段不动');
  assert.equal(data.projects[0].tasks[0].desc, '已有描述\n\n任务内容', '原有内容在前，旧内容块接在后面');
  assert.equal(data.projects[0].tasks[0].subtasks[0].desc, '## 深层', '深层子任务也要迁');
  assert.equal(data.migrations[BLOCKS_FLAG], true, '留标记');

  const again = migrateBlocksToDesc(store);
  assert.equal(again.changed, false, '第二次不再迁移');
});

test('问题2：没有内容块的条目不会被写脏', () => {
  const data = { projects: [{ id: 'p1', goal: '目标' }], tasks: [] };
  const r = migrateBlocksToDesc({ get: () => data });
  assert.equal(r.count, 0);
  assert.equal('desc' in data.projects[0], false, '没有内容就不该凭空加字段');
});

// ══════════ 接口：项目也能存 desc ══════════

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-content-'));
  const app = require('../lib/api.js').createApp({ dataFile: path.join(dir, 'data.json') });
  await new Promise((r) => app.listen(0, r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = async (method, url, body) => {
    const res = await nodeFetch(`${base}${url}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  try {
    return await fn(call);
  } finally {
    await new Promise((r) => app.close(r));
  }
}

test('问题2：接口层项目与任务都能存取 desc', async () => {
  await withServer(async (call) => {
    const p = (await call('POST', '/api/projects', { name: 'P', desc: '初始内容' })).json;
    assert.equal(p.desc, '初始内容');
    assert.equal((await call('PUT', `/api/projects/${p.id}`, { desc: '改过的内容' })).json.desc, '改过的内容');
    assert.equal((await call('GET', '/api/projects')).json[0].desc, '改过的内容', '重新读取仍在');

    const t = (await call('POST', `/api/projects/${p.id}/tasks`, { title: '任务', desc: '任务内容' })).json;
    assert.equal(t.desc, '任务内容');
  });
});
