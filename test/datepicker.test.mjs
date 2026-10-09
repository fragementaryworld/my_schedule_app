import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass, findAllByTag } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();

const dpUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'datepicker.js')).href;
const dp = await import(dpUrl);

const TODAY = '2024-05-11';
const tick = () => new Promise((r) => setTimeout(r, 10));

// ——— 日历计算 ———

test('日历：monthGrid 为 6 周 × 7 天且周日起始', () => {
  const grid = dp.monthGrid(2024, 5);
  assert.equal(grid.length, 42);
  assert.equal(grid[0].date, '2024-04-28', '2024-05-01 是周三，网格应从上周日起');
  assert.equal(grid[0].inMonth, false);
  assert.equal(grid[3].date, '2024-05-01');
  assert.equal(grid[3].inMonth, true);
  assert.equal(grid[41].date, '2024-06-08');
});

test('日历：shiftMonth 跨年正确', () => {
  assert.deepEqual(dp.shiftMonth(2024, 12, 1), { y: 2025, m: 1 });
  assert.deepEqual(dp.shiftMonth(2024, 1, -1), { y: 2023, m: 12 });
  assert.deepEqual(dp.shiftMonth(2024, 5, 0), { y: 2024, m: 5 });
  assert.equal(dp.monthTitle(2024, 5), '2024年5月');
});

test('日历：isBetween 只包含区间中间（不含两端、支持倒序）', () => {
  assert.equal(dp.isBetween('2024-05-05', '2024-05-01', '2024-05-11'), true);
  assert.equal(dp.isBetween('2024-05-01', '2024-05-01', '2024-05-11'), false);
  assert.equal(dp.isBetween('2024-05-11', '2024-05-01', '2024-05-11'), false);
  assert.equal(dp.isBetween('2024-05-05', '2024-05-11', '2024-05-01'), true);
  assert.equal(dp.isBetween('2024-05-05', null, '2024-05-11'), false);
});

// ——— 日期格式 ———

test('格式：六种 Date format 输出', () => {
  assert.equal(dp.formatDate('2024-05-11', 'full', TODAY), '2024年5月11日 周六');
  assert.equal(dp.formatDate('2024-05-11', 'short', TODAY), '2024年5月11日');
  assert.equal(dp.formatDate('2024-05-11', 'iso', TODAY), '2024-05-11');
  assert.equal(dp.formatDate('2024-05-11', 'mdy', TODAY), '05/11/2024');
  assert.equal(dp.formatDate('2024-05-11', 'ymd', TODAY), '2024/05/11');
});

test('格式：relative 相对日期', () => {
  assert.equal(dp.formatDate(TODAY, 'relative', TODAY), '今天');
  assert.equal(dp.formatDate('2024-05-12', 'relative', TODAY), '明天');
  assert.equal(dp.formatDate('2024-05-10', 'relative', TODAY), '昨天');
  assert.equal(dp.formatDate('2024-05-14', 'relative', TODAY), '3 天后');
  assert.equal(dp.formatDate('2024-05-09', 'relative', TODAY), '2 天前');
});

test('格式：非法输入返回空', () => {
  assert.equal(dp.formatDate('', 'full', TODAY), '');
  assert.equal(dp.formatDate(null, 'full', TODAY), '');
  assert.equal(dp.formatDate('2024-5-1', 'full', TODAY), '');
});

// ——— 值 ↔ 选择器状态 ———

test('状态：单日期只写在 dueDate 上', () => {
  const st = dp.toPickerState({ dueDate: '2024-05-11' });
  assert.equal(st.hasEnd, false);
  assert.equal(st.start, '2024-05-11');
  assert.equal(st.end, null);
  assert.deepEqual(dp.toApiPatch(st), {
    startDate: null, startTime: null, dueDate: '2024-05-11', dueTime: null, dateFormat: 'full'
  });
});

test('状态：区间模式保留起止', () => {
  const st = dp.toPickerState({ startDate: '2024-05-01', dueDate: '2024-05-11' });
  assert.equal(st.hasEnd, true);
  assert.equal(st.start, '2024-05-01');
  assert.equal(st.end, '2024-05-11');
  const patch = dp.toApiPatch(st);
  assert.equal(patch.startDate, '2024-05-01');
  assert.equal(patch.dueDate, '2024-05-11');
});

test('状态：只有 startDate 的历史数据归一到 dueDate', () => {
  const st = dp.toPickerState({ startDate: '2024-05-01' });
  assert.equal(st.hasEnd, false);
  assert.deepEqual(dp.toApiPatch(st), {
    startDate: null, startTime: null, dueDate: '2024-05-01', dueTime: null, dateFormat: 'full'
  });
});

