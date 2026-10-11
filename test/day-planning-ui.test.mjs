import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { dailyEntries, dailySections, buildDailyBoard, withPlannedCalendarEntries } from '../public/js/daily.js';
import { planningFor, comparePlan, planSummary, editPlan, buildTimeAxis, buildPlanProperty, periodForTime } from '../public/js/planning.js';
import { todayStr, addDays } from '../public/js/utils.js';
const date = todayStr();
const tick = () => new Promise(r => setTimeout(r, 15));
const byLabel = (root, label, tag = 'button') => findAllByTag(root, tag).find(e => e.getAttribute('aria-label') === label);
const textButton = (root, text) => findAllByTag(root, 'button').find(e => textOf(e) === text);
function setup() {
  globalThis.document = makeDocument(); globalThis.location = { hash: '#/today' };
  const tasks = [
    { id: 'a', title: '论文', date, planDate: date, planPeriod: 'morning', estimate: 90, planOrder: 1 },
    { id: 'b', title: '读文献', date, planDate: date, planTime: '09:00', planEndTime: '10:00' },
    { id: 'c', title: '咨询', date, planDate: date, planPeriod: 'morning', planOrder: 0 },
    { id: 'd', title: '邮件', date, planDate: date, planPeriod: 'afternoon', estimate: 10 },
    { id: 'done', title: '完成事项', date, done: true },
    { id: 'pool', title: '历史零散事项', date: addDays(date, -10), listId: 'work' }
  ];
  const projects = [{ id: 'p', name: '研究', tasks: [
    { id: 'due', title: '提交报告', dueDate: date, dueTime: '10:00' },
    { id: 'ongoing', title: '持续调研', startDate: addDays(date, -1), dueDate: addDays(date, 3) }
  ] }];
  const writes = []; let refreshes = 0;
  globalThis.fetch = async (url, options = {}) => { writes.push({ url, patch: JSON.parse(options.body) }); return { ok: true, json: async () => ({}) }; };
  const entries = dailyEntries(tasks, projects);
  const root = buildDailyBoard(entries, date, async () => refreshes++);
  return { root, entries, tasks, writes, refreshed: () => refreshes };
}

test('时段分区平铺任务：截止时间不充当执行时间，持续和候选任务默认不占页面', () => {
  const { root } = setup();
  assert.deepEqual(findAllByClass(root, 'daily-period').map(e => e.dataset.period), ['morning', 'afternoon', '']);
  const morning = findAllByClass(root, 'daily-period-morning')[0];
  assert.deepEqual(findAllByClass(morning, 'daily-task-title').map(textOf), ['读文献', '咨询', '论文']);
  assert.ok(textOf(findAllByClass(root, 'daily-period-unassigned')[0]).includes('提交报告'));
  assert.ok(textOf(root).includes('今日截止 10:00'));
  assert.ok(!textOf(root).includes('持续调研')); assert.ok(!textOf(root).includes('历史零散事项'));
  assert.equal(findAllByClass(root, 'daily-done')[0], root.children[root.children.length - 1]);
  assert.equal(findAllByClass(root, 'daily-done')[0].hasAttribute('open'), false);
});

test('时段耗时包含具体时间段，未估算项不会按零时长处理', () => {
  const { entries } = setup(); const selected = entries.filter(e => ['a', 'b', 'c'].includes(e.id));
  assert.equal(planSummary(selected, date), '已安排用时 2 小时 30 分钟 · 1 项未估算');
});

test('选择下午清除精确时间并保存，改到明天保留当次时间段且不修改原日期', async () => {
  const { root, writes, tasks } = setup();
  const period = byLabel(root, '安排时段：读文献', 'select'); period.value = 'afternoon'; period.fire('change'); await tick();
  assert.deepEqual(writes.pop(), { url: '/api/tasks/b', patch: { planDate: date, planPeriod: 'afternoon', planTime: null, planEndTime: null, planOrder: null } });
  assert.equal(tasks[1].planTime, '09:00', '渲染快照不能改写原数据');
  const fresh = setup(); byLabel(fresh.root, '改到明天：读文献').click(); await tick();
  assert.equal(fresh.writes[0].patch.planDate, addDays(date, 1));
  assert.equal(fresh.writes[0].patch.planTime, '09:00');
  assert.equal(fresh.writes[0].patch.date, undefined);
});

test('拖动跨时段和上移排序使用批量保存，完成状态与计划顺序分开', async () => {
  const { root, writes } = setup();
  const row = findAllByClass(root, 'daily-task').find(e => e.dataset.entry === '/api/tasks/a');
  let key; row.fire('dragstart', { dataTransfer: { setData: (_, value) => key = value } });
  const afternoon = findAllByClass(root, 'daily-period-afternoon')[0];
  afternoon.fire('drop', { dataTransfer: { getData: () => key } }); await tick();
  const batch = writes.pop(); assert.equal(batch.url, '/api/planning/batch');
  assert.deepEqual(batch.patch.items.map(x => [x.base, x.patch.planOrder]), [['/api/tasks/d', 0], ['/api/tasks/a', 1]]);
  assert.ok(batch.patch.items.every(x => x.patch.planPeriod === 'afternoon' && !('done' in x.patch)));
  const fresh = setup(); byLabel(fresh.root, '上移：论文').click(); await tick();
  assert.deepEqual(fresh.writes[0].patch.items.map(x => x.base), ['/api/tasks/a', '/api/tasks/c']);
});

