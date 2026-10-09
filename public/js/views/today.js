'use strict';
import { api } from '../api.js';
import { h, toast, confirmDialog, scrollPos, restoreScroll } from '../ui.js';
import { todayStr, escapeHtml, isOverdue, priorityClass, priorityLabel } from '../utils.js';
import {
  CALENDAR_VIEWS, DAY_TASK_COLOR, weekdayLabels, visibleDates, rangeOf, sortDayEntries,
  periodTitle, shiftAnchor, parseYm, sameMonth, isToday, dayNumber,
  projectEntriesForDates, mergeEntries, legendFor, dateBoard, multiDayEntries, spanBarLayout, tint, truncate
} from '../calendar.js';
import { createDayTask, dayTaskHref, sourceLabel } from '../daytask.js';

// 兼容：这些纯函数仍从本模块导出（供既有测试与页面复用）
export { repeatCode, decodeRepeat, repeatLabel, sourceLabel } from '../daytask.js';

let el = null;
let anchor = todayStr();
let view = 'week';
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
  const container = el; // 进入时就固定容器，避免旧的异步重绘写进新页面
  if (!container) return;
  const pos = scrollPos();
  const { from, to } = rangeOf(anchor, view, weekStartPref);
  const dates = visibleDates(anchor, view, weekStartPref);
  // 每日计划任务 + 工作项目里的所有任务（含各级子任务，跨多天的任务铺满整段）
  const [tasks, projects] = await Promise.all([
    api.get(`/api/tasks?from=${from}&to=${to}`),
    api.get('/api/projects').catch(() => [])
  ]);
  const projectEntries = projectEntriesForDates(projects, dates, todayStr());
  const byDate = mergeEntries(tasks.map(toEntry), projectEntries);
  const multiDay = multiDayEntries(projects, dates, todayStr());

  container.innerHTML = '';
  try {
    container.append(buildToolbar());
    container.append(view === 'month' ? buildMonth(byDate, dates, multiDay) : buildWeek(byDate, dates, multiDay));
    container.append(buildLegend(byDate, dates));
    container.append(buildSelectedBoard(byDate));
  } finally {
    restoreScroll(pos);
  }
}

function toEntry(t) {
  return {
    kind: 'day',
    id: t.id,
    title: t.title,
    date: t.date,
    time: t.time || '',
    done: !!t.done,
    priority: t.priority || 'medium',
    repeat: t.repeat || null,
    repeatOf: t.repeatOf || null,
    source: t.source || null,
    sourceLabel: t.source && t.source.type ? sourceLabel(t.source.type) : '',
    color: DAY_TASK_COLOR,
    detail: (t.note || '').trim(),
    overdue: isOverdue(t, todayStr()),
    raw: t
  };
}

