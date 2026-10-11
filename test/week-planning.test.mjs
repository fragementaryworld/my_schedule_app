import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dailyEntries } from '../public/js/daily.js';
import { weekPlanningModel, weekMovePatch } from '../public/js/week-planning.js';
import { planningFor } from '../public/js/planning.js';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { todayStr, addDays } from '../public/js/utils.js';
import { weekDates } from '../public/js/calendar.js';
import { render } from '../public/js/views/today.js';

const monday = '2026-10-12', dates = weekDates(monday);
const byTitle = (list, title) => list.find(e => e.title === title);
test('周安排模型区分执行时间、截止时间和原始范围，跨天安排不重复成日卡片', () => {
  const entries = dailyEntries([
    { id: 'a', title: '旧单日', date: monday, time: '09:00', endTime: '10:00' },
    { id: 'b', title: '晚上', date: monday, planDate: monday, planPeriod: 'evening' },
    { id: 'c', title: '未排时段', date: monday },
    { id: 'd', title: '原范围', date: monday, endDate: dates[3], time: '11:00' }
  ], [{ id: 'p', name: '项目', tasks: [
    { id: 'a', title: '截止提醒', dueDate: monday, dueTime: '17:00' },
    { id: 'b', title: '三日执行', startDate: dates[0], dueDate: dates[6], planDate: dates[1], planEndDate: dates[3], planPeriod: 'morning', planTime: '14:00' },
    { id: 'c', title: '开始标记', startDate: monday }
  ] }]);
  const snapshot = structuredClone(entries), model = weekPlanningModel(entries, dates);
  assert.equal(byTitle(model.days.get(monday), '旧单日').weekPeriod, 'morning');
  assert.equal(byTitle(model.days.get(monday), '晚上').weekPeriod, 'evening');
  assert.equal(byTitle(model.days.get(monday), '未排时段').weekPeriod, '');
  const due = byTitle(model.days.get(monday), '截止提醒');
  assert.equal(due.weekPeriod, ''); assert.equal(due.time, ''); assert.equal(due.deadlineOnly, true);
  assert.deepEqual(model.contexts.map(e => e.title), ['原范围', '开始标记']);
  assert.equal(model.spans.length, 1); assert.equal(model.spans[0].weekPeriod, 'afternoon', '具体时间优先');
  assert.equal(model.spans[0].spanDays, 3);
  for (const date of dates.slice(1, 4)) assert.equal(byTitle(model.days.get(date), '三日执行').spanDays, 3);
  assert.ok(!model.days.get(dates[4]).some(e => e.title === '三日执行'));
  assert.equal(byTitle(model.days.get(dates[6]), '三日执行').deadlineOnly, true, '安排外的截止日仍可见');
  assert.deepEqual(entries, snapshot, '模型构造不写入原始数据');
});

test('周拖动补齐旧时间安排，跨天平移和拉伸不改原始日期或项目截止', () => {
  const entries = dailyEntries([{ id: 'a', title: '旧事务', date: monday, time: '09:00', endTime: '10:00' }], []);
  const event = weekPlanningModel(entries, dates).days.get(monday)[0];
  assert.deepEqual(weekMovePatch(event, 1), { planDate: dates[1], planPeriod: 'morning', planTime: '09:00', planEndTime: '10:00', planOrder: null });
  assert.deepEqual(weekMovePatch(event, 2, 'morning', 'end'), { planDate: monday, planEndDate: dates[2], planPeriod: 'morning', planTime: '09:00', planEndTime: '10:00', planOrder: null });
  assert.equal(weekMovePatch(event, 0), null);
  const planned = weekPlanningModel(dailyEntries([], [{ id: 'p', tasks: [{ id: 't', title: '范围', dueDate: dates[6], planDate: dates[1], planEndDate: dates[3], planPeriod: 'morning' }] }]), dates).spans[0];
  assert.deepEqual(weekMovePatch(planned, 1, 'afternoon'), { planDate: dates[2], planEndDate: dates[4], planPeriod: 'afternoon', planTime: null, planEndTime: null, planOrder: null });
  assert.deepEqual(weekMovePatch(planned, 0, ''), { planDate: dates[1], planPeriod: null, planTime: null, planEndTime: null, planOrder: null });
});

