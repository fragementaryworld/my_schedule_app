'use strict';
import { api } from '../api.js';
import { h, toast, openModal, confirmDialog } from '../ui.js';
import { escapeHtml, PROJECT_STATUS, fmtDate, todayStr, priorityClass, priorityLabel, addDays } from '../utils.js';

let el = null;
let currentParams = {};
let currentFilter = 'all';
let listView = 'table';
let taskView = 'table';
let cachedProjects = [];

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
  const start = (p && p.startDate) || '';
  const due = (p && p.dueDate) || '';
  if (start && due) return `${start} → ${due}`;
  if (due) return due;
  if (start) return start;
  return '—';
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

export function pxToDays(dxPx, trackWidthPx, totalDays) {
  if (!trackWidthPx) return 0;
  return Math.round((dxPx / trackWidthPx) * totalDays);
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

export function ganttRange(tasks, project) {
  const p = project || {};
  let start = p.startDate || todayStr();
  let end = p.dueDate || todayStr();
  for (const t of tasks || []) {
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
  if (params.id) await paintDetail(params.id);
  else await paintList();
}

async function paintList() {
  if (!el) return;
  el.innerHTML = '';
  const projects = await api.get('/api/projects');
  cachedProjects = projects;
  el.append(buildViewBar());
  const shown = currentFilter === 'all' ? projects : projects.filter((p) => p.status === currentFilter);
  if (!shown.length) {
    el.append(h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, '📁'), h('p', {}, '还没有项目，点右上角「＋ 新增项目」。')));
    return;
  }
  el.append(renderProjectView(shown));
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
  bar.append(h('button', { class: 'btn btn-primary btn-sm', onclick: () => projectModal() }, '＋ 新增项目'));
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
    colEl.append(h('div', { class: 'board-new', onclick: () => projectModal() }, '＋ 新建项目'));
    board.append(colEl);
  }
  return board;
}

function buildBoardCard(p) {
  const d = projectRowData(p);
  const card = h('div', { class: 'kanban-card', draggable: 'true', style: 'cursor:pointer' });
  card.addEventListener('dragstart', (e) => { if (e.dataTransfer) e.dataTransfer.setData('text/plain', p.id); });
  card.onclick = () => { location.hash = `#/projects/${p.id}`; };
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

  const axis = h('div', { class: 'timeline-axis' });
  for (const t of timelineTicks(start, end, 7)) {
    axis.append(h('div', { class: 'timeline-tickwrap', style: `left:${t.pct}%` },
      h('span', { class: 'timeline-tick-label' }, t.date),
      h('i', { class: 'timeline-tick' })));
  }
  wrap.append(axis);

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
      const row = h('div', { class: 'timeline-row' });
      const label = h('span', { class: 'timeline-label', title: `${p.name}（拖到分组标题可改状态）`, draggable: 'true' }, escapeHtml(p.name));
      label.onclick = () => { location.hash = `#/projects/${p.id}`; };
      label.ondragstart = (e) => { if (e.dataTransfer) e.dataTransfer.setData('text/plain', p.id); };
      row.append(label);

      const track = h('div', { class: 'timeline-track' });
      if (tp !== null) track.append(h('div', { class: 'timeline-today', style: `left:${tp}%` }));
      const barEl = h('div', {
        class: `timeline-bar bar-${col.cls}`,
        style: `left:${bar.left}%;width:${bar.width}%`,
        title: `${p.name}（${formatProjectDates(p)}）`
      }, h('span', { class: 'timeline-bar-label' }, formatProjectDates(p)));
      barEl.onclick = () => { if (!barEl.dataset || !barEl.dataset.dragged) location.hash = `#/projects/${p.id}`; };
      attachBarDrag(barEl, track, p, totalDays);

      const leftH = h('div', { class: 'timeline-handle left', title: '拖动调整开始时间' });
      const rightH = h('div', { class: 'timeline-handle right', title: '拖动调整结束时间' });
      leftH.addEventListener('click', (e) => e.stopPropagation());
      rightH.addEventListener('click', (e) => e.stopPropagation());
      barEl.append(leftH, rightH);
      attachHandleDrag(leftH, barEl, track, p, totalDays, 'left');
      attachHandleDrag(rightH, barEl, track, p, totalDays, 'right');

      track.append(barEl);
      row.append(track);
      box.append(row);
    }
    wrap.append(box);
  }
  return wrap;
}

