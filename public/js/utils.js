'use strict';

const WD = ['日', '一', '二', '三', '四', '五', '六'];

function pad(n) {
  return String(n).padStart(2, '0');
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// 周一=0
export function weekdayIndex(str) {
  const [y, m, d] = str.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

// 本周起始日（周一/周日）对应的日期
export function weekStartDate(today, weekStart = 'mon') {
  const idx = weekdayIndex(today); // 周一=0 … 周日=6
  const offset = weekStart === 'sun' ? (idx + 1) % 7 : idx;
  return addDays(today, -offset);
}

export function fmtDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-').map(Number);
  return `${m}月${d}日 周${WD[new Date(y, m - 1, d).getDay()]}`;
}

export function fmtDateShort(str) {
  if (!str) return '';
  const [, m, d] = str.split('-').map(Number);
  return `${m}/${d}`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const PRIORITY = {
  high: { label: '高', cls: 'high' },
  medium: { label: '中', cls: 'medium' },
  low: { label: '低', cls: 'low' }
};
export function priorityLabel(p) { return (PRIORITY[p] || PRIORITY.medium).label; }
export function priorityClass(p) { return (PRIORITY[p] || PRIORITY.medium).cls; }

export const PROJECT_STATUS = {
  active: { label: '进行中', cls: 'active' },
  paused: { label: '暂停', cls: 'paused' },
  done: { label: '完成', cls: 'done' }
};
export const BOOK_STATUS = {
  want: { label: '想读' },
  reading: { label: '在读' },
  done: { label: '读完' }
};
export const IDEA_STATUS = {
  idea: { label: '灵感' },
  planning: { label: '计划中' },
  doing: { label: '实施中' },
  done: { label: '完成' },
  dropped: { label: '放弃' }
};
export const IDEA_ORDER = ['idea', 'planning', 'doing', 'done', 'dropped'];

// 条目的时间区间终点：优先结束日期/时间（项目任务用 dueDate/dueTime）
export function rangeEnd(item) {
  const it = item || {};
  const date = it.endDate || it.dueDate || it.date || null;
  if (!date) return { date: null, time: null };
  // 有结束日期就是区间：只认结束时间，没给就表示到那一天结束
  const hasRange = !!(it.endDate || it.dueDate);
  const time = hasRange ? (it.endTime || it.dueTime || null) : (it.time || null);
  return { date, time };
}

// 任务是否已逾期：当前时间晚于「时间区间的最后时间」才算逾期
export function isOverdue(task, today = todayStr(), now = new Date()) {
  if (!task || task.done) return false;
  const end = rangeEnd(task);
  if (!end.date) return false;
  if (end.date < today) return true;
  if (end.date > today) return false;
  // 最后一天：只给到日期时，这一天还没过完，不算逾期
  if (!end.time) return false;
  const [y, m, d] = end.date.split('-').map(Number);
  const [hh, mm] = String(end.time).split(':').map(Number);
  return now > new Date(y, m - 1, d, hh, mm, 0, 0);
}