test('状态：Include time 与 Date format 往返', () => {
  const st = dp.toPickerState({ dueDate: '2024-05-11', dueTime: '14:30', dateFormat: 'iso' });
  assert.equal(st.includeTime, true);
  assert.equal(st.startTime, '14:30');
  assert.equal(st.format, 'iso');
  assert.deepEqual(dp.toApiPatch(st), {
    startDate: null, startTime: null, dueDate: '2024-05-11', dueTime: '14:30', dateFormat: 'iso'
  });
  assert.equal(dp.toPickerState({ dueDate: '2024-05-11', dateFormat: 'bogus' }).format, 'full', '非法格式回落默认');
});

test('状态：区间 + 时间 + 格式 的完整补丁', () => {
  const st = { hasEnd: true, start: '2024-05-01', end: '2024-05-11', includeTime: true, startTime: '09:00', endTime: '18:00', format: 'short' };
  assert.deepEqual(dp.toApiPatch(st), {
    startDate: '2024-05-01', startTime: '09:00', dueDate: '2024-05-11', dueTime: '18:00', dateFormat: 'short'
  });
});

// ——— 交互规则 ———

test('交互：单日期模式点一天即设定该天', () => {
  const st = dp.setDay(dp.toPickerState({}), '2024-05-20');
  assert.equal(st.start, '2024-05-20');
  assert.equal(st.hasEnd, false);
});

test('交互：区间模式依次设起止并自动切换端点', () => {
  let st = dp.toPickerState({ startDate: '2024-05-01', dueDate: '2024-05-11' });
  assert.equal(st.editing, 'start');
  st = dp.setDay(st, '2024-05-05');
  assert.equal(st.start, '2024-05-05');
  assert.equal(st.editing, 'end');
  st = dp.setDay(st, '2024-05-20');
  assert.equal(st.end, '2024-05-20');
  assert.equal(st.start, '2024-05-05');
});

test('交互：端点顺序颠倒时自动交换保持 起 ≤ 止', () => {
  const a = dp.setDay({ hasEnd: true, start: '2024-05-01', end: '2024-05-11', editing: 'start' }, '2024-05-20');
  assert.equal(a.start, '2024-05-11');
  assert.equal(a.end, '2024-05-20');
  const b = dp.setDay({ hasEnd: true, start: '2024-05-01', end: '2024-05-11', editing: 'end' }, '2024-04-20');
  assert.equal(b.start, '2024-04-20');
  assert.equal(b.end, '2024-05-01');
});

test('交互：End date 开关', () => {
  const off = dp.toPickerState({ dueDate: '2024-05-11' });
  const on = dp.toggleEnd(off, true);
  assert.equal(on.hasEnd, true);
  assert.equal(on.start, '2024-05-11');
  assert.equal(on.end, '2024-05-11', '开启时结束日期默认与开始同一天');
  const back = dp.toggleEnd(on, false);
  assert.equal(back.hasEnd, false);
  assert.equal(back.end, null);
});

test('交互：Include time 开关', () => {
  const base = dp.toPickerState({ dueDate: '2024-05-11' });
  const on = dp.toggleTime(base, true);
  assert.equal(on.includeTime, true);
  assert.equal(on.startTime, dp.DEFAULT_TIME);
  assert.equal(on.endTime, dp.DEFAULT_TIME);
  assert.equal(dp.toggleTime(on, false).includeTime, false);
});

test('交互：清除只清日期与时间，保留格式', () => {
  const st = dp.clearState({ hasEnd: true, start: '2024-05-01', end: '2024-05-11', includeTime: true, startTime: '09:00', endTime: '10:00', format: 'mdy' });
  assert.equal(st.start, null);
  assert.equal(st.end, null);
  assert.equal(st.hasEnd, false);
  assert.equal(st.includeTime, false);
  assert.equal(st.format, 'mdy');
});

// ——— 展示 ———

test('展示：formatDateValue 单日期/区间/带时间/按格式', () => {
  assert.equal(dp.formatDateValue({ dueDate: '2024-05-11' }, TODAY), '2024年5月11日 周六');
  assert.equal(dp.formatDateValue({ startDate: '2024-05-01', dueDate: '2024-05-11' }, TODAY), '2024年5月1日 周三 → 2024年5月11日 周六');
  assert.equal(dp.formatDateValue({ dueDate: '2024-05-11', dueTime: '14:30' }, TODAY), '2024年5月11日 周六 14:30');
  assert.equal(dp.formatDateValue({ dueDate: '2024-05-11', dateFormat: 'iso' }, TODAY), '2024-05-11');
  assert.equal(dp.formatDateValue({ dueDate: '2024-05-11', dateFormat: 'relative' }, TODAY), '今天');
  assert.equal(dp.formatDateValue({}, TODAY), '');
});

