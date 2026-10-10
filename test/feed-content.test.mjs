import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/page/p1' };

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const projects = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href);

const tick = () => new Promise((r) => setTimeout(r, 10));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeFeed() {
  return {
    id: 'p1',
    name: 'P',
    tasks: [{
      id: 't1', title: '任务', done: false, dueDate: '2024-05-10',
      desc: '**重点**\n- [ ] 待办',
      subtasks: [{ id: 's1', title: '子任务', done: false }]
    }]
  };
}

test('问题3：信息流里这一栏叫「内容」而不是「描述」', () => {
  const feed = projects.buildTaskFeed(makeFeed());
  const sections = findAllByClass(feed, 'feed-sec').map((s) => textOf(s));
  assert.ok(sections.includes('内容'), `应有「内容」栏，实际 ${JSON.stringify(sections)}`);
  assert.equal(sections.includes('描述'), false, '不该再叫「描述」');
});

test('问题3：内容按 Markdown 渲染并可点击就地编辑', () => {
  const feed = projects.buildTaskFeed(makeFeed());
  const md = findAllByClass(feed, 'feed-goal-md')[0];
  assert.ok(String(md.innerHTML).includes('<strong>重点</strong>'), '内容应按 Markdown 渲染');
  assert.ok(String(md.getAttribute('data-placeholder')).includes('内容'), '提示语也要说内容');
  assert.ok(String(md.getAttribute('data-placeholder')).includes('Markdown'));

  md.click();
  const edit = findAllByClass(feed, 'feed-goal')[0];
  assert.equal(edit.style.display, '', '点击进入编辑');
  assert.equal(md.style.display, 'none');
});

test('问题3：信息流编辑内容写进 desc', async () => {
  calls.length = 0;
  const feed = projects.buildTaskFeed(makeFeed());
  findAllByClass(feed, 'feed-goal-md')[0].click();
  const edit = findAllByClass(feed, 'feed-goal')[0];
  edit.textContent = '新的内容';
  edit.fire('blur');
  await tick();

  const put = calls.find((c) => c.method === 'PUT' && c.body && 'desc' in c.body);
  assert.ok(put, '应保存到 desc');
  assert.deepEqual(put.body, { desc: '新的内容' });
});

test('问题3【回归】：信息流里边打字边自动保存，不用等失焦', async () => {
  calls.length = 0;
  const feed = projects.buildTaskFeed(makeFeed());
  findAllByClass(feed, 'feed-goal-md')[0].click();
  const edit = findAllByClass(feed, 'feed-goal')[0];

  edit.textContent = '正在写的内容';
  edit.fire('input');
  await wait(850);

  const put = calls.find((c) => c.method === 'PUT' && c.body && 'desc' in c.body);
  assert.ok(put, '打字过程中就该保存');
  assert.deepEqual(put.body, { desc: '正在写的内容' });
  assert.equal(edit.style.display, '', '不该把用户踢出编辑态');
});

test('问题3：内容没变就不重复写库', async () => {
  calls.length = 0;
  const feed = projects.buildTaskFeed(makeFeed());
  findAllByClass(feed, 'feed-goal-md')[0].click();
  const edit = findAllByClass(feed, 'feed-goal')[0];
  edit.fire('input');
  await wait(850);
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
});

test('问题3：信息流的内容编辑框带焦点键，重绘后能回来', () => {
  const feed = projects.buildTaskFeed(makeFeed());
  const edit = findAllByClass(feed, 'feed-goal')[0];
  assert.equal(edit.getAttribute('data-focus-key'), '/api/projects/p1/tasks/t1:content');
});

test('问题3：子任务信息流同样用「内容」', () => {
  const feed = projects.buildTaskFeed(makeFeed());
  const sections = findAllByClass(feed, 'feed-sec').map((s) => textOf(s));
  assert.ok(sections.includes('子任务'), '子任务栏保留');
  assert.ok(sections.filter((s) => s === '内容').length >= 1);
  assert.equal(sections.includes('描述'), false);
});
