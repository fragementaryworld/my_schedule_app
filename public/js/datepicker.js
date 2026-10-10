'use strict';
import { h } from './ui.js';
import { todayStr, addDays } from './utils.js';

// 日期显示格式（对应选择器里的 Date format）
export const DATE_FORMATS = [
  { value: 'full', label: '完整日期' },
  { value: 'short', label: '短日期' },
  { value: 'iso', label: '年-月-日' },
  { value: 'mdy', label: '月/日/年' },
  { value: 'ymd', label: '年/月/日' },
  { value: 'relative', label: '相对日期' }
];

// 默认按「年/月/日」显示
export const DEFAULT_DATE_FORMAT = 'ymd';
export const DEFAULT_TIME = '09:00';
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const pad = (n) => String(n).padStart(2, '0');

export function isDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function isTimeStr(s) {
  return typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s);
}

export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}

export function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate(); // m: 1-12
}

export function shiftMonth(y, m, delta) {
  const total = y * 12 + (m - 1) + delta;
  return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 + 1 };
}

export function monthTitle(y, m) {
  return `${y}年${m}月`;
}

// 6 周 × 7 天（周日起始）
export function monthGrid(y, m) {
  const first = new Date(y, m - 1, 1).getDay(); // 0 = 周日
  const from = addDays(`${y}-${pad(m)}-01`, -first);
  const out = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(from, i);
    out.push({ date, inMonth: Number(date.slice(5, 7)) === m });
  }
  return out;
}

// 区间内的中间日期（不含两端）
export function isBetween(date, start, end) {
  if (!isDateStr(start) || !isDateStr(end)) return false;
  const a = start <= end ? start : end;
  const b = start <= end ? end : start;
  return date > a && date < b;
}

export function formatDate(date, format = DEFAULT_DATE_FORMAT, today = todayStr()) {
  if (!isDateStr(date)) return '';
  const [y, m, d] = date.split('-').map(Number);
  switch (format) {
    case 'short': return `${y}年${m}月${d}日`;
    case 'iso': return date;
    case 'mdy': return `${pad(m)}/${pad(d)}/${y}`;
    case 'ymd': return `${y}/${pad(m)}/${pad(d)}`;
    case 'relative': {
      const diff = daysBetween(today, date);
      if (diff === 0) return '今天';
      if (diff === 1) return '明天';
      if (diff === -1) return '昨天';
      return diff > 1 ? `${diff} 天后` : `${-diff} 天前`;
    }
    case 'full':
    default:
      return `${y}年${m}月${d}日 周${WD[new Date(y, m - 1, d).getDay()]}`;
  }
}

// ——— 值 ↔ 选择器状态 ———
// 存储字段：startDate / dueDate / startTime / dueTime / dateFormat
// 单日期模式只写 dueDate（应用里"那一天"就是 dueDate）

export function toPickerState(value) {
  const v = value || {};
  const start = isDateStr(v.startDate) ? v.startDate : null;
  const due = isDateStr(v.dueDate) ? v.dueDate : null;
  const hasEnd = !!(start && due);
  const includeTime = isTimeStr(v.startTime) || isTimeStr(v.dueTime);
  const format = DATE_FORMATS.some((f) => f.value === v.dateFormat) ? v.dateFormat : DEFAULT_DATE_FORMAT;

  if (hasEnd) {
    return {
      hasEnd: true,
      start,
      end: due,
      includeTime,
      startTime: isTimeStr(v.startTime) ? v.startTime : DEFAULT_TIME,
      endTime: isTimeStr(v.dueTime) ? v.dueTime : DEFAULT_TIME,
      format,
      editing: 'start'
    };
  }
  return {
    hasEnd: false,
    start: due || start,
    end: null,
    includeTime,
    startTime: isTimeStr(v.dueTime) ? v.dueTime : (isTimeStr(v.startTime) ? v.startTime : DEFAULT_TIME),
    endTime: DEFAULT_TIME,
    format,
    editing: 'start'
  };
}

export function toApiPatch(state) {
  const s = state || {};
  const start = isDateStr(s.start) ? s.start : null;
  const end = s.hasEnd && isDateStr(s.end) ? s.end : null;
  const startTime = s.includeTime && isTimeStr(s.startTime) ? s.startTime : null;
  const endTime = s.includeTime && isTimeStr(s.endTime) ? s.endTime : null;
  if (s.hasEnd) {
    return { startDate: start, startTime, dueDate: end, dueTime: endTime, dateFormat: s.format };
  }
  return { startDate: null, startTime: null, dueDate: start, dueTime: startTime, dateFormat: s.format };
}

