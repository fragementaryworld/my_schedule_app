'use strict';
import { api } from '../api.js';
import { h, toast, confirmDialog, scrollPos, restoreScroll, focusSnapshot, focusRestore } from '../ui.js';
import { escapeHtml, PROJECT_STATUS, fmtDate, todayStr, priorityClass, priorityLabel, addDays, estimateText } from '../utils.js';
import { renderMarkdown } from '../markdown.js';
import { formatDateValue } from '../datepicker.js';

let el = null;
let currentParams = {};
let currentFilter = 'all';
let listView = 'table';
let taskView = 'table';

// 任务时间展示（按该任务选定的日期格式）
export function formatTaskDates(task) {
  return formatDateValue(task) || '—';
}

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '进行中' },
  { value: 'paused', label: '暂停' },
  { value: 'done', label: '完成' }
];

const LIST_VIEWS = [
  { value: 'table', label: '表格' },
  { value: 'timeline', label: '时间线' },
  { value: 'board', label: '看板' },
  { value: 'feed', label: '信息流' }
];

export function projectSummary(p) {
  const tasks = p.tasks || [];
  return {
    total: tasks.length,
    done: tasks.filter((t) => t.done).length,
    nextActions: tasks.filter((t) => !t.done).length
  };
}

export function collectOwners(projects) {
  const set = new Set();
  for (const p of projects || []) {
    const o = String(p.owner || '').trim();
    if (o) set.add(o);
  }
  return [...set].sort();
}

export function otherProjectNames(projects, excludeId) {
  return (projects || []).filter((x) => x.id !== excludeId && x.name).map((x) => x.name);
}

// 阻塞下拉：内容为其他项目；保留无法匹配的历史值
export function blockedByOptions(projects, currentValue, excludeId) {
  const names = otherProjectNames(projects, excludeId);
  const opts = [{ value: '', label: '无' }, ...names.map((n) => ({ value: n, label: n }))];
  if (currentValue && !names.includes(currentValue)) {
    opts.push({ value: currentValue, label: currentValue });
  }
  return opts;
}

export function formatProjectDates(p) {
  return formatDateValue(p) || '—';
}

// 表格/看板等视图所需的展示数据
export function projectRowData(p) {
  const st = PROJECT_STATUS[p.status] || PROJECT_STATUS.active;
  return {
    name: p.name,
    statusLabel: st.label,
    statusCls: st.cls,
    owner: p.owner || '',
    dates: formatProjectDates(p),
    priorityLabel: priorityLabel(p.priority || 'medium'),
    priorityCls: priorityClass(p.priority || 'medium'),
    completion: p.progress || 0,
    blockedBy: p.blockedBy || ''
  };
}

export function groupProjectsByStatus(projects) {
  const order = ['active', 'paused', 'done'];
  const cols = order.map((s) => ({ status: s, label: PROJECT_STATUS[s].label, cls: PROJECT_STATUS[s].cls, items: [] }));
  const byStatus = {};
  for (const c of cols) byStatus[c.status] = c;
  for (const p of projects || []) {
    const key = order.includes(p.status) ? p.status : 'active';
    byStatus[key].items.push(p);
  }
  return cols;
}

export function timelineRange(projects) {
  let start = null;
  let end = null;
  for (const p of projects || []) {
    if (p.startDate && (!start || p.startDate < start)) start = p.startDate;
    if (p.dueDate) {
      if (!start || p.dueDate < start) start = p.dueDate;
      if (!end || p.dueDate > end) end = p.dueDate;
    }
  }
  if (!start) start = todayStr();
  if (!end) end = start;
  if (end < start) end = start;
  return { start, end, days: Math.max(1, daysBetween(start, end)) };
}

export function timelineBar(project, start, end) {
  const total = Math.max(1, daysBetween(start, end));
  const barStart = project.startDate && project.startDate > start ? project.startDate : start;
  const barEnd = project.dueDate && project.dueDate > barStart ? project.dueDate : barStart;
  const left = Math.max(0, Math.min(100, Math.round((daysBetween(start, barStart) / total) * 100)));
  let width = Math.max(3, Math.round((daysBetween(barStart, barEnd) / total) * 100));
  if (left + width > 100) width = Math.max(0, 100 - left);
  return { left, width };
}

// 顶部日期刻度（类似 Notion）
export function timelineTicks(start, end, count = 7) {
  const total = Math.max(1, daysBetween(start, end));
  const n = Math.max(2, count);
  const ticks = [];
  for (let i = 0; i < n; i++) {
    const offset = Math.round((total * i) / (n - 1));
    ticks.push({ pct: (i / (n - 1)) * 100, date: addDays(start, offset) });
  }
  return ticks;
}

// 今日红线位置（不在范围内返回 null）
export function todayPct(start, end, today = todayStr()) {
  const total = Math.max(1, daysBetween(start, end));
  const d = daysBetween(start, today);
  if (d < 0 || d > total) return null;
  return (d / total) * 100;
}

export function lastDayOfMonth(y, m) {
  return new Date(y, m, 0).getDate(); // m: 1-12
}

// 日刻度密度：范围越长标注越稀，避免臃肿
export function axisStep(totalDays) {
  if (totalDays <= 31) return 1;
  if (totalDays <= 92) return 2;
  if (totalDays <= 200) return 7;
  return 14;
}

