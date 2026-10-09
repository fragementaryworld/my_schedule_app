'use strict';
import { api } from '../api.js';
import { h, toast, confirmDialog, scrollPos, restoreScroll } from '../ui.js';
import { escapeHtml } from '../utils.js';
import { createTask, createSubtask, subtaskHref } from './projects.js';
import { buildBlocksEditor } from './page.js';
import { buildDateField } from '../datepicker.js';

let el = null;
let projectId = null;
let taskId = null;
let titleEl = null;

export const DEFAULT_TASK_NAME = '新任务';

// 新建后尚未填写内容的子任务
export function isFreshTask(task) {
  if (!task) return false;
  return task.title === DEFAULT_TASK_NAME && !(task.subtasks || []).length && !task.dueDate;
}

export async function render(container, params = {}) {
  el = container;
  projectId = params.id || null;
  taskId = params.subId || null;
  await paint();
}

async function paint() {
  if (!el) return;
  const pos = scrollPos();
  try {
    titleEl = null;
    el.innerHTML = '';
    const projects = await api.get('/api/projects');
    const project = projects.find((x) => x.id === projectId);
    const task = project ? (project.tasks || []).find((t) => t.id === taskId) : null;
    if (!project || !task) {
      el.append(h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, '📋'), h('p', {}, '任务不存在或已删除。')));
      return;
    }
    el.append(buildBreadcrumb(project, task));
    el.append(buildTaskHead(project, task));
    el.append(buildTaskProperties(project, task));
    el.append(h('div', { class: 'page-section' }, '📝 内容'));
    el.append(buildBlocksEditor(task, `/api/projects/${projectId}/tasks/${taskId}`, paint));
    el.append(h('div', { class: 'page-section' }, '📄 子任务'));
    el.append(buildSubtasks(project, task));
    if (isFreshTask(task)) focusTitle();
  } finally {
    restoreScroll(pos);
  }
}

function buildBreadcrumb(project, task) {
  const bar = h('div', { class: 'breadcrumb' });
  bar.append(h('a', { href: '#/projects', class: 'crumb' }, '项目'));
  bar.append(h('span', { class: 'crumb-sep' }, '/'));
  bar.append(h('a', { href: `#/page/${project.id}`, class: 'crumb' }, `${project.icon || '📁'} ${escapeHtml(project.name)}`));
  bar.append(h('span', { class: 'crumb-sep' }, '/'));
  bar.append(h('span', { class: 'crumb current' }, `任务：${escapeHtml(task.title)}`));
  bar.append(h('span', { class: 'spacer' }));

  const del = h('button', { class: 'btn btn-sm btn-danger' }, '🗑 删除任务');
  del.onclick = async () => {
    if (await confirmDialog(`确认删除任务「${task.title}」？其子任务会一并删除。`, { danger: true })) {
      await api.del(`/api/projects/${project.id}/tasks/${task.id}`);
      toast('已删除');
      location.hash = `#/page/${project.id}`;
    }
  };
  bar.append(del);
  return bar;
}

function buildTaskHead(project, task) {
  const wrap = h('div', { class: 'page-head' });

  const cb = h('input', { type: 'checkbox', class: 'task-check', style: 'width:22px;height:22px' });
  cb.checked = !!task.done;
  cb.onclick = async () => {
    await api.put(`/api/projects/${project.id}/tasks/${task.id}`, { done: !task.done });
    task.done = !task.done;
    await paint();
  };
  wrap.append(cb);

  const title = h('h1', {
    class: 'page-title' + (task.done ? ' done-title' : ''),
    contenteditable: 'true',
    spellcheck: 'false',
    title: '点击直接编辑任务'
  });
  title.textContent = task.title;
  title.addEventListener('blur', async () => {
    const next = title.textContent.trim();
    if (!next) { title.textContent = task.title; return; }
    if (next !== task.title) {
      await api.put(`/api/projects/${project.id}/tasks/${task.id}`, { title: next });
      task.title = next;
      toast('已保存');
      await paint();
    }
  });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  wrap.append(title);
  titleEl = title;
  return wrap;
}

export function buildTaskProperties(project, task) {
  const card = h('div', { class: 'page-props' });
  const row = (label, ctrl) => h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, label), ctrl);

  const doneSel = h('select', { class: 'input inline-select' });
  doneSel.append(h('option', { value: 'no' }, '未完成'));
  doneSel.append(h('option', { value: 'yes' }, '已完成'));
  doneSel.value = task.done ? 'yes' : 'no';
  doneSel.onchange = async () => {
    await api.put(`/api/projects/${project.id}/tasks/${task.id}`, { done: doneSel.value === 'yes' });
    toast('已保存');
    await paint();
  };

  const dateField = buildDateField({
    value: task,
    onSave: async (patch) => {
      await api.put(`/api/projects/${project.id}/tasks/${task.id}`, patch);
      Object.assign(task, patch);
      toast('时间已更新');
    }
  });

  const subs = task.subtasks || [];
  card.append(
    row('状态', doneSel),
    row('时间', dateField),
    row('子任务', h('span', { class: 'small muted' }, `${subs.filter((s) => s.done).length}/${subs.length} 已完成`))
  );
  return card;
}

export function buildSubtasks(project, task) {
  const wrap = h('div', { class: 'card', style: 'padding:12px 16px' });
  const list = h('div', {});

  const renderList = () => {
    list.innerHTML = '';
    const subs = task.subtasks || [];
    if (!subs.length) list.append(h('p', { class: 'muted' }, '还没有子任务。'));
    for (const st of subs) {
      const row = h('div', { class: 'row', style: 'padding:4px 0' });
      const cb = h('input', { type: 'checkbox', class: 'task-check' });
      cb.checked = !!st.done;
      cb.onclick = async () => {
        await api.put(`/api/projects/${project.id}/tasks/${task.id}/subtasks/${st.id}`, { done: !st.done });
        st.done = !st.done;
        renderList();
      };
      row.append(cb);
      const link = h('span', {
        class: 'row-link',
        style: `flex:1;${st.done ? 'text-decoration:line-through;color:var(--muted)' : ''}`
      }, escapeHtml(st.title));
      link.onclick = () => { location.hash = subtaskHref(project, task, st); };
      row.append(link);
      const del = h('button', { class: 'icon-btn danger', title: '删除' }, '🗑');
      del.onclick = async () => {
        if (await confirmDialog('删除这个子任务？', { danger: true })) {
          await api.del(`/api/projects/${project.id}/tasks/${task.id}/subtasks/${st.id}`);
          task.subtasks = (task.subtasks || []).filter((x) => x.id !== st.id);
          renderList();
        }
      };
      row.append(del);
      list.append(row);
    }
  };
  renderList();
  wrap.append(list);
  wrap.append(h('button', {
    class: 'btn btn-primary btn-sm',
    style: 'margin-top:8px',
    onclick: () => createSubtask(project.id, task.id)
  }, '＋ 新增子任务'));
  return wrap;
}

function focusTitle() {
  if (!titleEl || !titleEl.focus) return;
  titleEl.focus();
}

export async function add() {
  if (!projectId) return;
  await createTask(projectId);
}