test('截止提醒拖入周时段创建单日执行安排，不平移此前安排段', () => {
  const entry = dailyEntries([], [{ id: 'p', tasks: [{ id: 't', title: '独立截止', dueDate: dates[6], planDate: dates[1], planEndDate: dates[3], planPeriod: 'morning' }] }]);
  const due = weekPlanningModel(entry, dates).days.get(dates[6])[0];
  assert.deepEqual(weekMovePatch(due, 0, 'afternoon'), { planDate: dates[6], planEndDate: null, planPeriod: 'afternoon', planTime: null, planEndTime: null, planOrder: null });
});

const buttons = root => findAllByTag(root, 'button');
const button = (root, label) => buttons(root).find(b => textOf(b) === label);
const tick = () => new Promise(r => setTimeout(r, 15));
async function setup(t, mobile = false) {
  const nativeFetch = globalThis.fetch;
  globalThis.document = makeDocument(); globalThis.location = { hash: '#/today' };
  globalThis.matchMedia = () => ({ matches: mobile });
  const date = todayStr();
  const tasks = [
    { id: 'm', title: '上午工作', date, planDate: date, planPeriod: 'morning', listId: 'work' },
    { id: 'a', title: '下午生活', date, planDate: date, planPeriod: 'afternoon', listId: 'personal' },
    { id: 'e', title: '晚上阅读', date, planDate: date, planTime: '19:00', listId: 'personal' },
    { id: 'u', title: '待安排事务', date, listId: 'work' },
    { id: 'r', title: '跨天执行', date: addDays(date, -20), planDate: weekDates(date)[0], planEndDate: weekDates(date)[3], planPeriod: 'morning', listId: 'work' }
  ];
  const projects = [{ id: 'p', name: '论文', tasks: [{ id: 'due', title: '截止任务', dueDate: date, dueTime: '17:00' }] },
    { id: 'archived', name: '已结束项目', status: 'completed', tasks: [{ id: 'history', title: '保留历史日期', dueDate: date, done: true }] }];
  const writes = [];
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') {
      const patch = JSON.parse(options.body); writes.push({ url, patch });
      Object.assign(tasks.find(e => url === `/api/tasks/${e.id}`) || projects[0].tasks[0], patch);
    }
    return { ok: true, json: async () => structuredClone(String(url).includes('projects') ? projects : String(url).includes('preferences') ? {} : tasks) };
  };
  t.after(() => { globalThis.fetch = nativeFetch; delete globalThis.matchMedia; });
  const root = document.createElement('div'); document.body.append(root); await render(root);
  button(root, '清除筛选').click(); button(root, '周视图').click(); await tick();
  return { root, date, tasks, writes };
}

