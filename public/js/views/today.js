import { beginRender } from '../view-lifecycle.js';
'use strict';
import { api } from '../api.js';
import { h, toast, confirmDialog, scrollPos, restoreScroll } from '../ui.js';
import { todayStr, isOverdue, priorityLabel, estimateText } from '../utils.js';
import { dailyEntries, dailySections, filterDailyEntries, buildDailyFilters, buildDailyBoard, withPlannedCalendarEntries } from '../daily.js';
import {
  CALENDAR_VIEWS, DAY_TASK_COLOR, weekdayLabels, visibleDates, rangeOf, sortDayEntries,
  periodTitle, shiftAnchor, parseYm, sameMonth, isToday, dayNumber, groupByDate, spanDays,
  projectEntriesByDate, legendFor, expandEntries, spanningEntries, spanBarLayout, tint,
  clampColDelta, dragRangePatch, dragSinglePatch, calendarRangeAfterPatch
} from '../calendar.js';
import { createDayTask, dayTaskHref, timeRangeLabel } from '../daytask.js';
import { attachCalendarDrag, cancelCalendarDrag } from '../calendar-drag.js';
import { PERIODS, planningFor, editPlan, timeConflicts } from '../planning.js';
import { weekPlanningModel, weekMovePatch } from '../week-planning.js';

// 兼容：这些纯函数仍从本模块导出（供既有测试与页面复用）
export { repeatCode, decodeRepeat, repeatLabel, sourceLabel } from '../daytask.js';

let el = null;
let anchor = todayStr();
let view = 'week';
let filters = {};
let paintVersion = 0;
let weekStartPref = 'mon';
let selectedDate = todayStr();
let dayDetailsOpen = false;
let planningEntries = [];
let closeTaskActions = null;
const narrowScreen = () => !!globalThis.matchMedia?.('(max-width: 700px)').matches;
globalThis.matchMedia?.('(max-width: 700px)').addEventListener?.('change', () => { if (el?.isConnected) paint(); });

export function partitionTasks(tasks) {
  const done = [];
  const timed = [];
  const untimed = [];
  for (const t of tasks || []) {
    if (t.done) done.push(t);
    else if (t.time) timed.push(t);
    else untimed.push(t);
  }
  return { timed, untimed, done };
}

async function paint() {
  cancelCalendarDrag();
  const container = el; // 进入时就固定容器，避免旧的异步重绘写进新页面
  const active = beginRender(container);
  if (!active()) return;
  const pos = scrollPos();
  const version = ++paintVersion;
  const { from, to } = rangeOf(anchor, view, weekStartPref);
  const dates = visibleDates(anchor, view, weekStartPref);
  // 每日计划任务 + 工作项目里的所有任务（含各级子任务，跨多天的任务铺满整段）
  const [tasks, projects] = await Promise.all([
    api.get(`/api/tasks?from=${from}&to=${to}&includePool=1`),
    api.get('/api/projects')
  ]);
  if (!active() || version !== paintVersion || container !== el) return;
  const allDaily = dailyEntries(tasks, projects);
  planningEntries = allDaily;
  const key = e => `${e.kind}:${e.kind === 'project' ? e.projectId : ''}:${e.id}`;
  const dailyByKey = new Map(dailyEntries(tasks, projects, true).map(e => [key(e), e]));
  const items = withPlannedCalendarEntries([...(tasks || []).map(toEntry), ...projectEntriesByDate(projects, todayStr())].map(e => {
    // 每日任务的归属来自独立字段；日历仍保留原有拖动所需的数据。
    const daily = dailyByKey.get(key(e));
    return { ...e, category: daily?.category || 'work', projectId: daily?.projectId || null,
      projectName: daily?.projectName || '', ownerKey: daily?.ownerKey, ownerLabel: daily?.ownerLabel, sourceType: daily?.sourceType || '', ancestors: daily?.ancestors || [],
      note: daily?.note || '', desc: daily?.desc || '' };
  }), allDaily);

  container.innerHTML = '';
  try {
    container.append(buildToolbar());
    const content = h('div', { class: 'daily-content' });
    const update = () => {
      cancelCalendarDrag();
      content.innerHTML = '';
      const filtered = filterDailyEntries(items, filters);
      const byDate = groupByDate(expandEntries(filtered, dates));
      const multiDay = spanningEntries(filtered, dates);
      content.append(view === 'month' ? buildMonth(byDate, dates, multiDay) : buildWeek(filterDailyEntries([...dailyByKey.values()], filters), dates));
      content.append(buildLegend(byDate, dates), buildSelectedBoard(filterDailyEntries(allDaily, filters), allDaily));
    };
    container.append(buildDailyFilters(filters, update, projects), content);
    update();
  } finally {
    restoreScroll(pos);
  }
}

