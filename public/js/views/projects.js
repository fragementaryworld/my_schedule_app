'use strict';
import { api } from '../api.js';
import { h, toast, openModal, confirmDialog } from '../ui.js';
import { escapeHtml, PROJECT_STATUS, fmtDate, todayStr } from '../utils.js';

let el = null;
let currentParams = {};
let currentFilter = 'all';

const MILESTONE_STATUS = { todo: '未开始', doing: '进行中', done: '完成' };
const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '进行中' },
  { value: 'paused', label: '暂停' },
  { value: 'done', label: '完成' }
];

export function projectSummary(p) {
  const milestones = p.milestones || [];
  const tasks = p.tasks || [];
  return {
    milestonesDone: milestones.filter((m) => m.status === 'done').length,
    milestonesTotal: milestones.length,
    nextActions: tasks.filter((t) => !t.done).length
  };
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
  el.append(buildFilterBar());
  const shown = currentFilter === 'all' ? projects : projects.filter((p) => p.status === currentFilter);
  if (!shown.length) {
    el.append(h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, '📁'), h('p', {}, '还没有项目，点击右下角「＋」新增。')));
  } else {
    el.append(h('div', { class: 'list' }, ...shown.map(buildProjectItem)));
  }
}

function buildFilterBar() {
  const bar = h('div', { class: 'toolbar' });
  for (const f of FILTERS) {
    const b = h('button', { class: 'btn btn-sm' + (currentFilter === f.value ? ' btn-primary' : '') }, f.label);
    b.onclick = () => { currentFilter = f.value; paintList(); };
    bar.append(b);
  }
  bar.append(h('span', { class: 'spacer' }));
  bar.append(h('button', { class: 'btn btn-primary btn-sm', onclick: () => projectModal() }, '＋ 新增项目'));
  return bar;
}

function buildProjectItem(p) {
  const st = PROJECT_STATUS[p.status] || PROJECT_STATUS.active;
  const s = projectSummary(p);
  const item = h('div', { class: 'list-item', style: 'cursor:pointer' });
  item.onclick = () => { location.hash = `#/projects/${p.id}`; };
  item.append(h('div', { class: 'row' },
    h('span', { style: 'font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, escapeHtml(p.name)),
    h('span', { class: `badge ${st.cls}` }, st.label),
    h('span', { class: 'small muted' }, `${p.progress || 0}%`)
  ));
  item.append(h('div', { class: 'progress', style: 'margin:6px 0' }, h('i', { style: `width:${p.progress || 0}%` })));
  const meta = [];
  if (s.nextActions) meta.push(`${s.nextActions} 个下一步`);
  if (s.milestonesTotal) meta.push(`里程碑 ${s.milestonesDone}/${s.milestonesTotal}`);
  if (p.dueDate) meta.push(`截止 ${fmtDate(p.dueDate)}`);
  item.append(h('div', { class: 'small muted' }, meta.join(' · ')));
  return item;
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
  el.append(h('h3', { style: 'margin:20px 0 8px' }, '🗂 里程碑'));
  el.append(buildMilestones(p));
  el.append(h('h3', { style: 'margin:20px 0 8px' }, '✅ 下一步任务'));
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

function buildMilestones(p) {
  const wrap = h('div', { class: 'card', style: 'padding:8px 16px' });
  if (!p.milestones.length) {
    wrap.append(h('p', { class: 'muted' }, '暂无里程碑，添加一个来标记阶段。'));
  }
  for (const m of p.milestones) {
    const row = h('div', { class: 'milestone ' + m.status });
    const dot = h('span', { class: 'dot', title: '点击切换状态' });
    dot.onclick = async () => {
      const next = m.status === 'todo' ? 'doing' : m.status === 'doing' ? 'done' : 'todo';
      await api.put(`/api/projects/${p.id}/milestones/${m.id}`, { status: next });
      paintDetail(p.id);
    };
    row.append(dot);
    row.append(h('span', { style: 'flex:1' }, escapeHtml(m.name)));
    row.append(h('span', { class: 'small muted' }, MILESTONE_STATUS[m.status] || m.status));
    if (m.date) row.append(h('span', { class: 'small muted' }, fmtDate(m.date)));
    const edit = h('button', { class: 'icon-btn', title: '编辑' }, '✏️');
    edit.onclick = () => milestoneModal(p, m);
    const del = h('button', { class: 'icon-btn danger', title: '删除' }, '🗑');
    del.onclick = async () => {
      if (await confirmDialog('删除这个里程碑？', { danger: true })) {
        await api.del(`/api/projects/${p.id}/milestones/${m.id}`);
        paintDetail(p.id);
      }
    };
    row.append(edit, del);
    wrap.append(row);
  }
  wrap.append(h('button', { class: 'btn btn-sm btn-ghost', style: 'margin:8px 0', onclick: () => milestoneModal(p) }, '＋ 添加里程碑'));
  return wrap;
}

function buildProjectTasks(p) {
  const wrap = h('div', { class: 'card', style: 'padding:8px 16px' });
  if (!p.tasks.length) {
    wrap.append(h('p', { class: 'muted' }, '还没有任务，添加下一步行动。'));
  }
  for (const t of p.tasks) {
    const row = h('div', { class: 'task-item' + (t.done ? ' done' : '') });
    const cb = h('input', { type: 'checkbox', class: 'task-check' });
    cb.checked = !!t.done;
    cb.onclick = async () => {
      await api.put(`/api/projects/${p.id}/tasks/${t.id}`, { done: !t.done });
      paintDetail(p.id);
    };
    row.append(cb);
    row.append(h('span', { class: 't', style: 'flex:1' }, escapeHtml(t.title)));
    const del = h('button', { class: 'icon-btn danger' }, '🗑');
    del.onclick = async () => {
      if (await confirmDialog('删除这个任务？', { danger: true })) {
        await api.del(`/api/projects/${p.id}/tasks/${t.id}`);
        paintDetail(p.id);
      }
    };
    row.append(del);
    wrap.append(row);
  }
  const addInput = h('input', { class: 'input', placeholder: '输入下一步任务，回车添加', style: 'margin:8px 0' });
  addInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && addInput.value.trim()) {
      await api.post(`/api/projects/${p.id}/tasks`, { title: addInput.value.trim() });
      addInput.value = '';
      paintDetail(p.id);
    }
  });
  wrap.append(addInput);
  return wrap;
}