// Notion 式两级时间轴：上面按月分段，下面按日分格
export function timelineAxis(start, end) {
  const totalDays = Math.max(1, daysBetween(start, end));
  const pct = (d) => (daysBetween(start, d) / totalDays) * 100;
  const months = [];
  let cursor = start;
  while (cursor <= end) {
    const y = Number(cursor.slice(0, 4));
    const m = Number(cursor.slice(5, 7));
    const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDayOfMonth(y, m)).padStart(2, '0')}`;
    const left = pct(cursor);
    const right = monthEnd < end ? pct(addDays(monthEnd, 1)) : 100;
    months.push({ key: `${y}-${m}`, label: `${y}年${m}月`, left, width: Math.max(0, right - left) });
    cursor = addDays(monthEnd, 1);
  }
  const step = axisStep(totalDays);
  const days = [];
  for (let i = 0; i < totalDays; i += step) {
    const date = addDays(start, i);
    days.push({
      date,
      day: Number(date.slice(8, 10)),
      left: pct(date),
      width: (Math.min(step, totalDays - i) / totalDays) * 100
    });
  }
  return { start, end, totalDays, step, months, days };
}

// 每条项目/任务一个稳定颜色（按 id 哈希，顺序变化也不跳色）
export const TIMELINE_COLORS = [
  '#4f6ef7', '#16a34a', '#f59e0b', '#8b5cf6', '#ec4899',
  '#0891b2', '#65a30d', '#ea580c', '#0d9488', '#64748b'
];

export function timelineColorIndex(id) {
  const s = String(id === null || id === undefined ? '' : id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % TIMELINE_COLORS.length;
}

export function timelineColor(id) {
  return TIMELINE_COLORS[timelineColorIndex(id)];
}

// 时间轴标尺：上排月份、下排日期，底部加极浅分格线
export function buildTimelineAxis(start, end) {
  const axis = timelineAxis(start, end);
  const minW = Math.max(520, Math.min(4000, axis.totalDays * 20));
  const ruler = h('div', { class: 'timeline-axis timeline-ruler', style: `min-width:${minW}px` });

  const months = h('div', { class: 'timeline-months' });
  for (const m of axis.months) {
    months.append(h('div', { class: 'timeline-month', style: `left:${m.left}%;width:${m.width}%` },
      h('span', { class: 'timeline-month-label timeline-tick-label' }, m.label)));
  }

  const days = h('div', { class: 'timeline-days' });
  for (const d of axis.days) {
    days.append(h('div', { class: 'timeline-day', style: `left:${d.left}%;width:${d.width}%` },
      h('span', { class: 'timeline-day-label timeline-tick-label' }, String(d.day))));
  }

  ruler.append(
    h('div', { class: 'timeline-ruler-gutter' }),
    h('div', { class: 'timeline-ruler-body' }, months, days, gridLines(axis))
  );
  ruler.dataset.totalDays = String(axis.totalDays);
  return ruler;
}

function gridLines(axis) {
  const grid = h('div', { class: 'timeline-grid' });
  for (const d of axis.days) grid.append(h('i', { class: 'timeline-gridline', style: `left:${d.left}%` }));
  return grid;
}

// 轨道里的同款浅灰分格，和标尺竖线对齐
function trackGrid(start, end) {
  const grid = h('div', { class: 'timeline-track-grid' });
  for (const d of timelineAxis(start, end).days) {
    grid.append(h('i', { class: 'timeline-gridline', style: `left:${d.left}%` }));
  }
  return grid;
}

// 连续位移百分比（画面 1:1 跟随鼠标，不做整天取整，避免跳格）
export function dragDeltaPct(dxPx, trackWidthPx) {
  if (!trackWidthPx) return 0;
  return (dxPx / trackWidthPx) * 100;
}

// 松手时把位移百分比吸附成整天
export function pctToDays(pct, totalDays) {
  if (!totalDays) return 0;
  return Math.round((pct / 100) * totalDays);
}

export function pxToDays(dxPx, trackWidthPx, totalDays) {
  if (!trackWidthPx) return 0;
  return pctToDays(dragDeltaPct(dxPx, trackWidthPx), totalDays);
}

export function shiftDates(project, deltaDays) {
  const startBase = project.startDate || project.dueDate || todayStr();
  const dueBase = project.dueDate || null;
  return {
    startDate: addDays(startBase, deltaDays),
    dueDate: dueBase ? addDays(dueBase, deltaDays) : null
  };
}

// 只调整开始时间（不超过结束时间）
export function resizeStart(project, deltaDays) {
  const base = project.startDate || project.dueDate || todayStr();
  let next = addDays(base, deltaDays);
  if (project.dueDate && next > project.dueDate) next = project.dueDate;
  return { startDate: next };
}

// 只调整结束时间（不早于开始时间）
export function resizeEnd(project, deltaDays) {
  const base = project.dueDate || project.startDate || todayStr();
  let next = addDays(base, deltaDays);
  if (project.startDate && next < project.startDate) next = project.startDate;
  return { dueDate: next };
}

export function feedGoalLines(goal) {
  if (!goal) return [];
  return String(goal).split(/\n|；|;/).map((s) => s.trim()).filter(Boolean);
}

export function sortFeedProjects(projects) {
  return (projects || []).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export const DEFAULT_PAGE_NAME = '未命名页面';

// 直接新建页面并跳转（不弹窗，由页面内就地填写信息）
export async function createProject() {
  const created = await api.post('/api/projects', { name: DEFAULT_PAGE_NAME });
  toast('已新建页面');
  location.hash = `#/page/${created.id}`;
  return created;
}

export const DEFAULT_TASK_NAME = '新任务';
export const DEFAULT_SUBTASK_NAME = '新子任务';

// 层级路径：项目 > tasks/t1[/subtasks/s1[/subtasks/s2 …]]，最多 5 层
export function itemBase(projectId, chain) {
  const parts = ['/api/projects', projectId, 'tasks', chain[0]];
  for (let i = 1; i < chain.length; i++) parts.push('subtasks', chain[i]);
  return parts.join('/');
}

export function itemHref(projectId, chain) {
  return `#/task/${[projectId, ...chain].join('/')}`;
}

// 第 1 层：在项目下新建任务并跳转
export async function createTask(projectId) {
  const created = await api.post(`/api/projects/${projectId}/tasks`, { title: DEFAULT_TASK_NAME });
  toast('已新建任务');
  location.hash = itemHref(projectId, [created.id]);
  return created;
}

// 任意层：在当前层下面再建一层并跳转
export async function createChild(projectId, chain) {
  const created = await api.post(`${itemBase(projectId, chain)}/subtasks`, { title: DEFAULT_SUBTASK_NAME });
  toast('已新建子任务');
  location.hash = itemHref(projectId, [...chain, created.id]);
  return created;
}

export function taskHref(project, task) {
  return itemHref(project.id, [task.id]);
}

export async function createSubtask(projectId, taskId) {
  return createChild(projectId, [taskId]);
}

export function subtaskHref(project, task, subtask) {
  return itemHref(project.id, [task.id, subtask.id]);
}

function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000);
}

export function groupTasksByDone(tasks) {
  const pending = [];
  const done = [];
  for (const t of tasks || []) {
    if (t.done) done.push(t);
    else pending.push(t);
  }
  return { pending, done };
}

// 任务视图（与项目展示一致：表格 / 时间线 / 看板 / 信息流）
export const TASK_VIEWS = [
  { value: 'table', label: '表格' },
  { value: 'timeline', label: '时间线' },
  { value: 'board', label: '看板' },
  { value: 'feed', label: '信息流' }
];

// 项目任务的“逾期”只看日期（不含具体时间）
export function taskIsOverdue(task, today) {
  if (!task || task.done || !task.dueDate) return false;
  return task.dueDate < today;
}

// 信息流排序：有时间的在前（按时间升序），无时间的按创建时间
export function sortTasksForFeed(tasks) {
  return (tasks || []).slice().sort((a, b) => {
    const ad = a.dueDate || '9999-99-99';
    const bd = b.dueDate || '9999-99-99';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

function taskStatusBadge(task, today) {
  if (task.done) return h('span', { class: 'badge done' }, '已完成');
  if (taskIsOverdue(task, today)) return h('span', { class: 'badge overdue' }, '已逾期');
  if (!task.dueDate) return h('span', { class: 'badge' }, '未排期');
  return h('span', { class: 'badge active' }, '进行中');
}

export function ganttRange(tasks, project) {
  const p = project || {};
  let start = p.startDate || todayStr();
  let end = p.dueDate || todayStr();
  for (const t of tasks || []) {
    if (t.startDate && t.startDate < start) start = t.startDate;
    if (t.dueDate) {
      if (t.dueDate < start) start = t.dueDate;
      if (t.dueDate > end) end = t.dueDate;
    }
  }
  if (end < start) end = start;
  return { start, end };
}

export function ganttBarPct(dueDate, start, end) {
  const total = daysBetween(start, end);
  if (total <= 0) return 0;
  const elapsed = daysBetween(start, dueDate);
  return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
}

export async function render(container, params = {}) {
  el = container;
  currentParams = params;
  if (params.id) { location.hash = `#/page/${params.id}`; return; }
  await paintList();
}

async function paintList() {
  const container = el; // 进入时就固定容器，避免旧的异步重绘写进新页面
  if (!container) return;
  const pos = scrollPos();
  const focus = focusSnapshot();
  // 先取数据，再一次性重建：中间不出现空页面，滚动条就不会被弹回顶部
  const projects = await api.get('/api/projects');
  container.innerHTML = '';
  try {
    container.append(buildViewBar());
    const shown = currentFilter === 'all' ? projects : projects.filter((p) => p.status === currentFilter);
    if (!shown.length) {
      container.append(h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, '📁'), h('p', {}, '还没有项目，点右上角「＋ 新增项目」。')));
      return;
    }
    container.append(renderProjectView(shown));
  } finally {
    restoreScroll(pos);
    focusRestore(focus);
  }
}

function buildViewBar() {
  const bar = h('div', { class: 'toolbar' });
  const tabs = h('div', { class: 'tabbar', style: 'margin:0;border:none;flex-wrap:wrap' });
  for (const v of LIST_VIEWS) {
    const b = h('button', { class: 'tab' + (listView === v.value ? ' active' : '') }, v.label);
    b.onclick = () => { listView = v.value; paintList(); };
    tabs.append(b);
  }
  bar.append(tabs, h('span', { class: 'spacer' }));
  const sel = h('select', { class: 'input', style: 'width:auto' });
  for (const f of FILTERS) sel.append(h('option', { value: f.value }, f.label));
  sel.value = currentFilter;
  sel.onchange = () => { currentFilter = sel.value; paintList(); };
  bar.append(sel);
  bar.append(h('button', { class: 'btn btn-primary btn-sm', onclick: () => createProject() }, '＋ 新增项目'));
  return bar;
}

function renderProjectView(projects) {
  if (listView === 'table') return buildProjectTable(projects);
  if (listView === 'board') return buildProjectBoard(projects);
  if (listView === 'timeline') return buildProjectTimeline(projects);
  return buildProjectFeed(projects);
}

export function buildProjectBoard(projects) {
  const cols = groupProjectsByStatus(projects);
  const board = h('div', { class: 'kanban' });
  for (const col of cols) {
    const colEl = h('div', { class: `kanban-col board-col-${col.status}` });
    colEl.addEventListener('dragover', (e) => { e.preventDefault(); colEl.classList.add('drop-hover'); });
    colEl.addEventListener('dragleave', () => colEl.classList.remove('drop-hover'));
    colEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      colEl.classList.remove('drop-hover');
      const pid = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
      if (!pid) return;
      await api.put(`/api/projects/${pid}`, { status: col.status });
      toast('状态已更新');
      paintList();
    });
    colEl.append(h('div', { class: 'col-head' },
      h('span', { class: `badge ${col.cls}` }, col.label),
      h('span', { class: 'small muted' }, String(col.items.length))));
    if (!col.items.length) colEl.append(h('div', { class: 'small muted', style: 'padding:6px' }, '暂无项目'));
    for (const p of col.items) colEl.append(buildBoardCard(p));
    colEl.append(h('div', { class: 'board-new', onclick: () => createProject() }, '＋ 新建项目'));
    board.append(colEl);
  }
  return board;
}

