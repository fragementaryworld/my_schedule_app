// 归属决定分组；来源只记录任务从哪里来。每日安排不改项目的截止日期。
import { h, toast, confirmDialog } from './ui.js';
import { api } from './api.js';
import { flattenProjectItems, itemSpan, spanDays, DAY_TASK_COLOR, truncate, tint } from './calendar.js';
import { itemBase, itemHref, timelineColor, createProject } from './views/projects.js';
import { estimateText, priorityLabel, priorityClass, isOverdue, todayStr } from './utils.js';
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
    spanDays: t.date ? spanDays({ from: t.date, to: t.endDate || t.date }) : 0,
    overdue: isOverdue(t, todayStr()),
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
      overdue: isOverdue(node, todayStr()),
      subtaskCount: (node.subtasks || []).length,
      subtaskDone: (node.subtasks || []).filter(n => n.done).length,
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

// 原日历保留起止/截止日期；单独安排到其他日期的任务增加一个执行日标记。
export function withPlannedCalendarEntries(calendarEntries, entries) {
  const extra = [];
  for (const e of entries) {
    if (!e.planDate) continue;
    const original = calendarEntries.find(c => c.kind === e.kind && c.id === e.id && (e.kind !== 'project' || c.projectId === e.projectId));
    if (original && original.spanFrom <= e.planDate && original.spanTo >= e.planDate) continue;
    extra.push({ ...e, date: e.planDate, time: '', planOnly: true,
      spanFrom: e.planDate, spanTo: e.planDate, spanDays: 1, spanStart: true, spanEnd: true,
      detail: e.kind === 'project' ? e.desc || '' : e.note || '' });
  }
  return [...calendarEntries, ...extra];
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

export function buildDailyBoard(entries, date, refresh, { onRemove } = {}) {
  const sections = dailySections(entries, date);
  const wrap = h('div', { class: 'daily-board kanban' });
  const active = h('div', { class: 'kanban-col board-col-active' });
  const pendingCount = sections.planned.length + sections.due.length + sections.ongoing.length;
  active.append(h('div', { class: 'col-head' }, '待办', h('span', { class: 'daily-count' }, String(pendingCount))));
  const completed = h('details', { class: 'kanban-col board-col-done daily-done' });
  completed.append(h('summary', { class: 'col-head' }, '已完成', h('span', { class: 'daily-count' }, String(sections.done.length))));
  wrap.append(active, completed);

  const save = async (e, patch) => {
    try { await api.put(e.base, patch); Object.assign(e, patch); await refresh(); return true; }
    catch (err) { toast(err.message, 'error'); return false; }
  };
  const shown = [...sections.planned, ...sections.due, ...sections.ongoing, ...sections.done];
  const dragEntries = new Map(shown.map(e => [e.base, e]));
  for (const [col, done] of [[active, false], [completed, true]]) {
    col.addEventListener('dragover', ev => {
      ev.preventDefault(); col.classList.add('drop-hover');
      if (done) col.open = true;
    });
    col.addEventListener('dragleave', () => col.classList.remove('drop-hover'));
    col.addEventListener('drop', async ev => {
      ev.preventDefault(); col.classList.remove('drop-hover');
      const e = dragEntries.get(ev.dataTransfer?.getData('text/plain'));
      if (!e || !!e.done === done) return;
      await save(e, { done });
    });
  }
  const row = (e, mode) => {
    const r = h('div', { class: 'daily-task' + (mode !== 'candidates' ? ' cal-board-card' : '') + (e.done ? ' done' : ''), dataset: { entry: e.base }, draggable: mode !== 'candidates' ? 'true' : null,
      style: `background:${tint(e.color || DAY_TASK_COLOR, 0.12)};border-left:3px solid ${e.color || DAY_TASK_COLOR}` });
    r.addEventListener('dragstart', ev => { ev.dataTransfer?.setData('text/plain', e.base); });
    const cb = h('input', { type: 'checkbox', class: 'task-check cal-check', 'aria-label': `完成任务：${e.title}` });
    cb.checked = !!e.done;
    cb.onclick = async () => { cb.checked = !e.done; cb.disabled = true; if (!(await save(e, { done: cb.checked }))) cb.checked = !!e.done; cb.disabled = false; };
    const body = h('div', { class: 'daily-task-body' });
    const title = h('a', { class: 'daily-task-title title row-link', href: e.href }, e.title);
    title.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); location.hash = e.href; };
    body.append(title);
    const detail = (e.kind === 'project' ? e.desc || '' : e.note || '').trim();
    if (detail) body.append(h('div', { class: 'cal-board-detail' }, truncate(detail, 90)));
    const meta = h('div', { class: 'daily-task-meta' });
    if (e.ancestors?.length) meta.append(h('span', { class: 'daily-breadcrumb' }, e.ancestors.join(' / ')));
    if (e.time) meta.append(h('span', {}, `${e.kind === 'project' ? '截止' : '安排'} ${e.time}`));
    if (e.kind === 'project' && e.dueDate) meta.append(h('span', {}, `截止 ${e.dueDate}`));
    if (estimateText(e)) meta.append(h('span', {}, estimateText(e)));
    if (e.spanDays > 1) meta.append(h('span', {}, `跨 ${e.spanDays} 天`));
    if (e.overdue && !e.done) meta.append(h('span', { class: 'badge overdue' }, '逾期'));
    if (e.subtaskCount) meta.append(h('span', {}, `子任务 ${e.subtaskDone}/${e.subtaskCount}`));
    const tag = ROUTINE_OPTIONS.find(([v]) => v && v === e.routineTag);
    if (tag && e.category === 'routine') meta.append(h('span', {}, tag[1]));
    if (e.priority === 'high') meta.append(h('span', { class: `badge ${priorityClass(e.priority)}` }, priorityLabel(e.priority)));
    body.append(meta);
    r.append(cb, body);
    if (onRemove) {
      const del = h('button', { type: 'button', class: 'icon-btn cal-board-del', title: `删除「${e.title}」`, 'aria-label': `删除「${e.title}」` }, '🗑');
      del.onclick = async ev => {
        ev.stopPropagation();
        try { await onRemove(e); } catch (err) { toast(err.message, 'error'); }
      };
      r.append(del);
    }
    if (e.repeat || e.repeatOf) {
      const finish = h('button', { class: 'icon-btn', title: '完成整个系列' }, '✓✓');
      finish.onclick = async () => {
        if (await confirmDialog('完成整个系列？所有已生成与未来的实例都会标记完成。')) await save(e, { done: true, finishSeries: true });
      };
      r.append(finish);
    }
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
  active.append(h('section', { class: 'daily-planned' }, h('h2', {}, '当天安排'),
    sections.planned.length ? grouped(sections.planned, 'planned') : h('div', { class: 'daily-empty muted' }, '还没有安排。从下方选择项目任务，或新增一条日常事务。')));
  if (sections.due.length) active.append(h('section', { class: 'daily-due' }, h('h2', {}, '当天截止', h('span', { class: 'daily-count' }, String(sections.due.length))), grouped(sections.due, 'due')));
  completed.append(sections.done.length ? grouped(sections.done, 'done') : h('p', { class: 'muted' }, '暂无任务'));
  for (const [key, label] of [['ongoing', '持续进行中'], ['candidates', '从项目中选择任务']]) {
    const fold = h('details', { class: `daily-fold daily-${key}` });
    fold.append(h('summary', {}, label, h('span', { class: 'daily-count' }, `${sections[key].length} 项`)));
    if (key === 'candidates') {
      const create = h('button', { class: 'btn btn-sm', style: 'margin:12px 0' }, '＋ 新建临时专题');
      create.onclick = () => createProject({ category: 'temporary' }).catch(err => toast(err.message, 'error'));
      fold.append(create);
    }
    fold.append(sections[key].length ? grouped(sections[key], key) : h('p', { class: 'muted' }, '暂无任务'));
    active.append(fold);
  }
  return wrap;
}