// 点日历里的一天
export function setDay(state, date) {
  const s = { ...state };
  if (!s.hasEnd) return { ...s, start: date };
  if (s.editing === 'end') {
    if (s.start && date < s.start) { s.end = s.start; s.start = date; } else { s.end = date; }
    s.editing = 'start';
  } else {
    if (s.end && date > s.end) { s.start = s.end; s.end = date; } else { s.start = date; }
    s.editing = 'end';
  }
  return s;
}

// End date 开关
export function toggleEnd(state, on) {
  if (on) return { ...state, hasEnd: true, end: state.end || state.start, editing: 'end' };
  return { ...state, hasEnd: false, end: null, editing: 'start' };
}

// Include time 开关
export function toggleTime(state, on) {
  if (on) {
    return {
      ...state,
      includeTime: true,
      startTime: isTimeStr(state.startTime) ? state.startTime : DEFAULT_TIME,
      endTime: isTimeStr(state.endTime) ? state.endTime : DEFAULT_TIME
    };
  }
  return { ...state, includeTime: false };
}

export function clearState(state) {
  const s = state || {};
  return {
    hasEnd: false,
    start: null,
    end: null,
    includeTime: false,
    startTime: DEFAULT_TIME,
    endTime: DEFAULT_TIME,
    format: DATE_FORMATS.some((f) => f.value === s.format) ? s.format : DEFAULT_DATE_FORMAT,
    editing: 'start'
  };
}

export function formatStateDisplay(state, today = todayStr()) {
  const s = state || {};
  const one = (date, time) => {
    const base = formatDate(date, s.format, today);
    return s.includeTime && isTimeStr(time) ? `${base} ${time}` : base;
  };
  if (s.hasEnd) {
    if (!s.start && !s.end) return '';
    const left = s.start ? one(s.start, s.startTime) : '开始';
    const right = s.end ? one(s.end, s.endTime) : '结束';
    return `${left} → ${right}`;
  }
  if (!s.start) return '';
  return one(s.start, s.startTime);
}

// 实体（项目/任务/子任务）的日期展示
export function formatDateValue(value, today = todayStr()) {
  return formatStateDisplay(toPickerState(value), today);
}

export function hasDateValue(value) {
  const v = value || {};
  return isDateStr(v.startDate) || isDateStr(v.dueDate);
}

// ——— 组件 ———

function switchRow(label, cls, on, onclick) {
  const row = h('div', { class: 'dp-row' });
  row.append(h('span', { class: 'dp-label' }, label));
  const btn = h('button', {
    type: 'button',
    class: `dp-switch ${cls}${on ? ' on' : ''}`,
    role: 'switch',
    'aria-checked': on ? 'true' : 'false'
  });
  btn.append(h('i', { class: 'dp-knob' }));
  btn.addEventListener('click', onclick);
  row.append(btn);
  return row;
}