function toEntry(t) {
  const from = t.date;
  const to = t.endDate || t.date;
  const span = to && from && to >= from ? { from, to } : { from: t.date, to: t.date };
  return {
    kind: 'day',
    id: t.id,
    title: t.title,
    date: t.date,
    time: timeRangeLabel(t.time, t.endTime),
    done: !!t.done,
    priority: t.priority || 'medium',
    repeat: t.repeat || null,
    repeatOf: t.repeatOf || null,
    source: t.source || null,
    color: DAY_TASK_COLOR,
    detail: (t.note || '').trim(),
    estimate: t.estimate || null,
    spanFrom: span.from,
    spanTo: span.to,
    spanDays: spanDays(span),
    spanStart: true,
    spanEnd: true,
    continued: false,
    overdue: isOverdue(t, todayStr()),
    raw: t
  };
}

function buildToolbar() {
  const wrap = h('div', { class: 'cal-toolbar' });

  // 第一行：左边视图切换，右边新增任务，中间用分隔撑开
  const top = h('div', { class: 'row cal-toolbar-top', style: 'flex-wrap:wrap;gap:8px' });

  const tabs = h('div', { class: 'tabbar cal-views', style: 'margin:0;border:none' });
  for (const v of CALENDAR_VIEWS) {
    const b = h('button', { class: 'tab' + (view === v.value ? ' active' : '') }, v.label);
    b.onclick = () => { view = v.value; anchor = selectedDate; paint(); };
    tabs.append(b);
  }
  top.append(tabs);

  // 分隔：把新增任务推到最右边，与视图窗口分开
  top.append(h('span', { class: 'spacer cal-toolbar-gap' }));

  if (view === 'week') {
    const arrange = h('button', { class: 'btn btn-sm', 'aria-label': '安排任务' }, '安排任务');
    arrange.onclick = () => {
      const board = el.querySelector('.cal-board');
      if (!board) return;
      board.open = true; dayDetailsOpen = true;
      board.querySelector('[aria-label="安排任务"]')?.click();
    };
    top.append(arrange);
  }

  const addBtn = h('button', { class: 'btn btn-primary btn-sm add-day-task cal-add' }, '＋ 新增任务');
  addBtn.onclick = () => addTask();
  top.append(addBtn);
  wrap.append(top);

  const nav = h('div', { class: 'row cal-nav' });
  nav.append(h('span', { class: 'cal-period' }, periodTitle(anchor, view)));
  nav.append(h('span', { class: 'spacer' }));
  const prev = h('button', { class: 'icon-btn cal-prev', title: '上一页' }, '‹');
  const todayBtn = h('button', { class: 'btn btn-sm' }, '今天');
  const next = h('button', { class: 'icon-btn cal-next', title: '下一页' }, '›');
  prev.onclick = () => { selectedDate = shiftAnchor(selectedDate, view, -1); anchor = selectedDate; paint(); };
  next.onclick = () => { selectedDate = shiftAnchor(selectedDate, view, 1); anchor = selectedDate; paint(); };
  todayBtn.onclick = () => { anchor = todayStr(); selectedDate = anchor; paint(); };
  nav.append(prev, todayBtn, next);
  wrap.append(nav);

  return wrap;
}

function buildWeekdays() {
  const row = h('div', { class: 'cal-weekdays' });
  for (const label of weekdayLabels(weekStartPref)) row.append(h('div', { class: 'cal-wd' }, label));
  return row;
}

// 跨天任务用连续 block 画在顶部，单日任务仍放在当天格子里
const SPAN_TOP = 34;
const SPAN_LANE_H = 28;
// 拖动期间抑制随之而来的 click（否则会顺手把日期选中/打开页面）
let suppressClick = false;
function suppressNextClick() {
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
}

async function saveEntryPatch(entry, patch) {
  if (!patch) return;
  if (entry.kind === 'project') await api.put(entry.base, patch);
  else await api.put(`/api/tasks/${entry.id}`, patch);
  toast('时间已更新');
  try { await paint(); }
  catch (error) { toast(`时间已保存，刷新失败：${error.message}`, 'error'); }
}

