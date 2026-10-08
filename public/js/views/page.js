'use strict';
import { api } from '../api.js';
import { h, toast } from '../ui.js';
import { escapeHtml, PROJECT_STATUS } from '../utils.js';
import { buildProjectTasksSection, collectOwners, blockedByOptions } from './projects.js';

let el = null;
let pageId = null;
const blockEls = new Map();

// 祖先页面（从根到父）
export function pageAncestors(projects, id) {
  const byId = new Map((projects || []).map((p) => [p.id, p]));
  const out = [];
  const seen = new Set();
  let cur = byId.get(id);
  while (cur && cur.parentId && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    out.unshift(parent);
    cur = parent;
  }
  return out;
}

export function pageChildren(projects, id) {
  return (projects || []).filter((p) => p.parentId === id);
}

export function pageBreadcrumb(projects, id) {
  const self = (projects || []).find((p) => p.id === id);
  return [...pageAncestors(projects, id), ...(self ? [self] : [])];
}

// 扁平项目列表 → 页面树（孤儿节点视为根）
export function buildPageTree(projects) {
  const byId = new Map();
  for (const p of projects || []) byId.set(p.id, { page: p, children: [] });
  const roots = [];
  for (const node of byId.values()) {
    const parentId = node.page.parentId;
    if (parentId && byId.has(parentId)) byId.get(parentId).children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function render(container, params = {}) {
  el = container;
  pageId = params.id || null;
  await paint();
}

async function paint() {
  if (!el) return;
  blockEls.clear();
  el.innerHTML = '';
  const projects = await api.get('/api/projects');
  const page = projects.find((x) => x.id === pageId);
  if (!page) {
    el.append(h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, '📄'), h('p', {}, '页面不存在或已删除。')));
    return;
  }
  el.append(buildBreadcrumb(projects, page));
  el.append(buildIconTitle(page));
  el.append(buildProperties(projects, page));
  el.append(h('div', { class: 'page-section' }, '📝 内容'));
  el.append(buildBlocksEditor(page));
  el.append(h('div', { class: 'page-section' }, '📄 子页面'));
  el.append(buildSubpages(projects, page));
  el.append(h('div', { class: 'page-section' }, '✅ 任务'));
  el.append(buildProjectTasksSection(page, paint));
}

function buildBreadcrumb(projects, page) {
  const bar = h('div', { class: 'breadcrumb' });
  bar.append(h('a', { href: '#/projects', class: 'crumb' }, '项目'));
  for (const anc of pageAncestors(projects, page.id)) {
    bar.append(h('span', { class: 'crumb-sep' }, '/'));
    bar.append(h('a', { href: `#/page/${anc.id}`, class: 'crumb' }, `${anc.icon || '📁'} ${escapeHtml(anc.name)}`));
  }
  bar.append(h('span', { class: 'crumb-sep' }, '/'));
  bar.append(h('span', { class: 'crumb current' }, `${page.icon || '📁'} ${escapeHtml(page.name)}`));
  return bar;
}

function buildIconTitle(page) {
  const wrap = h('div', { class: 'page-head' });

  const icon = h('input', { class: 'page-icon-input', value: page.icon || '📁', title: '修改图标' });
  icon.addEventListener('blur', async () => {
    const val = icon.value.trim() || '📁';
    if (val !== (page.icon || '📁')) {
      await api.put(`/api/projects/${page.id}`, { icon: val });
      toast('图标已更新');
      paint();
    }
  });
  icon.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); icon.blur(); } });
  wrap.append(icon);

  const title = h('h1', { class: 'page-title', contenteditable: 'true', spellcheck: 'false', title: '点击直接编辑标题' });
  title.textContent = page.name;
  title.addEventListener('blur', async () => {
    const next = title.textContent.trim();
    if (!next) { title.textContent = page.name; return; }
    if (next !== page.name) {
      await api.put(`/api/projects/${page.id}`, { name: next });
      toast('已保存');
      paint();
    }
  });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  wrap.append(title);
  return wrap;
}