function buildBoardCard(p) {
  const d = projectRowData(p);
  const card = h('div', { class: 'kanban-card', draggable: 'true', style: 'cursor:pointer' });
  card.addEventListener('dragstart', (e) => { if (e.dataTransfer) e.dataTransfer.setData('text/plain', p.id); });
  card.onclick = () => { location.hash = `#/page/${p.id}`; };
  card.append(h('div', { class: 'title', style: 'font-weight:600;margin-bottom:6px' }, escapeHtml(d.name)));
  card.append(h('div', { class: 'small muted' }, d.dates));
  const metaRow = h('div', { class: 'row', style: 'margin-top:6px;flex-wrap:wrap' });
  metaRow.append(h('span', { class: `badge ${d.priorityCls}` }, d.priorityLabel));
  if (d.owner) metaRow.append(h('span', { class: 'small muted' }, `👤 ${d.owner}`));
  if (d.blockedBy) metaRow.append(h('span', { class: 'badge blocked' }, `🚫 ${d.blockedBy}`));
  card.append(metaRow);
  card.append(h('div', { class: 'row', style: 'margin-top:8px' },
    h('div', { class: 'progress', style: 'flex:1' }, h('i', { style: `width:${d.completion}%` })),
    h('span', { class: 'small muted' }, `${d.completion}%`)));
  return card;
}

function buildProjectTimeline(projects) {
  const { start, end, days } = timelineRange(projects);
  const totalDays = Math.max(1, days);
  const wrap = h('div', { class: 'timeline' });
  wrap.append(h('div', { class: 'row timeline-head' },
    h('span', { class: 'small muted' }, `时间轴：${start} ~ ${end}`),
    h('span', { class: 'spacer' }),
    h('span', { class: 'small muted' }, `${days} 天`)));
  wrap.append(h('div', { class: 'small muted', style: 'margin-bottom:4px' }, '拖动时间条可改时间；把项目名拖到分组标题上可改状态'));

  wrap.append(buildTimelineAxis(start, end));

  const axisInfo = timelineAxis(start, end);
  const rowMinW = Math.max(520, Math.min(4000, axisInfo.totalDays * 20));
  const tp = todayPct(start, end);

  for (const col of groupProjectsByStatus(projects)) {
    const box = h('div', { class: 'timeline-groupbox' });
    box.append(h('div', { class: 'timeline-group' },
      h('span', { class: `badge ${col.cls}` }, col.label),
      h('span', { class: 'small muted' }, String(col.items.length))));

    box.ondragover = (e) => { e.preventDefault(); box.classList.add('drop-hover'); };
    box.ondragleave = () => box.classList.remove('drop-hover');
    box.ondrop = async (e) => {
      e.preventDefault();
      box.classList.remove('drop-hover');
      const pid = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
      if (pid) {
        await api.put(`/api/projects/${pid}`, { status: col.status });
        toast('状态已更新');
        paintList();
      }
    };

    if (!col.items.length) box.append(h('div', { class: 'small muted', style: 'padding:2px 8px' }, '暂无项目'));

    for (const p of col.items) {
      const bar = timelineBar(p, start, end);
      const color = timelineColor(p.id);
      const row = h('div', { class: 'timeline-row', style: `min-width:${rowMinW}px` });
      const label = h('span', { class: 'timeline-label', title: `${p.name}（拖到分组标题可改状态）`, draggable: 'true' },
        h('i', { class: 'timeline-dot', style: `background:${color}` }),
        escapeHtml(p.name));
      label.onclick = () => { location.hash = `#/page/${p.id}`; };
      label.ondragstart = (e) => { if (e.dataTransfer) e.dataTransfer.setData('text/plain', p.id); };
      row.append(label);

      const track = h('div', { class: 'timeline-track' });
      track.append(trackGrid(start, end));
      if (tp !== null) track.append(h('div', { class: 'timeline-today', style: `left:${tp}%` }));
      const barEl = h('div', {
        class: `timeline-bar bar-${col.cls}`,
        style: `left:${bar.left}%;width:${bar.width}%;background:${color}`,
        title: `${p.name}（${formatProjectDates(p)}）`
      }, h('span', { class: 'timeline-bar-label' }, formatProjectDates(p)));
      barEl.onclick = () => { if (!barEl.dataset || !barEl.dataset.dragged) location.hash = `#/page/${p.id}`; };
      const savePatch = async (patch) => {
        if (!patch) { paintList(); return; }
        await api.put(`/api/projects/${p.id}`, patch);
        toast('时间已更新');
        paintList();
      };
      attachBarDrag(barEl, track, p, totalDays, savePatch);

      const leftH = h('div', { class: 'timeline-handle left', title: '拖动调整开始时间' });
      const rightH = h('div', { class: 'timeline-handle right', title: '拖动调整结束时间' });
      leftH.addEventListener('click', (e) => e.stopPropagation());
      rightH.addEventListener('click', (e) => e.stopPropagation());
      barEl.append(leftH, rightH);
      attachHandleDrag(leftH, barEl, track, p, totalDays, 'left', savePatch);
      attachHandleDrag(rightH, barEl, track, p, totalDays, 'right', savePatch);

      track.append(barEl);
      row.append(track);
      box.append(row);
    }
    wrap.append(box);
  }
  return wrap;
}

function trackWidthPx(track) {
  const rect = track.getBoundingClientRect ? track.getBoundingClientRect() : null;
  const w = (rect && rect.width) || track.offsetWidth || 0;
  return w > 0 ? w : 0;
}

