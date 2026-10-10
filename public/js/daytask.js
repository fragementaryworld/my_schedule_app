'use strict';
// 每日计划任务（date + time 的独立任务）共用的模型与动作
import { api } from './api.js';
import { toast } from './ui.js';
import { DEFAULT_DATE_FORMAT } from './datepicker.js';

export const DEFAULT_DAY_TASK_TITLE = '新任务';

export const REPEAT_OPTIONS = [
  { value: '', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'd2', label: '每2天' },
  { value: 'w2', label: '每2周' }
];

export const PRIORITY_OPTIONS = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' }
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

export function dayTaskHref(id) {
  return `#/plan/${id}`;
}

// 任务的时间显示：区间时给出「09:00–11:00」
export function timeRangeLabel(time, endTime) {
  const t = time || '';
  const e = endTime || '';
  if (t && e && e !== t) return `${t}–${e}`;
  return t || (e ? `–${e}` : '');
}

// 每日任务 → 日期选择器的值（有结束日期就是区间，重开也要还原成区间）
export function taskDateValue(task) {
  const t = task || {};
  if (t.endDate) {
    return {
      startDate: t.date,
      dueDate: t.endDate,
      startTime: t.time,
      dueTime: t.endTime,
      dateFormat: t.dateFormat
    };
  }
  return { dueDate: t.date, dueTime: t.time, dateFormat: t.dateFormat };
}

// 日期选择器的结果 → 每日任务字段
// 注意：选择器的区间字段是 startDate/startTime + dueDate/dueTime
export function taskDatePatch(patch, current) {
  const p = patch || {};
  const cur = current || {};
  const format = p.dateFormat || cur.dateFormat || DEFAULT_DATE_FORMAT;
  if (p.startDate && p.dueDate) {
    return {
      date: p.startDate,
      time: p.startTime || null,
      endDate: p.dueDate,
      endTime: p.dueTime || null,
      dateFormat: format
    };
  }
  return {
    date: p.dueDate || cur.date || p.startDate,
    time: p.dueTime || null,
    endDate: null,
    endTime: null,
    dateFormat: format
  };
}

// 新建后还没填写内容
export function isFreshDayTask(t) {
  if (!t) return false;
  return t.title === DEFAULT_DAY_TASK_TITLE
    && !t.time
    && !t.note
    && !t.repeat
    && !t.source
    && (t.priority || 'medium') === 'medium';
}

// 直接新建任务并跳到它的页面（不弹窗）
export async function createDayTask(date) {
  const created = await api.post('/api/tasks', { title: DEFAULT_DAY_TASK_TITLE, date });
  toast('已新建任务');
  location.hash = dayTaskHref(created.id);
  return created;
}
