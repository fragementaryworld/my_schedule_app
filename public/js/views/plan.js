import { beginRender } from '../view-lifecycle.js';
import { buildPlanProperty } from '../planning.js';
'use strict';
import { registerEditor, serializeSave, flushContentEdits, contentCheckpoint } from '../saving.js';
import { api } from '../api.js';
import { h, toast, confirmDialog, scrollPos, restoreScroll, focusSnapshot, focusRestore } from '../ui.js';
import { todayStr } from '../utils.js';
import { buildEstimateField } from '../estimate.js';
import { renderMarkdown } from '../markdown.js';
import { buildDateField } from '../datepicker.js';
import { ownerOptions, ownership, ownerPatch } from '../ownership.js';
import {
  PRIORITY_OPTIONS, REPEAT_OPTIONS,
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
  const active = beginRender(container);
  if (!active()) return;
  try { await flushContentEdits(container); }
  catch (error) { toast('备注尚未保存，已保留编辑：' + error.message, 'error'); return; }
  if (!active()) return;
  const contentUnchanged = contentCheckpoint(container);
  const pos = scrollPos();
  const focus = focusSnapshot();
  titleEl = null;
  const [task, projects] = await Promise.all([api.get(`/api/tasks/${encodeURIComponent(taskId)}`), api.get('/api/projects')]);
  if (!active()) return;
  if (!contentUnchanged()) return paint();
  container.innerHTML = '';
  try {
    if (!task || !task.id) {
      container.append(h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, '📋'), h('p', {}, '任务不存在或已删除。')));
      return;
    }
    container.append(buildBreadcrumb(task));
    container.append(buildHead(task));
    container.append(buildProperties(task, projects));
    container.append(h('div', { class: 'page-section' }, '📝 备注'));
    container.append(buildNote(task));
    if (isFreshDayTask(task)) focusTitle();
  } finally {
    restoreScroll(pos);
    focusRestore(focus);
  }
}

function buildBreadcrumb(task) {
  const bar = h('div', { class: 'breadcrumb' });
  bar.append(h('a', { href: '#/today', class: 'crumb' }, '今日计划'));
  bar.append(h('span', { class: 'crumb-sep' }, '/'));
  bar.append(h('span', { class: 'crumb current' }, `任务：${task.title}`));
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
    title: '点击直接编辑',
    'data-focus-key': `/api/tasks/${task.id}:title`
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

function buildProperties(task, projects = []) {
  const card = h('div', { class: 'page-props' });
  const base = `/api/tasks/${task.id}`;
  const ownerSel = h('select', { class: 'input inline-select', 'aria-label': '所属清单' });
  for (const o of ownerOptions(projects)) ownerSel.append(h('option', { value: o.value }, o.label));
  ownerSel.value = ownership(task, projects).ownerKey;
  ownerSel.onchange = async () => { await api.put(base, ownerPatch(ownerSel.value)); toast('所属清单已更新'); await paint(); };
  // 第三参是"重绘后要恢复焦点"的稳定键
  const row = (label, ctrl, key) => {
    if (key && ctrl && ctrl.setAttribute) ctrl.setAttribute('data-focus-key', key);
    return h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, label), ctrl);
  };

  const doneSel = h('select', { class: 'input inline-select' });
  doneSel.append(h('option', { value: 'no' }, '未完成'));
  doneSel.append(h('option', { value: 'yes' }, '已完成'));
  doneSel.value = task.done ? 'yes' : 'no';
  doneSel.onchange = async () => {
    await api.put(base, { done: doneSel.value === 'yes' });
    toast('已保存');
    await paint();
  };

  const dateField = buildDateField({
    value: taskDateValue(task),
    key: `${base}:date`,
    onSave: async (patch) => {
      const next = taskDatePatch(patch, task);
      await api.put(base, next);
      Object.assign(task, next);
      toast('时间已更新');
    }
  });

  const prioSel = h('select', { class: 'input inline-select' });
  for (const o of PRIORITY_OPTIONS) prioSel.append(h('option', { value: o.value }, o.label));
  prioSel.value = task.priority || 'medium';
  prioSel.onchange = async () => {
    await api.put(base, { priority: prioSel.value });
    toast('已保存');
    await paint();
  };

  const repeatSel = h('select', { class: 'input inline-select' });
  for (const o of REPEAT_OPTIONS) repeatSel.append(h('option', { value: o.value }, o.label));
  repeatSel.value = repeatCode(task.repeat);
  repeatSel.onchange = async () => {
    await api.put(base, { repeat: decodeRepeat(repeatSel.value) });
    toast('已保存');
    await paint();
  };

  const estimateSel = buildEstimateField({
    value: task.estimate,
    key: `${base}:estimate`,
    onSave: async (minutes) => {
      await api.put(base, { estimate: minutes });
      task.estimate = minutes;
      toast('已保存');
      // 这一页没有别处显示预计用时，无需整页重绘（重绘会打断正在输入的手感）
    }
  });

  card.append(
    row('所属清单', ownerSel, `${base}:owner`),
    row('状态', doneSel, `${base}:done`),
    row('时间', dateField),
    row('当天安排', buildPlanProperty(task, base, async (_, patch) => { await api.put(base, patch); Object.assign(task, patch); await paint(); return true; })),
    row('预计用时', estimateSel),
    row('优先级', prioSel, `${base}:priority`),
    row('重复', repeatSel, `${base}:repeat`)
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
  const edit = h('div', { class: 'feed-goal', contenteditable: 'true', 'data-content-editor': 'true' });
  edit.textContent = task.note || '';
  edit.style.display = 'none';
  display.onclick = () => {
    display.style.display = 'none';
    edit.style.display = '';
    edit.textContent = task.note || '';
    if (edit.focus) edit.focus();
  };
  const saveNote = serializeSave(async () => {
    const next = edit.textContent.trim();
    if (next !== (task.note || '')) {
      await api.put(`/api/tasks/${task.id}`, { note: next });
      task.note = next;
      toast('已保存');
    }
  });
  registerEditor(edit, saveNote);
  edit.addEventListener('blur', async () => {
    try { await saveNote(); }
    catch (err) { toast(err.message, 'error'); return; }
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