// 按住时间条左右拖动 → 平移项目起止日期
function attachBarDrag(barEl, track, project, totalDays) {
  barEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const width = (track.getBoundingClientRect && track.getBoundingClientRect().width) || 1;
    const originLeft = parseFloat(barEl.style.left) || 0;
    const originWidth = parseFloat(barEl.style.width) || 0;
    const startX = e.clientX || 0;
    let deltaDays = 0;
    let moved = false;

    const onMove = (ev) => {
      const dx = (ev.clientX || 0) - startX;
      if (Math.abs(dx) > 2) moved = true;
      deltaDays = pxToDays(dx, width, totalDays);
      const shiftPct = (deltaDays / Math.max(1, totalDays)) * 100;
      const newLeft = Math.max(0, Math.min(Math.max(0, 100 - originWidth), originLeft + shiftPct));
      barEl.style.left = `${newLeft}%`;
    };
    const onUp = async () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!moved) return;
      if (barEl.dataset) barEl.dataset.dragged = '1';
      setTimeout(() => { if (barEl.dataset) delete barEl.dataset.dragged; }, 0);
      if (deltaDays === 0) return;
      await api.put(`/api/projects/${project.id}`, shiftDates(project, deltaDays));
      toast('时间已更新');
      paintList();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// 拖动时间条左右两端的把手 → 单独调整开始 / 结束时间
function attachHandleDrag(handleEl, barEl, track, project, totalDays, side) {
  handleEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const width = (track.getBoundingClientRect && track.getBoundingClientRect().width) || 1;
    const startX = e.clientX || 0;
    let deltaDays = 0;
    let moved = false;

    const onMove = (ev) => {
      const dx = (ev.clientX || 0) - startX;
      if (Math.abs(dx) > 2) moved = true;
      deltaDays = pxToDays(dx, width, totalDays);
      const shiftPct = (deltaDays / Math.max(1, totalDays)) * 100;
      const curLeft = parseFloat(barEl.style.left) || 0;
      const curWidth = parseFloat(barEl.style.width) || 0;
      if (side === 'left') {
        const newLeft = Math.max(0, Math.min(curLeft + curWidth - 3, curLeft + shiftPct));
        barEl.style.left = `${newLeft}%`;
        barEl.style.width = `${Math.max(3, curLeft + curWidth - newLeft)}%`;
      } else {
        const newWidth = Math.max(3, Math.min(100 - curLeft, curWidth + shiftPct));
        barEl.style.width = `${newWidth}%`;
      }
    };
    const onUp = async () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!moved) return;
      if (barEl.dataset) barEl.dataset.dragged = '1';
      setTimeout(() => { if (barEl.dataset) delete barEl.dataset.dragged; }, 0);
      if (deltaDays === 0) return;
      const patch = side === 'left' ? resizeStart(project, deltaDays) : resizeEnd(project, deltaDays);
      await api.put(`/api/projects/${project.id}`, patch);
      toast('时间已更新');
      paintList();
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
  // 描述：直接就地编辑（像 markdown 文本）
  const goalEl = h('div', { class: 'feed-goal', contenteditable: 'true', 'data-placeholder': '点击这里直接编辑描述…' });
  goalEl.textContent = p.goal || '';
  goalEl.addEventListener('blur', async () => {
    const next = goalEl.textContent.trim();
    if (next !== (p.goal || '')) {
      await api.put(`/api/projects/${p.id}`, { goal: next });
      toast('已保存');
      paintList();
    }
  });
  post.append(goalEl);

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

function buildProjectTable(projects) {
  const table = h('table', { class: 'project-table' });
  table.append(h('thead', {}, h('tr', {},
    h('th', {}, '项目名称'), h('th', {}, '状态'), h('th', {}, '负责人'),
    h('th', {}, '日期'), h('th', {}, '优先级'), h('th', {}, '完成度'), h('th', {}, '阻塞')
  )));
  const tbody = h('tbody', {});
  for (const p of projects) tbody.append(buildProjectRow(p));
  table.append(tbody);
  return table;
}

function buildProjectRow(p) {
  const d = projectRowData(p);
  const tr = h('tr', { style: 'cursor:pointer' });
  tr.onclick = () => { location.hash = `#/projects/${p.id}`; };
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
  return tr;
}

async function paintDetail(id) {
  const projects = await api.get('/api/projects');
  cachedProjects = projects;
  const p = projects.find((x) => x.id === id);
  if (!p) {
    el.innerHTML = '<div class="empty"><p>项目不存在或已删除。</p></div>';
    return;
  }
  el.innerHTML = '';
  el.append(buildDetailHead(p));
  el.append(buildOverview(p));
  el.append(h('h3', { style: 'margin:20px 0 8px' }, '✅ 任务'));
  el.append(buildProjectTasks(p));
}