// 统一拖动生命周期：连续预览、按帧更新、目标提示、取消和保存失败恢复。
function attachDrag(handle, opts) {
  attachCalendarDrag(handle, {
    ...opts, suppressClick: suppressNextClick, savePatch: opts.savePatch || saveEntryPatch,
    onError: error => toast(`保存失败：${error.message}`, 'error')
  });
}

function buildRow(rowDates, byDate, opts) {
  const { month, y, m, multiDay } = opts;
  const layout = spanBarLayout(multiDay, rowDates);
  const padTop = layout.laneCount * SPAN_LANE_H;

  const row = h('div', { class: 'cal-row ' + (month ? 'cal-month-row' : 'cal-week-row') });
  for (let col = 0; col < rowDates.length; col += 1) {
    const d = rowDates[col];
    const cell = h('div', {
      class: (month ? 'cal-cell' : 'cal-col')
        + (month && !sameMonth(d, y, m) ? ' outside' : '')
        + ([0, 6].includes(new Date(d + 'T12:00:00').getDay()) ? ' weekend' : '')
        + (isToday(d) ? ' today' : '')
        + (d === selectedDate ? ' selected' : ''),
      dataset: { date: d }
    });
    cell.append(h('div', { class: month ? 'cal-cell-head' : 'cal-col-head' },
      h('span', { class: 'cal-daynum' }, String(dayNumber(d)))));

    const list = h('div', { class: 'cal-cards', style: padTop ? `padding-top:${padTop}px` : '' });
    // 跨天任务由上面的连续 block 表示，这里只列当天的单日任务
    const entries = sortDayEntries(byDate.get(d) || []).filter((e) => !(e.spanDays > 1));
    const max = month ? 3 : entries.length;
    for (const e of entries.slice(0, max)) list.append(buildCard(e, { row, dates: rowDates, col }));
    if (entries.length > max) list.append(h('div', { class: 'cal-more' }, `+${entries.length - max}`));
    cell.append(list);

    cell.onclick = () => selectDate(d);
    row.append(cell);
  }
  if (layout.bars.length) row.append(buildSpanLayer(layout, rowDates.length, row, rowDates));
  return row;
}

function buildSpanLayer(layout, cols, row, dates, week = null) {
  const layer = h('div', { class: 'cal-span-layer' });
  for (const bar of layout.bars) {
    const e = bar.entry;
    const pct = (n) => `${(n / cols) * 100}%`;
    const el = h('div', {
      ...eventProps(e),
      class: 'cal-event cal-span'
        + (bar.continuesLeft ? ' clip-left' : '')
        + (bar.continuesRight ? ' clip-right' : '')
        + (e.done ? ' done' : ''),
      style: `left:${pct(bar.startCol)};width:${pct(bar.endCol - bar.startCol + 1)};`
        + `top:${SPAN_TOP + bar.lane * SPAN_LANE_H}px;${eventStyle(e)}`
    });
    el.onclick = (ev) => {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      if (suppressClick) return;
      openEntry(e);
    };

    const resetSpan = () => {
      el.style.transform = ''; el.style.left = pct(bar.startCol);
      el.style.width = pct(bar.endCol - bar.startCol + 1); el.classList.remove('dragging');
      layer.classList.remove('dragging-layer');
    };
    // 整体平移
    attachDrag(el, {
      ...(week ? weekDragOptions(e, row) : {}),
      entry: e,
      row,
      dates,
      clamp: (delta) => clampColDelta('move', bar.startCol, bar.endCol, delta, cols),
      crossRows: true,
      onPreview: (_, __, position) => {
        el.classList.add('dragging');
        if (week) layer.classList.add('dragging-layer');
        el.style.transform = `translate3d(${position.dx}px,${position.dy}px,0)`;
      },
      onEnd: resetSpan,
      patchOf: (delta, target) => week ? weekEventPatch(e, delta, target) : dragRangePatch(e, delta, 'move')
    });

    attachRangeHandles(el, e, { row, dates, clippedStart: bar.continuesLeft, clippedEnd: bar.continuesRight,
      previewTop: SPAN_TOP + bar.lane * SPAN_LANE_H, onEnd: resetSpan, week });

    if (bar.continuesLeft) el.append(h('span', { class: 'cal-span-clip' }, '◀'));
    if (e.time) el.append(h('span', { class: 'cal-event-time' }, e.time));
    el.append(h('span', { class: 'cal-span-title' }, e.title));
    el.append(h('span', { class: 'cal-span-days' }, `${e.spanDays} 天`));
    if (bar.continuesRight) el.append(h('span', { class: 'cal-span-clip' }, '▶'));
    if (week) appendTaskAction(el, e, dates[bar.startCol]);
    layer.append(el);
  }
  return layer;
}

