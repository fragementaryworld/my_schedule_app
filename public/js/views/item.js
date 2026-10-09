'use strict';
import { api } from '../api.js';
import { h, toast, confirmDialog, scrollPos, restoreScroll } from '../ui.js';
import { escapeHtml } from '../utils.js';
import { DEFAULT_TASK_NAME, itemBase, itemHref, createChild } from './projects.js';
import { buildBlocksEditor } from './page.js';
import { buildDateField, formatDateValue } from '../datepicker.js';

// 任务最多 5 层：任务 → 子任务 → 子子任务 → …
export const MAX_ITEM_DEPTH = 5;
const LEVEL_NAMES = ['任务', '子任务', '子子任务', '第 4 层', '第 5 层'];

export function levelName(depth) {
  return LEVEL_NAMES[depth - 1] || `第 ${depth} 层`;
}

export function childLevelName(depth) {
  return levelName(depth + 1);
}

// 新建后还没填内容
export function isFreshItem(item) {
  if (!item) return false;
  return item.title === DEFAULT_TASK_NAME
    && !(item.subtasks || []).length
    && !(item.blocks || []).length
    && !item.startDate
    && !item.dueDate;
}

// 按链取回每一层的节点（含最后一项），任意一层缺失则返回 []
export function chainNodes(project, chain) {
  if (!project || !Array.isArray(chain) || !chain.length) return [];
  const out = [];
  let list = project.tasks || [];
  for (const id of chain) {
    const node = list.find((x) => x.id === id);
    if (!node) return [];
    out.push(node);
    list = node.subtasks || [];
  }
  return out;
}

export function resolveChain(project, chain) {
  const nodes = chainNodes(project, chain);
  return nodes.length ? nodes[nodes.length - 1] : null;
}

let el = null;
let projectId = null;
let chain = [];
let titleEl = null;

export async function render(container, params = {}) {
  el = container;
  projectId = params.id || null;
  chain = Array.isArray(params.chain) ? params.chain.filter(Boolean) : [];
  await paint();
}

async function paint() {
  if (!el) return;
  const pos = scrollPos();
  // 先取数据，再一次性重建，避免中途出现空页面把滚动条弹回顶部
  const projects = await api.get('/api/projects');
  const project = projects.find((x) => x.id === projectId);
  const nodes = chainNodes(project, chain);
  const item = nodes.length ? nodes[nodes.length - 1] : null;
  titleEl = null;
  el.innerHTML = '';
  try {
    if (!project || !item) {
      el.append(h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, '📋'), h('p', {}, '内容不存在或已删除。')));
      return;
    }
    const depth = chain.length;
    el.append(buildBreadcrumb(project, nodes));
    el.append(buildHead(project, item, chain));
    el.append(buildItemProperties(project, item, chain));
    el.append(h('div', { class: 'page-section' }, '📝 内容'));
    el.append(buildBlocksEditor(item, itemBase(projectId, chain), paint));
    el.append(h('div', { class: 'page-section' }, `📄 ${childLevelName(depth)}`));
    el.append(buildChildren(project, item, chain, depth));
    if (isFreshItem(item)) focusTitle();
  } finally {
    restoreScroll(pos);
  }
}

export function buildBreadcrumb(project, nodes) {
  const ids = nodes.map((n) => n.id);
  const bar = h('div', { class: 'breadcrumb' });
  bar.append(h('a', { href: '#/projects', class: 'crumb' }, '项目'));
  bar.append(h('span', { class: 'crumb-sep' }, '/'));
  bar.append(h('a', { href: `#/page/${project.id}`, class: 'crumb' }, `${project.icon || '📁'} ${escapeHtml(project.name)}`));

  nodes.forEach((node, i) => {
    bar.append(h('span', { class: 'crumb-sep' }, '/'));
    if (i === nodes.length - 1) {
      bar.append(h('span', { class: 'crumb current' }, `${levelName(i + 1)}：${escapeHtml(node.title)}`));
    } else {
      bar.append(h('a', { href: itemHref(project.id, ids.slice(0, i + 1)), class: 'crumb' }, escapeHtml(node.title)));
    }
  });

  bar.append(h('span', { class: 'spacer' }));
  const current = nodes[nodes.length - 1];
  const del = h('button', { class: 'btn btn-sm btn-danger' }, `🗑 删除${levelName(nodes.length)}`);
  del.onclick = async () => {
    if (await confirmDialog(`确认删除「${current.title}」？其下级会一并删除。`, { danger: true })) {
      await api.del(itemBase(project.id, ids));
      toast('已删除');
      location.hash = ids.length > 1
        ? itemHref(project.id, ids.slice(0, -1))
        : `#/page/${project.id}`;
    }
  };
  bar.append(del);
  return bar;
}

