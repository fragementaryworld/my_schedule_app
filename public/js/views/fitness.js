'use strict';
import { api } from '../api.js';
import { h, toast, confirmDialog } from '../ui.js';
import { todayStr, fmtDate, escapeHtml } from '../utils.js';

let el = null;
let currentTab = 'schedule';

const DAY_LABEL = {
  mon: '周一', tue: '周二', wed: '周三', thu: '周四',
  fri: '周五', sat: '周六', sun: '周日'
};
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function todayExerciseIds(schedule, todayKey) {
  return (schedule && schedule[todayKey]) || [];
}

export function exerciseNames(exercises, ids) {
  const byId = new Map((exercises || []).map((e) => [e.id, e]));
  return (ids || []).map((id) => byId.get(id)).filter(Boolean).map((e) => e.name);
}

function exerciseById(exercises, id) {
  return (exercises || []).find((e) => e.id === id);
}

export async function render(container) {
  el = container;
  await paint();
}

async function paint() {
  el.innerHTML = '';
  const w = await api.get('/api/workouts');
  el.append(buildTabs());
  if (currentTab === 'schedule') el.append(buildSchedule(w));
  else if (currentTab === 'logs') el.append(buildLogs(w));
  else el.append(buildBody(w));
}

function buildTabs() {
  const bar = h('div', { class: 'tabbar' });
  for (const t of [['schedule', '日程'], ['logs', '记录'], ['body', '身体数据']]) {
    const b = h('button', { class: 'tab' + (currentTab === t[0] ? ' active' : '') }, t[1]);
    b.onclick = () => { currentTab = t[0]; paint(); };
    bar.append(b);
  }
  return bar;
}

function buildSchedule(w) {
  const grid = h('div', { class: 'schedule-grid' });
  for (const day of DAY_KEYS) {
    const names = exerciseNames(w.exercises, w.schedule[day] || []);
    const cell = h('div', { class: 'schedule-day' + (day === w.todayKey ? ' today' : '') });
    cell.append(h('div', { class: 'day-name' }, DAY_LABEL[day] + (day === w.todayKey ? ' ·今天' : '')));
    if (names.length) {
      for (const n of names) cell.append(h('div', { class: 'small' }, n));
    } else {
      cell.append(h('div', { class: 'rest' }, '休息'));
    }
    const edit = h('button', { class: 'icon-btn', title: '编辑', style: 'margin-top:4px' }, '✏️');
    edit.onclick = () => scheduleModal(w, day);
    cell.append(edit);
    grid.append(cell);
  }

  const actions = h('div', { class: 'row', style: 'margin-top:16px' });
  const checkin = h('button', { class: 'btn btn-primary btn-sm' }, '💪 今日打卡');
  checkin.onclick = () => logModal(w, w.todayExerciseIds);
  const manage = h('button', { class: 'btn btn-sm' }, '🏋️ 管理动作库');
  manage.onclick = () => exercisesModal(w);
  actions.append(checkin, manage);
  grid.append(actions);
  return grid;
}

function buildLogs(w) {
  const wrap = h('div', {});
  const addBtn = h('button', { class: 'btn btn-primary btn-sm', style: 'margin-bottom:12px' }, '＋ 新增打卡');
  addBtn.onclick = () => logModal(w, []);
  wrap.append(addBtn);
  const logs = (w.logs || []).slice().reverse();
  if (!logs.length) {
    wrap.append(h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, '💪'), h('p', {}, '还没有训练记录，去「日程」打卡吧。')));
    return wrap;
  }
  const list = h('div', { class: 'list' });
  for (const log of logs) {
    const item = h('div', { class: 'list-item' });
    const names = log.exercises.map((x) => {
      const ex = exerciseById(w.exercises, x.exerciseId);
      const detail = (x.sets || x.reps) ? ` ${x.sets || 0}×${x.reps || 0}` : '';
      return (ex ? ex.name : '动作') + detail;
    }).join('、');
    item.append(h('div', { class: 'row' }, h('span', { style: 'font-weight:600' }, fmtDate(log.date)), h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, log.duration || '')));
    if (names) item.append(h('div', {}, names));
    if (log.note) item.append(h('div', { class: 'small muted' }, escapeHtml(log.note)));
    list.append(item);
  }
  wrap.append(list);
  return wrap;
}