test('安排面板可跨清单搜索，批量选择候选和持续任务安排到上午', async () => {
  const { root, writes } = setup(); textButton(root, '安排任务').click();
  assert.ok(textOf(document.body).includes('持续调研'));
  const a = byLabel(document.body, '选择安排：持续调研', 'input'); a.checked = true; a.fire('change');
  const search = byLabel(document.body, '搜索待安排任务', 'input'); search.value = '历史'; search.fire('input');
  const b = byLabel(document.body, '选择安排：历史零散事项', 'input'); b.checked = true; b.fire('change');
  const target = byLabel(document.body, '批量安排时段', 'select'); target.value = 'morning';
  textButton(document.body, '安排选中 2 项').click(); await tick();
  assert.equal(writes[0].url, '/api/planning/batch');
  assert.equal(writes[0].patch.items.length, 2);
  assert.ok(writes[0].patch.items.every(x => x.patch.planPeriod === 'morning'));
  assert.equal(findAllByClass(document.body, 'modal').length, 0);
});

test('保存失败还原时段选择，批量失败保留面板和选项供重试', async () => {
  const { root, refreshed } = setup();
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: '磁盘保存失败' }) });
  const period = byLabel(root, '安排时段：论文', 'select'); period.value = 'afternoon'; period.fire('change'); await tick();
  assert.equal(period.value, 'morning'); assert.equal(period.disabled, false); assert.equal(refreshed(), 0);
  textButton(root, '安排任务').click(); const pick = byLabel(document.body, '选择安排：持续调研', 'input'); pick.checked = true; pick.fire('change');
  textButton(document.body, '安排选中 1 项').click(); await tick();
  assert.equal(findAllByClass(document.body, 'modal').length, 1); assert.equal(pick.checked, true);
  assert.equal(textButton(document.body, '安排选中 1 项').disabled, false);
});

test('精确时间编辑发现冲突，调整或明确允许重叠后才保存', async () => {
  const { entries } = setup(); const saved = [];
  editPlan(entries.find(e => e.id === 'a'), date, async (_, patch) => { saved.push(patch); return true; }, entries);
  const modal = findAllByClass(document.body, 'modal')[0];
  const inputs = findAllByTag(modal, 'input'); const times = inputs.filter(i => i.type === 'time');
  times[0].value = '09:30'; times[1].value = '10:30';
  findAllByTag(modal, 'form')[0].fire('submit'); await tick();
  assert.equal(saved.length, 0); assert.ok(textOf(modal).includes('时间重叠'));
  inputs.find(i => i.type === 'checkbox').checked = true;
  findAllByTag(modal, 'form')[0].fire('submit'); await tick();
  assert.equal(saved.length, 1); assert.equal(saved[0].planPeriod, 'morning'); assert.equal(saved[0].planTime, '09:30');
});

test('改到其他日期不会留在原日当天安排，单日日历卡片也只展示新日期', () => {
  const { entries } = setup(); const e = entries.find(e => e.id === 'a');
  e.planDate = addDays(date, 1); e.raw = { ...e.raw, planDate: e.planDate };
  assert.ok(!dailySections([e], date).planned.length);
  assert.equal(planningFor(e, date).period, '');
  const calendar = withPlannedCalendarEntries([{ ...e, date, spanFrom: date, spanTo: date }], [e]);
  assert.equal(calendar.length, 1); assert.equal(calendar[0].date, addDays(date, 1)); assert.equal(calendar[0].planOnly, true);
});

test('时间轴展示实际时间段并允许调整，不给只选上午的任务制造开始时间', () => {
  const { entries } = setup(); let selected;
  const axis = buildTimeAxis(entries, date, e => selected = e.id);
  const blocks = findAllByClass(axis, 'daily-time-block'); assert.equal(blocks.length, 1);
  assert.ok(textOf(blocks[0]).includes('09:00–10:00')); blocks[0].click(); assert.equal(selected, 'b');
  const a = entries.find(e => e.id === 'a'); assert.equal(planningFor(a, date).time, '');
  const ordered = entries.filter(e => ['a', 'c'].includes(e.id)).sort((a, b) => comparePlan(a, b, date));
  assert.deepEqual(ordered.map(e => e.id), ['c', 'a']);
});

test('安排弹窗保留待安排状态，切换时段自动清空精确时间，开始时间反推时段', async () => {
  const { entries } = setup();
  editPlan(entries.find(e => e.id === 'due'), date, async () => true, entries);
  let modal = findAllByClass(document.body, 'modal')[0];
  assert.equal(findAllByTag(modal, 'select')[0].value, '');
  textButton(modal, '取消').click();
  editPlan(entries.find(e => e.id === 'b'), date, async () => true, entries);
  modal = findAllByClass(document.body, 'modal')[0];
  const period = findAllByTag(modal, 'select')[0];
  const times = findAllByTag(modal, 'input').filter(e => e.type === 'time');
  period.value = 'afternoon'; period.fire('change');
  assert.equal(times[0].value, ''); assert.equal(times[1].value, '');
  times[0].value = '18:00'; times[0].fire('change'); assert.equal(period.value, 'evening');
  assert.equal(periodForTime('11:59'), 'morning'); assert.equal(periodForTime('12:00'), 'afternoon');
});

test('任务详情页加载所有清单的安排，冲突提示不会因归属不同而遗漏', async () => {
  const { tasks } = setup();
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    return { ok: true, json: async () => String(url).includes('/api/projects') ? [] : tasks };
  };
  const root = buildPlanProperty(tasks[0], '/api/tasks/a', async () => true);
  textButton(root, '调整安排').click(); await tick();
  assert.ok(calls.some(url => url.includes('includePool=1')));
  const modal = findAllByClass(document.body, 'modal')[0];
  const times = findAllByTag(modal, 'input').filter(e => e.type === 'time');
  times[0].value = '09:30'; times[1].value = '10:30';
  findAllByTag(modal, 'form')[0].fire('submit'); await tick();
  assert.ok(textOf(modal).includes('读文献'));
  assert.equal(findAllByClass(document.body, 'modal').length, 1);
});