export function projectFields(p) {
  return [
    { name: 'name', label: '项目名称', required: true, value: p ? p.name : '' },
    { name: 'goal', label: '目标说明', type: 'textarea', value: p ? (p.goal || '') : '' },
    { name: 'status', label: '状态', type: 'select', value: p ? (p.status || 'active') : 'active',
      options: Object.entries(PROJECT_STATUS).map(([k, v]) => ({ value: k, label: v.label })) },
    { name: 'startDate', label: '开始日期', type: 'date', value: p ? (p.startDate || todayStr()) : todayStr() },
    { name: 'dueDate', label: '截止日期（可选）', type: 'date', value: p ? (p.dueDate || '') : '' }
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
        dueDate: v.dueDate || null
      };
      if (p) await api.put(`/api/projects/${p.id}`, payload);
      else await api.post('/api/projects', payload);
      toast(p ? '已保存' : '已创建');
      if (p) paintDetail(p.id);
      else paintList();
    }
  });
}

function milestoneModal(p, m) {
  openModal({
    title: m ? '编辑里程碑' : '新增里程碑',
    fields: [
      { name: 'name', label: '名称', required: true, value: m ? m.name : '' },
      { name: 'status', label: '状态', type: 'select', value: m ? (m.status || 'todo') : 'todo',
        options: Object.entries(MILESTONE_STATUS).map(([k, v]) => ({ value: k, label: v })) },
      { name: 'date', label: '预计日期（可选）', type: 'date', value: m ? (m.date || '') : '' }
    ],
    onSubmit: async (v) => {
      const payload = { name: v.name.trim(), status: v.status, date: v.date || null };
      if (m) await api.put(`/api/projects/${p.id}/milestones/${m.id}`, payload);
      else await api.post(`/api/projects/${p.id}/milestones`, payload);
      toast(m ? '已保存' : '已添加');
      paintDetail(p.id);
    }
  });
}

export function add() {
  projectModal();
}
