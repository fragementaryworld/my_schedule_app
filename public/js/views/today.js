import { beginRender } from '../view-lifecycle.js';
import { PERIODS } from '../planning.js';
'use strict';
import { api } from '../api.js';
import { h, toast, confirmDialog, scrollPos, restoreScroll } from '../ui.js';
import { todayStr, escapeHtml, isOverdue, priorityClass, priorityLabel, estimateText } from '../utils.js';
import { dailyEntries, dailySections, filterDailyEntries, buildDailyFilters, buildDailyBoard, withPlannedCalendarEntries } from '../daily.js';
import {
  CALENDAR_VIEWS, DAY_TASK_COLOR, weekdayLabels, visibleDates, rangeOf, sortDayEntries,
  periodTitle, shiftAnchor, parseYm, sameMonth, isToday, dayNumber, groupByDate, spanDays,
  projectEntriesByDate, legendFor, expandEntries, spanningEntries, spanBarLayout, tint,
  clampColDelta, dragRangePatch, dragSinglePatch
} from '../calendar.js';
import { createDayTask, dayTaskHref, timeRangeLabel } from '../daytask.js';
import { attachCalendarDrag, cancelCalendarDrag } from '../calendar-drag.js';

// 兼容：这些纯函数仍从本模块导出（供既有测试与页面复用）
export { repeatCode, decodeRepeat, repeatLabel, sourceLabel } from '../daytask.js';

let el = null;
let anchor = todayStr();
let view = 'week';
let filters = {};
let paintVersion = 0;
let weekStartPref = 'mon';
let selectedDate = todayStr();

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
      content.append(view === 'month' ? buildMonth(byDate, dates, multiDay) : buildWeek(byDate, dates, multiDay));
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
    ...opts, suppressClick: suppressNextClick, savePatch: saveEntryPatch,
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
    for (const e of entries.slice(0, max)) list.append(buildCard(e, month, { row, dates: rowDates, col }));
    if (entries.length > max) list.append(h('div', { class: 'cal-more' }, `+${entries.length - max}`));
    cell.append(list);

    cell.onclick = () => selectDate(d);
    row.append(cell);
  }
  if (layout.bars.length) row.append(buildSpanLayer(layout, rowDates.length, row, rowDates));
  return row;
}

function buildSpanLayer(layout, cols, row, dates) {
  const layer = h('div', { class: 'cal-span-layer' });
  for (const bar of layout.bars) {
    const e = bar.entry;
    const pct = (n) => `${(n / cols) * 100}%`;
    const el = h('div', {
      class: 'cal-span'
        + (bar.continuesLeft ? ' clip-left' : '')
        + (bar.continuesRight ? ' clip-right' : '')
        + (e.done ? ' done' : ''),
      style: `left:${pct(bar.startCol)};width:${pct(bar.endCol - bar.startCol + 1)};`
        + `top:${SPAN_TOP + bar.lane * SPAN_LANE_H}px;background:${e.color || DAY_TASK_COLOR}`,
      title: `${e.title}（${e.spanFrom} → ${e.spanTo}，共 ${e.spanDays} 天）`
    });
    el.onclick = (ev) => {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      if (suppressClick) return;
      openEntry(e);
    };

    const resetSpan = () => {
      el.style.transform = ''; el.style.left = pct(bar.startCol);
      el.style.width = pct(bar.endCol - bar.startCol + 1); el.classList.remove('dragging');
    };
    // 整体平移
    attachDrag(el, {
      entry: e,
      row,
      dates,
      clamp: (delta) => clampColDelta('move', bar.startCol, bar.endCol, delta, cols),
      crossRows: true,
      onPreview: (_, __, position) => {
        el.classList.add('dragging');
        el.style.transform = `translate3d(${position.dx}px,${position.dy}px,0)`;
      },
      onEnd: resetSpan,
      patchOf: (delta) => dragRangePatch(e, delta, 'move')
    });

    // 两端把手：单独调整开始 / 结束
    const leftH = h('span', { class: 'cal-span-handle left', title: '拖动调整开始日期' });
    const rightH = h('span', { class: 'cal-span-handle right', title: '拖动调整结束日期' });
    attachDrag(leftH, {
      entry: e,
      row,
      dates,
      clamp: (delta) => clampColDelta('start', bar.startCol, bar.endCol, delta, cols),
      onPreview: (delta) => {
        el.style.left = pct(bar.startCol + delta);
        el.style.width = pct(bar.endCol - (bar.startCol + delta) + 1);
      },
      onEnd: resetSpan,
      patchOf: (delta) => dragRangePatch(e, delta, 'start')
    });
    attachDrag(rightH, {
      entry: e,
      row,
      dates,
      clamp: (delta) => clampColDelta('end', bar.startCol, bar.endCol, delta, cols),
      onPreview: (delta) => { el.style.width = pct(bar.endCol + delta - bar.startCol + 1); },
      onEnd: resetSpan,
      patchOf: (delta) => dragRangePatch(e, delta, 'end')
    });
    el.append(leftH);

    if (bar.continuesLeft) el.append(h('span', { class: 'cal-span-clip' }, '◀'));
    el.append(h('span', { class: 'cal-span-title' }, escapeHtml(e.title)));
    el.append(h('span', { class: 'cal-span-days' }, `${e.spanDays} 天`));
    if (bar.continuesRight) el.append(h('span', { class: 'cal-span-clip' }, '▶'));
    el.append(rightH);
    layer.append(el);
  }
  return layer;
}

