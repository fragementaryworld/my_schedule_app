import { PERIODS, planningFor, comparePlan, planSummary, editPlan, buildTimeAxis } from './planning.js';
import { ownership, ownerOptions } from './ownership.js';
// 清单决定存放位置，时段决定当天的执行顺序。安排不改项目的截止日期。
import { h, toast, confirmDialog, dismissOnOutsideClick } from './ui.js';
import { api } from './api.js';
import { flattenProjectItems, itemSpan, spanDays, DAY_TASK_COLOR, truncate, tint } from './calendar.js';
import { itemBase, itemHref, timelineColor } from './views/projects.js';
import { estimateText, priorityLabel, priorityClass, isOverdue, todayStr, addDays } from './utils.js';
import { timeRangeLabel, dayTaskHref } from './daytask.js';

export { ownerProjectId } from './ownership.js';

export function dailyEntries(tasks, projects, includeInactive = false) {
  const projectMap = new Map((projects || []).map(p => [p.id, p]));
  const legacyOwnership = project => ({
    category: project ? (project.category === 'temporary' ? 'temporary' : 'work') : 'routine',
    projectId: project?.id || null, projectName: project?.name || '',
    color: project ? timelineColor(project.id) : DAY_TASK_COLOR
  });
  const entries = (tasks || []).map(t => ({
    ...t, kind: 'day', ...legacyOwnership(projectMap.get(ownership(t, projects).projectId)), ...ownership(t, projects),
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
      ...node, kind: 'project', ...legacyOwnership(project), ...ownership({ projectId: project.id }, projects), path, ancestors,
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
  return entries.filter(e => (!filters.owner || e.ownerKey === filters.owner)
    && (!q || [e.title, e.projectName, ...(e.ancestors || []), e.note, e.desc].join(' ').toLocaleLowerCase().includes(q)));
}

// 原日历保留起止/截止日期；单独安排到其他日期的任务增加一个执行日标记。
export function withPlannedCalendarEntries(calendarEntries, entries) {
  const result = [...calendarEntries];
  for (const e of entries) {
    if (!e.planDate) continue;
    const index = result.findIndex(c => c.kind === e.kind && c.id === e.id && (e.kind !== 'project' || c.projectId === e.projectId));
    const original = result[index];
    const p = planningFor(e, e.planDate);
    // 独立单日任务的 date 是原执行日期；改计划日期后只展示新安排，避免旧日期出现残影。
    if (original && e.kind === 'day' && e.spanDays <= 1) result.splice(index, 1);
    else if (original && original.spanFrom <= e.planDate && original.spanTo >= e.planDate) {
      result[index] = { ...original, planDate: e.planDate, planPeriod: p.period, planTime: p.time, planEndTime: p.endTime };
      continue;
    }
    result.push({ ...e, date: e.planDate, time: timeRangeLabel(p.time, p.endTime), planOnly: true,
      planPeriod: p.period, planTime: p.time, planEndTime: p.endTime,
      spanFrom: e.planDate, spanTo: e.planDate, spanDays: 1, spanStart: true, spanEnd: true,
      detail: e.kind === 'project' ? e.desc || '' : e.note || '' });
  }
  return result;
}

export function dailySections(entries, date) {
  const out = { planned: [], due: [], ongoing: [], done: [], candidates: [] };
  for (const e of entries) {
    const spansDate = e.spanFrom && e.spanFrom <= date && e.spanTo >= date;
    const planned = e.planDate === date || (!e.planDate && e.kind === 'day' && e.date === date && (!e.endDate || e.endDate === date));
    const due = e.kind === 'project' ? e.dueDate === date : e.endDate === date;
    if (e.done) {
      if (planned || due || spansDate) out.done.push(e);
    } else if (planned) out.planned.push(e);
    else if (due) out.due.push(e);
    else if (spansDate) out.ongoing.push(e);
    else out.candidates.push(e);
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

export function buildDailyFilters(filters, onChange, projects = []) {
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
  select('全部清单', 'owner', ownerOptions(projects).map(o => [o.value, o.label]));
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

export function buildDailyBoard(entries, date, refresh, { onRemove, allEntries = entries } = {}) {
  const sections = dailySections(entries, date);
  const pending = [...sections.planned, ...sections.due].sort((a, b) => comparePlan(a, b, date));
  const wrap = h('div', { class: 'daily-board' });
  const active = h('div', { class: 'kanban-col board-col-active' });
  const completed = h('details', { class: 'kanban-col board-col-done daily-done' });
  completed.append(h('summary', { class: 'col-head' }, '已完成', h('span', { class: 'daily-count' }, String(sections.done.length))));
  const save = async (e, patch) => {
    try { await api.put(e.base, patch); Object.assign(e, patch); e.raw = { ...e.raw, ...patch }; await refresh(); return true; }
    catch (err) { toast(err.message, 'error'); return false; }
  };
  const batch = async changes => {
    try { await api.post('/api/planning/batch', { items: changes }); await refresh(); return true; }
    catch (err) { toast(err.message, 'error'); return false; }
  };
  const dragEntries = new Map(entries.map(e => [e.base, e]));
  const moveTo = (e, period) => save(e, { planDate: date, planPeriod: period || null, planTime: null, planEndTime: null, planOrder: null });
  const orderBefore = async (entry, period, before) => {
    const peers = pending.filter(e => !planningFor(e, date).time && planningFor(e, date).period === period && e.base !== entry.base);
    const index = before ? peers.findIndex(e => e.base === before.base) : peers.length;
    peers.splice(index < 0 ? peers.length : index, 0, entry);
    return batch(peers.map((e, i) => ({ base: e.base, patch: { planDate: date, planPeriod: period || null, planTime: null, planEndTime: null, planOrder: i } })));
  };
  for (const [col, done] of [[active, false], [completed, true]]) {
    col.addEventListener('dragover', ev => { ev.preventDefault(); col.classList.add('drop-hover'); if (done) col.open = true; });
    col.addEventListener('dragleave', () => col.classList.remove('drop-hover'));
    col.addEventListener('drop', async ev => {
      ev.preventDefault(); col.classList.remove('drop-hover');
      const e = dragEntries.get(ev.dataTransfer?.getData('text/plain'));
      if (e && !!e.done !== done) await save(e, { done });
    });
  }
  const row = (e, candidate = false, onAdded) => {
    const p = planningFor(e, date);
    const r = h('div', { class: 'daily-task' + (candidate ? '' : ' cal-board-card') + (e.done ? ' done' : ''), dataset: { entry: e.base }, draggable: candidate ? null : 'true' });
    r.addEventListener('dragstart', ev => { ev.stopPropagation(); ev.dataTransfer?.setData('text/plain', e.base); });
    if (!candidate && !e.done && !p.time) {
      r.addEventListener('dragover', ev => { ev.preventDefault(); ev.stopPropagation(); r.classList.add('drop-before'); });
      r.addEventListener('dragleave', () => r.classList.remove('drop-before'));
      r.addEventListener('drop', ev => {
        ev.preventDefault(); ev.stopPropagation(); r.classList.remove('drop-before');
        const dragged = dragEntries.get(ev.dataTransfer?.getData('text/plain'));
        if (dragged && !dragged.done && dragged.base !== e.base) orderBefore(dragged, p.period, e);
      });
    }
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
    meta.append(h('span', { class: 'daily-owner' }, e.ownerLabel));
    if (e.ancestors?.length) meta.append(h('span', { class: 'daily-breadcrumb' }, e.ancestors.join(' / ')));
    if (p.time) meta.append(h('span', { class: 'daily-plan-time' }, timeRangeLabel(p.time, p.endTime)));
    if (candidate && e.spanDays > 1) {
      const originalTime = e.kind === 'project' ? timeRangeLabel(e.startTime, e.dueTime) : timeRangeLabel(e.raw.time, e.raw.endTime);
      meta.append(h('span', {}, `原区间 ${e.spanFrom} → ${e.spanTo} · 跨 ${e.spanDays} 天${originalTime ? ` · ${originalTime}` : ''}`));
    }
    if (estimateText(e)) meta.append(h('span', {}, estimateText(e)));
    const dueDate = e.kind === 'project' ? e.dueDate : e.endDate;
    if (dueDate) meta.append(h('span', { class: dueDate === date ? 'badge overdue' : '' }, `${dueDate === date ? '今日截止' : `截止 ${dueDate}`}${e.kind === 'project' && e.dueTime ? ` ${e.dueTime}` : ''}`));
    if (e.overdue && !e.done) meta.append(h('span', { class: 'badge overdue' }, '逾期'));
    if (e.subtaskCount) meta.append(h('span', {}, `子任务 ${e.subtaskDone}/${e.subtaskCount}`));
    if (e.priority === 'high') meta.append(h('span', { class: `badge ${priorityClass(e.priority)}` }, priorityLabel(e.priority)));
    body.append(meta); if (!candidate) r.append(cb); r.append(body);
    const actions = h('div', { class: 'daily-actions' });
    const menu = dismissOnOutsideClick(h('details', { class: 'daily-task-menu' }));
    const menuItems = h('div', { class: 'daily-task-menu-items' });
    menu.append(h('summary', { 'aria-label': `更多操作：${e.title}` }, '⋯'), menuItems);
    if (!candidate && !e.done) {
      const period = h('select', { class: 'input daily-period-select', 'aria-label': `安排时段：${e.title}` });
      for (const o of PERIODS) period.append(h('option', { value: o.value }, o.label));
      period.value = p.period;
      period.onchange = async () => { period.disabled = true; if (!(await moveTo(e, period.value))) period.value = p.period; period.disabled = false; };
      const edit = h('button', { class: 'icon-btn', title: '调整日期或具体时间', 'aria-label': `调整安排：${e.title}` }, '调整日期或时间');
      edit.onclick = () => editPlan(e, date, save, allEntries);
      const tomorrow = h('button', { class: 'icon-btn', 'aria-label': `改到明天：${e.title}` }, '改到明天');
      tomorrow.onclick = () => save(e, { planDate: addDays(date, 1), planPeriod: p.period || null, planTime: p.time || null, planEndTime: p.endTime || null, planOrder: null });
      actions.append(period); menuItems.append(edit, tomorrow);
      if (!p.time) {
        const peers = pending.filter(x => !planningFor(x, date).time && planningFor(x, date).period === p.period);
        const i = peers.findIndex(x => x.base === e.base);
        const up = h('button', { class: 'icon-btn', 'aria-label': `上移：${e.title}`, disabled: i < 1 ? 'true' : null }, '↑ 上移');
        const down = h('button', { class: 'icon-btn', 'aria-label': `下移：${e.title}`, disabled: i >= peers.length - 1 ? 'true' : null }, '↓ 下移');
        up.onclick = () => { if (i > 0) orderBefore(e, p.period, peers[i - 1]); };
        down.onclick = () => { if (i < peers.length - 1) orderBefore(e, p.period, peers[i + 2]); };
        menuItems.append(up, down);
      }
    }
    if (candidate || (!e.done && !e.planDate && sections.due.includes(e))) {
      const add = h('button', { class: 'btn btn-sm daily-plan-add', 'aria-label': `加入当天：${e.title}` }, '＋ 加入当天');
      add.onclick = async () => { if (await save(e, { planDate: date })) onAdded?.(); }; actions.append(add);
    } else if (!e.done && e.planDate === date) {
      const remove = h('button', { class: 'icon-btn', title: '取消当天安排', 'aria-label': `移出当天：${e.title}` }, '撤销当天安排');
      remove.onclick = () => save(e, { planDate: null }); menuItems.append(remove);
    }
    if (e.repeat || e.repeatOf) {
      const finish = h('button', { class: 'icon-btn', title: '完成整个系列' }, '✓✓');
      finish.onclick = async () => { if (await confirmDialog('完成整个系列？所有已生成与未来的实例都会标记完成。')) await save(e, { done: true, finishSeries: true }); };
      menuItems.append(finish);
    }
    if (onRemove) {
      const del = h('button', { type: 'button', class: 'icon-btn cal-board-del', title: `删除「${e.title}」`, 'aria-label': `删除「${e.title}」` }, '🗑');
      del.onclick = async ev => { ev.stopPropagation(); try { await onRemove(e); } catch (err) { toast(err.message, 'error'); } }; menuItems.append(del);
    }
    if (menuItems.children.length) actions.append(menu);
    r.append(actions); return r;
  };
  const tools = h('div', { class: 'row daily-board-tools' });
  tools.append(h('span', { class: 'col-head' }, '待办', h('span', { class: 'daily-count' }, String(pending.length))), h('span', { class: 'spacer' }));
  const pool = [...sections.ongoing, ...sections.candidates];
  const arrange = h('button', { class: 'btn btn-sm', 'aria-label': '安排任务' }, '安排任务');
  arrange.onclick = () => {
    const backdrop = h('div', { class: 'modal-backdrop' });
    const modal = h('div', { class: 'modal daily-arrange-modal' });
    const close = h('button', { class: 'btn btn-sm' }, '关闭'); close.onclick = () => backdrop.remove();
    const picked = new Set();
    const search = h('input', { class: 'input', type: 'search', 'aria-label': '搜索待安排任务', placeholder: '搜索任务或清单…' });
    const target = h('select', { class: 'input', 'aria-label': '批量安排时段' });
    for (const o of PERIODS) target.append(h('option', { value: o.value }, o.label)); target.value = '';
    const apply = h('button', { class: 'btn btn-primary', disabled: 'true' });
    apply.textContent = '安排选中任务';
    const list = h('div', { class: 'daily-pool-list' });
    const poolEntries = [...pending, ...pool];
    const update = () => {
      list.innerHTML = '';
      const q = search.value.trim().toLocaleLowerCase();
      for (const e of poolEntries.filter(e => !q || `${e.title} ${e.ownerLabel} ${(e.ancestors || []).join(' ')}`.toLocaleLowerCase().includes(q))) {
        const choice = h('input', { type: 'checkbox', 'aria-label': `选择安排：${e.title}` }); choice.checked = picked.has(e.base);
        choice.onchange = () => { choice.checked ? picked.add(e.base) : picked.delete(e.base); apply.disabled = !picked.size; apply.textContent = picked.size ? `安排选中 ${picked.size} 项` : '安排选中任务'; };
        list.append(h('div', { class: 'daily-pool-choice' }, choice, row(e, true, () => backdrop.remove())));
      }
      if (!list.children.length) list.append(h('p', { class: 'muted' }, '没有匹配的待办任务'));
    };
    search.oninput = update;
    apply.onclick = async () => {
      if (!picked.size) return;
      apply.disabled = true;
      if (await batch([...picked].map(base => ({ base, patch: { planDate: date, planPeriod: target.value || null, planTime: null, planEndTime: null, planOrder: null } })))) backdrop.remove();
      else apply.disabled = false;
    };
    modal.append(h('div', { class: 'modal-title row' }, '安排任务', h('span', { class: 'spacer' }), close),
      h('div', { class: 'modal-body' }, search, list), h('div', { class: 'modal-foot' }, target, apply));
    backdrop.append(modal); document.body.append(backdrop); update(); search.focus();
  };
  const timeline = h('details', { class: 'daily-timeline-fold' });
  timeline.append(h('summary', {}, '具体时间轴'));
  timeline.addEventListener('toggle', () => {
    if (!timeline.open) return;
    if (timeline.children.length === 1) timeline.append(buildTimeAxis(pending, date, e => editPlan(e, date, save, allEntries)));
  });
  tools.append(arrange); active.append(tools, timeline);
  const planned = h('div', { class: 'daily-planned' });
  for (const period of PERIODS) {
    const list = pending.filter(e => planningFor(e, date).period === period.value);
    if (period.value === 'evening' && !list.length) continue;
    const section = h('section', { class: `daily-period daily-period-${period.value || 'unassigned'}` + (date === todayStr() && period.value === (new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening') ? ' current-period' : ''), dataset: { period: period.value } });
    section.append(h('div', { class: 'daily-period-head' }, h('h2', {}, period.label, h('span', { class: 'daily-count' }, String(list.length))), h('span', { class: 'small muted' }, list.length ? planSummary(list, date) : '')));
    section.addEventListener('dragover', ev => { ev.preventDefault(); ev.stopPropagation(); section.classList.add('drop-hover'); });
    section.addEventListener('dragleave', () => section.classList.remove('drop-hover'));
    section.addEventListener('drop', ev => {
      ev.preventDefault(); ev.stopPropagation(); section.classList.remove('drop-hover');
      const e = dragEntries.get(ev.dataTransfer?.getData('text/plain'));
      if (e && !e.done) orderBefore(e, period.value);
    });
    if (list.length) for (const e of list) section.append(row(e));
    else section.append(h('p', { class: 'muted daily-period-empty' }, '拖入任务，或点击“安排任务”'));
    planned.append(section);
  }
  active.append(planned);
  for (const e of sections.done) completed.append(row(e));
  if (!sections.done.length) completed.append(h('p', { class: 'muted' }, '暂无任务'));
  const overdue = pool.filter(e => e.overdue);
  if (overdue.length) { const notice = h('button', { class: 'btn btn-sm daily-overdue-notice' }, `另有 ${overdue.length} 项逾期，待重新安排`); notice.onclick = arrange.onclick; active.append(notice); }
  wrap.append(active, completed); return wrap;
}