// 日期字段：点一下展开选择器（单日期 / 时间区间 + 日期格式 + 包含时间）
export function buildDateField({ value, onSave, placeholder = '选择时间', today = todayStr(), key }) {
  let state = toPickerState(value);
  let view = { y: 0, m: 0 };

  const wrap = h('div', { class: 'date-field' });
  const trigger = h('button', {
    type: 'button',
    class: 'btn btn-sm date-trigger',
    'data-focus-key': key
  });
  const pop = h('div', { class: 'datepicker-pop' });
  pop.style.display = 'none';

  // 面板内部的点击不要冒泡到 document：
  // 点日期会重绘面板，旧节点随即脱离文档，若让它冒泡到全局监听就会被误判成"点了窗口外"
  pop.addEventListener('click', (e) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
  });

  const paintTrigger = () => {
    const text = formatStateDisplay(state, today);
    trigger.textContent = text || placeholder;
    trigger.classList.toggle('empty', !text);
  };

  const jumpToValue = () => {
    const base = state.start || state.end || today;
    view = { y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) };
  };

  const save = async () => {
    paintTrigger();
    if (typeof onSave === 'function') await onSave(toApiPatch(state));
  };

  const paintPop = () => {
    pop.innerHTML = '';

    const head = h('div', { class: 'dp-head' });
    const startChip = h('button', {
      type: 'button',
      class: 'dp-chip dp-chip-start' + (state.editing === 'start' ? ' active' : ''),
      onclick: () => { state.editing = 'start'; paintPop(); }
    }, state.start ? formatDate(state.start, state.format, today) : '选择日期');
    head.append(startChip);
    if (state.hasEnd) {
      head.append(h('span', { class: 'dp-arrow' }, '→'));
      head.append(h('button', {
        type: 'button',
        class: 'dp-chip dp-chip-end' + (state.editing === 'end' ? ' active' : ''),
        onclick: () => { state.editing = 'end'; paintPop(); }
      }, state.end ? formatDate(state.end, state.format, today) : '选择结束'));
    }
    pop.append(head);

    const nav = h('div', { class: 'dp-nav' });
    nav.append(h('span', { class: 'dp-month' }, monthTitle(view.y, view.m)), h('span', { class: 'spacer' }));
    nav.append(h('button', { type: 'button', class: 'dp-today', onclick: () => { const p = today.split('-').map(Number); view = { y: p[0], m: p[1] }; paintPop(); } }, 'Today'));
    nav.append(h('button', { type: 'button', class: 'dp-nav-btn dp-prev', onclick: () => { view = shiftMonth(view.y, view.m, -1); paintPop(); } }, '‹'));
    nav.append(h('button', { type: 'button', class: 'dp-nav-btn dp-next', onclick: () => { view = shiftMonth(view.y, view.m, 1); paintPop(); } }, '›'));
    pop.append(nav);

    const wd = h('div', { class: 'dp-weekdays' });
    for (const w of ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']) wd.append(h('span', { class: 'dp-wd' }, w));
    pop.append(wd);

    const grid = h('div', { class: 'dp-grid' });
    for (const cell of monthGrid(view.y, view.m)) {
      const cls = ['dp-day'];
      if (!cell.inMonth) cls.push('outside');
      if (cell.date === today) cls.push('today');
      if (state.start === cell.date) cls.push('selected', 'is-start');
      if (state.hasEnd && state.end === cell.date) cls.push('selected', 'is-end');
      if (state.hasEnd && isBetween(cell.date, state.start, state.end)) cls.push('in-range');
      grid.append(h('button', {
        type: 'button',
        class: cls.join(' '),
        dataset: { date: cell.date },
        onclick: async () => { state = setDay(state, cell.date); paintPop(); await save(); }
      }, String(Number(cell.date.slice(8, 10)))));
    }
    pop.append(grid);

    pop.append(switchRow('结束日期', 'dp-switch-end', state.hasEnd, async () => {
      state = toggleEnd(state, !state.hasEnd);
      paintPop();
      await save();
    }));

    const fmtRow = h('div', { class: 'dp-row' });
    fmtRow.append(h('span', { class: 'dp-label' }, '日期格式'));
    const sel = h('select', { class: 'dp-select date-format-select' });
    for (const f of DATE_FORMATS) sel.append(h('option', { value: f.value }, f.label));
    sel.value = state.format;
    sel.addEventListener('change', async () => { state.format = sel.value; paintPop(); await save(); });
    fmtRow.append(sel);
    pop.append(fmtRow);

    pop.append(switchRow('包含时间', 'dp-switch-time', state.includeTime, async () => {
      state = toggleTime(state, !state.includeTime);
      paintPop();
      await save();
    }));

    if (state.includeTime) {
      const timeRow = h('div', { class: 'dp-row' });
      timeRow.append(h('span', { class: 'dp-label' }, '时间'));
      const t1 = h('input', { type: 'time', class: 'dp-time dp-time-start' });
      t1.value = state.startTime || DEFAULT_TIME;
      t1.addEventListener('change', async () => { state.startTime = t1.value || DEFAULT_TIME; await save(); });
      timeRow.append(t1);
      if (state.hasEnd) {
        const t2 = h('input', { type: 'time', class: 'dp-time dp-time-end' });
        t2.value = state.endTime || DEFAULT_TIME;
        t2.addEventListener('change', async () => { state.endTime = t2.value || DEFAULT_TIME; await save(); });
        timeRow.append(t2);
      }
      pop.append(timeRow);
    }

    pop.append(h('button', {
      type: 'button',
      class: 'dp-clear',
      onclick: async () => { state = clearState(state); paintPop(); await save(); }
    }, '清除'));
    pop.append(h('div', { class: 'dp-hint small muted' }, '可只选一天；开启「结束日期」即为时间区间'));
  };

  const isInside = (node, root) => {
    let cur = node;
    while (cur) {
      if (cur === root) return true;
      cur = cur.parentNode || null;
    }
    return false;
  };

  // 关闭时同时摘掉全局监听，避免残留
  const closePop = () => {
    pop.style.display = 'none';
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onDocKey);
  };
  const onDocClick = (e) => {
    if (e && isInside(e.target, wrap)) return; // 点窗口内部不关
    closePop();
  };
  const onDocKey = (e) => {
    if (e && e.key === 'Escape') closePop();
  };

  const openPop = () => {
    jumpToValue();
    paintPop();
    pop.style.display = '';
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onDocKey);
  };

  trigger.addEventListener('click', () => {
    if (pop.style.display === 'none') openPop();
    else closePop();
  });

  paintTrigger();
  wrap.append(trigger, pop);
  return wrap;
}