function buildDetailHead(p) {
  const head = h('div', { class: 'detail-head' });
  const back = h('button', { class: 'btn btn-sm' }, '← 返回');
  back.onclick = () => { location.hash = '#/projects'; };
  head.append(back);
  head.append(h('h2', {}, escapeHtml(p.name)));
  const st = PROJECT_STATUS[p.status] || PROJECT_STATUS.active;
  head.append(h('span', { class: `badge ${st.cls}` }, st.label));

  const sel = h('select', { class: 'input', style: 'width:auto' });
  for (const [k, v] of Object.entries(PROJECT_STATUS)) sel.append(h('option', { value: k }, v.label));
  sel.value = p.status;
  sel.onchange = async () => {
    await api.put(`/api/projects/${p.id}`, { status: sel.value });
    toast('状态已更新');
    paintDetail(p.id);
  };
  head.append(sel);

  const edit = h('button', { class: 'btn btn-sm' }, '✏️ 编辑');
  edit.onclick = () => projectModal(p);
  const del = h('button', { class: 'btn btn-sm btn-danger' }, '删除');
  del.onclick = async () => {
    if (await confirmDialog(`确认删除项目「${p.name}」？此操作不可恢复。`, { danger: true })) {
      await api.del(`/api/projects/${p.id}`);
      toast('已删除');
      location.hash = '#/projects';
    }
  };
  head.append(edit, del);
  return head;
}

function buildOverview(p) {
  const card = h('div', { class: 'card', style: 'padding:16px' });
  if (p.goal) card.append(h('p', { class: 'muted', style: 'margin:0 0 8px' }, escapeHtml(p.goal)));
  const meta = h('div', { class: 'small muted row' });
  meta.append(h('span', {}, `开始 ${fmtDate(p.startDate)}`));
  if (p.dueDate) meta.append(h('span', {}, `· 截止 ${fmtDate(p.dueDate)}`));
  card.append(meta);

  const total = (p.tasks || []).length;
  const doneCount = (p.tasks || []).filter((t) => t.done).length;
  const pct = p.progress || 0;
  card.append(h('div', { class: 'row', style: 'margin-top:10px' },
    h('span', { class: 'small muted' }, '完成度'),
    h('div', { class: 'progress', style: 'flex:1' }, h('i', { style: `width:${pct}%` })),
    h('span', { class: 'small muted' }, `${pct}%（${doneCount}/${total}）`)
  ));
  return card;
}

function buildProjectTasks(p) {
  const wrap = h('div', { class: 'card', style: 'padding:12px 16px' });

  const switcher = h('div', { class: 'tabbar', style: 'margin-bottom:12px' });
  for (const [k, label] of [['table', '表格'], ['gantt', '甘特图'], ['kanban', '看板']]) {
    const b = h('button', { class: 'tab' + (taskView === k ? ' active' : '') }, label);
    b.onclick = () => { taskView = k; paintDetail(p.id); };
    switcher.append(b);
  }
  wrap.append(switcher);

  if (taskView === 'table') wrap.append(buildTaskTable(p));
  else if (taskView === 'gantt') wrap.append(buildTaskGantt(p));
  else wrap.append(buildTaskKanban(p));

  const addRow = h('div', { class: 'row', style: 'margin:12px 0 0' });
  const addInput = h('input', { class: 'input', placeholder: '输入任务，回车添加' });
  const dueInput = h('input', { type: 'date', class: 'input', style: 'width:auto', title: '任务时间' });
  addInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && addInput.value.trim()) {
      await api.post(`/api/projects/${p.id}/tasks`, { title: addInput.value.trim(), dueDate: dueInput.value || null });
      addInput.value = '';
      dueInput.value = '';
      paintDetail(p.id);
    }
  });
  addRow.append(addInput, dueInput);
  wrap.append(addRow);
  return wrap;
}

