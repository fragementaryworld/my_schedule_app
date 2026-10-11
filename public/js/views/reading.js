import { beginRender } from '../view-lifecycle.js';
'use strict';
import { api } from '../api.js';
import { h, toast, openModal, confirmDialog } from '../ui.js';
import { escapeHtml, BOOK_STATUS, todayStr, fmtDate } from '../utils.js';

let el = null;
let currentParams = {};
let currentTab = 'reading';

const TABS = [
  { value: 'want', label: '想读' },
  { value: 'reading', label: '在读' },
  { value: 'done', label: '读完' }
];

export function bookPercent(book) {
  if (!book) return 0;
  if (book.unit === 'percent') return Math.max(0, Math.min(100, Number(book.current) || 0));
  if (book.total) return Math.max(0, Math.min(100, Math.round((Number(book.current) || 0) / book.total * 100)));
  return 0;
}

export function bookProgressLabel(book) {
  if (!book) return '';
  if (book.unit === 'percent') return `${book.current || 0}%`;
  if (book.total) return `${book.current || 0}/${book.total} 页`;
  return `${book.current || 0} 页`;
}

export async function render(container, params = {}) {
  el = container;
  currentParams = params;
  if (params.id) await paintDetail(params.id);
  else await paintList();
}

async function paintList() {
  const container = el;
  const active = beginRender(container);
  if (!active()) return;
  container.innerHTML = '';
  const books = await api.get('/api/books');
  if (!active()) return;
  container.append(buildTabs());
  const shown = books.filter((b) => b.status === currentTab);
  if (!shown.length) {
    container.append(h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, '📚'), h('p', {}, '这里还没有书，点右下角「＋」添加。')));
  } else {
    container.append(h('div', { class: 'books-grid' }, ...shown.map(buildBookCard)));
  }
}

function buildTabs() {
  const bar = h('div', { class: 'tabbar' });
  for (const t of TABS) {
    const b = h('button', { class: 'tab' + (currentTab === t.value ? ' active' : '') }, t.label);
    b.onclick = () => { currentTab = t.value; paintList(); };
    bar.append(b);
  }
  return bar;
}