function buildHead(project, item, itemChain) {
  const wrap = h('div', { class: 'page-head' });
  const base = itemBase(project.id, itemChain);

  const cb = h('input', { type: 'checkbox', class: 'task-check', style: 'width:22px;height:22px' });
  cb.checked = !!item.done;
  cb.onclick = async () => {
    await api.put(base, { done: !item.done });
    item.done = !item.done;
    await paint();
  };
  wrap.append(cb);

  const title = h('h1', {
    class: 'page-title' + (item.done ? ' done-title' : ''),
    contenteditable: 'true',
    spellcheck: 'false',
    title: '点击直接编辑'
  });
  title.textContent = item.title;
  title.addEventListener('blur', async () => {
    const next = title.textContent.trim();
    if (!next) { title.textContent = item.title; return; }
    if (next !== item.title) {
      await api.put(base, { title: next });
      item.title = next;
      toast('已保存');
      await paint();
    }
  });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  wrap.append(title);
  titleEl = title;
  return wrap;
}

export function buildItemProperties(project, item, itemChain) {
  const card = h('div', { class: 'page-props' });
  const row = (label, ctrl) => h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, label), ctrl);
  const base = itemBase(project.id, itemChain);

  const doneSel = h('select', { class: 'input inline-select' });
  doneSel.append(h('option', { value: 'no' }, '未完成'));
  doneSel.append(h('option', { value: 'yes' }, '已完成'));
  doneSel.value = item.done ? 'yes' : 'no';
  doneSel.onchange = async () => {
    await api.put(base, { done: doneSel.value === 'yes' });
    toast('已保存');
    await paint();
  };

  const dateField = buildDateField({
    value: item,
    onSave: async (patch) => {
      await api.put(base, patch);
      Object.assign(item, patch);
      toast('时间已更新');
    }
  });

  const kids = (item.subtasks || []).length;
  card.append(
    row('状态', doneSel),
    row('时间', dateField),
    row('层级', h('span', { class: 'small muted' }, `${itemChain.length} / ${MAX_ITEM_DEPTH}`)),
    row('下级', h('span', { class: 'small muted' }, kids ? `${kids} 项` : '无'))
  );
  return card;
}

export function buildChildren(project, item, itemChain, depth) {
  const wrap = h('div', { class: 'card', style: 'padding:12px 16px' });
  const list = h('div', {});
  const base = itemBase(project.id, itemChain);
  const children = item.subtasks || [];

  if (!children.length) list.append(h('p', { class: 'muted' }, `还没有${childLevelName(depth)}。`));

  for (const child of children) {
    const row = h('div', { class: 'row', style: 'padding:4px 0' });

    const cb = h('input', { type: 'checkbox', class: 'task-check subtask-check' });
    cb.checked = !!child.done;
    cb.onclick = async () => {
      await api.put(`${base}/subtasks/${child.id}`, { done: !child.done });
      child.done = !child.done;
      await paint();
    };
    row.append(cb);

    const link = h('span', {
      class: 'row-link',
      style: `flex:1;${child.done ? 'text-decoration:line-through;color:var(--muted)' : ''}`
    }, escapeHtml(child.title));
    link.onclick = () => { location.hash = itemHref(project.id, [...itemChain, child.id]); };
    row.append(link);

    if (child.dueDate) row.append(h('span', { class: 'small muted' }, formatDateValue(child)));
    const grand = (child.subtasks || []).length;
    if (grand) row.append(h('span', { class: 'small muted' }, `下级 ${grand} 项`));

    const del = h('button', { class: 'icon-btn danger', title: '删除' }, '🗑');
    del.onclick = async () => {
      if (await confirmDialog(`删除「${child.title}」及其下级？`, { danger: true })) {
        await api.del(`${base}/subtasks/${child.id}`);
        item.subtasks = (item.subtasks || []).filter((x) => x.id !== child.id);
        await paint();
      }
    };
    row.append(del);
    list.append(row);
  }
  wrap.append(list);

  if (depth >= MAX_ITEM_DEPTH) {
    wrap.append(h('div', { class: 'small muted', style: 'margin-top:8px' }, `已达最大层级（${MAX_ITEM_DEPTH} 层），不能再添加下级。`));
  } else {
    wrap.append(h('button', {
      class: 'btn btn-primary btn-sm add-child-btn',
      style: 'margin-top:8px',
      onclick: () => createChild(project.id, itemChain)
    }, `＋ 新增${childLevelName(depth)}`));
  }
  return wrap;
}

function focusTitle() {
  if (!titleEl || !titleEl.focus) return;
  titleEl.focus();
}

export async function add() {
  if (!projectId || !chain.length) return;
  if (chain.length >= MAX_ITEM_DEPTH) { toast(`已达最大层级（${MAX_ITEM_DEPTH} 层）`, 'error'); return; }
  await createChild(projectId, chain);
}
