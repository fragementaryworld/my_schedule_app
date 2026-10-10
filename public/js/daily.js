// 归属决定分组；来源只记录任务从哪里来。每日安排不改项目的截止日期。
import { h, toast } from './ui.js';
import { api } from './api.js';
import { flattenProjectItems, itemSpan, spanDays, DAY_TASK_COLOR } from './calendar.js';
import { itemBase, itemHref, timelineColor, createProject } from './views/projects.js';
import { estimateText, priorityLabel, priorityClass } from './utils.js';
import { timeRangeLabel, dayTaskHref } from './daytask.js';

export const CATEGORY_OPTIONS = [['work', '工作项目'], ['temporary', '临时专题'], ['routine', '日常事务']];
export const ROUTINE_OPTIONS = [['', '未分类'], ['admin', '行政'], ['communication', '沟通'], ['organizing', '整理']];

export function ownerProjectId(task) {
  // 显式 null 表示已改为日常事务；缺省才兼容旧的项目来源。
  return task.projectId !== undefined ? task.projectId : (task.source?.type === 'project' ? task.source.id : null);
}

export function dailyEntries(tasks, projects, includeInactive = false) {
  const projectMap = new Map((projects || []).map(p => [p.id, p]));
  const ownership = project => ({
    category: project ? (project.category === 'temporary' ? 'temporary' : 'work') : 'routine',
    projectId: project?.id || null, projectName: project?.name || '',
    color: project ? timelineColor(project.id) : DAY_TASK_COLOR
  });
  const entries = (tasks || []).map(t => ({
    ...t, kind: 'day', ...ownership(projectMap.get(ownerProjectId(t))),
    time: timeRangeLabel(t.time, t.endTime),
    spanFrom: t.date, spanTo: t.endDate || t.date,
    sourceType: t.source?.type || '', raw: t,
    base: `/api/tasks/${t.id}`, href: dayTaskHref(t.id), path: []
  }));
  for (const { node, project, path } of flattenProjectItems(projects)) {
    if (!includeInactive && project.status && project.status !== 'active') continue;
    let parent = project;
    const ancestors = [];
    for (const id of path.slice(0, -1)) {
      parent = (parent.tasks || parent.subtasks || []).find(n => n.id === id);
      if (parent) ancestors.push(parent.title);
    }
    const span = itemSpan(node);
    entries.push({
      ...node, kind: 'project', ...ownership(project), path, ancestors,
      spanFrom: span?.from, spanTo: span?.to, spanDays: spanDays(span),
      time: node.dueTime || '', sourceType: project.sourceIdeaId ? 'idea' : 'project',
      raw: node, base: itemBase(project.id, path), href: itemHref(project.id, path)
    });
  }
  return entries;
}

export function filterDailyEntries(entries, filters = {}) {
  const q = (filters.search || '').trim().toLocaleLowerCase();
  return entries.filter(e => (!filters.category || e.category === filters.category)
    && (!q || [e.title, e.projectName, ...(e.ancestors || []), e.note, e.desc].join(' ').toLocaleLowerCase().includes(q)));
}

export function dailySections(entries, date) {
  const out = { planned: [], due: [], ongoing: [], done: [], candidates: [] };
  for (const e of entries) {
    const spansDate = e.spanFrom && e.spanFrom <= date && e.spanTo >= date;
    const planned = e.planDate === date || (e.kind === 'day' && e.date === date && (!e.endDate || e.endDate === date));
    const due = e.kind === 'project' ? e.dueDate === date : e.endDate === date;
    if (e.done) {
      if (planned || due || spansDate) out.done.push(e);
    } else if (planned) out.planned.push(e);
    else if (due) out.due.push(e);
    else if (spansDate) out.ongoing.push(e);
    else if (e.kind === 'project') out.candidates.push(e);
  }
  const priority = { high: 0, medium: 1, low: 2 };
  for (const list of Object.values(out)) list.sort((a, b) =>
    (a.time || '99').localeCompare(b.time || '99')
    || (priority[a.priority || 'medium'] - priority[b.priority || 'medium'])
    || a.title.localeCompare(b.title, 'zh-CN'));
  return out;
}