function buildWeek(entries, weekDates) {
  const wrap = h('div', { class: 'cal cal-week' });
  const dates = narrowScreen() ? [selectedDate] : weekDates;
  if (dates.length === 1) {
    const nav = h('div', { class: 'week-day-picker', 'aria-label': '选择周内日期' });
    for (const date of weekDates) {
      const button = h('button', { class: 'btn btn-sm' + (date === selectedDate ? ' active' : ''), 'aria-pressed': String(date === selectedDate) }, `${['日','一','二','三','四','五','六'][new Date(date + 'T12:00:00').getDay()]} ${dayNumber(date)}`);
      button.onclick = () => { selectedDate = date; paint(); }; nav.append(button);
    }
    wrap.append(nav);
  } else wrap.append(buildWeekdays());
  const model = weekPlanningModel(entries, dates);
  const contexts = spanBarLayout(model.contexts.filter(e => e.spanDays > 1), dates);
  const hasContext = model.contexts.some(e => e.spanFrom <= dates.at(-1) && e.spanTo >= dates[0]);
  const offset = hasContext ? 3 : 2;
  const layouts = PERIODS.map(period => spanBarLayout(model.spans.filter(e => e.weekPeriod === period.value), dates));
  const row = h('div', { class: 'cal-row cal-week-row week-period-grid', style: `grid-template-columns:repeat(${dates.length},minmax(0,1fr))` });
  for (const [col, date] of dates.entries()) {
    const cell = h('div', { class: 'cal-col' + (isToday(date) ? ' today' : '') + (date === selectedDate ? ' selected' : ''), dataset: { date } });
    const place = gridRow => `grid-column:${col + 1};grid-row:${gridRow}`;
    const head = h('button', { type: 'button', class: 'cal-col-head week-date-head', style: place(1), 'aria-label': `查看 ${date} 的任务详情` }, h('span', { class: 'cal-daynum' }, String(dayNumber(date))));
    head.onclick = ev => { ev.stopPropagation(); selectDate(date); }; cell.append(head);
    if (hasContext) {
      const context = h('div', { class: 'week-date-context', style: `${place(2)};min-height:${SPAN_TOP + contexts.laneCount * SPAN_LANE_H + 8}px` });
      context.append(h('span', { class: 'small muted' }, '日期范围'));
      const list = h('div', { class: 'cal-cards', style: `padding-top:${contexts.laneCount * SPAN_LANE_H}px` });
      for (const e of model.contexts.filter(e => e.spanDays <= 1 && e.spanFrom === date)) list.append(buildCard(e, { row, dates, col, week: { gridRow: 2 } }));
      context.append(list); cell.append(context);
    }
    for (const [index, period] of PERIODS.entries()) {
      const events = model.days.get(date).filter(e => e.weekPeriod === period.value);
      const gridRow = offset + index;
      const section = h('section', { class: `week-period-cell daily-period daily-period-${period.value || 'unassigned'}`,
        dataset: { date, period: period.value }, style: place(gridRow), 'aria-label': `${date} ${period.label}` });
      section.append(h('div', { class: 'week-period-head' }, h('span', {}, period.value ? period.label : '待安排'), h('span', { class: 'daily-count' }, String(events.filter(e => !e.done).length))));
      const list = h('div', { class: 'cal-cards', style: `padding-top:${layouts[index].laneCount * SPAN_LANE_H}px` });
      for (const e of events.filter(e => e.spanDays <= 1)) list.append(buildCard(e, { row, dates, col, week: { gridRow, period: period.value } }));
      if (!events.length) list.append(h('span', { class: 'week-period-empty muted' }, '—'));
      section.append(list); cell.append(section);
    }
    cell.onclick = () => selectDate(date); row.append(cell);
  }
  const addLayer = (layout, gridRow, period) => {
    if (!layout.bars.length) return;
    const layer = buildSpanLayer(layout, dates.length, row, dates, { gridRow, period });
    layer.classList.add('week-period-span-layer');
    layer.setAttribute('style', `grid-column:1 / -1;grid-row:${gridRow}`); row.append(layer);
  };
  addLayer(contexts, 2);
  for (const [index, period] of PERIODS.entries()) addLayer(layouts[index], offset + index, period.value);
  wrap.append(row);
  wrap.append(h('p', { class: 'week-planning-hint small muted' }, '拖动任务调整日期或时段；两端拉伸跨天范围。跨天安排的时段、具体时间和完成状态共同生效。'));
  return wrap;
}

