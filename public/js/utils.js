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

// ——— 预计用时（存分钟数）———
export const ESTIMATE_OPTIONS = [
  { value: 0, label: '未设置' },
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 120, label: '2 小时' },
  { value: 240, label: '半天' },
  { value: 480, label: '1 天' }
];

// 分钟 → 展示文案
export function estimateLabel(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return '';
  const hit = ESTIMATE_OPTIONS.find((o) => o.value === n);
  if (hit) return hit.label;
  if (n < 60) return `${Math.round(n)} 分钟`;
  const hours = n / 60;
  return Number.isInteger(hours) ? `${hours} 小时` : `${hours.toFixed(1)} 小时`;
}

// 任意输入 → 存储值（分钟数或 null）
export function normalizeEstimate(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  const rounded = Math.round(n);
  return rounded > 0 ? rounded : null;
}

// 展示用（没有就不显示）
export function estimateText(item) {
  const label = estimateLabel(item && item.estimate);
  return label ? `⏱ ${label}` : '';
}

// 分钟 ↔ 小时（手动填写用小时）
export function estimateHours(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n / 60) * 100) / 100;
}

export function hoursToMinutes(hours) {
  const n = Number(hours);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 60);
}

// 手填输入 → 分钟。容忍全角数字（中文输入法）、空格、以及 "h/小时" 后缀。
// 返回 null = 清空；返回 undefined = 非法输入（调用方应还原，不要写库）
export function parseEstimateInput(raw) {
  const text = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!text) return null;
  const half = text
    .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[\uFF0E\u3002\uFF0C]/g, '.')
    .replace(/\s+/g, '')
    .replace(/(小时|時|时|hours|hour|hrs|hr|h|H)$/, '');
  if (!/^\d*\.?\d+$/.test(half)) return undefined;
  const hours = Number(half);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return hoursToMinutes(hours);
}

// 项目截止日期独立于执行安排；普通事务重新安排后，按最新安排的最后一天判断。
// 开始时间和安排时段不是截止时间，没有明确截止时间时，当天结束才算逾期。
export function rangeEnd(item) {
  const it = item?.raw || item || {};
  if (it.dueDate) return { date: it.dueDate, time: it.dueTime || null };
  if (it.planDate) return { date: it.planEndDate || it.planDate, time: null };
  const date = it.endDate || it.date || null;
  if (!date) return { date: null, time: null };
  return { date, time: it.endTime || null };
}

// 任务是否已逾期：当前时间晚于「时间区间的最后时间」才算逾期
export function isOverdue(task, today = todayStr(), now = new Date()) {
  if (!task || (task.done ?? task.raw?.done)) return false;
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
