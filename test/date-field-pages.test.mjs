import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/page/p1' };

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({
    url: String(url),
    method: opts.method || 'GET',
    body: opts.body ? JSON.parse(opts.body) : null
  });
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const pageUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'page.js')).href;
const itemUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'item.js')).href;
const pageMod = await import(pageUrl);
const itemMod = await import(itemUrl);

const tick = () => new Promise((r) => setTimeout(r, 10));
const dateInputs = (root) => findAllByTag(root, 'input').filter((i) => i.getAttribute('type') === 'date');
const dayBtn = (root, date) => findAllByClass(root, 'dp-day').find((d) => d.dataset.date === date);
const putTo = (suffix) => calls.filter((c) => c.method === 'PUT' && c.url.endsWith(suffix));

// 每次用全新对象：保存时会就地更新传入对象
const mkProject = () => ({ id: 'p1', name: '项目', startDate: '2024-05-01', dueDate: '2024-05-31', dateFormat: 'iso' });
const mkTask = () => ({ id: 't1', title: '任务', dueDate: '2024-05-10' });
const mkSubtask = () => ({ id: 's1', title: '子任务', dueDate: '2024-05-05' });

test('时间字段：项目页用单个日期选择器，去掉开始/截止', () => {
  const project = mkProject();
  const props = pageMod.buildPageProperties([project], project);
  assert.equal(findAllByClass(props, 'date-field').length, 1, '应只有一个时间字段');
  assert.equal(dateInputs(props).length, 0, '不应再有原生 date 输入');
  const text = textOf(props);
  assert.ok(text.includes('时间'));
  assert.ok(!text.includes('开始') && !text.includes('截止'), '不应再有开始/截止两个字段');
  assert.equal(findAllByClass(props, 'date-trigger')[0].textContent, '2024-05-01 → 2024-05-31', '按项目选定的格式显示');
});

test('时间字段：项目页区间按当前端点写回项目接口', async () => {
  calls.length = 0;
  const project = mkProject();
  const props = pageMod.buildPageProperties([project], project);
  findAllByClass(props, 'date-trigger')[0].click();

  dayBtn(props, '2024-05-20').click();
  await tick();
  let put = putTo('/api/projects/p1').pop();
  assert.ok(put, '应更新项目时间');
  assert.equal(put.body.startDate, '2024-05-20', '默认编辑「开始」端点');
  assert.equal(put.body.dueDate, '2024-05-31');
  assert.equal(put.body.dateFormat, 'iso', '保留该项目选定的日期格式');

  findAllByClass(props, 'dp-chip-end')[0].click();
  dayBtn(props, '2024-05-25').click();
  await tick();
  put = putTo('/api/projects/p1').pop();
  assert.equal(put.body.dueDate, '2024-05-25', '切换后可改「结束」端点');
  assert.equal(put.body.startDate, '2024-05-20');
});

test('时间字段：任务页（第 1 层）用单个日期选择器，去掉开始/截止', () => {
  const props = itemMod.buildItemProperties({ id: 'p1' }, mkTask(), ['t1']);
  assert.equal(findAllByClass(props, 'date-field').length, 1);
  assert.equal(dateInputs(props).length, 0);
  assert.ok(!textOf(props).includes('开始') && !textOf(props).includes('截止'));
});

test('时间字段：任务页单日期写到 dueDate，不写 startDate', async () => {
  calls.length = 0;
  const props = itemMod.buildItemProperties({ id: 'p1' }, mkTask(), ['t1']);
  findAllByClass(props, 'date-trigger')[0].click();
  dayBtn(props, '2024-05-25').click();
  await tick();
  const put = putTo('/api/projects/p1/tasks/t1').pop();
  assert.ok(put, '应更新任务时间');
  assert.deepEqual(put.body, {
    startDate: null, startTime: null, dueDate: '2024-05-25', dueTime: null, dateFormat: 'full'
  });
});

test('时间字段：任务页可把单日期改成时间区间', async () => {
  calls.length = 0;
  const props = itemMod.buildItemProperties({ id: 'p1' }, mkTask(), ['t1']);
  findAllByClass(props, 'date-trigger')[0].click();
  findAllByClass(props, 'dp-switch-end')[0].click();
  await tick();
  const put = putTo('/api/projects/p1/tasks/t1').pop();
  assert.equal(put.body.startDate, '2024-05-10', '开启结束日期时以当天为开始');
  assert.equal(put.body.dueDate, '2024-05-10');
});

test('时间字段：子任务页（第 2 层）用单个日期选择器并写子任务接口', async () => {
  calls.length = 0;
  const props = itemMod.buildItemProperties({ id: 'p1' }, mkSubtask(), ['t1', 's1']);
  assert.equal(findAllByClass(props, 'date-field').length, 1);
  assert.equal(dateInputs(props).length, 0);
  assert.ok(!textOf(props).includes('截止'));

  findAllByClass(props, 'date-trigger')[0].click();
  dayBtn(props, '2024-05-09').click();
  await tick();
  const put = putTo('/api/projects/p1/tasks/t1/subtasks/s1').pop();
  assert.ok(put, '应更新子任务时间');
  assert.equal(put.body.dueDate, '2024-05-09');
  assert.equal(put.body.startDate, null);
});

test('时间字段：深层（第 4 层）也写对应层级接口', async () => {
  calls.length = 0;
  const deep = { id: 's3', title: 'L4', dueDate: '2024-05-20' };
  const props = itemMod.buildItemProperties({ id: 'p1' }, deep, ['t1', 's1', 's2', 's3']);
  findAllByClass(props, 'date-trigger')[0].click();
  dayBtn(props, '2024-05-22').click();
  await tick();
  const put = putTo('/api/projects/p1/tasks/t1/subtasks/s1/subtasks/s2/subtasks/s3').pop();
  assert.ok(put, '应写到第 4 层路径');
  assert.equal(put.body.dueDate, '2024-05-22');
});

test('时间字段：相关页面都不再出现原生 date 输入', () => {
  for (const f of ['page.js', 'item.js']) {
    const src = fs.readFileSync(path.join(process.cwd(), 'public', 'js', 'views', f), 'utf8');
    assert.ok(!src.includes("type: 'date'"), `${f} 不应再有原生 date 输入`);
    assert.ok(src.includes('buildDateField'), `${f} 应使用日期选择器`);
  }
});
