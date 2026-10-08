'use strict';
import { api } from '../api.js';
import { h, toast, confirmDialog } from '../ui.js';
import { escapeHtml, PROJECT_STATUS } from '../utils.js';
import { buildProjectTasksSection, collectOwners, blockedByOptions, DEFAULT_PAGE_NAME } from './projects.js';

let el = null;
let pageId = null;
let titleEl = null;
const blockEls = new Map();

// 新建后尚未填写内容的页面
export function isFreshPage(page) {
  if (!page) return false;
  return page.name === DEFAULT_PAGE_NAME && !(page.blocks || []).length && !String(page.goal || '').trim();
}

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
  titleEl = null;
  el.innerHTML = '';
  const projects = await api.get('/api/projects');
  const page = projects.find((x) => x.id === pageId);
  if (!page) {
    el.append(h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, '📄'), h('p', {}, '页面不存在或已删除。')));
    return;
  }
  el.append(buildBreadcrumb(page));
  el.append(buildCover(page));
  el.append(buildIconTitle(page));
  el.append(buildProperties(projects, page));
  el.append(h('div', { class: 'page-section' }, '📝 内容'));
  el.append(buildBlocksEditor(page));
  el.append(h('div', { class: 'page-section' }, '📄 子页面'));
  el.append(buildSubpages(projects, page));
  el.append(h('div', { class: 'page-section' }, '✅ 任务'));
  el.append(buildProjectTasksSection(page, paint));

  if (isFreshPage(page)) focusTitle();
}