function markDragged(barEl) {
  if (barEl.dataset) barEl.dataset.dragged = '1';
  setTimeout(() => { if (barEl.dataset) delete barEl.dataset.dragged; }, 0);
}

// 按住时间条左右拖动 → 平移起止日期（画面跟着鼠标走，松手才按天吸附）
function attachBarDrag(barEl, track, item, totalDays, save) {
  barEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const width = trackWidthPx(track);
    if (!width) return;
    const originLeft = parseFloat(barEl.style.left) || 0;
    const originWidth = parseFloat(barEl.style.width) || 0;
    const maxLeft = Math.max(0, 100 - originWidth);
    const startX = e.clientX || 0;
    let appliedPct = 0;
    let moved = false;

    const onMove = (ev) => {
      const dx = (ev.clientX || 0) - startX;
      if (!moved && Math.abs(dx) < 3) return; // 抖动阈值，避免误触
      moved = true;
      const newLeft = Math.max(0, Math.min(maxLeft, originLeft + dragDeltaPct(dx, width)));
      appliedPct = newLeft - originLeft;
      barEl.style.left = `${newLeft}%`;
    };
    const onUp = async () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!moved) return;
      markDragged(barEl);
      const deltaDays = pctToDays(appliedPct, totalDays);
      if (deltaDays === 0) { await save(null); return; }
      await save(shiftDates(item, deltaDays));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// 拖动时间条左右两端的把手 → 单独调整开始 / 结束时间
function attachHandleDrag(handleEl, barEl, track, item, totalDays, side, save) {
  handleEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const width = trackWidthPx(track);
    if (!width) return;
    const startX = e.clientX || 0;
    const originLeft = parseFloat(barEl.style.left) || 0;
    const originWidth = parseFloat(barEl.style.width) || 0;
    const rightEdge = originLeft + originWidth;
    let appliedPct = 0;
    let moved = false;

    const onMove = (ev) => {
      const dx = (ev.clientX || 0) - startX;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      const dPct = dragDeltaPct(dx, width);
      if (side === 'left') {
        const newLeft = Math.max(0, Math.min(rightEdge - 3, originLeft + dPct));
        appliedPct = newLeft - originLeft;
        barEl.style.left = `${newLeft}%`;
        barEl.style.width = `${rightEdge - newLeft}%`;
      } else {
        const newWidth = Math.max(3, Math.min(100 - originLeft, originWidth + dPct));
        appliedPct = newWidth - originWidth;
        barEl.style.width = `${newWidth}%`;
      }
    };
    const onUp = async () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!moved) return;
      markDragged(barEl);
      const deltaDays = pctToDays(appliedPct, totalDays);
      if (deltaDays === 0) { await save(null); return; }
      const patch = side === 'left' ? resizeStart(item, deltaDays) : resizeEnd(item, deltaDays);
      await save(patch);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function buildProjectFeed(projects) {
  const feed = h('div', { class: 'feed' });
  for (const p of sortFeedProjects(projects)) feed.append(buildFeedPost(p));
  return feed;
}

export { buildProjectFeed };

function buildFeedPost(p) {
  const d = projectRowData(p);
  const post = h('div', { class: 'feed-post card' });

  const head = h('div', { class: 'row', style: 'margin-bottom:8px' });
  head.append(h('span', { class: 'avatar' }, escapeHtml((d.owner || '我').slice(0, 1))));
  head.append(h('span', { class: 'small muted' }, `${d.owner || '我的'} · ${String(p.createdAt || '').slice(0, 10)}`));
  head.append(h('span', { class: 'spacer' }));

  // 状态：就地下拉
  const statusSel = h('select', { class: 'input inline-select' });
  for (const [k, v] of Object.entries(PROJECT_STATUS)) statusSel.append(h('option', { value: k }, v.label));
  statusSel.value = PROJECT_STATUS[p.status] ? p.status : 'active';
  statusSel.onchange = async () => {
    await api.put(`/api/projects/${p.id}`, { status: statusSel.value });
    toast('状态已更新');
    paintList();
  };
  head.append(statusSel);
  post.append(head);

  // 标题：直接就地编辑
  const title = h('h3', { class: 'feed-title', contenteditable: 'true', spellcheck: 'false', title: '点击直接编辑标题' });
  title.textContent = p.name;
  title.addEventListener('blur', async () => {
    const next = title.textContent.trim();
    if (!next) { title.textContent = p.name; return; }
    if (next !== p.name) {
      await api.put(`/api/projects/${p.id}`, { name: next });
      toast('已保存');
      paintList();
    }
  });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  post.append(title);

  post.append(h('h4', { class: 'feed-sec' }, 'About this project'));
  // 描述：渲染 Markdown 展示，点击就地编辑
  const goalDisplay = h('div', {
    class: 'feed-goal-md',
    html: renderMarkdown(p.goal || ''),
    'data-placeholder': '点击这里编辑描述，支持 Markdown…'
  });
  const goalEdit = h('div', { class: 'feed-goal', contenteditable: 'true' });
  goalEdit.textContent = p.goal || '';
  goalEdit.style.display = 'none';
  goalDisplay.onclick = () => {
    goalDisplay.style.display = 'none';
    goalEdit.style.display = '';
    goalEdit.textContent = p.goal || '';
    if (goalEdit.focus) goalEdit.focus();
  };
  goalEdit.addEventListener('blur', async () => {
    const next = goalEdit.textContent.trim();
    if (next !== (p.goal || '')) {
      await api.put(`/api/projects/${p.id}`, { goal: next });
      toast('已保存');
      paintList();
    }
  });
  post.append(goalDisplay, goalEdit);

  const metaRow = h('div', { class: 'row', style: 'margin:10px 0;flex-wrap:wrap' });
  // 优先级：就地下拉
  const prioSel = h('select', { class: 'input inline-select' });
  for (const [k, v] of [['high', '高'], ['medium', '中'], ['low', '低']]) {
    prioSel.append(h('option', { value: k }, `优先级 ${v}`));
  }
  prioSel.value = p.priority || 'medium';
  prioSel.onchange = async () => {
    await api.put(`/api/projects/${p.id}`, { priority: prioSel.value });
    toast('已保存');
    paintList();
  };
  metaRow.append(prioSel);
  metaRow.append(h('span', { class: 'small muted' }, `📅 ${d.dates}`));
  if (d.blockedBy) metaRow.append(h('span', { class: 'badge blocked' }, `🚫 ${d.blockedBy}`));
  post.append(metaRow);

  post.append(h('div', { class: 'row' },
    h('div', { class: 'progress', style: 'flex:1' }, h('i', { style: `width:${d.completion}%` })),
    h('span', { class: 'small muted' }, `${d.completion}%`)));

  post.append(h('h4', { class: 'feed-sec' }, 'Project tasks'));
  post.append(buildFeedTasks(p));

  const addRow = h('div', { class: 'row', style: 'margin-top:8px' });
  const addInput = h('input', { class: 'input', placeholder: '添加任务，回车确认' });
  const dueInput = h('input', { type: 'date', class: 'input', style: 'width:auto', title: '任务时间' });
  addInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && addInput.value.trim()) {
      await api.post(`/api/projects/${p.id}/tasks`, { title: addInput.value.trim(), dueDate: dueInput.value || null });
      toast('已添加任务');
      paintList();
    }
  });
  addRow.append(addInput, dueInput);
  post.append(addRow);
  return post;
}

function buildFeedTasks(p) {
  const { pending, done } = groupTasksByDone(p.tasks || []);
  const board = h('div', { class: 'kanban' });
  board.append(feedTaskCol('未完成', pending, p, false));
  board.append(feedTaskCol('已完成', done, p, true));
  return board;
}

