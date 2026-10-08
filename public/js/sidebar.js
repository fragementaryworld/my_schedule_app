'use strict';
import { api } from './api.js';
import { h, toast } from './ui.js';
import { buildPageTree, pageAncestors } from './views/page.js';

const expanded = new Set();

function currentPageId() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return parts[0] === 'page' ? parts[1] || null : null;
}

export async function renderPageTree() {
  const box = document.getElementById('pageTree');
  if (!box) return;
  let projects = [];
  try {
    projects = await api.get('/api/projects');
  } catch (e) {
    return;
  }
  const activeId = currentPageId();
  if (activeId) for (const anc of pageAncestors(projects, activeId)) expanded.add(anc.id);

  box.innerHTML = '';
  box.append(h('div', { class: 'tree-head' },
    h('span', {}, '页面'),
    h('button', { class: 'icon-btn', title: '新建页面', onclick: () => createPage(null) }, '＋')));

  const tree = buildPageTree(projects);
  if (!tree.length) {
    box.append(h('div', { class: 'tree-empty small muted' }, '暂无页面'));
    return;
  }
  const list = h('div', { class: 'tree-list' });
  for (const node of tree) list.append(renderNode(node, 0, activeId));
  box.append(list);
}

function renderNode(node, depth, activeId) {
  const wrap = h('div', { class: 'tree-node' });
  const row = h('div', { class: 'tree-row', style: `padding-left:${6 + depth * 14}px` });
  const hasKids = node.children.length > 0;
  const isOpen = expanded.has(node.page.id);

  const caret = h('span', { class: 'tree-caret' }, hasKids ? (isOpen ? '▾' : '▸') : '·');
  caret.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!hasKids) return;
    if (expanded.has(node.page.id)) expanded.delete(node.page.id);
    else expanded.add(node.page.id);
    renderPageTree();
  };
  row.append(caret);

  row.append(h('a', {
    class: 'tree-link' + (node.page.id === activeId ? ' active' : ''),
    href: `#/page/${node.page.id}`,
    title: node.page.name
  }, `${node.page.icon || '📄'} ${node.page.name}`));

  const addBtn = h('button', { class: 'icon-btn tree-add', title: '新建子页面' }, '＋');
  addBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    createPage(node.page.id);
  };
  row.append(addBtn);
  wrap.append(row);

  if (hasKids && isOpen) {
    for (const kid of node.children) wrap.append(renderNode(kid, depth + 1, activeId));
  }
  return wrap;
}

export async function createPage(parentId) {
  const created = await api.post('/api/projects', { name: '新页面', parentId: parentId || null });
  if (parentId) expanded.add(parentId);
  toast('已新建页面');
  await renderPageTree();
  location.hash = `#/page/${created.id}`;
}
