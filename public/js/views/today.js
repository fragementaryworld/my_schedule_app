'use strict';
import { api } from '../api.js';
import { h, toast, openModal, confirmDialog, scrollPos, restoreScroll } from '../ui.js';
import { todayStr, escapeHtml, isOverdue, priorityClass, priorityLabel } from '../utils.js';
import {
  CALENDAR_VIEWS, weekdayLabels, visibleDates, rangeOf, groupByDate, sortDayEntries,
  periodTitle, shiftAnchor, parseYm, sameMonth, isToday, dayNumber
} from '../calendar.js';

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

const REPEAT_OPTIONS = [
  { value: '', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'd2', label: '每2天' },
  { value: 'w2', label: '每2周' }
];

export function repeatCode(r) {
  if (r === 'daily') return 'daily';
  if (r === 'weekly') return 'weekly';
  if (r && r.interval === 2 && r.unit === 'day') return 'd2';
  if (r && r.interval === 2 && r.unit === 'week') return 'w2';
  return '';
}

export function decodeRepeat(code) {
  if (code === 'daily') return 'daily';
  if (code === 'weekly') return 'weekly';
  if (code === 'd2') return { interval: 2, unit: 'day' };
  if (code === 'w2') return { interval: 2, unit: 'week' };
  return null;
}

export function repeatLabel(r) {
  if (r === 'daily') return '每天';
  if (r === 'weekly') return '每周';
  if (r && r.unit === 'day') return `每${r.interval}天`;
  if (r && r.unit === 'week') return `每${r.interval}周`;
  return '';
}

const SOURCE_MAP = { project: '📁 项目', book: '📚 阅读', workout: '💪 健身', idea: '💡 灵感' };
export function sourceLabel(type) {
  return SOURCE_MAP[type] || type || '';
}

const SOURCE_OPTIONS = [
  { value: '', label: '无' },
  { value: 'project', label: '工作项目' },
  { value: 'book', label: '阅读' },
  { value: 'workout', label: '健身' },
  { value: 'idea', label: '灵感' }
];
const PRIORITY_OPTIONS = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' }
];

async function paint() {
  if (!el) return;
  const pos = scrollPos();
  const { from, to } = rangeOf(anchor, view, weekStartPref);
  const tasks = await api.get(`/api/tasks?from=${from}&to=${to}`);
  const byDate = groupByDate(tasks.map(toEntry));
  const dates = visibleDates(anchor, view, weekStartPref);

  el.innerHTML = '';
  try {
    el.append(buildToolbar());
    el.append(view === 'month' ? buildMonth(byDate, dates) : buildWeek(byDate, dates));
    el.append(buildLegend());
  } finally {
    restoreScroll(pos);
  }
}

// 日历条目：目前是每日计划里的独立任务（工作项目任务在后续增量并入）
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
  const addBtn = h('button', { class: 'btn btn-primary btn-sm' }, '＋ 新增任务');
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
    const col = h('div', { class: 'cal-col' + (isToday(d) ? ' today' : ''), dataset: { date: d } });
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
    class: 'cal-card' + (e.done ? ' done' : '') + (e.kind === 'project' ? ' from-project' : ''),
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
  const title = h('div', { class: 'cal-card-title row-link' }, escapeHtml(e.title));
  title.onclick = () => openEntry(e);
  body.append(title);

  const meta = h('div', { class: 'cal-card-meta' });
  if (e.time) meta.append(h('span', { class: 'cal-chip' }, `🕐 ${e.time}`));
  if (e.kind === 'project' && e.projectName) meta.append(h('span', { class: 'cal-chip' }, `📁 ${escapeHtml(e.projectName)}`));
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

function buildLegend() {
  return h('div', { class: 'small muted cal-legend' }, '点标题可编辑；勾选框可直接完成/取消完成。');
}

async function toggleEntry(e) {
  await api.put(`/api/tasks/${e.id}`, { done: !e.done });
  paint();
}

function openEntry(e) {
  editTask(e.raw || e);
}

function taskFields(t) {
  return [
    { name: 'title', label: '标题', required: true, value: t ? t.title : '' },
    { name: 'time', label: '时间（可留空）', type: 'time', value: t ? (t.time || '') : '' },
    { name: 'priority', label: '优先级', type: 'select', value: t ? (t.priority || 'medium') : 'medium', options: PRIORITY_OPTIONS },
    { name: 'repeat', label: '重复', type: 'select', value: t ? repeatCode(t.repeat) : '', options: REPEAT_OPTIONS },
    { name: 'source', label: '来源（可选）', type: 'select', value: t ? ((t.source && t.source.type) || '') : '', options: SOURCE_OPTIONS },
    { name: 'note', label: '备注', type: 'textarea', value: t ? (t.note || '') : '' }
  ];
}

function editTask(t) {
  openModal({
    title: '编辑任务',
    fields: taskFields(t),
    onSubmit: async (v) => {
      await api.put(`/api/tasks/${t.id}`, {
        title: v.title.trim(),
        time: v.time || null,
        priority: v.priority,
        repeat: decodeRepeat(v.repeat),
        source: v.source ? { type: v.source, id: null } : null,
        note: v.note
      });
      toast('已保存');
      paint();
    }
  });
}

function addTask() {
  openModal({
    title: '新增任务',
    fields: taskFields(null),
    onSubmit: async (v) => {
      await api.post('/api/tasks', {
        title: v.title.trim(),
        date: anchor,
        time: v.time || null,
        priority: v.priority,
        repeat: decodeRepeat(v.repeat),
        source: v.source ? { type: v.source, id: null } : null,
        note: v.note,
        order: Date.now()
      });
      toast('已添加');
      paint();
    }
  });
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
  addTask();
}
