'use strict';
import { api } from '../api.js';
import { h, toast, confirmDialog } from '../ui.js';
import { escapeHtml, PROJECT_STATUS } from '../utils.js';
import { renderMarkdown } from '../markdown.js';
import { buildProjectTasksSection, collectOwners, blockedByOptions, DEFAULT_PAGE_NAME, createProject } from './projects.js';

let el = null;
let pageId = null;
let titleEl = null;
const blockEls = new Map();

// 新建后尚未填写内容的页面
export function isFreshPage(page) {
  if (!page) return false;
  return page.name === DEFAULT_PAGE_NAME && !(page.blocks || []).length && !String(page.goal || '').trim();
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
  el.append(buildIconTitle(page));
  el.append(buildProperties(projects, page));
  el.append(h('div', { class: 'page-section' }, '📝 内容'));
  el.append(buildBlocksEditor(page, `/api/projects/${page.id}`, paint));
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
// owner：持有 blocks 的对象（页面或任务）；basePath：其 API 基础路径；onRefresh：保存后刷新
export function buildBlocksEditor(owner, basePath, onRefresh) {
  const base = basePath || `/api/projects/${owner.id}`;
  const refresh = typeof onRefresh === 'function' ? onRefresh : paint;
  const wrap = h('div', { class: 'page-blocks editor' });
  const blocks = owner.blocks || [];

  if (!blocks.length) {
    const add = h('div', { class: 'block-add-hint' }, '＋ 点击添加内容');
    add.onclick = async () => {
      const created = await api.post(`${base}/blocks`, { type: 'text', text: '' });
      await refresh();
      focusBlock(created && created.id);
    };
    wrap.append(add);
    return wrap;
  }

  for (let i = 0; i < blocks.length; i++) wrap.append(buildBlockEl(owner, blocks[i], i, blocks, base, refresh));
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

function buildTypeSelect(base, refresh, block) {
  const sel = h('select', { class: 'block-type-select', title: '转换类型' });
  for (const [v, label] of BLOCK_TYPE_OPTIONS) sel.append(h('option', { value: v }, label));
  sel.value = block.type;
  sel.onchange = async () => {
    await api.put(`${base}/blocks/${block.id}`, { type: sel.value });
    await refresh();
  };
  return sel;
}

function buildBlockEl(owner, block, index, blocks, base, refresh) {
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
    await api.put(`${base}/blocks`, { order });
    await refresh();
  });

  if (block.type === 'divider') {
    row.append(h('div', { class: 'block-divider' }));
    row.append(buildTypeSelect(base, refresh, block));
    return row;
  }

  const marker = blockMarker(block, index);
  if (marker) {
    const isTodo = block.type === 'todo';
    const m = h('span', { class: 'block-marker' + (isTodo ? ' clickable' : '') }, marker);
    if (isTodo) {
      m.onclick = async () => {
        await api.put(`${base}/blocks/${block.id}`, { checked: !block.checked });
        block.checked = !block.checked;
        await refresh();
      };
    }
    row.append(m);
  }

  const editable = h('div', { class: `block block-${block.type} block-edit`, contenteditable: 'true', spellcheck: 'false' });
  editable.textContent = block.text || '';
  editable.style.display = 'none';

  // 显示层渲染 Markdown，点击进入编辑
  const display = h('div', {
    class: `block-md block-md-${block.type}`,
    html: renderMarkdown(block.text),
    'data-placeholder': '输入内容，支持 Markdown'
  });
  const enterEdit = () => {
    display.style.display = 'none';
    editable.style.display = '';
    editable.textContent = block.text || '';
    if (editable.focus) editable.focus();
  };
  display.onclick = enterEdit;
  blockEls.set(block.id, { display, editable });

  editable.addEventListener('blur', async () => {
    const next = editable.textContent;
    if (next !== (block.text || '')) {
      await api.put(`${base}/blocks/${block.id}`, { text: next });
      block.text = next;
      toast('已保存');
    }
    display.innerHTML = renderMarkdown(block.text || '');
    editable.style.display = 'none';
    display.style.display = '';
  });

  editable.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey && block.type !== 'quote') {
      e.preventDefault();
      const sameType = ['todo', 'bullet', 'number'].includes(block.type);
      const created = await api.post(`${base}/blocks`, {
        type: sameType ? block.type : 'text',
        text: '',
        afterId: block.id
      });
      await refresh();
      focusBlock(created && created.id);
    } else if (e.key === 'Backspace' && !editable.textContent && blocks.length > 1) {
      e.preventDefault();
      await api.del(`${base}/blocks/${block.id}`);
      const prev = blocks[index - 1];
      await refresh();
      if (prev) focusBlock(prev.id);
    }
  });

  row.append(display, editable, buildTypeSelect(base, refresh, block));
  return row;
}

function focusBlock(id) {
  if (!id) return;
  const pair = blockEls.get(id);
  if (!pair) return;
  if (pair.display) pair.display.style.display = 'none';
  if (pair.editable) {
    pair.editable.style.display = '';
    if (pair.editable.focus) pair.editable.focus();
  }
}

export async function add() {
  await createProject();
}
