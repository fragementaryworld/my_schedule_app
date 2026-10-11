'use strict';
// 共享任务标识与配色规则，不依赖 DOM、API 或具体页面。
// 层级路径：项目 > tasks/t1[/subtasks/s1[/subtasks/s2 …]]，最多 5 层
export function itemBase(projectId, chain) {
  const parts = ['/api/projects', projectId, 'tasks', chain[0]];
  for (let i = 1; i < chain.length; i++) parts.push('subtasks', chain[i]);
  return parts.join('/');
}

export function itemHref(projectId, chain) {
  return `#/task/${[projectId, ...chain].join('/')}`;
}

// 每条项目/任务一个稳定颜色（按 id 哈希，顺序变化也不跳色）
export const TIMELINE_COLORS = [
  '#4f6ef7', '#16a34a', '#f59e0b', '#8b5cf6', '#ec4899',
  '#0891b2', '#65a30d', '#ea580c', '#0d9488', '#64748b'
];

export function timelineColorIndex(id) {
  const s = String(id === null || id === undefined ? '' : id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % TIMELINE_COLORS.length;
}

export function timelineColor(id) {
  return TIMELINE_COLORS[timelineColorIndex(id)];
}