test('展示：hasDateValue', () => {
  assert.equal(dp.hasDateValue({ dueDate: '2024-05-11' }), true);
  assert.equal(dp.hasDateValue({ startDate: '2024-05-11' }), true);
  assert.equal(dp.hasDateValue({}), false);
});

// ——— 组件行为 ———

function makeField(value, today = TODAY) {
  const saved = [];
  const field = dp.buildDateField({ value, today, onSave: (patch) => { saved.push(patch); } });
  return { field, saved };
}

const dayBtn = (field, date) => findAllByClass(field, 'dp-day').find((d) => d.dataset.date === date);

test('组件：默认收起，点击展开日历', () => {
  const { field } = makeField({ dueDate: '2024-05-11' });
  const pop = findAllByClass(field, 'datepicker-pop')[0];
  assert.equal(pop.style.display, 'none');
  assert.equal(findAllByClass(field, 'date-trigger')[0].textContent, '2024年5月11日 周六');
  findAllByClass(field, 'date-trigger')[0].click();
  assert.equal(pop.style.display, '', '应展开');
  assert.equal(findAllByClass(field, 'dp-day').length, 42);
});

test('组件：未选时间时显示占位文案', () => {
  const { field } = makeField({});
  const trigger = findAllByClass(field, 'date-trigger')[0];
  assert.equal(trigger.textContent, '选择时间');
  assert.ok(trigger.classList.contains('empty'));
});

test('组件：点一天保存为 dueDate（单日期）', async () => {
  const { field, saved } = makeField({});
  findAllByClass(field, 'date-trigger')[0].click();
  dayBtn(field, '2024-05-20').click();
  await tick();
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], { startDate: null, startTime: null, dueDate: '2024-05-20', dueTime: null, dateFormat: 'full' });
  assert.equal(findAllByClass(field, 'date-trigger')[0].textContent, '2024年5月20日 周一');
});

test('组件：开启结束日期后保存为区间', async () => {
  const { field, saved } = makeField({ dueDate: '2024-05-11' });
  findAllByClass(field, 'date-trigger')[0].click();
  findAllByClass(field, 'dp-switch-end')[0].click();
  await tick();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].startDate, '2024-05-11');
  assert.equal(saved[0].dueDate, '2024-05-11');

  dayBtn(field, '2024-05-20').click();
  await tick();
  assert.equal(saved[1].startDate, '2024-05-11');
  assert.equal(saved[1].dueDate, '2024-05-20');
  assert.equal(findAllByClass(field, 'dp-chip-end').length, 1, '区间模式出现结束日期按钮');
});

test('组件：开启包含时间会写入默认时间，并可改时间', async () => {
  const { field, saved } = makeField({ dueDate: '2024-05-11' });
  findAllByClass(field, 'date-trigger')[0].click();
  findAllByClass(field, 'dp-switch-time')[0].click();
  await tick();
  assert.equal(saved[0].dueTime, dp.DEFAULT_TIME);

  const timeInput = findAllByClass(field, 'dp-time-start')[0];
  assert.ok(timeInput, '应出现时间输入');
  timeInput.value = '18:30';
  timeInput.fire('change');
  await tick();
  assert.equal(saved[1].dueTime, '18:30');
  assert.equal(saved[1].dateFormat, 'full');
});

test('组件：切换 Date format 会保存并立即影响显示', async () => {
  const { field, saved } = makeField({ dueDate: '2024-05-11' });
  findAllByClass(field, 'date-trigger')[0].click();
  const sel = findAllByClass(field, 'date-format-select')[0];
  assert.equal(sel.value, 'full');
  assert.equal(findAllByTag(sel, 'option').length, dp.DATE_FORMATS.length);
  sel.value = 'iso';
  sel.fire('change');
  await tick();
  assert.equal(saved[0].dateFormat, 'iso');
  assert.equal(findAllByClass(field, 'date-trigger')[0].textContent, '2024-05-11');
});

test('组件：清除会写回空日期', async () => {
  const { field, saved } = makeField({ startDate: '2024-05-01', dueDate: '2024-05-11' });
  findAllByClass(field, 'date-trigger')[0].click();
  findAllByClass(field, 'dp-clear')[0].click();
  await tick();
  assert.deepEqual(saved[0], { startDate: null, startTime: null, dueDate: null, dueTime: null, dateFormat: 'full' });
  assert.equal(findAllByClass(field, 'date-trigger')[0].textContent, '选择时间');
});

test('组件：区间在日历上标出起止与中间范围', () => {
  const { field } = makeField({ startDate: '2024-05-06', dueDate: '2024-05-10' });
  findAllByClass(field, 'date-trigger')[0].click();
  assert.ok(findAllByClass(field, 'is-start').length === 1);
  assert.ok(findAllByClass(field, 'is-end').length === 1);
  assert.equal(findAllByClass(field, 'in-range').length, 3, '7/8/9 三天的范围高亮');
});
