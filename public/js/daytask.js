'use strict';
// 每日计划任务（date + time 的独立任务）共用的模型与动作
import { api } from './api.js';
import { toast } from './ui.js';

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

export const SOURCE_OPTIONS = [
  { value: '', label: '无' },
  { value: 'project', label: '工作项目' },
  { value: 'book', label: '阅读' },
  { value: 'workout', label: '健身' },
  { value: 'idea', label: '灵感' }
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
