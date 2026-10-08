'use strict';
import { api } from '../api.js';
import { h, toast, openModal, confirmDialog } from '../ui.js';
import { escapeHtml, PROJECT_STATUS, fmtDate, todayStr, priorityClass, priorityLabel } from '../utils.js';

let el = null;
let currentParams = {};
let currentFilter = 'all';
let listView = 'table';
let taskView = 'table';

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
  el.innerHTML = '';
  const projects = await api.get('/api/projects');
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

function placeholderView(name) {
  return h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, '🚧'), h('p', {}, `${name}视图将在后续步骤实现`));
}

function buildProjectBoard() {
  return placeholderView('看板');
}

function buildProjectTimeline() {
  return placeholderView('时间线');
}

function buildProjectFeed() {
  return placeholderView('信息流');
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
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
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
    { name: 'owner', label: '负责人', value: p ? (p.owner || '') : '' },
    { name: 'blockedBy', label: '阻塞（可选）', value: p ? (p.blockedBy || '') : '' }
  ];
}

function projectModal(p) {
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
      if (p) paintDetail(p.id);
      else paintList();
    }
  });
}

export function add() {
  projectModal();
}
