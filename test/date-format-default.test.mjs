import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr } from '../public/js/utils.js';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/today' };

const picker = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'datepicker.js')).href);
const daytask = await import(pathToFileURL(path.join(process.cwd(), 'public', 'js', 'daytask.js')).href);

const { DATE_FORMATS, DEFAULT_DATE_FORMAT, formatDate, toPickerState, buildDateField, toApiPatch } = picker;

test('问题1：默认日期格式是「年/月/日」', () => {
  assert.equal(DEFAULT_DATE_FORMAT, 'ymd');
  const f = DATE_FORMATS.find((x) => x.value === DEFAULT_DATE_FORMAT);
  assert.ok(f, '默认格式必须在可选列表里');
  assert.equal(f.label, '年/月/日');
});

test('问题1：默认格式渲染成 2024/05/10', () => {
  assert.equal(formatDate('2024-05-10', DEFAULT_DATE_FORMAT), '2024/05/10');
  assert.equal(formatDate('2024-05-10'), '2024/05/10', '不传格式也用默认（年/月/日）');
});

test('问题1：没有存过格式的值，落到默认格式', () => {
  assert.equal(toPickerState({ dueDate: '2024-05-10', dueTime: '09:00' }).format, 'ymd');
  assert.equal(toPickerState({ dueDate: '2024-05-10', dateFormat: 'bogus' }).format, 'ymd', '非法格式也回落到默认');
  assert.equal(toPickerState({ dueDate: '2024-05-10', dateFormat: 'iso' }).format, 'iso', '存过的格式要保留');
  assert.equal(toPickerState({ dueDate: '2024-05-10' }).format, 'ymd');
});

test('问题1：每日任务保存时不指定格式也用默认', () => {
  const next = daytask.taskDatePatch({ dueDate: '2024-05-10', dueTime: '09:00' }, {});
  assert.equal(next.dateFormat, 'ymd');
});

test('问题1：选择器里默认选中「年/月/日」，且触发按钮按年/月/日显示', () => {
  const field = buildDateField({ value: { dueDate: '2024-05-10', dueTime: '09:00' }, onSave: () => {} });
  document.body.append(field);

  const trigger = findAllByClass(field, 'date-trigger')[0];
  assert.equal(textOf(trigger), '2024/05/10 09:00', '触发按钮按年/月/日显示');

  trigger.click();
  const select = findAllByClass(field, 'date-format-select')[0];
  assert.ok(select, '面板里应有日期格式选择');
  assert.equal(select.value, 'ymd', '默认选中「年/月/日」');

  const chosen = findAllByTag(select, 'option').find((o) => o.getAttribute('value') === select.value);
  assert.equal(textOf(chosen), '年/月/日');
});

test('问题1：改格式后写回所选格式（默认不覆盖用户选择）', async () => {
  const saved = [];
  const field = buildDateField({ value: { dueDate: '2024-05-10', dateFormat: 'iso' }, onSave: (p) => saved.push(p) });
  document.body.append(field);
  assert.equal(textOf(findAllByClass(field, 'date-trigger')[0]), '2024-05-10', 'iso 显示为 年-月-日');

  findAllByClass(field, 'date-trigger')[0].click();
  const select = findAllByClass(field, 'date-format-select')[0];
  select.value = 'short';
  select.fire('change');
  await new Promise((r) => setTimeout(r, 5));

  assert.equal(saved.length, 1, '应保存一次');
  assert.equal(saved[0].dateFormat, 'short', '写回用户所选格式');
  assert.equal(textOf(findAllByClass(field, 'date-trigger')[0]), '2024年5月10日', '触发按钮跟着变');
});

// ——— 接口侧的默认值 ———

const { createApp } = (await import(pathToFileURL(path.join(process.cwd(), 'lib', 'api.js')).href)).default;

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-fmt-'));
  const app = createApp({ dataFile: path.join(dir, 'data.json') });
  await new Promise((r) => app.listen(0, r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
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

test('问题1：新建任务/项目/子任务默认都是年/月/日', async () => {
  await withServer(async (call) => {
    const task = await call('POST', '/api/tasks', { title: '任务', date: todayStr() });
    assert.equal(task.json.dateFormat, 'ymd', '每日任务');

    const project = await call('POST', '/api/projects', { name: '项目' });
    assert.equal(project.json.dateFormat, 'ymd', '项目');

    const item = await call('POST', `/api/projects/${project.json.id}/tasks`, { title: '项目任务' });
    assert.equal(item.json.dateFormat, 'ymd', '项目任务');

    const sub = await call('POST', `/api/projects/${project.json.id}/tasks/${item.json.id}/subtasks`, { title: '子任务' });
    assert.equal(sub.json.dateFormat, 'ymd', '子任务');

    const explicit = await call('POST', '/api/tasks', { title: '指定格式', date: todayStr(), dateFormat: 'iso' });
    assert.equal(explicit.json.dateFormat, 'iso', '显式指定的格式不被覆盖');
  });
});