function weekDragOptions(entry, row) {
  return {
    resolveTarget: event => {
      const cells = [...row.querySelectorAll('.week-period-cell')];
      const measured = cells.filter(cell => cell.getBoundingClientRect?.().width > 0);
      // Non-layout environments still support horizontal date changes.
      if (!measured.length) return entry.weekContext ? undefined : { period: entry.weekPeriod };
      const hit = cell => {
        const r = cell.getBoundingClientRect?.();
        return r && event.clientX >= r.left && event.clientX < r.left + r.width && event.clientY >= r.top && event.clientY < r.top + r.height;
      };
      const target = measured.find(hit);
      if (target) return { period: target.dataset.period, label: PERIODS.find(p => p.value === target.dataset.period).label };
      if (entry.weekContext && [...row.querySelectorAll('.week-date-context')].some(hit)) return { context: true, label: '原日期范围' };
      return { valid: false };
    },
    highlightCell: (cell, target) => target?.context ? cell.querySelector('.week-date-context') : [...cell.querySelectorAll('.week-period-cell')].find(c => c.dataset.period === (target?.period ?? entry.weekPeriod)),
    rangeAfterPatch: (e, patch) => calendarRangeAfterPatch(patch?.planDate ? asWeekPlan(e) : e, patch),
    savePatch: (e, patch) => e.weekContext && !patch.planDate ? saveEntryPatch(e, patch) : saveWeekPatch(asWeekPlan(e), patch)
  };
}

function asWeekPlan(entry) {
  return entry.weekContext ? { ...entry, planOnly: true, weekPeriod: '', planTime: '', planEndTime: '' } : entry;
}

function weekEventPatch(entry, delta, target) {
  if (entry.weekContext && !(target && 'period' in target)) return entry.spanDays > 1 ? dragRangePatch(entry, delta) : dragSinglePatch(entry, delta);
  const plan = asWeekPlan(entry);
  const patch = weekMovePatch(plan, delta, target?.period ?? plan.weekPeriod);
  if (!patch && entry.weekContext) return { planDate: entry.spanFrom, planEndDate: entry.spanDays > 1 ? entry.spanTo : null,
    planPeriod: target.period || null, planTime: null, planEndTime: null, planOrder: null };
  return patch;
}

async function saveWeekPatch(entry, patch) {
  const periodChanged = 'planPeriod' in patch && (patch.planPeriod || '') !== entry.weekPeriod;
  const { from, to: until } = calendarRangeAfterPatch(entry, patch);
  const replacingPlan = entry.deadlineOnly && entry.raw?.planDate;
  if (replacingPlan || (periodChanged && entry.planTime) || timeConflicts(planningEntries, from, entry.base, patch.planTime ?? entry.planTime, patch.planEndTime ?? entry.planEndTime, until).length) {
    const raw = { ...entry.raw, ...patch };
    const draft = { ...entry.original, ...raw, raw };
    toast(replacingPlan ? '任务已有安排；保存会替换原安排，请确认日期范围' : periodChanged ? '原任务有具体时间，请确认新的时段或时间后保存' : '新日期存在时间重叠，请检查后保存');
    await editPlan(draft, from, async (e, changes) => { await saveEntryPatch(e, changes); return true; }, planningEntries);
    return;
  }
  await saveEntryPatch(entry, patch);
}

function buildMonth(byDate, dates, multiDay) {
  const { y, m } = parseYm(anchor);
  const wrap = h('div', { class: 'cal cal-month' });
  wrap.append(buildWeekdays());

  const grid = h('div', { class: 'cal-month-grid' });
  for (let i = 0; i < dates.length; i += 7) {
    grid.append(buildRow(dates.slice(i, i + 7), byDate, { month: true, y, m, multiDay }));
  }
  wrap.append(grid);
  return wrap;
}

function eventStyle(e) {
  const color = e.color || DAY_TASK_COLOR;
  return `--event-color:${color};background:${tint(color, .14)};border-left:3px solid ${color}`;
}