// 任务看板列：可拖动卡片改完成状态
function feedTaskCol(title, tasks, p, doneFlag) {
  const col = h('div', { class: 'kanban-col' });
  col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop-hover'); });
  col.addEventListener('dragleave', () => col.classList.remove('drop-hover'));
  col.addEventListener('drop', async (e) => {
    e.preventDefault();
    col.classList.remove('drop-hover');
    const tid = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
    if (!tid) return;
    await api.put(`/api/projects/${p.id}/tasks/${tid}`, { done: doneFlag });
    toast('任务已更新');
    paintList();
  });
  col.append(h('div', { class: 'col-head' }, title, h('span', { class: 'small muted' }, String(tasks.length))));
  if (!tasks.length) col.append(h('div', { class: 'small muted', style: 'padding:6px' }, '暂无'));
  for (const t of tasks) {
    const card = h('div', { class: 'kanban-card', draggable: 'true' });
    card.addEventListener('dragstart', (e) => { if (e.dataTransfer) e.dataTransfer.setData('text/plain', t.id); });
    card.append(h('div', { class: 'title' }, escapeHtml(t.title)));
    if (t.dueDate) card.append(h('div', { class: 'small muted' }, `📅 ${t.dueDate}`));
    const subs = t.subtasks || [];
    card.append(h('div', { class: 'small muted' }, `子任务 ${subs.filter((s) => s.done).length}/${subs.length}`));
    col.append(card);
  }
  return col;
}

export function buildProjectTable(projects) {
  const table = h('table', { class: 'project-table' });
  table.append(h('thead', {}, h('tr', {},
    h('th', {}, '项目名称'), h('th', {}, '状态'), h('th', {}, '负责人'),
    h('th', {}, '日期'), h('th', {}, '优先级'), h('th', {}, '完成度'), h('th', {}, '阻塞'), h('th', {}, '')
  )));
  const tbody = h('tbody', {});
  for (const p of projects) tbody.append(buildProjectRow(p));
  table.append(tbody);
  return table;
}

function buildProjectRow(p) {
  const d = projectRowData(p);
  const tr = h('tr', { style: 'cursor:pointer' });
  tr.onclick = () => { location.hash = `#/page/${p.id}`; };
  tr.append(h('td', {}, h('span', { class: 'proj-name' }, escapeHtml(d.name))));
  tr.append(h('td', {}, h('span', { class: `badge ${d.statusCls}` }, d.statusLabel)));
  tr.append(h('td', {}, d.owner
    ? h('span', { class: 'row' }, h('span', { class: 'avatar' }, escapeHtml(d.owner.slice(0, 1))), d.owner)
    : h('span', { class: 'muted' }, '—')));
  tr.append(h('td', { class: 'small muted' }, d.dates));
  tr.append(h('td', {}, h('span', { class: `badge ${d.priorityCls}` }, d.priorityLabel)));
  tr.append(h('td', {}, h('div', { class: 'row' },
    h('div', { class: 'progress', style: 'width:70px' }, h('i', { style: `width:${d.completion}%` })),
    h('span', { class: 'small muted' }, `${d.completion}%`))));
  tr.append(h('td', {}, d.blockedBy ? h('span', { class: 'badge blocked' }, escapeHtml(d.blockedBy)) : ''));

  const tdOps = h('td', {});
  const edit = h('button', { class: 'icon-btn', title: '编辑' }, '✏️');
  edit.onclick = (e) => { e.stopPropagation(); location.hash = `#/page/${p.id}`; };
  const del = h('button', { class: 'icon-btn danger', title: '删除' }, '🗑');
  del.onclick = async (e) => {
    e.stopPropagation();
    if (await confirmDialog(`确认删除「${p.name}」？此操作不可恢复。`, { danger: true })) {
      await api.del(`/api/projects/${p.id}`);
      toast('已删除');
      paintList();
    }
  };
  tdOps.append(edit, del);
  tr.append(tdOps);
  return tr;
}

// 任务区刷新回调（由页面视图注入）
let refreshFn = null;
function refreshTasks() {
  if (refreshFn) refreshFn();
}

// 展开状态：默认收起时记"已展开"，默认展开时记"已收起"（id 全局唯一）
const expandedItems = new Set();
const collapsedItems = new Set();

function isOpen(ctx, node) {
  return ctx.defaultExpanded ? !collapsedItems.has(node.id) : expandedItems.has(node.id);
}

function toggleOpen(ctx, node) {
  const set = ctx.defaultExpanded ? collapsedItems : expandedItems;
  if (set.has(node.id)) set.delete(node.id);
  else set.add(node.id);
}

// 把子树按深度优先摊平成 [{ node, path, depth }]；isExpanded 控制是否继续往下
export function flattenSubtree(nodes, opts = {}) {
  const { path = [], depth = 1, isExpanded } = opts;
  const out = [];
  for (const node of nodes || []) {
    const nodePath = [...path, node.id];
    out.push({ node, path: nodePath, depth });
    const kids = node.subtasks || [];
    if (kids.length && (!isExpanded || isExpanded(node))) {
      out.push(...flattenSubtree(kids, { path: nodePath, depth: depth + 1, isExpanded }));
    }
  }
  return out;
}

// 一个"层级"的视图上下文：项目页任务区（第 1 层）与任意层级的任务页共用同一套视图
// opts: { projectId, parentChain, items, refresh, canAdd, addLabel, onAdd, rangeNode, emptyText, hint, deep, defaultExpanded }
function nodeCtx(opts = {}) {
  const projectId = opts.projectId;
  const parent = opts.parentChain || [];
  const ctx = {
    projectId,
    parentChain: parent,
    items: opts.items || [],
    refresh: typeof opts.refresh === 'function' ? opts.refresh : refreshTasks,
    canAdd: opts.canAdd !== false,
    addLabel: opts.addLabel || '＋ 新增任务',
    onAdd: opts.onAdd || (() => createTask(projectId)),
    rangeNode: opts.rangeNode || {},
    emptyText: opts.emptyText || '还没有内容，点右上角新增。',
    hint: opts.hint || '',
    deep: !!opts.deep,
    defaultExpanded: !!opts.defaultExpanded
  };
  // path 是相对"当前层"的 id 链，例如 ['t1','s1','s2']
  ctx.deepBase = (path) => itemBase(projectId, [...parent, ...path]);
  ctx.deepHref = (path) => itemHref(projectId, [...parent, ...path]);
  ctx.base = (node, sub) => ctx.deepBase(sub ? [node.id, sub.id] : [node.id]);
  ctx.href = (node, sub) => ctx.deepHref(sub ? [node.id, sub.id] : [node.id]);
  // 需列出哪些条目：deep=整棵子树；否则只列直接下级
  ctx.entries = () => (ctx.deep
    ? flattenSubtree(ctx.items)
    : ctx.items.map((node) => ({ node, path: [node.id], depth: 1 })));
  return ctx;
}

// 项目页任务区（第 1 层，父级是项目）
function projectItemCtx(p, refresh) {
  return nodeCtx({
    projectId: p.id,
    parentChain: [],
    items: p.tasks || [],
    refresh,
    rangeNode: p,
    addLabel: '＋ 新增任务',
    onAdd: () => createTask(p.id),
    emptyText: '还没有任务，点右上角「＋ 新增任务」。'
  });
}

// 供页面视图复用：项目任务区（表格 / 时间线 / 看板 / 信息流）
export function buildProjectTasksSection(p, refresh) {
  refreshFn = refresh;
  return buildChildViews(projectItemCtx(p, refresh));
}

