'use strict';
import { api } from '../api.js';
import { h, toast, confirmDialog } from '../ui.js';
import { escapeHtml } from '../utils.js';
import { DEFAULT_SUBTASK_NAME } from './projects.js';
import { buildBlocksEditor } from './page.js';
import { buildDateField } from '../datepicker.js';

let el = null;
let projectId = null;
let taskId = null;
let subtaskId = null;
let titleEl = null;

// 新建后尚未填写内容的子任务（与任务页保持一致）
export function isFreshSubtask(subtask) {
  if (!subtask) return false;
  return subtask.title === DEFAULT_SUBTASK_NAME && !(subtask.blocks || []).length && !subtask.startDate && !subtask.dueDate;
}

export async function render(container, params = {}) {
  el = container;
  projectId = params.id || null;
  taskId = params.subId || null;
  subtaskId = params.subId2 || null;
  await paint();
}

async function paint() {
  if (!el) return;
  titleEl = null;
  el.innerHTML = '';
  const projects = await api.get('/api/projects');
  const project = projects.find((x) => x.id === projectId);
  const task = project ? (project.tasks || []).find((t) => t.id === taskId) : null;
  const subtask = task ? (task.subtasks || []).find((s) => s.id === subtaskId) : null;
  if (!project || !task || !subtask) {
    el.append(h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, '☑'), h('p', {}, '子任务不存在或已删除。')));
    return;
  }
  el.append(buildBreadcrumb(project, task, subtask));
  el.append(buildHead(project, task, subtask));
  el.append(buildSubtaskProperties(project, task, subtask));
  el.append(h('div', { class: 'page-section' }, '📝 内容'));
  el.append(buildBlocksEditor(subtask, `/api/projects/${projectId}/tasks/${taskId}/subtasks/${subtaskId}`, paint));
  if (isFreshSubtask(subtask)) focusTitle();
}

function buildBreadcrumb(project, task, subtask) {
  const bar = h('div', { class: 'breadcrumb' });
  bar.append(h('a', { href: '#/projects', class: 'crumb' }, '项目'));
  bar.append(h('span', { class: 'crumb-sep' }, '/'));
  bar.append(h('a', { href: `#/page/${project.id}`, class: 'crumb' }, `${project.icon || '📁'} ${escapeHtml(project.name)}`));
  bar.append(h('span', { class: 'crumb-sep' }, '/'));
  bar.append(h('a', { href: `#/task/${project.id}/${task.id}`, class: 'crumb' }, `任务：${escapeHtml(task.title)}`));
  bar.append(h('span', { class: 'crumb-sep' }, '/'));
  bar.append(h('span', { class: 'crumb current' }, `子任务：${escapeHtml(subtask.title)}`));
  bar.append(h('span', { class: 'spacer' }));

  const del = h('button', { class: 'btn btn-sm btn-danger' }, '🗑 删除子任务');
  del.onclick = async () => {
    if (await confirmDialog(`确认删除子任务「${subtask.title}」？`, { danger: true })) {
      await api.del(`/api/projects/${project.id}/tasks/${task.id}/subtasks/${subtask.id}`);
      toast('已删除');
      location.hash = `#/task/${project.id}/${task.id}`;
    }
  };
  bar.append(del);
  return bar;
}

function buildHead(project, task, subtask) {
  const wrap = h('div', { class: 'page-head' });

  const cb = h('input', { type: 'checkbox', class: 'task-check', style: 'width:22px;height:22px' });
  cb.checked = !!subtask.done;
  cb.onclick = async () => {
    await api.put(`/api/projects/${project.id}/tasks/${task.id}/subtasks/${subtask.id}`, { done: !subtask.done });
    subtask.done = !subtask.done;
    await paint();
  };
  wrap.append(cb);

  const title = h('h1', {
    class: 'page-title' + (subtask.done ? ' done-title' : ''),
    contenteditable: 'true',
    spellcheck: 'false',
    title: '点击直接编辑子任务'
  });
  title.textContent = subtask.title;
  title.addEventListener('blur', async () => {
    const next = title.textContent.trim();
    if (!next) { title.textContent = subtask.title; return; }
    if (next !== subtask.title) {
      await api.put(`/api/projects/${project.id}/tasks/${task.id}/subtasks/${subtask.id}`, { title: next });
      subtask.title = next;
      toast('已保存');
      await paint();
    }
  });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  wrap.append(title);
  titleEl = title;
  return wrap;
}

export function buildSubtaskProperties(project, task, subtask) {
  const card = h('div', { class: 'page-props' });
  const row = (label, ctrl) => h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, label), ctrl);
  const subBase = `/api/projects/${project.id}/tasks/${task.id}/subtasks/${subtask.id}`;

  const doneSel = h('select', { class: 'input inline-select' });
  doneSel.append(h('option', { value: 'no' }, '未完成'));
  doneSel.append(h('option', { value: 'yes' }, '已完成'));
  doneSel.value = subtask.done ? 'yes' : 'no';
  doneSel.onchange = async () => {
    await api.put(subBase, { done: doneSel.value === 'yes' });
    toast('已保存');
    await paint();
  };

  const dateField = buildDateField({
    value: subtask,
    onSave: async (patch) => {
      await api.put(subBase, patch);
      Object.assign(subtask, patch);
      toast('时间已更新');
    }
  });

  card.append(
    row('状态', doneSel),
    row('时间', dateField)
  );
  return card;
}

function focusTitle() {
  if (!titleEl || !titleEl.focus) return;
  titleEl.focus();
}

export async function add() {
  /* 子任务页面不再嵌套新建 */
}