function buildBody(w) {
  const wrap = h('div', {});
  const addBtn = h('button', { class: 'btn btn-primary btn-sm', style: 'margin-bottom:12px' }, '＋ 记录身体数据');
  addBtn.onclick = () => bodyModal();
  wrap.append(addBtn);
  const body = (w.bodyData || []).slice().reverse();
  if (!body.length) {
    wrap.append(h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, '📏'), h('p', {}, '还没有身体数据记录。')));
    return wrap;
  }
  const list = h('div', { class: 'list' });
  for (const r of body) {
    const item = h('div', { class: 'list-item' });
    const parts = [];
    if (r.weight) parts.push(`体重 ${r.weight}`);
    for (const [k, v] of Object.entries(r.measurements || {})) if (v) parts.push(`${k} ${v}`);
    item.append(h('div', { class: 'row' }, h('span', { style: 'font-weight:600' }, fmtDate(r.date)), h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, parts.join(' · '))));
    list.append(item);
  }
  wrap.append(list);
  return wrap;
}

function modalShell(title, body, foot) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', { class: 'modal' });
  modal.append(h('div', { class: 'modal-title' }, title), body, foot);
  backdrop.append(modal);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  return { close };
}

function scheduleModal(w, day) {
  const body = h('div', { class: 'modal-body' });
  const selected = new Set(w.schedule[day] || []);
  if (!w.exercises.length) body.append(h('p', { class: 'muted' }, '请先在「管理动作库」里添加动作。'));
  for (const ex of w.exercises) {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = selected.has(ex.id);
    const label = h('label', { class: 'checkbox-label' }, cb, ex.name);
    cb.onchange = () => { cb.checked ? selected.add(ex.id) : selected.delete(ex.id); };
    body.append(label);
  }
  const foot = h('div', { class: 'modal-foot' });
  const cancel = h('button', { class: 'btn' }, '取消');
  const save = h('button', { class: 'btn btn-primary' }, '保存');
  foot.append(cancel, save);
  const shell = modalShell(`安排${DAY_LABEL[day]}训练`, body, foot);
  cancel.onclick = () => shell.close();
  save.onclick = async () => {
    await api.put('/api/workouts/schedule', { [day]: [...selected] });
    toast('已保存');
    shell.close();
    paint();
  };
}