// 只在父任务也出现在同一个区块时折叠子任务；否则独立显示并保留祖先路径。
export function entryForest(entries) {
  const nodes = entries.map(entry => ({ entry, children: [] }));
  const byKey = new Map(nodes.filter(n => n.entry.kind === 'project').map(n =>
    [`${n.entry.projectId}:${n.entry.path.join('/')}`, n]));
  const roots = [];
  for (const node of nodes) {
    const e = node.entry;
    const parent = e.kind === 'project' && e.path.length > 1
      ? byKey.get(`${e.projectId}:${e.path.slice(0, -1).join('/')}`) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function buildDailyFilters(filters, onChange) {
  const bar = h('div', { class: 'daily-filters' });
  const selects = [];
  const search = h('input', { class: 'input daily-search', type: 'search', placeholder: '搜索任务或项目…', 'aria-label': '搜索任务或项目' });
  search.value = filters.search || '';
  search.oninput = () => { filters.search = search.value; onChange(); };
  bar.append(search);
  const select = (label, key, choices) => {
    const ctrl = h('select', { class: 'input', 'aria-label': label });
    ctrl.append(h('option', { value: '' }, label));
    for (const [value, text] of choices) ctrl.append(h('option', { value }, text));
    ctrl.value = filters[key] || '';
    ctrl.onchange = () => { filters[key] = ctrl.value; onChange(); };
    bar.append(ctrl);
    selects.push(ctrl);
  };
  select('全部归属', 'category', CATEGORY_OPTIONS);
  const clear = h('button', { class: 'btn btn-sm' }, '清除筛选');
  clear.onclick = () => {
    for (const key of Object.keys(filters)) delete filters[key];
    search.value = '';
    for (const ctrl of selects) ctrl.value = '';
    onChange();
  };
  bar.append(clear);
  return bar;
}

export function buildDailyList(entries, date, refresh) {
  const sections = dailySections(entries, date);
  const wrap = h('div', { class: 'daily-list' });
  wrap.append(h('div', { class: 'daily-summary' },
    h('div', {}, h('strong', {}, '先安排，再开始'), h('p', { class: 'muted' }, '把今天要做的事放进清单，其他任务留在各自的项目里。')),
    h('div', { class: 'daily-stats' }, h('strong', {}, String(sections.planned.length)), '项安排', h('span', {}, `${sections.due.length} 项截止 · ${sections.done.length} 项完成`))));

  const save = async (e, patch) => {
    try { await api.put(e.base, patch); await refresh(); return true; }
    catch (err) { toast(err.message, 'error'); return false; }
  };
  const row = (e, mode) => {
    const r = h('div', { class: 'daily-task' + (e.done ? ' done' : ''), dataset: { entry: `${e.kind}:${e.projectId || ''}:${e.id}` } });
    const cb = h('input', { type: 'checkbox', class: 'task-check', 'aria-label': `完成任务：${e.title}` });
    cb.checked = !!e.done;
    cb.onchange = async () => { cb.disabled = true; if (!(await save(e, { done: cb.checked }))) cb.checked = !!e.done; cb.disabled = false; };
    const body = h('div', { class: 'daily-task-body' });
    body.append(h('a', { class: 'daily-task-title', href: e.href }, e.title));
    const meta = h('div', { class: 'daily-task-meta' });
    if (e.ancestors?.length) meta.append(h('span', { class: 'daily-breadcrumb' }, e.ancestors.join(' / ')));
    if (e.time) meta.append(h('span', {}, `${e.kind === 'project' ? '截止' : '安排'} ${e.time}`));
    if (e.kind === 'project' && e.dueDate) meta.append(h('span', {}, `截止 ${e.dueDate}`));
    if (estimateText(e)) meta.append(h('span', {}, estimateText(e)));
    const tag = ROUTINE_OPTIONS.find(([v]) => v && v === e.routineTag);
    if (tag && e.category === 'routine') meta.append(h('span', {}, tag[1]));
    if (e.priority === 'high') meta.append(h('span', { class: `badge ${priorityClass(e.priority)}` }, priorityLabel(e.priority)));
    body.append(meta);
    r.append(cb, body);
    if (!e.done && (mode === 'due' || mode === 'ongoing' || mode === 'candidates')) {
      const add = h('button', { class: 'btn btn-sm daily-plan-add', 'aria-label': `加入当天：${e.title}` }, '＋ 加入当天');
      add.onclick = () => save(e, { planDate: date });
      r.append(add);
    } else if (!e.done && e.planDate === date) {
      const remove = h('button', { class: 'icon-btn', title: '移出当天清单', 'aria-label': `移出当天：${e.title}` }, '−');
      remove.onclick = () => save(e, { planDate: null });
      r.append(remove);
    }
    return r;
  };
  const tree = (node, mode) => {
    const block = h('div', { class: 'daily-tree' });
    block.append(row(node.entry, mode));
    if (node.children.length) {
      const fold = h('details', { class: 'daily-subtasks' });
      fold.append(h('summary', {}, `${node.children.length} 个子任务`));
      for (const child of node.children) fold.append(tree(child, mode));
      block.append(fold);
    }
    return block;
  };
  const grouped = (list, mode) => {
    const groups = h('div', { class: 'daily-groups' });
    for (const [category, label] of CATEGORY_OPTIONS) {
      const items = list.filter(e => e.category === category);
      if (!items.length) continue;
      const section = h('section', { class: `daily-category daily-category-${category}` });
      section.append(h('h3', {}, label, h('span', { class: 'daily-count' }, String(items.length))));
      const projectGroups = new Map();
      for (const e of items) {
        const key = e.projectId || 'routine';
        if (!projectGroups.has(key)) projectGroups.set(key, []);
        projectGroups.get(key).push(e);
      }
      for (const list of projectGroups.values()) {
        const group = h('details', { class: 'daily-project', open: true });
        group.append(h('summary', {}, list[0].projectName || '日常待办', h('span', { class: 'daily-count' }, `${list.length} 项`)));
        for (const node of entryForest(list)) group.append(tree(node, mode));
        section.append(group);
      }
      groups.append(section);
    }
    return groups;
  };
  wrap.append(h('section', { class: 'daily-planned' }, h('h2', {}, '当天清单'),
    sections.planned.length ? grouped(sections.planned, 'planned') : h('div', { class: 'daily-empty muted' }, '还没有安排。从下方选择项目任务，或新增一条日常事务。')));
  if (sections.due.length) wrap.append(h('section', { class: 'daily-due' }, h('h2', {}, '当天截止', h('span', { class: 'daily-count' }, String(sections.due.length))), grouped(sections.due, 'due')));
  for (const [key, label] of [['ongoing', '持续进行中'], ['done', '已完成'], ['candidates', '从项目中选择任务']]) {
    const fold = h('details', { class: `daily-fold daily-${key}` });
    fold.append(h('summary', {}, label, h('span', { class: 'daily-count' }, `${sections[key].length} 项`)));
    if (key === 'candidates') {
      const create = h('button', { class: 'btn btn-sm', style: 'margin:12px 0' }, '＋ 新建临时专题');
      create.onclick = () => createProject({ category: 'temporary' }).catch(err => toast(err.message, 'error'));
      fold.append(create);
    }
    fold.append(sections[key].length ? grouped(sections[key], key) : h('p', { class: 'muted' }, '暂无任务'));
    wrap.append(fold);
  }
  return wrap;
}