function buildTaskTable(p) {
  if (!p.tasks.length) return h('p', { class: 'muted' }, '还没有任务，在下方添加。');
  const table = h('table', { class: 'task-table' });
  table.append(h('thead', {}, h('tr', {},
    h('th', {}, '完成'), h('th', {}, '任务'), h('th', {}, '时间'), h('th', {}, '子任务'), h('th', {}, '')
  )));
  const tbody = h('tbody', {});
  for (const t of p.tasks) {
    const tr = h('tr', {});
    const tdCb = h('td', {});
    const cb = h('input', { type: 'checkbox', class: 'task-check' });
    cb.checked = !!t.done;
    cb.onclick = async () => { await api.put(`/api/projects/${p.id}/tasks/${t.id}`, { done: !t.done }); paintDetail(p.id); };
    tdCb.append(cb);
    const tdTitle = h('td', {}, h('span', { class: t.done ? 'muted' : '' }, escapeHtml(t.title)));
    const tdDate = h('td', {}, t.dueDate || '—');
    const subs = t.subtasks || [];
    const tdSub = h('td', {}, `${subs.filter((s) => s.done).length}/${subs.length}`);
    const tdOps = h('td', {});
    const edit = h('button', { class: 'icon-btn', title: '编辑' }, '✏️');
    edit.onclick = () => taskModal(p, t);
    const del = h('button', { class: 'icon-btn danger', title: '删除' }, '🗑');
    del.onclick = async () => {
      if (await confirmDialog('删除这个任务及其子任务？', { danger: true })) {
        await api.del(`/api/projects/${p.id}/tasks/${t.id}`);
        paintDetail(p.id);
      }
    };
    tdOps.append(edit, del);
    tr.append(tdCb, tdTitle, tdDate, tdSub, tdOps);
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

function buildTaskGantt(p) {
  if (!p.tasks.length) return h('p', { class: 'muted' }, '还没有任务，在下方添加。');
  const dated = p.tasks.filter((t) => t.dueDate);
  const undated = p.tasks.filter((t) => !t.dueDate);
  const wrap = h('div', {});
  if (dated.length) {
    const { start, end } = ganttRange(p.tasks, p);
    wrap.append(h('div', { class: 'small muted', style: 'margin-bottom:8px' }, `时间轴：${start} ~ ${end}`));
    for (const t of dated) {
      const pct = ganttBarPct(t.dueDate, start, end);
      const row = h('div', { class: 'gantt-row' });
      const label = h('span', { class: 'gantt-label', title: t.title }, escapeHtml(t.title));
      label.onclick = () => taskModal(p, t);
      row.append(label);
      const track = h('div', { class: 'gantt-track' });
      track.append(h('i', { style: `width:${pct}%` }));
      row.append(track);
      row.append(h('span', { class: 'small muted' }, t.dueDate));
      wrap.append(row);
    }
  }
  if (undated.length) {
    wrap.append(h('div', { class: 'small muted', style: 'margin-top:8px' }, '未设置时间：' + undated.map((t) => t.title).join('、')));
  }
  return wrap;
}

function buildTaskKanban(p) {
  if (!p.tasks.length) return h('p', { class: 'muted' }, '还没有任务，在下方添加。');
  const { pending, done } = groupTasksByDone(p.tasks);
  const board = h('div', { class: 'kanban' });
  board.append(kanbanCol('待办', pending, p));
  board.append(kanbanCol('已完成', done, p));
  return board;
}

function kanbanCol(title, tasks, p) {
  const col = h('div', { class: 'kanban-col' });
  col.append(h('div', { class: 'col-head' }, title, h('span', { class: 'small muted' }, String(tasks.length))));
  for (const t of tasks) {
    const card = h('div', { class: 'kanban-card' });
    const head = h('div', { class: 'row' });
    const cb = h('input', { type: 'checkbox', class: 'task-check' });
    cb.checked = !!t.done;
    cb.onclick = async () => { await api.put(`/api/projects/${p.id}/tasks/${t.id}`, { done: !t.done }); paintDetail(p.id); };
    head.append(cb);
    const titleEl = h('span', { class: 'title', style: 'flex:1' }, escapeHtml(t.title));
    titleEl.onclick = () => taskModal(p, t);
    head.append(titleEl);
    card.append(head);
    if (t.dueDate) card.append(h('div', { class: 'small muted' }, `📅 ${t.dueDate}`));
    const subs = t.subtasks || [];
    card.append(h('div', { class: 'small muted' }, `子任务 ${subs.filter((s) => s.done).length}/${subs.length}`));
    col.append(card);
  }
  return col;
}

function taskModal(p, t) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', { class: 'modal' });
  const body = h('div', { class: 'modal-body' });

  body.append(h('label', {}, '任务'));
  const titleInput = h('input', { class: 'input', value: t.title });
  body.append(titleInput);
  body.append(h('label', { style: 'margin-top:8px' }, '时间（可选）'));
  const dueInput = h('input', { type: 'date', class: 'input', value: t.dueDate || '' });
  body.append(dueInput);

  body.append(h('label', { style: 'margin-top:8px' }, '子任务'));
  const subWrap = h('div', {});
  const renderSubs = () => {
    subWrap.innerHTML = '';
    for (const st of t.subtasks || []) {
      const row = h('div', { class: 'row' });
      const cb = h('input', { type: 'checkbox', class: 'task-check' });
      cb.checked = !!st.done;
      cb.onclick = async () => {
        await api.put(`/api/projects/${p.id}/tasks/${t.id}/subtasks/${st.id}`, { done: !st.done });
        st.done = !st.done;
        renderSubs();
      };
      row.append(cb);
      row.append(h('span', { style: 'flex:1' }, escapeHtml(st.title)));
      const del = h('button', { type: 'button', class: 'icon-btn danger' }, '🗑');
      del.onclick = async () => {
        if (await confirmDialog('删除这个子任务？', { danger: true })) {
          await api.del(`/api/projects/${p.id}/tasks/${t.id}/subtasks/${st.id}`);
          t.subtasks = (t.subtasks || []).filter((x) => x.id !== st.id);
          renderSubs();
        }
      };
      row.append(del);
      subWrap.append(row);
    }
  };
  renderSubs();
  body.append(subWrap);

  const subInput = h('input', { class: 'input', placeholder: '添加子任务，回车确认', style: 'margin-top:4px' });
  subInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && subInput.value.trim()) {
      const st = await api.post(`/api/projects/${p.id}/tasks/${t.id}/subtasks`, { title: subInput.value.trim() });
      t.subtasks = t.subtasks || [];
      t.subtasks.push(st);
      subInput.value = '';
      renderSubs();
    }
  });
  body.append(subInput);

  const foot = h('div', { class: 'modal-foot' });
  const cancel = h('button', { class: 'btn' }, '取消');
  const save = h('button', { class: 'btn btn-primary' }, '保存');
  foot.append(cancel, save);
  modal.append(h('div', { class: 'modal-title' }, '编辑任务'), body, foot);
  backdrop.append(modal);
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  cancel.onclick = () => close();
  // 点击遮罩不关闭，避免误触丢失已填内容
  save.onclick = async () => {
    if (!titleInput.value.trim()) { toast('请填写任务名称', 'error'); return; }
    await api.put(`/api/projects/${p.id}/tasks/${t.id}`, { title: titleInput.value.trim(), dueDate: dueInput.value || null });
    toast('已保存');
    close();
    paintDetail(p.id);
  };
}

