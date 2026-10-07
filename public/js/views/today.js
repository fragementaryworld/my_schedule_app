'use strict';
import { api } from '../api.js';
import { h, toast, openModal, confirmDialog } from '../ui.js';
import {
  todayStr, addDays, fmtDate, escapeHtml, isOverdue, priorityClass, priorityLabel
} from '../utils.js';

let el = null;
let currentDate = todayStr();

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
  el.innerHTML = '';
  el.append(buildToolbar());
  const tasks = await api.get(`/api/tasks?date=${currentDate}`);
  const s = partitionTasks(tasks);
  el.append(buildList(s));
}

function buildToolbar() {
  const bar = h('div', { class: 'toolbar' });
  const prev = h('button', { class: 'btn btn-sm' }, '‹ 前一天');
  const next = h('button', { class: 'btn btn-sm' }, '后一天 ›');
  const todayBtn = h('button', { class: 'btn btn-sm' }, '今天');
  const dateInput = h('input', { type: 'date', class: 'input', style: 'width:auto', value: currentDate });
  const addBtn = h('button', { class: 'btn btn-primary btn-sm' }, '＋ 新增任务');

  const go = (d) => { currentDate = d; dateInput.value = d; paint(); };
  prev.onclick = () => go(addDays(currentDate, -1));
  next.onclick = () => go(addDays(currentDate, 1));
  todayBtn.onclick = () => go(todayStr());
  dateInput.onchange = () => { if (dateInput.value) go(dateInput.value); };
  addBtn.onclick = () => addTask();

  bar.append(prev, todayBtn, next, dateInput, h('span', { class: 'spacer' }), addBtn);
  return bar;
}

function buildList(s) {
  const list = h('div', { class: 'list' });
  if (!s.timed.length && !s.untimed.length && !s.done.length) {
    list.append(h('div', { class: 'empty' },
      h('span', { class: 'empty-icon' }, '📋'),
      h('p', {}, '这一天还没有安排，点右上角新增任务。')));
    return list;
  }
  for (const t of s.timed) list.append(buildTaskItem(t));
  s.untimed.forEach((t, i) => list.append(buildTaskItem(t, i)));
  if (s.done.length) {
    const doneWrap = h('div', { style: 'display:none' });
    s.done.forEach((t) => doneWrap.append(buildTaskItem(t)));
    const fold = h('div', { class: 'fold-head' }, h('span', {}, `▾ 已完成 ${s.done.length} 项`));
    fold.onclick = () => { doneWrap.style.display = doneWrap.style.display === 'none' ? '' : 'none'; };
    list.append(fold, doneWrap);
  }
  return list;
}

function buildTaskItem(t, untimedIndex) {
  const item = h('div', { class: 'task-item' + (t.done ? ' done' : '') });

  const cb = h('input', { type: 'checkbox', class: 'task-check' });
  cb.checked = !!t.done;
  cb.onclick = async () => { await toggleDone(t); };
  item.append(cb);

  const body = h('div', { class: 'task-body' });
  const titleRow = h('div', { class: 'task-title' });
  titleRow.append(h('span', { class: `badge ${priorityClass(t.priority)}` }, priorityLabel(t.priority)));
  titleRow.append(h('span', { class: 't' }, escapeHtml(t.title)));
  if (isOverdue(t, todayStr())) titleRow.append(h('span', { class: 'badge overdue' }, '逾期'));
  body.append(titleRow);

  const meta = h('div', { class: 'task-meta' });
  if (t.time) meta.append(h('span', { class: 'task-time' }, `🕐 ${t.time}`));
  if (t.repeat) meta.append(h('span', { class: 'chip' }, `🔁 ${repeatLabel(t.repeat)}`));
  if (t.repeatOf) meta.append(h('span', { class: 'chip' }, '🔁 重复'));
  if (t.source && t.source.type) meta.append(h('span', { class: 'chip' }, sourceLabel(t.source.type)));
  if (t.note) meta.append(h('span', { class: 'chip', title: t.note }, '📝'));
  body.append(meta);
  item.append(body);

  const actions = h('div', { class: 'task-actions' });
  if (!t.done && untimedIndex !== undefined) {
    const up = h('button', { class: 'icon-btn', title: '上移' }, '↑');
    const down = h('button', { class: 'icon-btn', title: '下移' }, '↓');
    up.onclick = async () => { await moveUntimed(untimedIndex, -1); };
    down.onclick = async () => { await moveUntimed(untimedIndex, 1); };
    actions.append(up, down);
  }
  if (t.repeat || t.repeatOf) {
    const finish = h('button', { class: 'icon-btn', title: '完成整个系列' }, '✓✓');
    finish.onclick = async () => {
      if (await confirmDialog('完成整个系列？所有已生成与未来的实例都会标记完成。')) {
        await api.put(`/api/tasks/${t.id}`, { done: true, finishSeries: true });
        toast('已完成整个系列');
        paint();
      }
    };
    actions.append(finish);
  }
  const edit = h('button', { class: 'icon-btn', title: '编辑' }, '✏️');
  edit.onclick = () => editTask(t);
  const del = h('button', { class: 'icon-btn danger', title: '删除' }, '🗑');
  del.onclick = async () => {
    if (await confirmDialog('确认删除这个任务？此操作不可恢复。', { danger: true })) {
      await api.del(`/api/tasks/${t.id}`);
      toast('已删除');
      paint();
    }
  };
  actions.append(edit, del);
  item.append(actions);

  return item;
}

async function toggleDone(t) {
  await api.put(`/api/tasks/${t.id}`, { done: !t.done });
  paint();
}

async function moveUntimed(index, dir) {
  const tasks = await api.get(`/api/tasks?date=${currentDate}`);
  const s = partitionTasks(tasks);
  const j = index + dir;
  if (j < 0 || j >= s.untimed.length) return;
  const a = s.untimed[index];
  const b = s.untimed[j];
  const tmp = a.order ?? 0;
  await api.put(`/api/tasks/${a.id}`, { order: b.order ?? 0 });
  await api.put(`/api/tasks/${b.id}`, { order: tmp });
  paint();
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
        date: currentDate,
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
  currentDate = todayStr();
  await paint();
}

export function add() {
  addTask();
}