function eventProps(e) {
  const title = [e.title, e.time, e.ownerLabel || e.projectName,
    e.deadlineOnly ? `截止 ${e.original?.dueDate || e.original?.endDate}${e.original?.dueTime ? ` ${e.original.dueTime}` : ''} · 尚未安排执行` : e.weekContext ? '原日期范围，尚未安排执行时段' : '',
    e.spanDays > 1 ? `${e.spanFrom} → ${e.spanTo} · ${e.spanDays} 天` : e.date,
    estimateText(e), e.priority ? priorityLabel(e.priority) : '',
    e.repeat || e.repeatOf ? '重复任务' : '', e.done ? '已完成' : e.overdue ? '逾期' : ''].filter(Boolean).join(' · ');
  return { title, role: 'link', tabindex: '0', 'aria-label': title,
    onkeydown: ev => { if (ev.key === 'Enter' && !suppressClick) { ev.preventDefault(); openEntry(e); } } };
}

// 拉伸时按实际日期范围在各周行绘制预览，不把整段挤在起始周行里。
function attachRangeHandles(element, entry, { row, dates, clippedStart = false, clippedEnd = false, previewTop = SPAN_TOP, onEnd, week } = {}) {
  let calendar = row;
  while (calendar && !calendar.classList.contains('cal')) calendar = calendar.parentNode;
  // 构建阶段尚未挂到日历上，第一次预览时再寻找根节点。
  const previews = new Map();
  const preview = (_, __, range) => {
    if (!calendar) { calendar = row; while (calendar && !calendar.classList.contains('cal')) calendar = calendar.parentNode; }
    element.classList.add('resizing');
    for (const targetRow of calendar?.querySelectorAll('.cal-row') || []) {
      const cells = [...targetRow.children].filter(c => c.dataset.date);
      const columns = cells.map((cell, i) => cell.dataset.date >= range.from && cell.dataset.date <= range.to ? i : -1).filter(i => i >= 0);
      let ghost = previews.get(targetRow);
      if (!range.valid || !columns.length) { ghost?.remove(); previews.delete(targetRow); continue; }
      if (!ghost) {
        ghost = h('div', { class: 'cal-event cal-range-preview', 'aria-hidden': 'true' }, entry.title);
        targetRow.append(ghost); previews.set(targetRow, ghost);
      }
      ghost.setAttribute('style', `${week ? `grid-column:1 / -1;grid-row:${week.gridRow};` : ''}left:${columns[0] / cells.length * 100}%;width:${columns.length / cells.length * 100}%;top:${previewTop}px;${eventStyle(entry)}`);
    }
  };
  const restore = () => {
    for (const ghost of previews.values()) ghost.remove();
    previews.clear(); element.classList.remove('resizing'); onEnd?.();
  };
  for (const mode of ['start', 'end']) {
    if ((mode === 'start' && clippedStart) || (mode === 'end' && clippedEnd)) continue;
    const side = mode === 'start' ? 'left' : 'right';
    const single = element.classList.contains('cal-card');
    const handle = h('span', {
      class: `cal-resize-handle ${single ? `cal-grip ${mode === 'start' ? 'cal-card-start' : 'cal-card-stretch'}` : 'cal-span-handle'} ${side}`,
      title: `拖动调整${mode === 'start' ? '开始' : '结束'}日期`
    });
    attachDrag(handle, { entry, row, dates, crossRows: true, resize: mode,
      clamp: delta => mode === 'start' ? Math.min(entry.spanDays - 1, delta) : Math.max(1 - entry.spanDays, delta),
      savePatch: week && !entry.weekContext ? saveWeekPatch : saveEntryPatch,
      highlightCell: week ? cell => [...cell.querySelectorAll('.week-period-cell')].find(c => c.dataset.period === entry.weekPeriod) : undefined,
      onPreview: preview, onEnd: restore, patchOf: delta => week && !entry.weekContext ? weekMovePatch(entry, delta, entry.weekPeriod, mode) : dragRangePatch(entry, delta, mode) });
    element.append(handle);
  }
}

