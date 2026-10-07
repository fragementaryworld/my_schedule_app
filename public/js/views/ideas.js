'use strict';
import { api } from '../api.js';
import { h, toast, openModal, confirmDialog } from '../ui.js';
import { escapeHtml, IDEA_STATUS, IDEA_ORDER, todayStr } from '../utils.js';

let el = null;
let searchText = '';
let tagFilter = '';

export function groupIdeasByStatus(ideas) {
  const cols = IDEA_ORDER.map((status) => ({ status, items: [] }));
  const byStatus = {};
  for (const c of cols) byStatus[c.status] = c;
  for (const i of ideas || []) {
    const key = IDEA_ORDER.includes(i.status) ? i.status : 'idea';
    byStatus[key].items.push(i);
  }
  return cols;
}

export async function render(container) {
  el = container;
  await paint();
}

async function paint() {
  el.innerHTML = '';
  const ideas = await api.get('/api/ideas');
  el.append(buildToolbar(ideas));

  const q = searchText.trim().toLowerCase();
  let filtered = ideas;
  if (q) filtered = filtered.filter((i) => `${i.title} ${i.desc || ''}`.toLowerCase().includes(q));
  if (tagFilter) filtered = filtered.filter((i) => (i.tags || []).includes(tagFilter));

  el.append(buildKanban(filtered));
}

function buildToolbar(ideas) {
  const bar = h('div', { class: 'toolbar' });
  const search = h('input', { class: 'input', placeholder: '搜索灵感…', style: 'width:180px', value: searchText });
  search.oninput = () => { searchText = search.value; paint(); };

  const tags = new Set();
  for (const i of ideas) for (const t of i.tags || []) tags.add(t);
  const tagSel = h('select', { class: 'input', style: 'width:auto' });
  tagSel.append(h('option', { value: '' }, '全部标签'));
  for (const t of tags) tagSel.append(h('option', { value: t }, t));
  tagSel.value = tagFilter;
  tagSel.onchange = () => { tagFilter = tagSel.value; paint(); };

  bar.append(search, tagSel, h('span', { class: 'spacer' }));
  bar.append(h('button', { class: 'btn btn-primary btn-sm', onclick: () => ideaModal() }, '＋ 记录灵感'));
  return bar;
}

function buildKanban(ideas) {
  const cols = groupIdeasByStatus(ideas);
  const board = h('div', { class: 'kanban' });
  for (const col of cols) {
    const colEl = h('div', { class: 'kanban-col', dataset: { status: col.status } });
    colEl.append(h('div', { class: 'col-head' },
      IDEA_STATUS[col.status].label,
      h('span', { class: 'small muted' }, String(col.items.length))));
    for (const idea of col.items) colEl.append(buildCard(idea));
    colEl.ondragover = (e) => { e.preventDefault(); colEl.classList.add('drop-hover'); };
    colEl.ondragleave = () => colEl.classList.remove('drop-hover');
    colEl.ondrop = async (e) => {
      e.preventDefault();
      colEl.classList.remove('drop-hover');
      const id = e.dataTransfer.getData('text/plain');
      if (id) {
        await api.put(`/api/ideas/${id}`, { status: col.status });
        toast('已移动');
        paint();
      }
    };
    board.append(colEl);
  }
  return board;
}

function buildCard(idea) {
  const card = h('div', { class: 'kanban-card', draggable: 'true' });
  card.ondragstart = (e) => { e.dataTransfer.setData('text/plain', idea.id); card.classList.add('dragging'); };
  card.ondragend = () => card.classList.remove('dragging');

  const title = h('div', { class: 'title', style: 'cursor:pointer' }, escapeHtml(idea.title));
  title.onclick = () => ideaModal(idea);
  card.append(title);
  if (idea.desc) card.append(h('div', { class: 'small muted', style: 'margin-top:2px' }, escapeHtml(idea.desc.slice(0, 60))));
  if (idea.tags && idea.tags.length) {
    card.append(h('div', { style: 'margin-top:4px' }, ...idea.tags.map((t) => h('span', { class: 'tag' }, escapeHtml(t)))));
  }

  const actions = h('div', { class: 'row', style: 'margin-top:8px' });
  const moveSel = h('select', { class: 'input', style: 'width:auto;padding:2px 4px;font-size:12px' });
  for (const [k, v] of Object.entries(IDEA_STATUS)) moveSel.append(h('option', { value: k }, v.label));
  moveSel.value = IDEA_ORDER.includes(idea.status) ? idea.status : 'idea';
  moveSel.onchange = async () => { await api.put(`/api/ideas/${idea.id}`, { status: moveSel.value }); paint(); };
  actions.append(moveSel);

  const toProject = h('button', { class: 'icon-btn', title: '转成工作项目' }, '📁');
  toProject.onclick = async () => {
    await api.post(`/api/ideas/${idea.id}/to-project`);
    toast('已转为工作项目');
    paint();
  };
  const toTask = h('button', { class: 'icon-btn', title: '加入今日计划' }, '📋');
  toTask.onclick = () => ideaToTask(idea);
  const edit = h('button', { class: 'icon-btn', title: '编辑' }, '✏️');
  edit.onclick = () => ideaModal(idea);
  const del = h('button', { class: 'icon-btn danger', title: '删除' }, '🗑');
  del.onclick = async () => {
    if (await confirmDialog('删除这个灵感？此操作不可恢复。', { danger: true })) {
      await api.del(`/api/ideas/${idea.id}`);
      toast('已删除');
      paint();
    }
  };
  actions.append(toProject, toTask, edit, del);
  card.append(actions);
  return card;
}

function ideaToTask(idea) {
  openModal({
    title: '加入今日计划',
    fields: [
      { name: 'date', label: '日期', type: 'date', value: todayStr() },
      { name: 'time', label: '时间（可留空）', type: 'time', value: '' }
    ],
    onSubmit: async (v) => {
      await api.post(`/api/ideas/${idea.id}/to-task`, { date: v.date, time: v.time || null });
      toast('已加入今日计划');
      paint();
    }
  });
}

function ideaModal(idea) {
  openModal({
    title: idea ? '编辑灵感' : '记录灵感',
    fields: [
      { name: 'title', label: '标题', required: true, value: idea ? idea.title : '' },
      { name: 'desc', label: '描述', type: 'textarea', value: idea ? (idea.desc || '') : '' },
      { name: 'tags', label: '标签（用逗号分隔）', value: idea ? (idea.tags || []).join(',') : '' },
      { name: 'status', label: '状态', type: 'select', value: idea ? (idea.status || 'idea') : 'idea',
        options: Object.entries(IDEA_STATUS).map(([k, v]) => ({ value: k, label: v.label })) }
    ],
    onSubmit: async (v) => {
      const tags = v.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
      const payload = { title: v.title.trim(), desc: v.desc, tags, status: v.status };
      if (idea) await api.put(`/api/ideas/${idea.id}`, payload);
      else await api.post('/api/ideas', payload);
      toast(idea ? '已保存' : '已记录');
      paint();
    }
  });
}

export function add() {
  ideaModal();
}