function buildBookCard(b) {
  const pct = bookPercent(b);
  const card = h('div', { class: 'card book-card' });
  card.onclick = () => { location.hash = `#/reading/${b.id}`; };
  card.append(h('div', { class: 'book-cover' }, (b.title || '书').slice(0, 1)));
  card.append(h('div', { style: 'font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, escapeHtml(b.title)));
  card.append(h('div', { class: 'small muted' }, b.author || '未知作者'));
  card.append(h('div', { class: 'row', style: 'margin-top:8px' },
    h('div', { class: 'progress', style: 'flex:1' }, h('i', { style: `width:${pct}%` })),
    h('span', { class: 'small muted' }, `${pct}%`)
  ));
  return card;
}

async function paintDetail(id) {
  const container = el;
  const active = beginRender(container);
  if (!active()) return;
  const books = await api.get('/api/books');
  if (!active()) return;
  const b = books.find((x) => x.id === id);
  if (!b) {
    container.innerHTML = '<div class="empty"><p>这本书不存在或已删除。</p></div>';
    return;
  }
  container.innerHTML = '';
  container.append(buildBookHead(b));
  container.append(buildBookProgress(b));
  container.append(buildReadingGoal(b));
  container.append(h('h3', { style: 'margin:20px 0 8px' }, '📝 笔记与摘录'));
  container.append(buildNotes(b));
  if (b.status === 'done') container.append(buildReview(b));
}

function buildBookHead(b) {
  const head = h('div', { class: 'detail-head' });
  const back = h('button', { class: 'btn btn-sm' }, '← 返回');
  back.onclick = () => { location.hash = '#/reading'; };
  head.append(back);
  head.append(h('h2', {}, escapeHtml(b.title)));
  head.append(h('span', { class: 'small muted' }, b.author || ''));
  const st = BOOK_STATUS[b.status] || BOOK_STATUS.want;
  head.append(h('span', { class: 'badge' }, st.label));

  const sel = h('select', { class: 'input', style: 'width:auto' });
  for (const [k, v] of Object.entries(BOOK_STATUS)) sel.append(h('option', { value: k }, v.label));
  sel.value = b.status;
  sel.onchange = async () => {
    await api.put(`/api/books/${b.id}`, { status: sel.value });
    toast('状态已更新');
    paintDetail(b.id);
  };
  head.append(sel);

  const edit = h('button', { class: 'btn btn-sm' }, '✏️ 编辑');
  edit.onclick = () => bookModal(b);
  const del = h('button', { class: 'btn btn-sm btn-danger' }, '删除');
  del.onclick = async () => {
    if (await confirmDialog(`确认删除《${b.title}》？`, { danger: true })) {
      await api.del(`/api/books/${b.id}`);
      toast('已删除');
      location.hash = '#/reading';
    }
  };
  head.append(edit, del);
  return head;
}

function buildBookProgress(b) {
  const pct = bookPercent(b);
  const card = h('div', { class: 'card', style: 'padding:16px;margin-bottom:16px' });
  card.append(h('div', { class: 'row' },
    h('div', { class: 'progress', style: 'flex:1' }, h('i', { style: `width:${pct}%` })),
    h('span', { class: 'small muted' }, bookProgressLabel(b))
  ));
  const btn = h('button', { class: 'btn btn-sm', style: 'margin-top:10px' }, '📖 记录进度');
  btn.onclick = () => bookModal(b);
  card.append(btn);
  return card;
}

function buildReadingGoal(b) {
  const card = h('div', { class: 'card', style: 'padding:16px;margin-bottom:16px' });
  card.append(h('div', { class: 'card-title', style: 'margin-bottom:8px' }, '🎯 每日阅读目标'));
  const setBtn = h('button', { class: 'btn btn-sm' }, '设定每日阅读目标');
  setBtn.onclick = async () => {
    await api.post('/api/tasks', {
      title: `阅读《${b.title}》`,
      date: todayStr(),
      time: null,
      priority: 'medium',
      repeat: 'daily',
      source: { type: 'book', id: b.id },
      note: '',
      order: Date.now()
    });
    toast('已设定每日阅读目标');
  };
  const checkBtn = h('button', { class: 'btn btn-sm btn-primary', style: 'margin-left:8px' }, '✓ 今日打卡');
  checkBtn.onclick = async () => {
    const today = todayStr();
    const tasks = await api.get(`/api/tasks?date=${today}`);
    const inst = tasks.find((t) => t.source && t.source.type === 'book' && t.source.id === b.id && (t.repeat || t.repeatOf));
    if (!inst) { toast('请先设定每日阅读目标', 'error'); return; }
    if (inst.done) { toast('今天已经打卡啦'); return; }
    await api.put(`/api/tasks/${inst.id}`, { done: true });
    toast('今日阅读打卡成功 📖');
  };
  card.append(h('div', { class: 'small muted', style: 'margin-bottom:8px' }, '设定后每天会自动出现在「今日计划」里，来这里一键打卡。'));
  card.append(setBtn, checkBtn);
  return card;
}

function buildNotes(b) {
  const wrap = h('div', { class: 'card', style: 'padding:8px 16px' });
  if (!b.notes.length) {
    wrap.append(h('p', { class: 'muted' }, '还没有笔记，记录下你的摘录与想法。'));
  }
  for (const n of b.notes) {
    const row = h('div', { class: 'list-item', style: 'padding:10px 0' });
    if (n.excerpt) row.append(h('div', { class: 'small muted', style: 'border-left:3px solid var(--primary);padding-left:8px;margin-bottom:4px' }, escapeHtml(n.excerpt)));
    if (n.thought) row.append(h('div', {}, escapeHtml(n.thought)));
    const actions = h('div', { class: 'row', style: 'margin-top:4px' });
    actions.append(h('span', { class: 'small muted' }, fmtDate(n.createdAt.slice(0, 10))));
    const edit = h('button', { class: 'icon-btn', title: '编辑' }, '✏️');
    edit.onclick = () => noteModal(b, n);
    const del = h('button', { class: 'icon-btn danger', title: '删除' }, '🗑');
    del.onclick = async () => {
      if (await confirmDialog('删除这条笔记？', { danger: true })) {
        await api.del(`/api/books/${b.id}/notes/${n.id}`);
        paintDetail(b.id);
      }
    };
    actions.append(edit, del);
    row.append(actions);
    wrap.append(row);
  }
  wrap.append(h('button', { class: 'btn btn-sm btn-ghost', style: 'margin:8px 0', onclick: () => noteModal(b) }, '＋ 添加笔记'));
  return wrap;
}

function buildReview(b) {
  const card = h('div', { class: 'card', style: 'padding:16px;margin-top:16px' });
  card.append(h('h3', {}, '💬 简评'));
  card.append(h('p', { class: 'muted' }, b.review || '还没有写简评。'));
  const btn = h('button', { class: 'btn btn-sm', style: 'margin-top:8px' }, '写简评');
  btn.onclick = () => openModal({
    title: '写简评',
    fields: [{ name: 'review', label: '简评', type: 'textarea', value: b.review || '' }],
    onSubmit: async (v) => { await api.put(`/api/books/${b.id}`, { review: v.review }); toast('已保存'); paintDetail(b.id); }
  });
  card.append(btn);
  return card;
}

function bookFields(b) {
  return [
    { name: 'title', label: '书名', required: true, value: b ? b.title : '' },
    { name: 'author', label: '作者', value: b ? (b.author || '') : '' },
    { name: 'status', label: '状态', type: 'select', value: b ? (b.status || 'want') : 'want',
      options: Object.entries(BOOK_STATUS).map(([k, v]) => ({ value: k, label: v.label })) },
    { name: 'unit', label: '进度单位', type: 'select', value: b ? (b.unit || 'page') : 'page',
      options: [{ value: 'page', label: '页数' }, { value: 'percent', label: '百分比' }] },
    { name: 'total', label: '总页数（可选，百分比则留空）', type: 'number', value: b ? (b.total ?? '') : '' },
    { name: 'current', label: '当前进度', type: 'number', value: b ? (b.current ?? 0) : 0 }
  ];
}

function bookModal(b) {
  openModal({
    title: b ? '编辑书籍' : '添加书籍',
    fields: bookFields(b),
    onSubmit: async (v) => {
      const payload = {
        title: v.title.trim(),
        author: v.author,
        status: v.status,
        unit: v.unit,
        total: v.total ? Number(v.total) : null,
        current: Number(v.current) || 0
      };
      if (b) await api.put(`/api/books/${b.id}`, payload);
      else await api.post('/api/books', payload);
      toast(b ? '已保存' : '已添加');
      if (b) paintDetail(b.id);
      else paintList();
    }
  });
}

function noteModal(b, n) {
  openModal({
    title: n ? '编辑笔记' : '添加笔记',
    fields: [
      { name: 'excerpt', label: '原文摘录', type: 'textarea', value: n ? (n.excerpt || '') : '' },
      { name: 'thought', label: '我的想法', type: 'textarea', value: n ? (n.thought || '') : '' }
    ],
    onSubmit: async (v) => {
      const payload = { excerpt: v.excerpt, thought: v.thought };
      if (n) await api.put(`/api/books/${b.id}/notes/${n.id}`, payload);
      else await api.post(`/api/books/${b.id}/notes`, payload);
      toast(n ? '已保存' : '已添加');
      paintDetail(b.id);
    }
  });
}

export function add() {
  bookModal();
}