// 新建页面时自动聚焦标题，方便直接输入
function focusTitle() {
  if (!titleEl || !titleEl.focus) return;
  titleEl.focus();
  try {
    if (typeof window === 'undefined' || !window.getSelection || !document.createRange) return;
    const range = document.createRange();
    range.selectNodeContents(titleEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (e) {
    /* 选区失败不影响输入 */
  }
}

function buildBreadcrumb(page) {
  const bar = h('div', { class: 'breadcrumb' });
  bar.append(h('a', { href: '#/projects', class: 'crumb' }, '项目'));
  bar.append(h('span', { class: 'crumb-sep' }, '/'));
  bar.append(h('span', { class: 'crumb current' }, `${page.icon || '📁'} ${escapeHtml(page.name)}`));
  bar.append(h('span', { class: 'spacer' }));

  const del = h('button', { class: 'btn btn-sm btn-danger' }, '🗑 删除页面');
  del.onclick = async () => {
    if (await confirmDialog(`确认删除「${page.name}」？此操作不可恢复。`, { danger: true })) {
      await api.del(`/api/projects/${page.id}`);
      toast('已删除');
      location.hash = '#/projects';
    }
  };
  bar.append(del);
  return bar;
}

export const PAGE_ICONS = ['📁', '📘', '📗', '📙', '📕', '📄', '📝', '✅', '💡', '🎯', '🚀', '⚙️', '📊', '🧪', '🏠', '❤️', '⭐', '🔥'];

export const PAGE_COVERS = [
  { key: 'none', label: '无', css: '' },
  { key: 'blue', label: '蓝', css: 'linear-gradient(135deg,#4f6ef7,#9b6cf7)' },
  { key: 'green', label: '绿', css: 'linear-gradient(135deg,#16a34a,#84cc16)' },
  { key: 'orange', label: '橙', css: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
  { key: 'violet', label: '紫', css: 'linear-gradient(135deg,#8b5cf6,#ec4899)' },
  { key: 'slate', label: '灰', css: 'linear-gradient(135deg,#64748b,#94a3b8)' }
];

export function coverCss(key) {
  const c = PAGE_COVERS.find((x) => x.key === key);
  return c ? c.css : '';
}

export function buildCover(page) {
  const wrap = h('div', { class: 'page-cover-wrap' });
  const css = coverCss(page.cover);
  let paletteEl = null;

  if (css) wrap.append(h('div', { class: 'page-cover', style: `background:${css}` }));

  const btn = h('button', { class: 'btn btn-sm page-cover-btn' }, css ? '更换封面' : '添加封面');
  btn.onclick = () => {
    if (paletteEl) { paletteEl.remove(); paletteEl = null; return; }
    paletteEl = h('div', { class: 'cover-palette' });
    for (const c of PAGE_COVERS) {
      const sw = h('button', {
        class: 'cover-swatch',
        title: c.label,
        style: c.css ? `background:${c.css}` : 'background:var(--panel-2)'
      }, c.css ? '' : '无');
      sw.onclick = async () => {
        await api.put(`/api/projects/${page.id}`, { cover: c.key });
        toast('封面已更新');
        paint();
      };
      paletteEl.append(sw);
    }
    wrap.append(paletteEl);
  };
  wrap.append(btn);
  return wrap;
}

export function buildIconTitle(page) {
  const wrap = h('div', { class: 'page-head' });
  let pickerEl = null;

  const iconBtn = h('button', { class: 'page-icon', title: '修改图标' }, page.icon || '📁');
  iconBtn.onclick = () => {
    if (pickerEl) { pickerEl.remove(); pickerEl = null; return; }
    pickerEl = h('div', { class: 'icon-picker' });
    for (const emoji of PAGE_ICONS) {
      const b = h('button', { class: 'icon-choice' }, emoji);
      b.onclick = async () => {
        await api.put(`/api/projects/${page.id}`, { icon: emoji });
        toast('图标已更新');
        paint();
      };
      pickerEl.append(b);
    }
    const custom = h('input', { class: 'input inline-input', placeholder: '自定义', style: 'width:80px' });
    custom.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && custom.value.trim()) {
        await api.put(`/api/projects/${page.id}`, { icon: custom.value.trim() });
        toast('图标已更新');
        paint();
      }
    });
    pickerEl.append(custom);
    wrap.append(pickerEl);
  };
  wrap.append(iconBtn);

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
  titleEl = title;
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

export const BLOCK_TYPE_OPTIONS = [
  ['text', '正文'], ['h1', '标题1'], ['h2', '标题2'], ['h3', '标题3'],
  ['todo', '待办'], ['bullet', '无序列表'], ['number', '有序列表'], ['quote', '引用'], ['divider', '分割线']
];

// 把 dragId 移动到 targetId 之前/之后，返回新顺序
export function reorderIds(ids, dragId, targetId, before = true) {
  const list = (ids || []).filter((x) => x !== dragId);
  const idx = list.indexOf(targetId);
  if (idx < 0) return (ids || []).slice();
  list.splice(before ? idx : idx + 1, 0, dragId);
  return list;
}

// 依据指针在目标行中的位置判断插入到前面还是后面
export function dropPosition(clientY, rectTop, rectHeight) {
  if (!rectHeight) return 'before';
  return clientY < rectTop + rectHeight / 2 ? 'before' : 'after';
}

function rowRect(node) {
  const r = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
  return r || { top: 0, height: 0 };
}

function buildTypeSelect(page, block) {
  const sel = h('select', { class: 'block-type-select', title: '转换类型' });
  for (const [v, label] of BLOCK_TYPE_OPTIONS) sel.append(h('option', { value: v }, label));
  sel.value = block.type;
  sel.onchange = async () => {
    await api.put(`/api/projects/${page.id}/blocks/${block.id}`, { type: sel.value });
    await paint();
  };
  return sel;
}

function buildBlockEl(page, block, index, blocks) {
  const row = h('div', { class: `block-row block-row-${block.type}`, dataset: { blockId: block.id }, draggable: 'true' });

  row.addEventListener('dragstart', (e) => { if (e.dataTransfer) e.dataTransfer.setData('text/plain', block.id); });
  row.addEventListener('dragover', (e) => { if (e.preventDefault) e.preventDefault(); row.classList.add('drop-target'); });
  row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
  row.addEventListener('drop', async (e) => {
    if (e.preventDefault) e.preventDefault();
    row.classList.remove('drop-target');
    const dragId = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
    if (!dragId || dragId === block.id) return;
    const rect = rowRect(row);
    const before = dropPosition(e.clientY || 0, rect.top, rect.height) === 'before';
    const order = reorderIds(blocks.map((b) => b.id), dragId, block.id, before);
    await api.put(`/api/projects/${page.id}/blocks`, { order });
    await paint();
  });

  if (block.type === 'divider') {
    row.append(h('div', { class: 'block-divider' }));
    row.append(buildTypeSelect(page, block));
    return row;
  }

  const marker = blockMarker(block, index);
  if (marker) {
    const isTodo = block.type === 'todo';
    const m = h('span', { class: 'block-marker' + (isTodo ? ' clickable' : '') }, marker);
    if (isTodo) {
      m.onclick = async () => {
        await api.put(`/api/projects/${page.id}/blocks/${block.id}`, { checked: !block.checked });
        block.checked = !block.checked;
        await paint();
      };
    }
    row.append(m);
  }

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

  row.append(editable, buildTypeSelect(page, block));
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
