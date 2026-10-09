'use strict';
// 今日计划（日历）用到的纯计算：周/月网格、分组、排序、工作项目任务并入
import { addDays, weekdayIndex, todayStr } from './utils.js';
import { itemBase, itemHref, timelineColor } from './views/projects.js';

export const CALENDAR_VIEWS = [
  { value: 'week', label: '周视图' },
  { value: 'month', label: '月视图' }
];

// 每日任务（不属于任何项目）的固定配色
export const DAY_TASK_COLOR = '#8a919c';

// '#rrggbb' → 半透明同色，用来把整块卡片背景染色（文字仍然清晰）
export function tint(hex, alpha = 0.26) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex === null || hex === undefined ? '' : hex));
  if (!m) return '';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

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

// ——— 工作项目任务并入每日计划 ———

// 把项目里所有任务与各级子任务摊平，带上级路径
export function flattenProjectItems(projects) {
  const out = [];
  const list = Array.isArray(projects) ? projects : [];
  const walk = (nodes, project, parentPath, depth) => {
    for (const node of nodes || []) {
      const path = [...parentPath, node.id];
      out.push({ node, project, path, depth });
      walk(node.subtasks, project, path, depth + 1);
    }
  };
  for (const project of list) walk(project.tasks, project, [], 1);
  return out;
}

// 项目任务落在哪一天：优先截止日，没有截止日就用开始日；都没有则不进日历
export function itemCalendarDate(node) {
  if (!node) return null;
  return node.dueDate || node.startDate || null;
}

export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}

// 任务的日期跨度（保证 from <= to）；只有一个日期时跨度就是那一天
export function itemSpan(node) {
  if (!node) return null;
  const a = node.startDate || node.dueDate || null;
  const b = node.dueDate || node.startDate || null;
  if (!a || !b) return null;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export function spanDays(span) {
  if (!span) return 0;
  return daysBetween(span.from, span.to) + 1;
}

// 项目任务铺到给定日期：跨多天的任务在每一天都出现（不是只放在开始/结束那天）
export function projectEntriesForDates(projects, dates, today = todayStr()) {
  return expandEntries(projectEntriesByDate(projects, today), dates);
}

// 项目任务 → 日历条目（只落在一天：优先截止日）
export function projectEntriesByDate(projects, today = todayStr()) {
  const out = [];
  for (const { node, project, path, depth } of flattenProjectItems(projects)) {
    const date = itemCalendarDate(node);
    if (!date) continue;
    const span = itemSpan(node) || { from: date, to: date };
    out.push({
      kind: 'project',
      id: node.id,
      title: node.title,
      date,
      time: node.dueTime || '',
      done: !!node.done,
      projectId: project.id,
      projectName: project.name,
      color: timelineColor(project.id),
      path,
      depth,
      base: itemBase(project.id, path),
      href: itemHref(project.id, path),
      spanFrom: span.from,
      spanTo: span.to,
      spanDays: spanDays(span),
      spanStart: date === span.from,
      spanEnd: date === span.to,
      continued: date !== span.from,
      detail: detailText(node),
      subtaskCount: (node.subtasks || []).length,
      subtaskDone: (node.subtasks || []).filter((s) => s && s.done).length,
      overdue: !node.done && !!node.dueDate && node.dueDate < today
    });
  }
  return out;
}

// 合并每日任务与项目任务后按日期分组
export function mergeEntries(dayEntries, projectEntries) {
  return groupByDate([...(dayEntries || []), ...(projectEntries || [])]);
}

// 图例：当前范围里出现的「颜色 → 来源」
export function legendFor(entries) {
  const seen = new Map();
  for (const e of entries || []) {
    const key = e.kind === 'project' ? `p:${e.projectId}` : 'day';
    if (seen.has(key)) continue;
    seen.set(key, {
      key,
      kind: e.kind,
      label: e.kind === 'project' ? e.projectName : '每日任务',
      color: e.color || DAY_TASK_COLOR
    });
  }
  return [...seen.values()];
}

// 某一天的看板：待办 / 已完成
export function dateBoard(entries) {
  const list = sortDayEntries(entries || []);
  const pending = list.filter((e) => !e.done);
  const done = list.filter((e) => e.done);
  return { pending, done, total: list.length };
}

// 内容块里的文字拼成一段（用于详情预览）
export function blocksText(blocks) {
  return (blocks || [])
    .map((b) => (b && b.text ? String(b.text).trim() : ''))
    .filter(Boolean)
    .join(' ');
}

export function truncate(text, max = 90) {
  const s = String(text === null || text === undefined ? '' : text).trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

// 任务详情预览：描述 + 内容块
export function detailText(node) {
  if (!node) return '';
  const parts = [];
  if (node.desc && String(node.desc).trim()) parts.push(String(node.desc).trim());
  const bt = blocksText(node.blocks);
  if (bt) parts.push(bt);
  return parts.join(' · ');
}

// 把「带跨度的条目」铺到每一天（项目任务与每日任务通用）
export function expandEntries(entries, dates) {
  const out = [];
  for (const e of entries || []) {
    const from = e.spanFrom || e.date;
    const to = e.spanTo || e.date;
    for (const d of dates || []) {
      if (!d || d < from || d > to) continue;
      out.push({ ...e, date: d, spanStart: d === from, spanEnd: d === to, continued: d !== from });
    }
  }
  return out;
}

// 与给定日期范围有交集的跨天条目（每个任务只出一条，用来画连续 block）
export function spanningEntries(entries, dates) {
  const wanted = (dates || []).filter(Boolean).slice().sort();
  if (!wanted.length) return [];
  const from = wanted[0];
  const to = wanted[wanted.length - 1];
  return (entries || []).filter((e) => {
    if (!e || (e.spanDays || 1) <= 1) return false;
    return (e.spanFrom || e.date) <= to && (e.spanTo || e.date) >= from;
  });
}

// 跨多天的条目：每个任务只出一条（用于画连续 block，而不是每天放一个）
export function multiDayEntries(projects, dates, today = todayStr()) {
  const wanted = (dates || []).filter(Boolean).slice().sort();
  if (!wanted.length) return [];
  const from = wanted[0];
  const to = wanted[wanted.length - 1];
  return projectEntriesByDate(projects, today)
    .filter((e) => e.spanDays > 1 && e.spanFrom <= to && e.spanTo >= from);
}

// 把跨天任务切成"某一周行"里的连续横条，并分配互不重叠的泳道
export function spanBarLayout(entries, rowDates) {
  const bars = [];
  for (const e of entries || []) {
    if (!e || !(e.spanDays > 1)) continue;
    let startCol = -1;
    let endCol = -1;
    (rowDates || []).forEach((d, i) => {
      if (d >= e.spanFrom && d <= e.spanTo) {
        if (startCol < 0) startCol = i;
        endCol = i;
      }
    });
    if (startCol < 0) continue;
    bars.push({
      entry: e,
      startCol,
      endCol,
      continuesLeft: e.spanFrom < rowDates[startCol],
      continuesRight: e.spanTo > rowDates[endCol]
    });
  }
  bars.sort((a, b) => a.startCol - b.startCol || b.endCol - a.endCol);
  const lanes = [];
  for (const bar of bars) {
    let lane = lanes.findIndex((lastCol) => lastCol < bar.startCol);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push(-1);
    }
    lanes[lane] = bar.endCol;
    bar.lane = lane;
  }
  return { bars, laneCount: lanes.length };
}
