import { h } from './ui.js';

// Shared presentation for daily tasks and every level of project tasks.
// The views retain their existing controls, save handlers and navigation paths.
const PROPERTY_ICONS = {
  '所属清单': '<path d="M3 6h6l2 2h10v12H3z"/>',
  '状态': '<circle cx="12" cy="12" r="8"/><path d="m8 12 3 3 5-6"/>',
  '时间': '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 11h16"/>',
  '当天安排': '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4m-7 8 2 2 4-4"/>',
  '预计用时': '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  '优先级': '<path d="M5 21V4m0 0h14l-3 4 3 4H5"/>',
  '重复': '<path d="m17 3 4 4-4 4M3 11V7h18M7 21l-4-4 4-4m14 0v4H3"/>',
  '层级': '<path d="m12 3 9 5-9 5-9-5zm-9 9 9 5 9-5m-18 5 9 5 9-5"/>',
  '下级': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M6 10v7h8"/>'
};

export function taskProperty(label, control, key) {
  if (key) control.setAttribute('data-focus-key', key);
  if (['INPUT', 'SELECT', 'BUTTON'].includes(control.tagName) && !control.hasAttribute('aria-label')) control.setAttribute('aria-label', label);
  if (label === '状态') {
    control.classList.add('task-status-select');
    control.dataset.state = control.value === 'yes' ? 'done' : 'pending';
  }
  const icon = h('span', { class: 'task-property-icon', 'aria-hidden': 'true', html:
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${PROPERTY_ICONS[label] || ''}</svg>` });
  return h('div', { class: 'prop-row', role: 'group', 'aria-label': label },
    h('span', { class: 'prop-label' }, icon, label), control);
}

export function taskSection(title, content, { count, children = false } = {}) {
  const heading = h('h2', { class: 'page-section task-section-title' }, title);
  if (count !== undefined) heading.append(h('span', { class: 'task-section-count' }, String(count)));
  return h('section', { class: `task-page-section${children ? ' task-children-section' : ''}`, 'aria-label': title }, heading, content);
}

export function buildTaskDocument({ breadcrumb, heading, properties, sections, label, done }) {
  const state = h('span', { class: `task-page-status${done ? ' is-done' : ''}` },
    h('span', { class: 'task-status-dot', 'aria-hidden': 'true' }), done ? '已完成' : '未完成');
  const hero = h('header', { class: 'task-page-hero' },
    h('div', { class: 'task-page-kicker' }, h('span', {}, label), state), heading);
  return h('article', { class: 'task-document', 'aria-label': '任务详情' }, breadcrumb, hero,
    h('section', { class: 'task-properties-section', 'aria-label': '任务属性' }, properties), ...sections);
}
