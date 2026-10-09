'use strict';
// 今日计划（日历）用到的纯计算：周/月网格、分组、排序
import { addDays, weekdayIndex, todayStr } from './utils.js';

export const CALENDAR_VIEWS = [
  { value: 'week', label: '周视图' },
  { value: 'month', label: '月视图' }
];

const WD = ['日', '一', '二', '三', '四', '五', '六'];

// 一周 7 天的标签，按「一周起始日」偏好排序
export function weekdayLabels(weekStartPref = 'mon') {
  const order = weekStartPref === 'sun' ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
  return order.map((i) => WD[i]);
}

// 该日期所在周的起始日
export function weekStartOf(dateStr, weekStartPref = 'mon') {
  const idx = weekdayIndex(dateStr); // 周一=0
  const offset = weekStartPref === 'sun' ? (idx + 1) % 7 : idx;
  return addDays(dateStr, -offset);
}

export function weekDates(anchor, weekStartPref = 'mon') {
  const start = weekStartOf(anchor, weekStartPref);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// 月视图网格：6 周 × 7 天
export function monthGridDates(year, month, weekStartPref = 'mon') {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const start = weekStartOf(first, weekStartPref);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function parseYm(dateStr) {
  return { y: Number(dateStr.slice(0, 4)), m: Number(dateStr.slice(5, 7)) };
}

export function monthTitle(year, month) {
  return `${year}年${month}月`;
}

export function periodTitle(anchor, view) {
  const { y, m } = parseYm(anchor);
  if (view === 'month') return monthTitle(y, m);
  const days = weekDates(anchor);
  const from = days[0];
  const to = days[6];
  const a = parseYm(from);
  const b = parseYm(to);
  if (a.m === b.m && a.y === b.y) return `${a.y}年${a.m}月${Number(from.slice(8, 10))}–${Number(to.slice(8, 10))}日`;
  return `${a.m}月${Number(from.slice(8, 10))}日 – ${b.m}月${Number(to.slice(8, 10))}日`;
}

// 上一页 / 下一页：周视图 ±7 天，月视图 ±1 月（日号越界时收敛到当月最后一天）
export function shiftAnchor(anchor, view, delta) {
  if (view === 'month') {
    const { y, m } = parseYm(anchor);
    const total = y * 12 + (m - 1) + delta;
    const ny = Math.floor(total / 12);
    const nm = ((total % 12) + 12) % 12 + 1;
    const day = Number(anchor.slice(8, 10));
    const last = new Date(ny, nm, 0).getDate();
    return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
  }
  return addDays(anchor, 7 * delta);
}

export function sameMonth(dateStr, year, month) {
  return Number(dateStr.slice(0, 4)) === year && Number(dateStr.slice(5, 7)) === month;
}

export function isToday(dateStr, today = todayStr()) {
  return dateStr === today;
}

export function dayNumber(dateStr) {
  return Number(dateStr.slice(8, 10));
}

// 条目 → { 'YYYY-MM-DD': [条目] }
export function groupByDate(entries) {
  const map = new Map();
  for (const e of entries || []) {
    if (!e || !e.date) continue;
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  }
  return map;
}

// 同一天内：先按时间，再未完成优先，最后按标题
export function sortDayEntries(entries) {
  return (entries || []).slice().sort((a, b) => {
    const at = a.time || '99:99';
    const bt = b.time || '99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

export function visibleDates(anchor, view, weekStartPref = 'mon') {
  if (view === 'month') {
    const { y, m } = parseYm(anchor);
    return monthGridDates(y, m, weekStartPref);
  }
  return weekDates(anchor, weekStartPref);
}

// 请求日历数据用的日期区间
export function rangeOf(anchor, view, weekStartPref = 'mon') {
  const dates = visibleDates(anchor, view, weekStartPref);
  return { from: dates[0], to: dates[dates.length - 1], dates };
}