// 任意层级的"下级"区块：视图切换 + 四视图 + 新增下级按钮
export function buildChildViews(opts) {
  const ctx = typeof opts.base === 'function' ? opts : nodeCtx(opts);
  const wrap = h('div', { class: 'card', style: 'padding:12px 16px' });

  const bar = h('div', { class: 'row', style: 'margin-bottom:12px;flex-wrap:wrap' });
  const switcher = h('div', { class: 'tabbar', style: 'margin:0;border:none;flex-wrap:wrap' });
  for (const v of TASK_VIEWS) {
    const b = h('button', { class: 'tab' + (taskView === v.value ? ' active' : '') }, v.label);
    b.onclick = () => { taskView = v.value; ctx.refresh(); };
    switcher.append(b);
  }
  bar.append(switcher, h('span', { class: 'spacer' }));
  if (ctx.canAdd) {
    bar.append(h('button', { class: 'btn btn-primary btn-sm add-child-btn', onclick: () => ctx.onAdd() }, ctx.addLabel));
  }
  wrap.append(bar);

  wrap.append(renderItemView(ctx));
  if (ctx.hint) wrap.append(h('div', { class: 'small muted', style: 'margin-top:8px' }, ctx.hint));
  return wrap;
}

function renderItemView(ctx) {
  if (!ctx.items.length) return h('p', { class: 'muted' }, ctx.emptyText);
  if (taskView === 'timeline') return buildItemTimeline(ctx);
  if (taskView === 'board') return buildItemBoard(ctx);
  if (taskView === 'feed') return buildItemFeed(ctx);
  return buildItemTable(ctx);
}

// 表格：完成 / 任务 / 时间 / 状态 / 下级；展开后把下面所有层级都列出来
export function buildItemTable(ctx) {
  const today = todayStr();
  const table = h('table', { class: 'task-table' });
  table.append(h('thead', {}, h('tr', {},
    h('th', { style: 'width:28px' }, ''), h('th', {}, '完成'), h('th', {}, '任务'),
    h('th', {}, '时间'), h('th', {}, '预计'), h('th', {}, '状态'), h('th', {}, '子任务'), h('th', {}, '')
  )));
  const tbody = h('tbody', {});
  for (const t of ctx.items) {
    const subs = t.subtasks || [];
    const open = isOpen(ctx, t);

    const tr = h('tr', {});
    const tdToggle = h('td', {});
    const toggle = h('button', {
      class: 'icon-btn',
      title: subs.length ? '展开/收起子任务' : '无子任务'
    }, subs.length ? (open ? '▾' : '▸') : '·');
    toggle.onclick = (e) => {
      e.stopPropagation();
      if (!subs.length) return;
      toggleOpen(ctx, t);
      ctx.refresh();
    };
    tdToggle.append(toggle);
    tr.append(tdToggle);

    const tdCb = h('td', {});
    const cb = h('input', { type: 'checkbox', class: 'task-check item-check' });
    cb.checked = !!t.done;
    cb.onclick = async () => {
      await api.put(ctx.base(t), { done: !t.done });
      t.done = !t.done;
      ctx.refresh();
    };
    tdCb.append(cb);
    tr.append(tdCb);

    const titleSpan = h('span', { class: 'row-link' + (t.done ? ' muted' : '') }, escapeHtml(t.title));
    titleSpan.onclick = () => { location.hash = ctx.href(t); };
    tr.append(h('td', {}, titleSpan));

    tr.append(h('td', { class: 'small muted' }, formatTaskDates(t)));
    tr.append(h('td', { class: 'small muted estimate-cell' }, estimateText(t) || '—'));
    tr.append(h('td', {}, taskStatusBadge(t, today)));
    tr.append(h('td', { class: 'small muted' }, `${subs.filter((s) => s.done).length}/${subs.length}`));

    const tdOps = h('td', {});
    const edit = h('button', { class: 'icon-btn', title: '编辑' }, '✏️');
    edit.onclick = () => { location.hash = ctx.href(t); };
    const del = h('button', { class: 'icon-btn danger', title: '删除' }, '🗑');
    del.onclick = async () => {
      if (await confirmDialog('删除这个任务及其子任务？', { danger: true })) {
        await api.del(ctx.base(t));
        ctx.refresh();
      }
    };
    tdOps.append(edit, del);
    tr.append(tdOps);
    tbody.append(tr);

    if (open && subs.length) tbody.append(subtreeRow(ctx, t));
  }
  table.append(tbody);
  return table;
}

// 展开行：该任务下面**所有**层级（每层都能勾选 / 进入 / 删除）
function subtreeRow(ctx, top) {
  const list = h('div', { class: 'subtask-list' });
  const entries = flattenSubtree(top.subtasks || [], {
    path: [top.id],
    depth: 1,
    isExpanded: (n) => isOpen(ctx, n)
  });
  if (!entries.length) list.append(h('div', { class: 'small muted' }, '没有下级'));
  for (const entry of entries) list.append(subtreeItemRow(ctx, entry));
  return h('tr', { class: 'subtask-row' }, h('td', { colspan: '7' }, list));
}

function subtreeItemRow(ctx, entry) {
  const { node, path, depth } = entry;
  const kids = node.subtasks || [];
  const row = h('div', { class: 'row', style: 'padding:2px 0' });

  if (depth > 1) row.append(h('span', { style: `width:${(depth - 1) * 16}px;flex-shrink:0` }));

  const toggle = h('button', {
    class: 'icon-btn subtree-toggle',
    title: kids.length ? '展开/收起下级' : '无下级'
  }, kids.length ? (isOpen(ctx, node) ? '▾' : '▸') : '·');
  toggle.onclick = (e) => {
    e.stopPropagation();
    if (!kids.length) return;
    toggleOpen(ctx, node);
    ctx.refresh();
  };
  row.append(toggle);

  const cb = h('input', { type: 'checkbox', class: 'task-check subtask-check' });
  cb.checked = !!node.done;
  cb.onclick = async () => {
    await api.put(ctx.deepBase(path), { done: !node.done });
    node.done = !node.done;
    ctx.refresh();
  };
  row.append(cb);

  const link = h('span', {
    class: 'row-link',
    style: `flex:1;${node.done ? 'text-decoration:line-through;color:var(--muted)' : ''}`
  }, escapeHtml(node.title));
  link.onclick = () => { location.hash = ctx.deepHref(path); };
  row.append(link);

  row.append(h('span', { class: 'small muted' }, formatDateValue(node)));
  if (kids.length) row.append(h('span', { class: 'small muted' }, `下级 ${kids.length}`));

  const del = h('button', { class: 'icon-btn danger', title: '删除' }, '🗑');
  del.onclick = async () => {
    if (await confirmDialog(`删除「${node.title}」及其下级？`, { danger: true })) {
      await api.del(ctx.deepBase(path));
      ctx.refresh();
    }
  };
  row.append(del);
  return row;
}

export function buildTaskTable(p) {
  return buildItemTable(projectItemCtx(p));
}

// 任务在时间轴上的位置：有区间显示区间，只有截止时间则显示截止点
export function taskTimelineBar(task, start, end) {
  const total = Math.max(1, daysBetween(start, end));
  const pct = (d) => Math.max(0, Math.min(100, Math.round((daysBetween(start, d) / total) * 100)));
  if (task.startDate && task.dueDate) {
    const left = pct(task.startDate);
    const width = Math.max(3, pct(task.dueDate) - left);
    return { left, width: Math.min(width, 100 - left) };
  }
  if (task.dueDate) {
    const right = pct(task.dueDate);
    return { left: Math.max(0, right - 3), width: 3 };
  }
  return { left: 0, width: 3 };
}