function buildToolbar() {
  const wrap = h('div', { class: 'cal-toolbar' });

  const top = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' });
  const addBtn = h('button', { class: 'btn btn-primary btn-sm add-day-task' }, '＋ 新增任务');
  addBtn.onclick = () => addTask();
  top.append(addBtn);

  const tabs = h('div', { class: 'tabbar', style: 'margin:0;border:none' });
  for (const v of CALENDAR_VIEWS) {
    const b = h('button', { class: 'tab' + (view === v.value ? ' active' : '') }, v.label);
    b.onclick = () => { view = v.value; paint(); };
    tabs.append(b);
  }
  top.append(tabs);
  wrap.append(top);

  const nav = h('div', { class: 'row cal-nav' });
  nav.append(h('span', { class: 'cal-period' }, periodTitle(anchor, view)));
  nav.append(h('span', { class: 'spacer' }));
  const prev = h('button', { class: 'icon-btn cal-prev', title: '上一页' }, '‹');
  const todayBtn = h('button', { class: 'btn btn-sm' }, '今天');
  const next = h('button', { class: 'icon-btn cal-next', title: '下一页' }, '›');
  prev.onclick = () => { anchor = shiftAnchor(anchor, view, -1); paint(); };
  next.onclick = () => { anchor = shiftAnchor(anchor, view, 1); paint(); };
  todayBtn.onclick = () => { anchor = todayStr(); paint(); };
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
const SPAN_TOP = 28;
const SPAN_LANE_H = 22;

function buildRow(rowDates, byDate, opts) {
  const { month, y, m, multiDay } = opts;
  const layout = spanBarLayout(multiDay, rowDates);
  const padTop = layout.laneCount * SPAN_LANE_H;

  const row = h('div', { class: 'cal-row ' + (month ? 'cal-month-row' : 'cal-week-row') });
  for (const d of rowDates) {
    const cell = h('div', {
      class: (month ? 'cal-cell' : 'cal-col')
        + (month && !sameMonth(d, y, m) ? ' outside' : '')
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
    for (const e of entries.slice(0, max)) list.append(buildCard(e, month));
    if (entries.length > max) list.append(h('div', { class: 'cal-more' }, `+${entries.length - max}`));
    cell.append(list);

    cell.onclick = () => selectDate(d);
    row.append(cell);
  }
  if (layout.bars.length) row.append(buildSpanLayer(layout, rowDates.length));
  return row;
}

function buildSpanLayer(layout, cols) {
  const layer = h('div', { class: 'cal-span-layer' });
  for (const bar of layout.bars) {
    const e = bar.entry;
    const el = h('div', {
      class: 'cal-span'
        + (bar.continuesLeft ? ' clip-left' : '')
        + (bar.continuesRight ? ' clip-right' : '')
        + (e.done ? ' done' : ''),
      style: `left:${(bar.startCol / cols) * 100}%;width:${((bar.endCol - bar.startCol + 1) / cols) * 100}%;`
        + `top:${SPAN_TOP + bar.lane * SPAN_LANE_H}px;background:${e.color || DAY_TASK_COLOR}`,
      title: `${e.title}（${e.spanFrom} → ${e.spanTo}，共 ${e.spanDays} 天）`
    });
    el.onclick = (ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); openEntry(e); };
    if (bar.continuesLeft) el.append(h('span', { class: 'cal-span-clip' }, '◀'));
    el.append(h('span', { class: 'cal-span-title' }, escapeHtml(e.title)));
    el.append(h('span', { class: 'cal-span-days' }, `${e.spanDays} 天`));
    if (bar.continuesRight) el.append(h('span', { class: 'cal-span-clip' }, '▶'));
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

function buildCard(e, compact) {
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
  body.append(titleRow);

  const meta = h('div', { class: 'cal-card-meta' });
  if (e.time) meta.append(h('span', { class: 'cal-chip' }, `🕐 ${e.time}`));
  if (e.kind === 'project' && e.projectName) meta.append(h('span', { class: 'cal-chip' }, `📁 ${escapeHtml(e.projectName)}`));
  if (e.spanDays > 1) meta.append(h('span', { class: 'cal-chip' }, `${e.spanStart ? '起' : (e.spanEnd ? '止' : '续')} · 共 ${e.spanDays} 天`));
  if (e.sourceLabel) meta.append(h('span', { class: 'cal-chip' }, e.sourceLabel));
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

// 选中日期的任务看板
function buildSelectedBoard(byDate) {
  const entries = byDate.get(selectedDate) || [];
  const { pending, done, total } = dateBoard(entries);

  const wrap = h('div', { class: 'cal-board card' });
  const head = h('div', { class: 'row cal-board-head' });
  head.append(h('span', { class: 'cal-board-date' }, selectedLabel()));
  head.append(h('span', { class: 'spacer' }));
  head.append(h('span', { class: 'small muted' }, total ? `共 ${total} 项 · 待办 ${pending.length} · 已完成 ${done.length}` : '这一天还没有任务'));
  wrap.append(head);

  const board = h('div', { class: 'kanban' });
  const all = [...pending, ...done];
  board.append(boardCol('待办', pending, false, all));
  board.append(boardCol('已完成', done, true, all));
  wrap.append(board);
  return wrap;
}

function boardCol(title, entries, doneFlag, all) {
  const col = h('div', { class: 'kanban-col ' + (doneFlag ? 'board-col-done' : 'board-col-active') });

  // 可以拖动任务：拖到另一列即切换完成状态
  col.addEventListener('dragover', (ev) => { ev.preventDefault(); col.classList.add('drop-hover'); });
  col.addEventListener('dragleave', () => col.classList.remove('drop-hover'));
  col.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    col.classList.remove('drop-hover');
    const id = ev.dataTransfer ? ev.dataTransfer.getData('text/plain') : '';
    const entry = (all || []).find((x) => x.id === id);
    if (!entry || entry.done === doneFlag) return;
    await moveEntry(entry, doneFlag);
  });

  col.append(h('div', { class: 'col-head' }, title, h('span', { class: 'small muted' }, String(entries.length))));
  if (!entries.length) col.append(h('div', { class: 'small muted', style: 'padding:6px' }, '暂无'));
  for (const e of entries) {
    const card = h('div', {
      class: 'kanban-card cal-board-card' + (e.done ? ' done' : ''),
      style: `background:${tint(e.color || DAY_TASK_COLOR)};border-left: 3px solid ${e.color || DAY_TASK_COLOR}`,
      draggable: 'true'
    });
    card.addEventListener('dragstart', (ev) => {
      if (ev.dataTransfer) ev.dataTransfer.setData('text/plain', e.id);
    });

    const row = h('div', { class: 'row' });
    const cb = h('input', { type: 'checkbox', class: 'task-check cal-check' });
    cb.checked = !!e.done;
    cb.onclick = async (ev) => {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      await toggleEntry(e);
    };
    row.append(cb);
    const title = h('span', { class: 'title row-link', style: 'flex:1' }, escapeHtml(e.title));
    title.onclick = (ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); openEntry(e); };
    row.append(title);
    card.append(row);

    // 有详细内容就显示出来（描述 / 内容块 / 备注）
    if (e.detail) card.append(h('div', { class: 'cal-board-detail' }, truncate(e.detail, 90)));

    const meta = h('div', { class: 'row cal-card-meta' });
    if (e.time) meta.append(h('span', { class: 'cal-chip' }, `🕐 ${e.time}`));
    meta.append(h('span', { class: 'cal-chip' }, e.kind === 'project' ? `📁 ${escapeHtml(e.projectName)}` : '每日任务'));
    if (e.spanDays > 1) meta.append(h('span', { class: 'cal-chip' }, `跨 ${e.spanDays} 天`));
    if (e.subtaskCount) meta.append(h('span', { class: 'cal-chip' }, `子任务 ${e.subtaskDone}/${e.subtaskCount}`));
    if (e.overdue && !e.done) meta.append(h('span', { class: 'badge overdue' }, '逾期'));
    card.append(meta);
    col.append(card);
  }
  return col;
}

// 拖动切换完成状态
async function moveEntry(entry, done) {
  if (entry.kind === 'project') await api.put(entry.base, { done });
  else await api.put(`/api/tasks/${entry.id}`, { done });
  toast(done ? '已移到已完成' : '已移回待办');
  paint();
}

function selectedLabel() {
  const d = parseYm(selectedDate);
  const wd = ['日', '一', '二', '三', '四', '五', '六'][new Date(d.y, d.m - 1, dayNumber(selectedDate)).getDay()];
  return `${d.y}年${d.m}月${dayNumber(selectedDate)}日 周${wd} 的任务看板`;
}

function selectDate(date) {
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
  await createDayTask(anchor);
}

export async function render(container) {
  el = container;
  anchor = todayStr();
  selectedDate = todayStr();
  try {
    const prefs = await api.get('/api/preferences');
    weekStartPref = prefs && prefs.weekStart === 'sun' ? 'sun' : 'mon';
  } catch (err) {
    weekStartPref = 'mon';
  }
  await paint();
}

export function add() {
  return addTask();
}