function logModal(w, prefillIds) {
  const body = h('div', { class: 'modal-body' });
  body.append(h('label', {}, '日期'));
  const dateInput = h('input', { type: 'date', class: 'input', value: todayStr() });
  body.append(dateInput);

  body.append(h('label', { style: 'margin-top:8px' }, '训练动作'));
  const rowsWrap = h('div', {});
  body.append(rowsWrap);

  const rows = [];
  const addRow = (exerciseId) => {
    const ex = exerciseById(w.exercises, exerciseId) || {};
    const row = h('div', { class: 'row', style: 'margin-bottom:8px' });
    const sel = h('select', { class: 'input', style: 'flex:2' });
    for (const e of w.exercises) sel.append(h('option', { value: e.id }, e.name));
    if (exerciseId) sel.value = exerciseId;
    const sets = h('input', { type: 'number', class: 'input', placeholder: '组', style: 'width:56px', value: ex.sets || '' });
    const reps = h('input', { type: 'number', class: 'input', placeholder: '次', style: 'width:56px', value: ex.reps || '' });
    const weight = h('input', { class: 'input', placeholder: '重量', style: 'width:80px', value: ex.weight || '' });
    const del = h('button', { type: 'button', class: 'icon-btn danger' }, '✕');
    del.onclick = () => { row.remove(); };
    row.append(sel, sets, reps, weight, del);
    rowsWrap.append(row);
    rows.push({ sel, sets, reps, weight });
  };

  const prefill = prefillIds.length ? prefillIds : [];
  if (prefill.length) prefill.forEach((id) => addRow(id));
  else addRow();

  const addBtn = h('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, '＋ 添加动作');
  addBtn.onclick = () => addRow();
  body.append(addBtn);

  body.append(h('label', { style: 'margin-top:8px' }, '时长'));
  const duration = h('input', { class: 'input', placeholder: '如 40分钟' });
  body.append(duration);

  body.append(h('label', { style: 'margin-top:8px' }, '感受'));
  const note = h('input', { class: 'input', placeholder: '一句话感受（可选）' });
  body.append(note);

  const foot = h('div', { class: 'modal-foot' });
  const cancel = h('button', { class: 'btn' }, '取消');
  const save = h('button', { class: 'btn btn-primary' }, '保存打卡');
  foot.append(cancel, save);
  const shell = modalShell('训练打卡', body, foot);
  cancel.onclick = () => shell.close();
  save.onclick = async () => {
    const exercises = rows
      .filter((r) => r.sel.value)
      .map((r) => ({
        exerciseId: r.sel.value,
        sets: Number(r.sets.value) || 0,
        reps: Number(r.reps.value) || 0,
        weight: r.weight.value || ''
      }));
    await api.post('/api/workouts/logs', { date: dateInput.value, exercises, duration: duration.value, note: note.value });
    toast('打卡成功 💪');
    shell.close();
    paint();
  };
}

function exercisesModal(w) {
  const body = h('div', { class: 'modal-body' });
  const list = h('div', {});
  const renderList = () => {
    list.innerHTML = '';
    for (const ex of w.exercises) {
      const row = h('div', { class: 'row', style: 'margin-bottom:6px' });
      row.append(h('span', { style: 'flex:1' }, `${ex.name}${ex.part ? `（${ex.part}）` : ''}`));
      row.append(h('span', { class: 'small muted' }, ex.sets && ex.reps ? `${ex.sets}×${ex.reps}` : ''));
      const del = h('button', { class: 'icon-btn danger' }, '🗑');
      del.onclick = async () => {
        if (await confirmDialog(`删除动作「${ex.name}」？`, { danger: true })) {
          await api.del(`/api/workouts/exercises/${ex.id}`);
          w = await api.get('/api/workouts');
          renderList();
        }
      };
      row.append(del);
      list.append(row);
    }
    if (!w.exercises.length) list.append(h('p', { class: 'muted' }, '还没有动作，在下面添加。'));
  };
  renderList();
  body.append(list);

  const addForm = h('div', { style: 'border-top:1px solid var(--border);padding-top:12px;margin-top:12px' });
  const name = h('input', { class: 'input', placeholder: '动作名（如 深蹲）' });
  const part = h('input', { class: 'input', placeholder: '部位（如 腿）' });
  const row2 = h('div', { class: 'row', style: 'margin-top:8px' });
  const sets = h('input', { type: 'number', class: 'input', placeholder: '组', style: 'width:60px' });
  const reps = h('input', { type: 'number', class: 'input', placeholder: '次', style: 'width:60px' });
  const weight = h('input', { class: 'input', placeholder: '重量', style: 'width:90px' });
  row2.append(sets, reps, weight);
  const addBtn = h('button', { class: 'btn btn-sm btn-primary', style: 'margin-top:8px' }, '＋ 添加动作');
  addBtn.onclick = async () => {
    if (!name.value.trim()) { toast('请填写动作名', 'error'); return; }
    await api.post('/api/workouts/exercises', { name: name.value.trim(), part: part.value, sets: Number(sets.value) || 0, reps: Number(reps.value) || 0, weight: weight.value });
    name.value = part.value = sets.value = reps.value = weight.value = '';
    w = await api.get('/api/workouts');
    renderList();
    toast('已添加');
  };
  addForm.append(name, part, row2, addBtn);
  body.append(addForm);

  const foot = h('div', { class: 'modal-foot' });
  const done = h('button', { class: 'btn btn-primary' }, '完成');
  foot.append(done);
  const shell = modalShell('动作库', body, foot);
  done.onclick = () => { shell.close(); paint(); };
}

function bodyModal() {
  const body = h('div', { class: 'modal-body' });
  body.append(h('label', {}, '日期'));
  const dateInput = h('input', { type: 'date', class: 'input', value: todayStr() });
  body.append(dateInput);
  body.append(h('label', { style: 'margin-top:8px' }, '体重（可选）'));
  const weight = h('input', { class: 'input', placeholder: '如 70（公斤）' });
  body.append(weight);
  body.append(h('label', { style: 'margin-top:8px' }, '腰围（可选）'));
  const waist = h('input', { class: 'input', placeholder: '如 80（厘米）' });
  body.append(waist);

  const foot = h('div', { class: 'modal-foot' });
  const cancel = h('button', { class: 'btn' }, '取消');
  const save = h('button', { class: 'btn btn-primary' }, '保存');
  foot.append(cancel, save);
  const shell = modalShell('记录身体数据', body, foot);
  cancel.onclick = () => shell.close();
  save.onclick = async () => {
    await api.post('/api/workouts/body', {
      date: dateInput.value,
      weight: weight.value || null,
      measurements: waist.value ? { 腰围: waist.value } : {}
    });
    toast('已记录');
    shell.close();
    paint();
  };
}

export async function add() {
  const w = await api.get('/api/workouts');
  logModal(w, w.todayExerciseIds);
}