// 任务拖动时间：有区间则整体平移，只有截止时间则只移动截止时间
export function shiftTaskDates(task, deltaDays) {
  if (task.startDate && task.dueDate) return shiftDates(task, deltaDays);
  if (task.dueDate) return { dueDate: addDays(task.dueDate, deltaDays) };
  return { startDate: addDays(task.startDate || todayStr(), deltaDays) };
}

// 时间线：日期刻度 + 今日红线 + 待办/已完成分组（可拖动改时间、拖名切换完成）
export function buildItemTimeline(ctx) {
  const today = todayStr();
  const all = ctx.entries();
  const dated = all.filter((e) => e.node.dueDate);
  const wrap = h('div', { class: 'timeline' });

  if (!dated.length) {
    wrap.append(h('p', { class: 'muted' }, '还没有设置时间的任务。'));
    return wrap;
  }

  const { start, end } = ganttRange(all.map((e) => e.node), ctx.rangeNode);
  const totalDays = Math.max(1, daysBetween(start, end));
  wrap.append(h('div', { class: 'row timeline-head' },
    h('span', { class: 'small muted' }, `时间轴：${start} ~ ${end}`),
    h('span', { class: 'spacer' }),
    h('span', { class: 'small muted' }, `${totalDays} 天`)));
  wrap.append(h('div', { class: 'small muted', style: 'margin-bottom:4px' }, '拖动时间条可改时间、拖两端可改起止；把名称拖到分组标题上可切换完成'));

  wrap.append(buildTimelineAxis(start, end));

  const axisInfo = timelineAxis(start, end);
  const rowMinW = Math.max(520, Math.min(4000, axisInfo.totalDays * 20));
  const tp = todayPct(start, end);
  const groups = [
    { key: 'pending', label: '待办', cls: 'active', done: false, items: dated.filter((e) => !e.node.done) },
    { key: 'done', label: '已完成', cls: 'done', done: true, items: dated.filter((e) => e.node.done) }
  ];

  for (const grp of groups) {
    const box = h('div', { class: 'timeline-groupbox' });
    box.append(h('div', { class: 'timeline-group' },
      h('span', { class: `badge ${grp.cls}` }, grp.label),
      h('span', { class: 'small muted' }, String(grp.items.length))));

    box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drop-hover'); });
    box.addEventListener('dragleave', () => box.classList.remove('drop-hover'));
    box.addEventListener('drop', async (e) => {
      e.preventDefault();
      box.classList.remove('drop-hover');
      const id = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
      const entry = all.find((x) => x.node.id === id);
      if (!entry) return;
      await api.put(ctx.deepBase(entry.path), { done: grp.done });
      toast('状态已更新');
      ctx.refresh();
    });

    if (!grp.items.length) box.append(h('div', { class: 'small muted', style: 'padding:2px 8px' }, '暂无'));

    for (const entry of grp.items) {
      const t = entry.node;
      const bar = taskTimelineBar(t, start, end);
      const color = timelineColor(t.id);
      const row = h('div', { class: 'timeline-row', style: `min-width:${rowMinW}px` });
      const label = h('span', {
        class: 'timeline-label row-link',
        style: entry.depth > 1 ? `padding-left:${(entry.depth - 1) * 14}px` : '',
        title: `${t.title}（拖到分组标题可切换完成）`,
        draggable: 'true'
      }, h('i', { class: 'timeline-dot', style: `background:${color}` }), escapeHtml(t.title));
      if (estimateText(t)) label.append(h('span', { class: 'small muted estimate-chip' }, estimateText(t)));
      label.onclick = () => { location.hash = ctx.deepHref(entry.path); };
      label.ondragstart = (e) => { if (e.dataTransfer) e.dataTransfer.setData('text/plain', t.id); };
      row.append(label);

      const track = h('div', { class: 'timeline-track' });
      track.append(trackGrid(start, end));
      if (tp !== null) track.append(h('div', { class: 'timeline-today', style: `left:${tp}%` }));

      const savePatch = async (patch) => {
        if (!patch) { ctx.refresh(); return; }
        await api.put(ctx.deepBase(entry.path), patch);
        toast('时间已更新');
        ctx.refresh();
      };

      const cls = t.done ? 'done' : (taskIsOverdue(t, today) ? 'paused' : 'active');
      const barEl = h('div', {
        class: `timeline-bar bar-${cls}`,
        style: `left:${bar.left}%;width:${bar.width}%;background:${color}`,
        title: `${t.title}（${formatTaskDates(t)}）`
      }, h('span', { class: 'timeline-bar-label' }, formatTaskDates(t)));
      barEl.onclick = () => { if (!barEl.dataset || !barEl.dataset.dragged) location.hash = ctx.deepHref(entry.path); };
      attachBarDrag(barEl, track, t, totalDays, savePatch);

      const leftH = h('div', { class: 'timeline-handle left', title: '拖动调整开始时间' });
      const rightH = h('div', { class: 'timeline-handle right', title: '拖动调整结束时间' });
      leftH.addEventListener('click', (e) => e.stopPropagation());
      rightH.addEventListener('click', (e) => e.stopPropagation());
      barEl.append(leftH, rightH);
      attachHandleDrag(leftH, barEl, track, t, totalDays, 'left', savePatch);
      attachHandleDrag(rightH, barEl, track, t, totalDays, 'right', savePatch);

      track.append(barEl);
      row.append(track);
      box.append(row);
    }
    wrap.append(box);
  }

  const undated = all.filter((e) => !e.node.dueDate);
  if (undated.length) {
    wrap.append(h('div', { class: 'small muted', style: 'margin-top:8px' }, '未设置时间：' + undated.map((e) => e.node.title).join('、')));
  }
  return wrap;
}

export function buildTaskTimeline(p) {
  return buildItemTimeline(projectItemCtx(p));
}

// 看板：待办 / 已完成（可拖动卡片切换）
export function buildItemBoard(ctx) {
  const all = ctx.entries();
  const today = todayStr();
  const board = h('div', { class: 'kanban' });
  board.append(itemCol(ctx, '待办', all.filter((e) => !e.node.done), today, false, all));
  board.append(itemCol(ctx, '已完成', all.filter((e) => e.node.done), today, true, all));
  return board;
}

export function buildTaskBoard(p) {
  return buildItemBoard(projectItemCtx(p));
}

function itemCol(ctx, title, entries, today, doneFlag, all) {
  const col = h('div', { class: 'kanban-col ' + (doneFlag ? 'board-col-done' : 'board-col-active') });
  col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop-hover'); });
  col.addEventListener('dragleave', () => col.classList.remove('drop-hover'));
  col.addEventListener('drop', async (e) => {
    e.preventDefault();
    col.classList.remove('drop-hover');
    const id = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
    const entry = all.find((x) => x.node.id === id);
    if (!entry) return;
    await api.put(ctx.deepBase(entry.path), { done: doneFlag });
    toast('状态已更新');
    ctx.refresh();
  });

  col.append(h('div', { class: 'col-head' }, title, h('span', { class: 'small muted' }, String(entries.length))));
  if (!entries.length) col.append(h('div', { class: 'small muted', style: 'padding:6px' }, '暂无'));

  for (const entry of entries) {
    const t = entry.node;
    const card = h('div', {
      class: 'kanban-card',
      draggable: 'true',
      style: entry.depth > 1 ? `margin-left:${(entry.depth - 1) * 12}px` : ''
    });
    card.addEventListener('dragstart', (e) => { if (e.dataTransfer) e.dataTransfer.setData('text/plain', t.id); });

    const titleEl = h('div', { class: 'title row-link' }, escapeHtml(t.title));
    titleEl.onclick = () => { location.hash = ctx.deepHref(entry.path); };
    card.append(titleEl);

    const metaRow = h('div', { class: 'row', style: 'margin-top:6px;flex-wrap:wrap' });
    metaRow.append(h('span', { class: 'small muted' }, `📅 ${formatTaskDates(t)}`));
    if (estimateText(t)) metaRow.append(h('span', { class: 'small muted estimate-chip' }, estimateText(t)));
    if (!t.done && taskIsOverdue(t, today)) metaRow.append(h('span', { class: 'badge overdue' }, '已逾期'));
    card.append(metaRow);

    const subs = t.subtasks || [];
    if (subs.length) {
      const list = h('div', { class: 'subtask-list', style: 'margin-top:6px' });
      for (const st of subs) {
        const subEntry = { node: st, path: [...entry.path, st.id], depth: entry.depth + 1 };
        const scb = h('input', { type: 'checkbox', class: 'task-check subtask-check' });
        scb.checked = !!st.done;
        scb.onclick = async (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          await api.put(ctx.deepBase(subEntry.path), { done: !st.done });
          st.done = !st.done;
          ctx.refresh();
        };
        const subLink = h('span', { class: 'small row-link', style: `flex:1;${st.done ? 'text-decoration:line-through;color:var(--muted)' : ''}` }, escapeHtml(st.title));
        subLink.onclick = (e) => { if (e && e.stopPropagation) e.stopPropagation(); location.hash = ctx.deepHref(subEntry.path); };
        list.append(h('div', { class: 'row' }, scb, subLink));
      }
      card.append(list);
    } else {
      card.append(h('div', { class: 'small muted', style: 'margin-top:6px' }, '无子任务'));
    }
    col.append(card);
  }
  return col;
}

