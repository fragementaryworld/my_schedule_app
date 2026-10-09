'use strict';
import { api } from '../api.js';
import { h, toast, confirmDialog, scrollPos, restoreScroll } from '../ui.js';
import { todayStr, escapeHtml, isOverdue, priorityClass, priorityLabel } from '../utils.js';
import {
  CALENDAR_VIEWS, weekdayLabels, visibleDates, rangeOf, sortDayEntries,
  periodTitle, shiftAnchor, parseYm, sameMonth, isToday, dayNumber,
  projectEntriesForDates, mergeEntries
} from '../calendar.js';
import { createDayTask, dayTaskHref, sourceLabel } from '../daytask.js';

// 兼容：这些纯函数仍从本模块导出（供既有测试与页面复用）
export { repeatCode, decodeRepeat, repeatLabel, sourceLabel } from '../daytask.js';

let el = null;
let anchor = todayStr();
let view = 'week';
let weekStartPref = 'mon';

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

  container.innerHTML = '';
  try {
    container.append(buildToolbar());
    container.append(view === 'month' ? buildMonth(byDate, dates) : buildWeek(byDate, dates));
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

function buildWeek(byDate, dates) {
  const wrap = h('div', { class: 'cal cal-week' });
  wrap.append(buildWeekdays());

  const row = h('div', { class: 'cal-week-row' });
  for (const d of dates) {
    const col = h('div', {
      class: 'cal-col' + (isToday(d) ? ' today' : ''),
      dataset: { date: d }
    });
    col.append(h('div', { class: 'cal-col-head' }, h('span', { class: 'cal-daynum' }, String(dayNumber(d)))));
    const list = h('div', { class: 'cal-cards' });
    for (const e of sortDayEntries(byDate.get(d) || [])) list.append(buildCard(e));
    col.append(list);
    row.append(col);
  }
  wrap.append(row);
  return wrap;
}

function buildMonth(byDate, dates) {
  const { y, m } = parseYm(anchor);
  const wrap = h('div', { class: 'cal cal-month' });
  wrap.append(buildWeekdays());

  const grid = h('div', { class: 'cal-month-grid' });
  for (const d of dates) {
    const cell = h('div', {
      class: 'cal-cell' + (sameMonth(d, y, m) ? '' : ' outside') + (isToday(d) ? ' today' : ''),
      dataset: { date: d }
    });
    cell.append(h('div', { class: 'cal-cell-head' }, h('span', { class: 'cal-daynum' }, String(dayNumber(d)))));
    const entries = sortDayEntries(byDate.get(d) || []);
    const list = h('div', { class: 'cal-cards' });
    for (const e of entries.slice(0, 3)) list.append(buildCard(e, true));
    if (entries.length > 3) list.append(h('div', { class: 'cal-more' }, `+${entries.length - 3}`));
    cell.append(list);
    grid.append(cell);
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
    title: e.title
  });

  const cb = h('input', { type: 'checkbox', class: 'task-check cal-check' });
  cb.checked = !!e.done;
  cb.onclick = async (ev) => {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    await toggleEntry(e);
  };
  card.append(cb);

  const body = h('div', { class: 'cal-card-body' });
  const titleRow = h('div', { class: 'row cal-card-titlerow' });
  if (e.continued) titleRow.append(h('span', { class: 'cal-cont', title: `延续自 ${e.spanFrom}` }, '↳'));
  const title = h('span', { class: 'cal-card-title row-link' }, escapeHtml(e.title));
  title.onclick = () => openEntry(e);
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