function buildCard(e, ctx) {
  const card = h('div', {
    ...eventProps(e),
    class: 'cal-event cal-card'
      + (e.done ? ' done' : '')
      + (e.kind === 'project' ? ' from-project' : '')
      + (e.spanDays > 1 ? ' spanning' : '')
      + (e.continued ? ' continued' : '')
      + (e.spanDays > 1 && e.spanEnd ? ' span-end' : ''),
    style: eventStyle(e)
  });
  // 卡片上的点击不要冒泡到格子，避免"想点任务却变成选日期"
  card.onclick = ev => {
    ev.stopPropagation();
    if (!suppressClick) openEntry(e);
  };

  const body = h('div', { class: 'cal-card-body' });
  const titleRow = h('div', { class: 'row cal-card-titlerow' });
  if (e.time) titleRow.append(h('span', { class: 'cal-event-time' }, e.time));
  if (e.deadlineOnly) titleRow.append(h('span', { class: 'cal-event-deadline' }, '截止'));
  const title = h('span', { class: 'cal-card-title row-link' }, e.title);
  titleRow.append(title);

  // 整条任务都可改期；两端拉伸日期，明确安排只修改安排区间。
  if (ctx) {
    card.classList.add('cal-card-move');
    attachDrag(card, {
      ...(ctx.week ? weekDragOptions(e, ctx.row) : {}),
      entry: e,
      row: ctx.row,
      dates: ctx.dates,
      clamp: (delta) => clampColDelta('move', ctx.col, ctx.col, delta, ctx.dates.length),
      crossRows: true,
      onPreview: (_, __, position) => {
        card.classList.add('dragging');
        card.style.transform = `translate3d(${position.dx}px,${position.dy}px,0)`;
      },
      onEnd: () => { card.style.transform = ''; card.classList.remove('dragging'); },
      patchOf: (delta, target) => ctx.week ? weekEventPatch(e, delta, target) : dragSinglePatch(e, delta)
    });
    attachRangeHandles(card, e, { row: ctx.row, dates: ctx.dates, week: ctx.week });
  }

  body.append(titleRow);
  if (e.repeat || e.repeatOf) titleRow.append(h('span', { class: 'cal-event-repeat', 'aria-hidden': 'true' }, '↻'));
  card.append(body);
  if (ctx?.week) appendTaskAction(card, e, ctx.dates[ctx.col]);
  return card;
}

// Keep navigation on the event title; the small action button operates in the week view.
function appendTaskAction(element, entry, date) {
  const button = h('button', { type: 'button', class: 'cal-event-action', 'aria-label': `操作任务：${entry.title}`, title: '完成或调整安排' }, '⋯');
  for (const type of ['mousedown', 'pointerdown', 'keydown']) button.addEventListener(type, ev => ev.stopPropagation());
  button.onclick = ev => { ev.stopPropagation(); if (!suppressClick) showTaskActions(entry.original || entry, date, button); };
  element.append(button);
}

function showTaskActions(entry, date, trigger) {
  closeTaskActions?.();
  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', { class: 'modal modal-sm week-task-actions', role: 'dialog', 'aria-modal': 'true', 'aria-label': entry.title });
  const close = () => {
    backdrop.remove(); document.removeEventListener('keydown', keydown);
    if (closeTaskActions === close) {
      closeTaskActions = null;
      if (trigger.isConnected) trigger.focus();
      else [...el?.querySelectorAll('.cal-col') || []].find(c => c.dataset.date === selectedDate)?.querySelector('.week-date-head')?.focus();
    }
  };
  const buttons = [];
  const keydown = ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    if (ev.key === 'Tab') {
      const enabled = buttons.filter(b => !b.disabled), first = enabled[0], last = enabled.at(-1);
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
  };
  closeTaskActions = close;
  const action = (label, handler, primary = false) => {
    const button = h('button', { type: 'button', class: 'btn' + (primary ? ' btn-primary' : '') }, label);
    button.onclick = async () => { button.disabled = true; try { await handler(); } catch (err) { toast(err.message, 'error'); } finally { button.disabled = false; } };
    buttons.push(button); return button;
  };
  const p = planningFor(entry, date);
  const info = [entry.ownerLabel, date, p.time ? timeRangeLabel(p.time, p.endTime) : PERIODS.find(o => o.value === p.period)?.label,
    entry.planEndDate ? `整个安排：${entry.planDate} → ${entry.planEndDate}` : '',
    entry.dueDate ? `截止 ${entry.dueDate}${entry.dueTime ? ` ${entry.dueTime}` : ''}` : ''].filter(Boolean).join(' · ');
  const body = h('div', { class: 'modal-body' }, h('p', { class: 'small muted' }, info));
  body.append(action(entry.done ? '标记为未完成' : '完成任务', async () => { await api.put(entry.base, { done: !entry.done }); await paint(); close(); }, true));
  body.append(action('调整日期或时间', () => {
    close(); return editPlan(entry, date, async (e, patch) => { await saveEntryPatch(e, patch); return true; }, planningEntries);
  }));
  if (entry.planDate) body.append(action(entry.planEndDate ? '撤销这段安排' : '撤销当天安排', async () => { await saveEntryPatch(entry, { planDate: null }); close(); }));
  body.append(action('打开任务详情', () => { close(); openEntry(entry); }));
  const dismiss = action('关闭', close);
  modal.append(h('div', { class: 'modal-title' }, entry.title), body, h('div', { class: 'modal-foot' }, dismiss));
  backdrop.onclick = ev => { if (ev.target === backdrop) close(); };
  backdrop.append(modal); document.body.append(backdrop); document.addEventListener('keydown', keydown); buttons[0].focus();
}