function buildProperties(projects, page) {
  const card = h('div', { class: 'page-props' });
  const row = (label, ctrl) => h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, label), ctrl);

  const statusSel = h('select', { class: 'input inline-select' });
  for (const [k, v] of Object.entries(PROJECT_STATUS)) statusSel.append(h('option', { value: k }, v.label));
  statusSel.value = PROJECT_STATUS[page.status] ? page.status : 'active';
  statusSel.onchange = async () => { await api.put(`/api/projects/${page.id}`, { status: statusSel.value }); toast('已保存'); paint(); };

  const prioSel = h('select', { class: 'input inline-select' });
  for (const [k, v] of [['high', '高'], ['medium', '中'], ['low', '低']]) prioSel.append(h('option', { value: k }, v));
  prioSel.value = page.priority || 'medium';
  prioSel.onchange = async () => { await api.put(`/api/projects/${page.id}`, { priority: prioSel.value }); toast('已保存'); paint(); };

  const listId = `owner-list-${page.id}`;
  const ownerInput = h('input', { class: 'input inline-input', list: listId, value: page.owner || '', placeholder: '未指定' });
  const dl = h('datalist', { id: listId });
  for (const o of collectOwners(projects)) dl.append(h('option', { value: o }));
  ownerInput.addEventListener('blur', async () => {
    const val = ownerInput.value.trim();
    if (val !== (page.owner || '')) { await api.put(`/api/projects/${page.id}`, { owner: val }); toast('已保存'); paint(); }
  });

  const startInput = h('input', { type: 'date', class: 'input inline-input', value: page.startDate || '' });
  startInput.onchange = async () => { await api.put(`/api/projects/${page.id}`, { startDate: startInput.value }); toast('已保存'); paint(); };

  const dueInput = h('input', { type: 'date', class: 'input inline-input', value: page.dueDate || '' });
  dueInput.onchange = async () => { await api.put(`/api/projects/${page.id}`, { dueDate: dueInput.value || null }); toast('已保存'); paint(); };

  const blockedSel = h('select', { class: 'input inline-select' });
  for (const o of blockedByOptions(projects, page.blockedBy || '', page.id)) blockedSel.append(h('option', { value: o.value }, o.label));
  blockedSel.value = page.blockedBy || '';
  blockedSel.onchange = async () => { await api.put(`/api/projects/${page.id}`, { blockedBy: blockedSel.value }); toast('已保存'); paint(); };

  card.append(
    row('状态', statusSel),
    row('优先级', prioSel),
    row('负责人', h('span', { class: 'row' }, ownerInput, dl)),
    row('开始', startInput),
    row('截止', dueInput),
    row('阻塞', blockedSel)
  );
  return card;
}

// 内容块编辑器：就地编辑 / 回车新建 / 空块退格删除 / 失焦自动保存
export function buildBlocksEditor(page) {
  const wrap = h('div', { class: 'page-blocks editor' });
  const blocks = page.blocks || [];

  if (!blocks.length) {
    const add = h('div', { class: 'block-add-hint' }, '＋ 点击添加内容');
    add.onclick = async () => {
      const created = await api.post(`/api/projects/${page.id}/blocks`, { type: 'text', text: '' });
      await paint();
      focusBlock(created && created.id);
    };
    wrap.append(add);
    return wrap;
  }

  for (let i = 0; i < blocks.length; i++) wrap.append(buildBlockEl(page, blocks[i], i, blocks));
  return wrap;
}

function blockMarker(block, index) {
  if (block.type === 'todo') return block.checked ? '☑' : '☐';
  if (block.type === 'bullet') return '•';
  if (block.type === 'number') return `${index + 1}.`;
  return null;
}

function buildBlockEl(page, block, index, blocks) {
  const row = h('div', { class: `block-row block-row-${block.type}`, dataset: { blockId: block.id } });

  if (block.type === 'divider') {
    row.append(h('div', { class: 'block-divider' }));
    return row;
  }

  const marker = blockMarker(block, index);
  if (marker) row.append(h('span', { class: 'block-marker' }, marker));

  const editable = h('div', { class: `block block-${block.type}`, contenteditable: 'true', spellcheck: 'false' });
  editable.textContent = block.text || '';
  blockEls.set(block.id, editable);

  editable.addEventListener('blur', async () => {
    const next = editable.textContent;
    if (next !== (block.text || '')) {
      await api.put(`/api/projects/${page.id}/blocks/${block.id}`, { text: next });
      block.text = next;
      toast('已保存');
    }
  });

  editable.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey && block.type !== 'quote') {
      e.preventDefault();
      const sameType = ['todo', 'bullet', 'number'].includes(block.type);
      const created = await api.post(`/api/projects/${page.id}/blocks`, {
        type: sameType ? block.type : 'text',
        text: '',
        afterId: block.id
      });
      await paint();
      focusBlock(created && created.id);
    } else if (e.key === 'Backspace' && !editable.textContent && blocks.length > 1) {
      e.preventDefault();
      await api.del(`/api/projects/${page.id}/blocks/${block.id}`);
      const prev = blocks[index - 1];
      await paint();
      if (prev) focusBlock(prev.id);
    }
  });

  row.append(editable);
  return row;
}

function focusBlock(id) {
  if (!id) return;
  const node = blockEls.get(id);
  if (node && node.focus) node.focus();
}

function buildSubpages(projects, page) {
  const kids = pageChildren(projects, page.id);
  const wrap = h('div', { class: 'subpages' });
  if (!kids.length) {
    wrap.append(h('span', { class: 'small muted' }, '暂无子页面，点右下角「＋」新建。'));
  }
  for (const k of kids) {
    wrap.append(h('a', { class: 'subpage-item', href: `#/page/${k.id}` }, `${k.icon || '📄'} ${escapeHtml(k.name)}`));
  }
  return wrap;
}

export async function add() {
  if (!pageId) return;
  const created = await api.post('/api/projects', { name: '新页面', parentId: pageId });
  toast('已新建子页面');
  location.hash = `#/page/${created.id}`;
}
