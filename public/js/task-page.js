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

export function taskBreadcrumb(items) {
  const list = h('ol', { class: 'task-path-list' });
  items.forEach((item, index) => {
    const current = index === items.length - 1;
    const icon = item.icon ? h('span', { class: 'task-path-icon', 'aria-hidden': 'true' }, item.icon)
      : h('span', { class: 'task-path-icon', 'aria-hidden': 'true', html:
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${current
          ? '<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8m-8 4h6"/>'
          : '<path d="M3 6h6l2 2h10v12H3z"/>'}</svg>` });
    const node = h(current ? 'span' : 'a', {
      class: `crumb task-path-node${current ? ' current' : ' task-path-folder'}`,
      href: current ? null : item.href, title: item.label, 'aria-current': current ? 'page' : null
    }, icon, current && item.kind ? h('span', { class: 'task-path-kind' }, `${item.kind}：`) : null,
      h('span', { class: 'task-path-name' }, item.label));
    const segment = h('li', { class: 'task-path-segment' });
    if (index) segment.append(h('span', { class: 'crumb-sep task-path-separator', 'aria-hidden': 'true' }, '›'));
    segment.append(node); list.append(segment);
  });
  return h('div', { class: 'breadcrumb task-path-bar' }, h('nav', { class: 'task-path-nav', 'aria-label': '任务路径' }, list));
}

export function taskProperty(label, control, key) {
  if (key) control.setAttribute('data-focus-key', key);
  if (['INPUT', 'SELECT', 'BUTTON'].includes(control.tagName) && !control.hasAttribute('aria-label')) control.setAttribute('aria-label', label);
  if (label === '状态') {
    control.classList.add('task-status-select');
    control.dataset.state = control.value === 'yes' ? 'done' : 'pending';
  }
  const icon = h('span', { class: 'task-property-icon', 'aria-hidden': 'true', html:
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${PROPERTY_ICONS[label] || ''}</svg>` });
  const wide = label === '时间' || label === '当天安排';
  return h('div', { class: `prop-row${wide ? ' task-property-wide' : ''}`, role: 'group', 'aria-label': label },
    h('span', { class: 'prop-label' }, icon, label), control);
}

export function taskProperties(rows) {
  const wrap = h('div', { class: 'page-props' });
  for (const [wide, label, className] of [[false, '基本属性', 'task-property-basics'], [true, '时间安排', 'task-property-schedule']]) {
    const matches = rows.filter(row => row.classList.contains('task-property-wide') === wide);
    if (matches.length) wrap.append(h('div', { class: `task-property-grid ${className}`, role: 'group', 'aria-label': label }, ...matches));
  }
  return wrap;
}

export function taskSection(title, content, { count, children = false } = {}) {
  const heading = h('h2', { class: 'page-section task-section-title' }, title);
  if (count !== undefined) heading.append(h('span', { class: 'task-section-count' }, String(count)));
  return h('section', { class: `task-page-section task-region ${children ? 'task-children-section' : 'task-content-section'}`, 'aria-label': title }, heading, content);
}

export function buildTaskDocument({ breadcrumb, heading, properties, sections, label, done }) {
  const state = h('span', { class: `task-page-status${done ? ' is-done' : ''}` },
    h('span', { class: 'task-status-dot', 'aria-hidden': 'true' }), done ? '已完成' : '未完成');
  const hero = h('header', { class: 'task-page-hero' },
    h('div', { class: 'task-page-kicker' }, h('span', {}, label), state), heading);
  return h('article', { class: 'task-document', 'aria-label': '任务详情' }, breadcrumb, hero,
    h('section', { class: 'task-properties-section task-region', 'aria-label': '任务属性' },
      h('h2', { class: 'task-section-title' }, '任务属性'), properties), ...sections);
}