// 图例：颜色 → 来源
function buildLegend(byDate, dates) {
  const all = [];
  for (const d of dates) all.push(...(byDate.get(d) || []));
  const items = legendFor(all);
  const row = h('div', { class: 'cal-legend-row' });
  if (!items.length) {
    row.append(h('span', { class: 'small muted' }, '当前范围还没有任务'));
    return row;
  }
  for (const it of items) {
    row.append(h('span', { class: 'cal-legend-item' },
      h('i', { class: 'cal-dot', style: `background:${it.color}` }),
      it.label));
  }
  return row;
}

// 周/月视图共用选中日期的分类看板，包含未设置截止日期的当天安排。
function buildSelectedBoard(entries, allEntries) {
  const sections = dailySections(entries, selectedDate);
  const pending = sections.planned.length + sections.due.length;
  const total = pending + sections.done.length;
  const wrap = h('details', { class: 'cal-board card', 'aria-label': '所选日期任务看板' });
  wrap.open = view === 'month' || dayDetailsOpen;
  wrap.addEventListener('toggle', () => { if (view === 'week' && el?.querySelector('.cal-board') === wrap) dayDetailsOpen = wrap.open; });
  const head = h('summary', { class: 'row cal-board-head' });
  head.append(h('span', { class: 'cal-board-date' }, selectedLabel()));
  head.append(h('span', { class: 'spacer' }));
  head.append(h('span', { class: 'small muted' }, total ? `共 ${total} 项 · 待办 ${pending} · 已完成 ${sections.done.length}` : '这一天还没有任务'));
  wrap.append(head, buildDailyBoard(entries, selectedDate, paint, { onRemove: removeEntry, allEntries }));
  return wrap;
}

// 删除任务（项目任务删它自己那一层，含其子任务；每日任务删整条/整个系列）
async function removeEntry(entry) {
  const extra = entry.repeat
    ? '（重复任务会删除整个系列）'
    : (entry.subtaskCount ? `（会连同 ${entry.subtaskCount} 个子任务一起删除）` : '');
  if (!(await confirmDialog(`确认删除「${entry.title}」？${extra}`, { danger: true }))) return;
  if (entry.kind === 'project') await api.del(entry.base);
  else await api.del(`/api/tasks/${entry.id}`);
  toast('已删除');
  paint();
}

function selectedLabel() {
  const d = parseYm(selectedDate);
  const wd = ['日', '一', '二', '三', '四', '五', '六'][new Date(d.y, d.m - 1, dayNumber(selectedDate)).getDay()];
  return `${d.y}年${d.m}月${dayNumber(selectedDate)}日 周${wd} 的任务看板`;
}

function selectDate(date) {
  if (suppressClick) return; // 刚拖完不顺手改选中日期
  selectedDate = date;
  dayDetailsOpen = true;
  paint();
}

// 标题点进入对应页面（页面式编辑，不再弹窗）
function openEntry(e) {
  location.hash = e.kind === 'project' ? e.href : dayTaskHref(e.id);
}

async function addTask() {
  await createDayTask(selectedDate);
}

export async function render(container) {
  closeTaskActions?.();
  dayDetailsOpen = false;
  el = container;
  const active = beginRender(container);
  anchor = todayStr();
  selectedDate = todayStr();
  try {
    const prefs = await api.get('/api/preferences');
    weekStartPref = prefs && prefs.weekStart === 'sun' ? 'sun' : 'mon';
  } catch (err) {
    weekStartPref = 'mon';
  }
  if (active()) await paint();
}

export function add() {
  return addTask();
}
