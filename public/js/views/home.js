'use strict';
import { api } from '../api.js';
import { h, toast, openModal, confirmDialog } from '../ui.js';
import {
  todayStr, fmtDate, escapeHtml, isOverdue, weekdayIndex, weekStartDate,
  priorityClass, priorityLabel, PROJECT_STATUS, BOOK_STATUS
} from '../utils.js';

const WEEK_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

function greeting() {
  const hh = new Date().getHours();
  if (hh < 6) return '夜深了';
  if (hh < 11) return '早上好';
  if (hh < 14) return '中午好';
  if (hh < 18) return '下午好';
  return '晚上好';
}

function bookPercent(book) {
  if (!book) return 0;
  if (book.unit === 'percent') return Math.max(0, Math.min(100, Number(book.current) || 0));
  if (book.total) return Math.max(0, Math.min(100, Math.round((Number(book.current) || 0) / book.total * 100)));
  return 0;
}

/**
 * 纯函数：把各模块原始数据汇总成首页摘要。
 * input = { tasks, memos, projects, books, workouts, ideas }
 */
export function summarize(input, today, weekStartPref = 'mon') {
  const tasks = input.tasks || [];
  const pending = tasks.filter((t) => !t.done);
  const doneCount = tasks.length - pending.length;
  const overdue = pending.filter((t) => isOverdue(t, today));
  const top3 = pending
    .slice()
    .sort((a, b) =>
      (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
      (a.order || 0) - (b.order || 0)
    )
    .slice(0, 3);

  const memos = (input.memos || []).slice().reverse().slice(0, 5);
  const projects = input.projects || [];
  const activeProjects = projects.filter((p) => p.status === 'active');
  const readingBooks = (input.books || []).filter((b) => b.status === 'reading');

  const workouts = input.workouts || {};
  const logs = workouts.logs || [];
  const weekStart = weekStartDate(today, weekStartPref);
  const weekLogCount = logs.filter((l) => l.date >= weekStart && l.date <= today).length;

  const todayKey = WEEK_KEYS[weekdayIndex(today)];
  const schedule = workouts.schedule || {};
  const exercises = workouts.exercises || [];
  const todayTraining = (schedule[todayKey] || [])
    .map((id) => exercises.find((e) => e.id === id))
    .filter(Boolean)
    .map((e) => e.name);

  const ideas = input.ideas || [];
  const ideasOpen = ideas.filter((i) => ['idea', 'planning', 'doing'].includes(i.status)).length;
  const latestIdeas = ideas.slice().reverse().slice(0, 2);

  return {
    pending, doneCount, overdue, top3, memos,
    activeProjects, readingBooks, weekLogCount, todayTraining,
    ideasOpen, latestIdeas
  };
}

let el = null;
async function refresh() {
  if (el) await render(el);
}

function buildGreeting(today) {
  return h('div', { style: 'margin-bottom:16px' },
    h('h1', { style: 'font-size:22px' }, `${greeting()}，`)
  , h('div', { class: 'muted' }, fmtDate(today)));
}

function buildMemoInput() {
  const input = h('input', {
    class: 'input', placeholder: '快速备忘：记一句，回车保存…', style: 'margin-bottom:16px'
  });
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      try {
        await api.post('/api/memos', { text: input.value.trim() });
        input.value = '';
        toast('已添加备忘');
        refresh();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
  return input;
}

function buildTodayCard(s, today) {
  const card = h('div', { class: 'card home-card wide', onclick: () => (location.hash = '#/today') });
  card.append(h('div', { class: 'card-title' },
    '📋 今日计划', h('span', { class: 'spacer' }),
    h('span', { class: 'small muted' }, s.pending.length ? `剩 ${s.pending.length} 件` : '全部完成')
  ));
  if (s.overdue.length) {
    card.append(h('div', { class: 'badge overdue', style: 'margin-bottom:6px' }, `${s.overdue.length} 项已逾期`));
  }
  if (s.top3.length) {
    const list = h('div', {});
    for (const t of s.top3) {
      const row = h('div', { class: 'row', style: 'padding:4px 0' });
      row.append(h('span', { class: `badge ${priorityClass(t.priority)}` }, priorityLabel(t.priority)));
      row.append(h('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, escapeHtml(t.title)));
      if (isOverdue(t, today)) row.append(h('span', { class: 'badge overdue' }, '逾期'));
      list.append(row);
    }
    card.append(list);
  } else {
    card.append(h('p', { class: 'muted' }, '今天没有待办，好好享受～'));
  }
  card.append(h('div', { class: 'small muted', style: 'margin-top:8px' }, '查看全部 →'));
  return card;
}

function buildMemoCard(s) {
  const card = h('div', { class: 'card home-card' });
  card.append(h('div', { class: 'card-title' }, '🗒 快速备忘', h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, `${s.memos.length}`)));
  if (s.memos.length) {
    for (const m of s.memos) {
      const line = h('div', { class: 'memo-line' });
      line.append(h('span', { class: 'text', title: m.text }, escapeHtml(m.text)));
      const edit = h('button', { class: 'icon-btn', title: '编辑' }, '✏️');
      const del = h('button', { class: 'icon-btn danger', title: '删除' }, '🗑');
      edit.onclick = async (e) => {
        e.stopPropagation();
        await openModal({
          title: '编辑备忘',
          fields: [{ name: 'text', label: '内容', type: 'textarea', value: m.text, required: true }],
          onSubmit: async (v) => { await api.put(`/api/memos/${m.id}`, { text: v.text.trim() }); toast('已更新'); refresh(); }
        });
      };
      del.onclick = async (e) => {
        e.stopPropagation();
        if (await confirmDialog('确认删除这条备忘？此操作不可恢复。', { danger: true })) {
          await api.del(`/api/memos/${m.id}`);
          toast('已删除');
          refresh();
        }
      };
      line.append(edit, del);
      card.append(line);
    }
  } else {
    card.append(h('p', { class: 'muted' }, '还没有备忘，记下第一个想法吧。'));
  }
  return card;
}

function buildProjectCard(s) {
  const card = h('div', { class: 'card home-card', onclick: () => (location.hash = '#/projects') });
  card.append(h('div', { class: 'card-title' }, '📁 工作项目', h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, `${s.activeProjects.length} 进行中`)));
  if (s.activeProjects.length) {
    for (const p of s.activeProjects.slice(0, 2)) {
      const row = h('div', { style: 'padding:6px 0;cursor:pointer' });
      row.onclick = (e) => { e.stopPropagation(); location.hash = `#/projects/${p.id}`; };
      row.append(h('div', { class: 'row' }, h('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, escapeHtml(p.name)), h('span', { class: 'small muted' }, `${p.progress || 0}%`)));
      row.append(h('div', { class: 'progress' }, h('i', { style: `width:${p.progress || 0}%` })));
      card.append(row);
    }
  } else {
    card.append(h('p', { class: 'muted' }, '暂无进行中的项目。'));
  }
  card.append(h('div', { class: 'small muted', style: 'margin-top:8px' }, '查看全部 →'));
  return card;
}

function buildReadingCard(s) {
  const card = h('div', { class: 'card home-card', onclick: () => (location.hash = '#/reading') });
  card.append(h('div', { class: 'card-title' }, '📚 阅读计划', h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, `${s.readingBooks.length} 在读`)));
  if (s.readingBooks.length) {
    for (const b of s.readingBooks.slice(0, 2)) {
      const pct = bookPercent(b);
      const row = h('div', { style: 'padding:6px 0;cursor:pointer' });
      row.onclick = (e) => { e.stopPropagation(); location.hash = `#/reading/${b.id}`; };
      row.append(h('div', { class: 'row' }, h('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, escapeHtml(b.title)), h('span', { class: 'small muted' }, `${pct}%`)));
      row.append(h('div', { class: 'progress' }, h('i', { style: `width:${pct}%` })));
      card.append(row);
    }
  } else {
    card.append(h('p', { class: 'muted' }, '暂无在读的书。'));
  }
  card.append(h('div', { class: 'small muted', style: 'margin-top:8px' }, '查看全部 →'));
  return card;
}

function buildFitnessCard(s) {
  const card = h('div', { class: 'card home-card', onclick: () => (location.hash = '#/fitness') });
  card.append(h('div', { class: 'card-title' }, '💪 健身计划'));
  card.append(h('div', { class: 'row' }, h('span', {}, `本周完成 ${s.weekLogCount} 次`)));
  card.append(h('div', { class: 'muted small', style: 'margin-top:4px' },
    s.todayTraining.length ? `今天练：${s.todayTraining.join('、')}` : '今天没有安排训练'));
  card.append(h('div', { class: 'small muted', style: 'margin-top:8px' }, '查看全部 →'));
  return card;
}

function buildIdeaCard(s) {
  const card = h('div', { class: 'card home-card', onclick: () => (location.hash = '#/ideas') });
  card.append(h('div', { class: 'card-title' }, '💡 灵感', h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, `${s.ideasOpen} 个未完成`)));
  if (s.latestIdeas.length) {
    for (const i of s.latestIdeas) {
      card.append(h('div', { class: 'memo-line' }, h('span', { class: 'text', title: i.title }, escapeHtml(i.title))));
    }
  } else {
    card.append(h('p', { class: 'muted' }, '有灵感就记下来吧。'));
  }
  card.append(h('div', { class: 'small muted', style: 'margin-top:8px' }, '查看全部 →'));
  return card;
}

export async function render(container) {
  el = container;
  container.innerHTML = '';
  const today = todayStr();
  const [prefs, tasks, memos, projects, books, workouts, ideas] = await Promise.all([
    api.get('/api/preferences'),
    api.get(`/api/tasks?date=${today}`),
    api.get('/api/memos'),
    api.get('/api/projects'),
    api.get('/api/books'),
    api.get('/api/workouts'),
    api.get('/api/ideas')
  ]);
  const s = summarize({ tasks, memos, projects, books, workouts, ideas }, today, prefs.weekStart || 'mon');

  container.append(buildGreeting(today));
  container.append(buildMemoInput());
  const grid = h('div', { class: 'home-grid' });
  grid.append(
    buildTodayCard(s, today),
    buildMemoCard(s),
    buildProjectCard(s),
    buildReadingCard(s),
    buildFitnessCard(s),
    buildIdeaCard(s)
  );
  container.append(grid);
}

export async function add() {
  await openModal({
    title: '快速备忘',
    fields: [{ name: 'text', label: '内容', type: 'textarea', required: true }],
    onSubmit: async (v) => {
      await api.post('/api/memos', { text: v.text.trim() });
      toast('已添加备忘');
      refresh();
    }
  });
}