// 信息流：每项一张卡片（标题就地编辑 + 下级看板可拖动）
export function buildItemFeed(ctx) {
  const all = ctx.entries();
  const order = sortTasksForFeed(all.map((e) => e.node)).map((n) => n.id);
  const sorted = order.map((id) => all.find((e) => e.node.id === id)).filter(Boolean);
  const feed = h('div', { class: 'feed' });
  for (const entry of sorted) feed.append(buildItemPost(ctx, entry));
  return feed;
}

export function buildTaskFeed(p) {
  return buildItemFeed(projectItemCtx(p));
}

function buildItemPost(ctx, entry) {
  const t = entry.node;
  const today = todayStr();
  const post = h('div', { class: 'feed-post card' });
  if (entry.depth > 1) post.style.marginLeft = `${(entry.depth - 1) * 16}px`;

  const head = h('div', { class: 'row', style: 'margin-bottom:6px' });
  const cb = h('input', { type: 'checkbox', class: 'task-check item-check' });
  cb.checked = !!t.done;
  cb.onclick = async () => {
    await api.put(ctx.deepBase(entry.path), { done: !t.done });
    t.done = !t.done;
    ctx.refresh();
  };
  head.append(cb);

  const title = h('h3', { class: 'feed-title', contenteditable: 'true', spellcheck: 'false', style: 'margin:0;flex:1' });
  title.textContent = t.title;
  title.addEventListener('blur', async () => {
    const next = title.textContent.trim();
    if (!next) { title.textContent = t.title; return; }
    if (next !== t.title) {
      await api.put(ctx.deepBase(entry.path), { title: next });
      t.title = next;
      toast('已保存');
      ctx.refresh();
    }
  });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  head.append(title, taskStatusBadge(t, today));
  post.append(head);

  const meta = h('div', { class: 'row', style: 'margin:6px 0;flex-wrap:wrap' });
  if (entry.depth > 1) meta.append(h('span', { class: 'small muted' }, `第 ${entry.depth} 层`));
  meta.append(h('span', { class: 'small muted' }, `📅 ${formatTaskDates(t)}`));
  if (estimateText(t)) meta.append(h('span', { class: 'small muted estimate-chip' }, estimateText(t)));
  const subs = t.subtasks || [];
  meta.append(h('span', { class: 'small muted' }, `子任务 ${subs.filter((s) => s.done).length}/${subs.length}`));
  if (t.createdAt) meta.append(h('span', { class: 'small muted' }, `创建于 ${String(t.createdAt).slice(0, 10)}`));
  post.append(meta);

  // 内容：整篇 Markdown 展示，点击就地编辑；边打字边自动保存
  post.append(h('h4', { class: 'feed-sec' }, '内容'));
  const descDisplay = h('div', {
    class: 'feed-goal-md',
    html: renderMarkdown(t.desc || ''),
    'data-placeholder': '点击这里编辑内容，支持 Markdown…'
  });
  const descEdit = h('div', {
    class: 'feed-goal',
    contenteditable: 'true',
    'data-focus-key': `${ctx.deepBase(entry.path)}:content`
  });
  descEdit.textContent = t.desc || '';
  descEdit.style.display = 'none';
  descDisplay.onclick = () => {
    descDisplay.style.display = 'none';
    descEdit.style.display = '';
    descEdit.textContent = t.desc || '';
    if (descEdit.focus) descEdit.focus();
  };

  let descTimer = null;
  const cancelDescTimer = () => {
    if (descTimer) {
      clearTimeout(descTimer);
      descTimer = null;
    }
  };
  const saveDesc = async (silent) => {
    const next = descEdit.textContent.trim();
    if (next === (t.desc || '')) return;
    await api.put(ctx.deepBase(entry.path), { desc: next });
    t.desc = next;
    if (!silent) toast('已保存');
  };
  // 边打字边保存：别的保存会触发整页重绘，只靠失焦会丢掉还没保存的字
  descEdit.addEventListener('input', () => {
    cancelDescTimer();
    descTimer = setTimeout(() => {
      descTimer = null;
      saveDesc(true);
    }, 700);
  });
  descEdit.addEventListener('blur', async () => {
    cancelDescTimer();
    await saveDesc(false);
    ctx.refresh();
  });
  post.append(descDisplay, descEdit);

  post.append(h('h4', { class: 'feed-sec' }, '子任务'));
  post.append(buildItemSubBoard(ctx, entry));
  return post;
}

function buildItemSubBoard(ctx, entry) {
  const subs = entry.node.subtasks || [];
  const subEntries = subs.map((s) => ({ node: s, path: [...entry.path, s.id], depth: entry.depth + 1 }));
  const board = h('div', { class: 'kanban' });
  board.append(itemSubCol(ctx, '未完成', subEntries.filter((e) => !e.node.done), false, subEntries));
  board.append(itemSubCol(ctx, '已完成', subEntries.filter((e) => e.node.done), true, subEntries));
  return board;
}

function itemSubCol(ctx, title, entries, doneFlag, all) {
  const col = h('div', { class: 'kanban-col ' + (doneFlag ? 'board-col-done' : 'board-col-active') });
  col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop-hover'); });
  col.addEventListener('dragleave', () => col.classList.remove('drop-hover'));
  col.addEventListener('drop', async (e) => {
    e.preventDefault();
    col.classList.remove('drop-hover');
    const id = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
    const entry = all.find((x) => x.node.id === id);
    if (!entry) return;
    await api.put(ctx.deepBase(entry.path), { done: doneFlag });
    toast('子任务已更新');
    ctx.refresh();
  });
  col.append(h('div', { class: 'col-head' }, title, h('span', { class: 'small muted' }, String(entries.length))));
  if (!entries.length) col.append(h('div', { class: 'small muted', style: 'padding:6px' }, '暂无'));
  for (const entry of entries) {
    const card = h('div', { class: 'kanban-card', draggable: 'true' });
    card.addEventListener('dragstart', (e) => { if (e.dataTransfer) e.dataTransfer.setData('text/plain', entry.node.id); });
    card.append(h('div', { class: 'title' }, escapeHtml(entry.node.title)));
    col.append(card);
  }
  return col;
}

export function add() {
  createProject();
}
