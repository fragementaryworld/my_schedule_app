'use strict';
import { api } from '../api.js';
import { h, toast, confirmDialog, scrollPos, restoreScroll } from '../ui.js';
import { escapeHtml, todayStr } from '../utils.js';
import { buildEstimateField } from '../estimate.js';
import { renderMarkdown } from '../markdown.js';
import { buildDateField } from '../datepicker.js';
import {
  PRIORITY_OPTIONS, REPEAT_OPTIONS, SOURCE_OPTIONS,
  repeatCode, decodeRepeat, isFreshDayTask, createDayTask, taskDateValue, taskDatePatch
} from '../daytask.js';

let el = null;
let taskId = null;
let titleEl = null;

export { isFreshDayTask };

export async function render(container, params = {}) {
  el = container;
  taskId = params.id || null;
  await paint();
}

async function paint() {
  const container = el; // 进入时就固定容器，避免旧的异步重绘写进新页面
  if (!container) return;
  const pos = scrollPos();
  titleEl = null;
  const task = await api.get(`/api/tasks/${encodeURIComponent(taskId)}`);
  container.innerHTML = '';
  try {
    if (!task || !task.id) {
      container.append(h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, '📋'), h('p', {}, '任务不存在或已删除。')));
      return;
    }
    container.append(buildBreadcrumb(task));
    container.append(buildHead(task));
    container.append(buildProperties(task));
    container.append(h('div', { class: 'page-section' }, '📝 备注'));
    container.append(buildNote(task));
    if (isFreshDayTask(task)) focusTitle();
  } finally {
    restoreScroll(pos);
  }
}

function buildBreadcrumb(task) {
  const bar = h('div', { class: 'breadcrumb' });
  bar.append(h('a', { href: '#/today', class: 'crumb' }, '今日计划'));
  bar.append(h('span', { class: 'crumb-sep' }, '/'));
  bar.append(h('span', { class: 'crumb current' }, `任务：${escapeHtml(task.title)}`));
  bar.append(h('span', { class: 'spacer' }));

  const del = h('button', { class: 'btn btn-sm btn-danger' }, '🗑 删除任务');
  del.onclick = async () => {
    if (await confirmDialog(`确认删除任务「${task.title}」？`, { danger: true })) {
      await api.del(`/api/tasks/${task.id}`);
      toast('已删除');
      location.hash = '#/today';
    }
  };
  bar.append(del);
  return bar;
}

function buildHead(task) {
  const wrap = h('div', { class: 'page-head' });

  const cb = h('input', { type: 'checkbox', class: 'task-check', style: 'width:22px;height:22px' });
  cb.checked = !!task.done;
  cb.onclick = async () => {
    await api.put(`/api/tasks/${task.id}`, { done: !task.done });
    task.done = !task.done;
    await paint();
  };
  wrap.append(cb);

  const title = h('h1', {
    class: 'page-title' + (task.done ? ' done-title' : ''),
    contenteditable: 'true',
    spellcheck: 'false',
    title: '点击直接编辑'
  });
  title.textContent = task.title;
  title.addEventListener('blur', async () => {
    const next = title.textContent.trim();
    if (!next) { title.textContent = task.title; return; }
    if (next !== task.title) {
      await api.put(`/api/tasks/${task.id}`, { title: next });
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

function buildProperties(task) {
  const card = h('div', { class: 'page-props' });
  const row = (label, ctrl) => h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, label), ctrl);

  const doneSel = h('select', { class: 'input inline-select' });
  doneSel.append(h('option', { value: 'no' }, '未完成'));
  doneSel.append(h('option', { value: 'yes' }, '已完成'));
  doneSel.value = task.done ? 'yes' : 'no';
  doneSel.onchange = async () => {
    await api.put(`/api/tasks/${task.id}`, { done: doneSel.value === 'yes' });
    toast('已保存');
    await paint();
  };

  const dateField = buildDateField({
    value: taskDateValue(task),
    onSave: async (patch) => {
      const next = taskDatePatch(patch, task);
      await api.put(`/api/tasks/${task.id}`, next);
      Object.assign(task, next);
      toast('时间已更新');
    }
  });

  const prioSel = h('select', { class: 'input inline-select' });
  for (const o of PRIORITY_OPTIONS) prioSel.append(h('option', { value: o.value }, o.label));
  prioSel.value = task.priority || 'medium';
  prioSel.onchange = async () => {
    await api.put(`/api/tasks/${task.id}`, { priority: prioSel.value });
    toast('已保存');
    await paint();
  };

  const repeatSel = h('select', { class: 'input inline-select' });
  for (const o of REPEAT_OPTIONS) repeatSel.append(h('option', { value: o.value }, o.label));
  repeatSel.value = repeatCode(task.repeat);
  repeatSel.onchange = async () => {
    await api.put(`/api/tasks/${task.id}`, { repeat: decodeRepeat(repeatSel.value) });
    toast('已保存');
    await paint();
  };

  const sourceSel = h('select', { class: 'input inline-select' });
  for (const o of SOURCE_OPTIONS) sourceSel.append(h('option', { value: o.value }, o.label));
  sourceSel.value = (task.source && task.source.type) || '';
  sourceSel.onchange = async () => {
    await api.put(`/api/tasks/${task.id}`, { source: sourceSel.value ? { type: sourceSel.value, id: null } : null });
    toast('已保存');
    await paint();
  };

  const estimateSel = buildEstimateField({
    value: task.estimate,
    onSave: async (minutes) => {
      await api.put(`/api/tasks/${task.id}`, { estimate: minutes });
      task.estimate = minutes;
      toast('已保存');
      await paint();
    }
  });

  card.append(
    row('状态', doneSel),
    row('时间', dateField),
    row('预计用时', estimateSel),
    row('优先级', prioSel),
    row('重复', repeatSel),
    row('来源', sourceSel)
  );
  return card;
}

function buildNote(task) {
  const wrap = h('div', { class: 'card', style: 'padding:12px 16px' });
  const display = h('div', {
    class: 'feed-goal-md',
    html: renderMarkdown(task.note || ''),
    'data-placeholder': '点击这里写备注，支持 Markdown…'
  });
  const edit = h('div', { class: 'feed-goal', contenteditable: 'true' });
  edit.textContent = task.note || '';
  edit.style.display = 'none';
  display.onclick = () => {
    display.style.display = 'none';
    edit.style.display = '';
    edit.textContent = task.note || '';
    if (edit.focus) edit.focus();
  };
  edit.addEventListener('blur', async () => {
    const next = edit.textContent.trim();
    if (next !== (task.note || '')) {
      await api.put(`/api/tasks/${task.id}`, { note: next });
      task.note = next;
      toast('已保存');
    }
    display.innerHTML = renderMarkdown(task.note || '');
    edit.style.display = 'none';
    display.style.display = '';
  });
  wrap.append(display, edit);
  return wrap;
}

function focusTitle() {
  if (titleEl && titleEl.focus) titleEl.focus();
}

export function add() {
  return createDayTask(todayStr());
}
