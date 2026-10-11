import { itemBase, itemHref } from '../task-model.js';
import { beginRender } from '../view-lifecycle.js';
import { buildPlanProperty } from '../planning.js';
'use strict';
import { api } from '../api.js';
import { h, toast, confirmDialog, scrollPos, restoreScroll, focusSnapshot, focusRestore } from '../ui.js';
import { buildEstimateField } from '../estimate.js';
import { DEFAULT_TASK_NAME, createChild, buildChildViews } from './projects.js';
import { restoreBlockEditing, buildContentEditor, restoreContentEditing, clearContentEditors } from './page.js';
import { buildDateField } from '../datepicker.js';

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
    && !String(item.desc || '').trim()
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
  const container = el; // 进入时就固定容器，避免旧的异步重绘写进新页面
  const active = beginRender(container);
  if (!active()) return;
  const pos = scrollPos();
  const focus = focusSnapshot();
  // 先取数据，再一次性重建，避免中途出现空页面把滚动条弹回顶部
  const requestedProject = projectId;
  const requestedChain = [...chain];
  const projects = await api.get('/api/projects');
  if (!active()) return;
  const project = projects.find((x) => x.id === requestedProject);
  const nodes = chainNodes(project, requestedChain);
  const item = nodes.length ? nodes[nodes.length - 1] : null;
  titleEl = null;
  clearContentEditors();
  container.innerHTML = '';
  try {
    if (!project || !item) {
      container.append(h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, '📋'), h('p', {}, '内容不存在或已删除。')));
      return;
    }
    const depth = requestedChain.length;
    container.append(buildBreadcrumb(project, nodes));
    container.append(buildHead(project, item, requestedChain));
    container.append(buildItemProperties(project, item, requestedChain));
    container.append(h('div', { class: 'page-section' }, '📝 内容'));
    const contentBase = itemBase(project.id, nodes.map(node => node.id));
    container.append(buildContentEditor({
      value: item.desc,
      key: `${contentBase}:content`,
      onSave: async (text) => {
        await api.put(contentBase, { desc: text });
        item.desc = text;
      }
    }));
    container.append(h('div', { class: 'page-section' }, `📄 ${childLevelName(depth)}`));
    container.append(buildChildren(project, item, requestedChain, depth));
    if (isFreshItem(item)) focusTitle();
  } finally {
    restoreScroll(pos);
    focusRestore(focus);
    restoreBlockEditing();
    restoreContentEditing(); // 内容区：重绘后回到刚在写的地方并恢复光标
  }
}

export function buildBreadcrumb(project, nodes) {
  const ids = nodes.map((n) => n.id);
  const bar = h('div', { class: 'breadcrumb' });
  bar.append(h('a', { href: '#/projects', class: 'crumb' }, '项目'));
  bar.append(h('span', { class: 'crumb-sep' }, '/'));
  bar.append(h('a', { href: `#/page/${project.id}`, class: 'crumb' }, `${project.icon || '📁'} ${project.name}`));

  nodes.forEach((node, i) => {
    bar.append(h('span', { class: 'crumb-sep' }, '/'));
    if (i === nodes.length - 1) {
      bar.append(h('span', { class: 'crumb current' }, `${levelName(i + 1)}：${node.title}`));
    } else {
      bar.append(h('a', { href: itemHref(project.id, ids.slice(0, i + 1)), class: 'crumb' }, node.title));
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
    title: '点击直接编辑',
    'data-focus-key': `${base}:title`
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
  const base = itemBase(project.id, itemChain);
  // 第三参是"重绘后要恢复焦点"的稳定键
  const row = (label, ctrl, key) => {
    if (key && ctrl && ctrl.setAttribute) ctrl.setAttribute('data-focus-key', key);
    return h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, label), ctrl);
  };

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
    key: `${base}:date`,
    onSave: async (patch) => {
      await api.put(base, patch);
      Object.assign(item, patch);
      toast('时间已更新');
    }
  });

  const kids = (item.subtasks || []).length;
  card.append(
    row('状态', doneSel, `${base}:done`),
    row('时间', dateField),
    row('当天安排', buildPlanProperty(item, base, async (_, patch) => { await api.put(base, patch); Object.assign(item, patch); await paint(); return true; })),
    row('预计用时', estimateSelect(item, base)),
    row('层级', h('span', { class: 'small muted' }, `${itemChain.length} / ${MAX_ITEM_DEPTH}`)),
    row('下级', h('span', { class: 'small muted' }, kids ? `${kids} 项` : '无'))
  );
  return card;
}

// 预计用时（手填小时），所有任务/子任务通用
export function estimateSelect(item, base) {
  return buildEstimateField({
    value: item && item.estimate,
    key: `${base}:estimate`,
    onSave: async (minutes) => {
      await api.put(base, { estimate: minutes });
      if (item) item.estimate = minutes;
      toast('已保存');
      // 这一页没有别处显示预计用时，无需整页重绘（重绘会打断正在输入的手感）
    }
  });
}

// 下级区块：与项目页任务区一致的标准四视图（表格 / 时间线 / 看板 / 信息流）
export function buildChildren(project, item, itemChain, depth) {
  const canAdd = depth < MAX_ITEM_DEPTH;
  return buildChildViews({
    projectId: project.id,
    parentChain: itemChain,
    items: item.subtasks || [],
    refresh: paint,
    rangeNode: item,
    canAdd,
    deep: true,             // 列出下级以及所有更低级任务
    defaultExpanded: true,  // 默认全部展开
    addLabel: `＋ 新增${childLevelName(depth)}`,
    onAdd: () => createChild(project.id, itemChain),
    emptyText: `还没有${childLevelName(depth)}。`,
    hint: canAdd ? '' : `已达最大层级（${MAX_ITEM_DEPTH} 层），不能再添加下级。`
  });
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
