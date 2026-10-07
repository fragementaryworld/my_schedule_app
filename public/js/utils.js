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

// 任务是否已逾期（未完成，且已过日期/时间）
export function isOverdue(task, today) {
  if (!task || task.done) return false;
  if (task.date < today) return true;
  if (task.date === today && task.time) {
    const [h, m] = task.time.split(':').map(Number);
    const now = new Date();
    const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    return now > due;
  }
  return false;
}
