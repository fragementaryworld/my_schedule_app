import { beginRender } from '../view-lifecycle.js';
'use strict';
import { api } from '../api.js';
import { h, toast, confirmDialog, scrollPos, restoreScroll, focusSnapshot, focusRestore } from '../ui.js';
import { PROJECT_STATUS } from '../utils.js';
import { renderMarkdown } from '../markdown.js';
import { buildDateField } from '../datepicker.js';
import { registerEditor, serializeSave } from '../saving.js';
import { buildProjectTasksSection, collectOwners, blockedByOptions, DEFAULT_PAGE_NAME, createProject } from './projects.js';

let el = null;
let pageId = null;
let titleEl = null;
const blockEls = new Map();

// 内容编辑状态：正在编辑哪一块、光标在哪 —— 用来在整页重绘后接着编辑
const editState = { key: null, caret: null };

// 取当前光标在节点内的字符偏移（拿不到就返回 null）
export function caretOffset(node, win = typeof window === 'undefined' ? null : window) {
  const sel = win && win.getSelection ? win.getSelection() : null;
  if (!sel || !sel.rangeCount || !node || !node.contains || !node.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(node);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

// 把光标放回指定偏移（offset 为空则放到末尾）
export function setCaret(node, offset, win = typeof window === 'undefined' ? null : window) {
  const doc = typeof document === 'undefined' ? null : document;
  const sel = win && win.getSelection ? win.getSelection() : null;
  if (!sel || !doc || !doc.createRange || !node) return;
  const len = String(node.textContent || '').length;
  const at = Math.max(0, Math.min(typeof offset === 'number' ? offset : len, len));
  const range = doc.createRange();
  const text = node.firstChild;
  if (text && text.nodeType === 3) range.setStart(text, Math.min(at, text.textContent.length));
  else range.setStart(node, 0);
  range.collapse(true);
  if (sel.removeAllRanges) sel.removeAllRanges();
  sel.addRange(range);
}

// 重绘后：回到刚才正在编辑的那一块，并把光标放回原处
export function restoreBlockEditing() {
  if (!editState.key) return;
  const pair = blockEls.get(editState.key);
  if (!pair) { editState.key = null; return; }
  if (pair.display) pair.display.style.display = 'none';
  if (pair.editable) {
    pair.editable.style.display = '';
    if (pair.editable.focus) pair.editable.focus();
    setCaret(pair.editable, editState.caret);
  }
}

// ——— 内容：整篇一个 Markdown 编辑框 ———
const contentEls = new Map();
const contentEdit = { key: null, caret: null };

export function clearContentEditors() {
  contentEls.clear();
}

// 重绘后：如果刚才正在写内容，回到编辑态并恢复光标
export function restoreContentEditing() {
  if (!contentEdit.key) return;
  const item = contentEls.get(contentEdit.key);
  if (!item) { contentEdit.key = null; return; }
  item.enterEdit();
}

// 单个 Markdown 编辑框：平时渲染 Markdown，点击进入编辑；边打字边自动保存
export function buildContentEditor({ value, onSave, key, placeholder = '写点什么，支持 Markdown…', debounceMs = 700 }) {
  let current = value || '';
  const wrap = h('div', { class: 'md-content' });
  const display = h('div', {
    class: 'feed-goal-md md-content-view',
    html: renderMarkdown(current),
    'data-placeholder': placeholder
  });
  const edit = h('div', {
    class: 'feed-goal md-content-input',
    contenteditable: 'true',
    spellcheck: 'false',
    'data-focus-key': key
  });
  edit.textContent = current;
  edit.style.display = 'none';

  let timer = null;
  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const save = serializeSave(async (silent) => {
    const next = edit.textContent;
    if (next === current) return;
    await onSave(next);
    current = next;
    if (!silent) toast('已保存');
  });

  const enterEdit = () => {
    display.style.display = 'none';
    edit.style.display = '';
    edit.textContent = current;
    contentEdit.key = key;
    if (edit.focus) edit.focus();
    setCaret(edit, contentEdit.caret);
  };
  display.onclick = enterEdit;
  contentEls.set(key, { enterEdit, edit, display });
  registerEditor(edit, () => { cancel(); return save(true); });

  edit.addEventListener('input', () => {
    contentEdit.caret = caretOffset(edit);
    cancel();
    timer = setTimeout(() => {
      timer = null;
      save(true).catch((err) => toast(err.message, 'error'));
    }, debounceMs);
  });
  edit.addEventListener('blur', async () => {
    cancel();
    try { await save(false); }
    catch (err) { toast(err.message, 'error'); return; }
    contentEdit.key = null;
    contentEdit.caret = null;
    display.innerHTML = renderMarkdown(current);
    edit.style.display = 'none';
    display.style.display = '';
  });

  wrap.append(display, edit);
  return wrap;
}

// 新建后尚未填写内容的页面
export function isFreshPage(page) {
  if (!page) return false;
  return page.name === DEFAULT_PAGE_NAME && !String(page.desc || '').trim() && !String(page.goal || '').trim();
}

export async function render(container, params = {}) {
  el = container;
  pageId = params.id || null;
  await paint();
}

async function paint() {
  const container = el; // 进入时就固定容器，避免旧的异步重绘写进新页面
  const active = beginRender(container);
  if (!active()) return;
  const pos = scrollPos();
  const focus = focusSnapshot();
  // 先取数据，再一次性重建，避免中途出现空页面把滚动条弹回顶部
  const requestedId = pageId;
  const projects = await api.get('/api/projects');
  if (!active()) return;
  const page = projects.find((x) => x.id === requestedId);
  blockEls.clear();
  clearContentEditors();
  titleEl = null;
  container.innerHTML = '';
  try {
    if (!page) {
      container.append(h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, '📄'), h('p', {}, '页面不存在或已删除。')));
      return;
    }
    container.append(buildBreadcrumb(page));
    container.append(buildIconTitle(page));
    container.append(buildPageProperties(projects, page));
    container.append(h('div', { class: 'page-section' }, '📝 内容'));
    container.append(buildContentEditor({
      value: page.desc,
      key: `project:${page.id}:content`,
      onSave: async (text) => {
        await api.put(`/api/projects/${page.id}`, { desc: text });
        page.desc = text;
      }
    }));
    container.append(h('div', { class: 'page-section' }, '✅ 任务'));
    container.append(buildProjectTasksSection(page, paint));

    if (isFreshPage(page)) focusTitle();
  } finally {
    restoreScroll(pos);
    focusRestore(focus);
    restoreBlockEditing();
    restoreContentEditing(); // 内容区：重绘后回到刚在写的地方并恢复光标
  }
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
  bar.append(h('span', { class: 'crumb current' }, `${page.icon || '📁'} ${page.name}`));
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

export function buildPageProperties(projects, page) {
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

  const dateField = buildDateField({
    value: page,
    onSave: async (patch) => {
      await api.put(`/api/projects/${page.id}`, patch);
      Object.assign(page, patch);
      toast('时间已更新');
    }
  });

  const blockedSel = h('select', { class: 'input inline-select' });
  for (const o of blockedByOptions(projects, page.blockedBy || '', page.id)) blockedSel.append(h('option', { value: o.value }, o.label));
  blockedSel.value = page.blockedBy || '';
  blockedSel.onchange = async () => { await api.put(`/api/projects/${page.id}`, { blockedBy: blockedSel.value }); toast('已保存'); paint(); };

  card.append(
    row('状态', statusSel),
    row('优先级', prioSel),
    row('负责人', h('span', { class: 'row' }, ownerInput, dl)),
    row('时间', dateField),
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
    editState.key = block.id;
    editState.caret = null;
    if (editable.focus) editable.focus();
  };
  display.onclick = enterEdit;
  blockEls.set(block.id, { display, editable });

  // 边打字边保存：页面里任何别的保存都会整页重绘，
  // 只靠失焦保存的话，重绘会把还没保存的字直接丢掉。
  let saveTimer = null;
  const saveText = async (silent = true) => {
    const next = editable.textContent;
    if (next === (block.text || '')) return;
    await api.put(`${base}/blocks/${block.id}`, { text: next });
    block.text = next;
    if (!silent) toast('已保存');
  };
  const cancelSave = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  };

  editable.addEventListener('input', () => {
    editState.caret = caretOffset(editable);
    cancelSave();
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveText(true);
    }, 700);
  });

  editable.addEventListener('blur', async () => {
    cancelSave();
    await saveText(false);
    editState.key = null;
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