function buildWeek(byDate, dates, multiDay) {
  const wrap = h('div', { class: 'cal cal-week' });
  wrap.append(buildWeekdays());
  wrap.append(buildRow(dates, byDate, { month: false, multiDay }));
  return wrap;
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

function buildCard(e, compact, ctx) {
  const card = h('div', {
    class: 'cal-card'
      + (e.done ? ' done' : '')
      + (e.kind === 'project' ? ' from-project' : '')
      + (e.spanDays > 1 ? ' spanning' : '')
      + (e.continued ? ' continued' : '')
      + (e.spanDays > 1 && e.spanEnd ? ' span-end' : ''),
    style: `background:${tint(e.color || DAY_TASK_COLOR)};border-left: 3px solid ${e.color || DAY_TASK_COLOR}`,
    title: e.title
  });
  // 卡片上的点击不要冒泡到格子，避免"想点任务却变成选日期"
  card.onclick = (ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); };

  const cb = h('input', { type: 'checkbox', class: 'task-check cal-check' });
  cb.checked = !!e.done;
  cb.onclick = async (ev) => {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    await toggleEntry(e);
  };
  card.append(cb);

  const body = h('div', { class: 'cal-card-body' });
  const titleRow = h('div', { class: 'row cal-card-titlerow' });
  titleRow.append(h('i', { class: 'cal-dot', style: `background:${e.color || DAY_TASK_COLOR}` }));
  if (e.continued) titleRow.append(h('span', { class: 'cal-cont', title: `延续自 ${e.spanFrom}` }, '↳'));
  const title = h('span', { class: 'cal-card-title row-link' }, escapeHtml(e.title));
  title.onclick = (ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); openEntry(e); };
  titleRow.append(title);

  // 单日任务也能拖动：⠿ 改期，右边缘拉伸等于改结束日期（拉长后就是跨天 block）
  if (ctx) {
    const move = h('span', { class: 'cal-grip cal-card-move', title: '拖动改期' }, '⠿');
    attachDrag(move, {
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
      patchOf: (delta) => dragSinglePatch(e, delta)
    });
    titleRow.append(move);

    if (!e.planOnly) {
      const stretch = h('span', { class: 'cal-grip cal-card-stretch', title: '拖动调整结束日期' });
      attachDrag(stretch, {
        entry: e,
        row: ctx.row,
        dates: ctx.dates,
        clamp: (delta) => clampColDelta('end', ctx.col, ctx.col, delta, ctx.dates.length),
        onPreview: (delta, colW) => { card.classList.add('dragging'); card.style.width = `${colW * (1 + delta) - 12}px`; },
        onEnd: () => { card.style.width = ''; card.classList.remove('dragging'); },
        patchOf: (delta) => dragRangePatch(e, delta, 'end')
      });
      card.append(stretch);
    }
  }

  body.append(titleRow);

  const meta = h('div', { class: 'cal-card-meta' });
  if (e.planOnly || e.planDate === e.date) meta.append(h('span', { class: 'cal-chip' }, e.planPeriod ? PERIODS.find(p => p.value === e.planPeriod)?.label || '当天安排' : '当天安排'));
  if (!e.planOnly && e.planDate === e.date && e.planTime) meta.append(h('span', { class: 'cal-chip' }, `安排 ${timeRangeLabel(e.planTime, e.planEndTime)}`));
  if (e.time) meta.append(h('span', { class: 'cal-chip' }, `🕐 ${e.time}`));
  if (estimateText(e)) meta.append(h('span', { class: 'cal-chip estimate-chip' }, estimateText(e)));
  if (e.kind === 'project' && e.projectName) meta.append(h('span', { class: 'cal-chip' }, `📁 ${escapeHtml(e.projectName)}`));
  if (e.spanDays > 1) meta.append(h('span', { class: 'cal-chip' }, `${e.spanStart ? '起' : (e.spanEnd ? '止' : '续')} · 共 ${e.spanDays} 天`));
  if (e.repeat || e.repeatOf) meta.append(h('span', { class: 'cal-chip' }, '🔁'));
  if (e.overdue && !e.done) meta.append(h('span', { class: 'badge overdue' }, '逾期'));
  if (!compact && e.priority) meta.append(h('span', { class: `badge ${priorityClass(e.priority)}` }, priorityLabel(e.priority)));
  if (meta.children.length) body.append(meta);
  card.append(body);

  if (e.repeat || e.repeatOf) {
    const finish = h('button', { class: 'icon-btn cal-card-act', title: '完成整个系列' }, '✓✓');
    finish.onclick = async (ev) => {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      if (await confirmDialog('完成整个系列？所有已生成与未来的实例都会标记完成。')) {
        await api.put(`/api/tasks/${e.id}`, { done: true, finishSeries: true });
        toast('已完成整个系列');
        paint();
      }
    };
    card.append(finish);
  }
  return card;
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
  const wrap = h('section', { class: 'cal-board card', 'aria-label': '所选日期任务看板' });
  const head = h('div', { class: 'row cal-board-head' });
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
  paint();
}

async function toggleEntry(e) {
  if (e.kind === 'project') await api.put(e.base, { done: !e.done });
  else await api.put(`/api/tasks/${e.id}`, { done: !e.done });
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