test('日期×四时段对齐、原配色复用、连续条只画一次，详情默认折叠且可展开', async t => {
  const { root, date } = await setup(t);
  const cells = findAllByClass(root, 'week-period-cell');
  assert.equal(cells.length, 28);
  for (const period of ['morning','afternoon','evening','']) {
    const slot = cells.find(c => c.dataset.date === date && c.dataset.period === period);
    assert.ok(slot.classList.contains(`daily-period-${period || 'unassigned'}`));
    const name = { morning: '上午工作', afternoon: '下午生活', evening: '晚上阅读', '': '待安排事务' }[period];
    assert.ok(textOf(slot).includes(name));
    const peers = cells.filter(c => c.dataset.period === period);
    const gridRows = new Set(peers.map(c => /grid-row:(\d+)/.exec(c.getAttribute('style'))[1]));
    assert.equal(gridRows.size, 1, '日期列使用共同的 CSS 网格行');
  }
  const deadline = cells.find(c => c.dataset.date === date && c.dataset.period === '');
  assert.ok(textOf(deadline).includes('截止任务')); assert.ok(textOf(deadline).includes('截止'));
  assert.ok(textOf(deadline).includes('保留历史日期'), '保留非活动项目在日历上的历史记录');
  assert.ok(!textOf(cells.find(c => c.dataset.date === date && c.dataset.period === 'afternoon')).includes('截止任务'));
  const spans = findAllByClass(root, 'cal-span');
  assert.equal(spans.filter(e => textOf(e).includes('跨天执行')).length, 1);
  const board = findAllByClass(root, 'cal-board')[0];
  assert.equal(board.tagName, 'DETAILS'); assert.equal(board.open, false);
  findAllByClass(root, 'week-date-head')[0].click(); await tick();
  assert.equal(findAllByClass(root, 'cal-board')[0].open, true);
  const css = readFileSync(new URL('../public/css/modules.css', import.meta.url), 'utf8');
  assert.match(css, /\.daily-period-morning \{ --period-bg:#fff8ed; --period-ink:#865300; --period-border:#f2dfba;/);
  assert.match(css, /\.daily-period-afternoon \{ --period-bg:#f0f6ff; --period-ink:#2854a0; --period-border:#ceddf4;/);
  assert.match(css, /--period-bg:#f4f5f7; --period-ink:#546174; --period-border:#dce1e8;/);
});

test('周任务快捷操作可直接完成、取消完成，外部点击/Esc 关闭且不会导航或触发拖动', async t => {
  const { root, tasks, writes } = await setup(t);
  const control = () => buttons(root).find(b => b.getAttribute('aria-label') === '操作任务：上午工作');
  control().fire('mousedown', { button: 0, clientX: 30 });
  control().click();
  assert.equal(location.hash, '#/today'); assert.equal(writes.length, 0);
  assert.ok(findAllByClass(document.body, 'week-task-actions')[0]);
  button(document.body, '完成任务').click(); await tick();
  assert.equal(tasks[0].done, true);
  assert.deepEqual(writes[0], { url: '/api/tasks/m', patch: { done: true } });
  assert.equal(findAllByClass(document.body, 'week-task-actions').length, 0);
  assert.equal(findAllByClass(root, 'cal-board')[0].open, false);
  control().click(); button(document.body, '标记为未完成').click(); await tick(); assert.equal(tasks[0].done, false);
  control().click(); document.dispatchEvent('keydown', { key: 'Escape' }); assert.equal(findAllByClass(document.body, 'week-task-actions').length, 0);
  control().click(); findAllByClass(document.body, 'modal-backdrop')[0].click(); assert.equal(findAllByClass(document.body, 'week-task-actions').length, 0);
});

test('窄屏展示选中日的四时段，七日选择保留，月视图维持完整网格', async t => {
  const { root } = await setup(t, true);
  assert.equal(findAllByClass(root, 'week-period-cell').length, 4);
  const picker = findAllByClass(root, 'week-day-picker')[0]; assert.equal(buttons(picker).length, 7);
  buttons(picker).at(-1).click(); await tick();
  assert.equal(findAllByClass(root, 'cal-col')[0].dataset.date, weekDates(todayStr()).at(-1));
  button(root, '月视图').click(); await tick();
  assert.equal(findAllByClass(root, 'cal-cell').length, 42);
  assert.equal(findAllByClass(root, 'cal-board')[0].open, true);
});

test('周工具栏安排入口继续打开可搜索的候选任务面板', async t => {
  const { root } = await setup(t);
  button(root, '安排任务').click();
  assert.equal(findAllByClass(root, 'cal-board')[0].open, true);
  assert.ok(findAllByClass(document.body, 'daily-arrange-modal').length);
  assert.ok(findAllByTag(document.body, 'input').some(e => e.getAttribute('aria-label') === '搜索待安排任务'));
});