export function projectFields(p) {
  return [
    { name: 'name', label: '项目名称', required: true, value: p ? p.name : '' },
    { name: 'goal', label: '目标说明', type: 'textarea', value: p ? (p.goal || '') : '' },
    { name: 'status', label: '状态', type: 'select', value: p ? (p.status || 'active') : 'active',
      options: Object.entries(PROJECT_STATUS).map(([k, v]) => ({ value: k, label: v.label })) },
    { name: 'startDate', label: '开始日期', type: 'date', value: p ? (p.startDate || todayStr()) : todayStr() },
    { name: 'dueDate', label: '截止日期（可选）', type: 'date', value: p ? (p.dueDate || '') : '' },
    { name: 'priority', label: '优先级', type: 'select', value: p ? (p.priority || 'medium') : 'medium',
      options: [{ value: 'high', label: '高' }, { value: 'medium', label: '中' }, { value: 'low', label: '低' }] },
    { name: 'owner', label: '负责人（可选择或输入）', type: 'datalist', value: p ? (p.owner || '') : '', options: collectOwners(cachedProjects) },
    { name: 'blockedBy', label: '阻塞（可选）', type: 'select', value: p ? (p.blockedBy || '') : '',
      options: blockedByOptions(cachedProjects, p ? (p.blockedBy || '') : '', p ? p.id : null) }
  ];
}

function projectModal(p, onDone) {
  openModal({
    title: p ? '编辑项目' : '新增项目',
    fields: projectFields(p),
    onSubmit: async (v) => {
      const payload = {
        name: v.name.trim(),
        goal: v.goal,
        status: v.status,
        startDate: v.startDate,
        dueDate: v.dueDate || null,
        priority: v.priority,
        owner: v.owner,
        blockedBy: v.blockedBy
      };
      if (p) await api.put(`/api/projects/${p.id}`, payload);
      else await api.post('/api/projects', payload);
      toast(p ? '已保存' : '已创建');
      if (onDone) onDone();
      else if (p) paintDetail(p.id);
      else paintList();
    }
  });
}

export function add() {
  projectModal();
}
