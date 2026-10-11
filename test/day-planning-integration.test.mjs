import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr, addDays } from '../public/js/utils.js';
import { render } from '../public/js/views/today.js';
const { createApp } = createRequire(import.meta.url)('../lib/api.js');

test('实际 HTTP 服务贯通日内安排、排序、刷新、完成和磁盘重开', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-integration-'));
  const file = path.join(dir, 'data.json'); const server = createApp({ dataFile: file });
  const nativeFetch = globalThis.fetch;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  globalThis.document = makeDocument(); globalThis.location = { hash: '#/today' };
  globalThis.fetch = (url, options) => nativeFetch(base + url, options);
  try {
    const post = async (url, body) => (await globalThis.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    const date = todayStr();
    const a = await post('/api/tasks', { title: '回复消息', date, listId: 'work', estimate: 10 });
    const p = await post('/api/projects', { name: '论文修改' });
    const b = await post(`/api/projects/${p.id}/tasks`, { title: '修改图表', dueDate: addDays(date, 5), dueTime: '17:00', estimate: 60 });
    const root = document.createElement('div'); await render(root);
    const button = label => findAllByTag(root, 'button').find(e => e.getAttribute('aria-label') === label);
    const waitFor = async check => { const until = Date.now() + 2500; while (!check()) { if (Date.now() > until) assert.fail('页面未完成预期刷新'); await new Promise(r => setTimeout(r, 10)); } };
    button('安排任务').click();
    for (const title of ['回复消息', '修改图表']) {
      const choice = findAllByTag(document.body, 'input').find(e => e.getAttribute('aria-label') === `选择安排：${title}`);
      choice.checked = true; choice.fire('change');
    }
    const target = findAllByTag(document.body, 'select').find(e => e.getAttribute('aria-label') === '批量安排时段');
    target.value = 'afternoon';
    findAllByTag(document.body, 'button').find(e => textOf(e) === '安排选中 2 项').click();
    await waitFor(() => findAllByClass(document.body, 'daily-arrange-modal').length === 0);
    const afternoonTitles = () => findAllByClass(findAllByClass(findAllByClass(root, 'cal-board')[0], 'daily-period-afternoon')[0], 'daily-task-title').map(textOf);
    assert.equal(afternoonTitles().length, 2);
    const last = afternoonTitles()[1]; button(`上移：${last}`).click();
    await waitFor(() => afternoonTitles()[0] === last);
    const saved = createApp({ dataFile: file }).store.get();
    assert.equal(saved.tasks.find(t => t.id === a.id).planPeriod, 'afternoon');
    assert.equal(saved.projects.find(x => x.id === p.id).tasks[0].dueDate, addDays(date, 5));
    assert.equal(saved.projects.find(x => x.id === p.id).tasks[0].dueTime, '17:00');
    findAllByTag(root, 'input').find(e => e.getAttribute('aria-label') === '完成任务：修改图表').click();
    await waitFor(() => findAllByClass(findAllByClass(root, 'daily-done')[0], 'daily-task-title').some(e => textOf(e) === '修改图表'));
    const final = createApp({ dataFile: file }).store.get();
    assert.equal(final.projects.find(x => x.id === p.id).tasks.find(t => t.id === b.id).done, true);
    assert.equal(final.tasks.length, 1, '安排项目任务不会复制为独立任务');
  } finally {
    globalThis.fetch = nativeFetch;
    await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true });
  }
});
