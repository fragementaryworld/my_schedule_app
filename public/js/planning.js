import { h, openModal, toast } from './ui.js';
import { timeRangeLabel } from './daytask.js';
import { todayStr } from './utils.js';
import { api } from './api.js';

export const PERIODS = [
  { value: 'morning', label: '上午' },
  { value: 'afternoon', label: '下午' },
  { value: 'evening', label: '晚上' },
  { value: '', label: '当天待安排' }
];

export function periodForTime(time) {
  if (!time) return '';
  const hour = Number(time.slice(0, 2));
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

export function planningFor(entry, date) {
  const t = entry.raw || entry;
  const plannedDate = t.planDate || (entry.kind === 'day' && (!t.endDate || t.endDate === t.date) ? t.date : null);
  if (plannedDate !== date) return { period: '', time: '', endTime: '', order: null };
  const legacy = !t.planDate && entry.kind === 'day';
  const time = t.planTime || (legacy ? t.time : '') || '';
  const endTime = t.planEndTime || (legacy ? t.endTime : '') || '';
  return { period: time ? periodForTime(time) : (t.planPeriod || ''), time, endTime, order: t.planOrder ?? null };
}

export function comparePlan(a, b, date) {
  const x = planningFor(a, date), y = planningFor(b, date);
  if (x.time || y.time) return (x.time || '99:99').localeCompare(y.time || '99:99');
  return (x.order ?? Number.MAX_SAFE_INTEGER) - (y.order ?? Number.MAX_SAFE_INTEGER)
    || (a.order || 0) - (b.order || 0) || a.title.localeCompare(b.title, 'zh-CN');
}

export function planSummary(entries, date) {
  let minutes = 0, unknown = 0;
  for (const e of entries) {
    const p = planningFor(e, date);
    const minute = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const duration = p.time && p.endTime ? minute(p.endTime) - minute(p.time) : Number(e.estimate || 0);
    if (duration > 0) minutes += duration;
    else unknown++;
  }
  const time = minutes >= 60 ? `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}` : `${minutes} 分钟`;
  return `${minutes ? `已安排用时 ${time}` : '用时未估算'}${unknown ? ` · ${unknown} 项未估算` : ''}`;
}

export function timeConflicts(entries, date, base, start, end) {
  if (!start || !end) return [];
  return entries.filter(e => {
    const p = planningFor(e, date);
    return !e.done && e.base !== base && p.time && p.endTime && p.time < end && p.endTime > start;
  });
}

export function editPlan(entry, date, save, entries = []) {
  const p = planningFor(entry, date);
  return openModal({
    title: `安排：${entry.title}`, submitText: '保存安排',
    fields: [
      { name: 'date', label: '安排日期', type: 'date', value: date, required: true },
      { name: 'period', label: '时段', type: 'select', value: p.period, options: PERIODS, onChange: (_, controls) => { controls.time.value = ''; controls.end.value = ''; } },
      { name: 'time', label: '开始时间（可留空）', type: 'time', value: p.time, help: '只选时段即可。填写具体时间后，按开始时间确定时段。', onChange: (time, controls) => { controls.period.value = periodForTime(time); if (!time) controls.end.value = ''; } },
      { name: 'end', label: '结束时间（可留空）', type: 'time', value: p.endTime },
      { name: 'allowOverlap', label: '允许与已有安排重叠', type: 'checkbox', value: false }
    ],
    onSubmit: async v => {
      if (v.end && (!v.time || v.end <= v.time)) return { ok: false, error: '结束时间必须晚于开始时间，请安排在同一天内' };
      const conflicts = timeConflicts(entries, v.date, entry.base, v.time, v.end);
      if (conflicts.length && !v.allowOverlap) return { ok: false, error: `与「${conflicts.map(e => e.title).join('、')}」时间重叠；请调整时间或勾选允许重叠` };
      const patch = { planDate: v.date, planPeriod: v.time ? periodForTime(v.time) : (v.period || null), planTime: v.time || null, planEndTime: v.end || null, planOrder: null };
      if (!(await save(entry, patch))) return { ok: false, error: '安排未保存，请重试' };
    }
  });
}

export function buildPlanProperty(task, base, save) {
  const entry = { ...task, kind: base.startsWith('/api/tasks/') ? 'day' : 'project', base, raw: task };
  const date = task.planDate || (entry.kind === 'day' ? task.date : null);
  const p = planningFor(entry, date);
  const text = date ? `${date} · ${p.time ? timeRangeLabel(p.time, p.endTime) : PERIODS.find(o => o.value === p.period).label}` : '未安排';
  const wrap = h('div', { class: 'row plan-property' });
  const edit = h('button', { class: 'btn btn-sm', type: 'button' }, date ? '调整安排' : '安排任务');
  edit.onclick = async () => {
    try {
      const target = date || todayStr();
      const [tasks, projects] = await Promise.all([api.get(`/api/tasks?from=${target}&to=${target}&includePool=1`), api.get('/api/projects')]);
      const { dailyEntries } = await import('./daily.js');
      await editPlan(entry, target, save, dailyEntries(tasks, projects));
    } catch (err) { toast(err.message, 'error'); }
  };
  wrap.append(h('span', { class: 'small' }, text), edit);
  return wrap;
}

export function buildTimeAxis(entries, date, onEdit) {
  const timed = entries.map(e => ({ e, p: planningFor(e, date) })).filter(x => x.p.time);
  const wrap = h('div', { class: 'daily-time-axis', 'aria-label': '当天具体时间安排' });
  if (!timed.length) { wrap.append(h('p', { class: 'muted' }, '填写具体开始时间后，任务会显示在时间轴中。')); return wrap; }
  const minute = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const from = Math.min(8, ...timed.map(x => Math.floor(minute(x.p.time) / 60)));
  const to = Math.min(24, Math.max(18, ...timed.map(x => Math.ceil(minute(x.p.endTime || x.p.time) / 60) + 1)));
  const grid = h('div', { class: 'daily-time-grid', style: `height:${(to - from) * 48}px` });
  for (let hour = from; hour <= to; hour++) grid.append(h('div', { class: 'daily-time-hour', style: `top:${(hour - from) * 48}px` }, `${String(hour).padStart(2, '0')}:00`));
  const laneEnds = [];
  const blocks = timed.sort((a, b) => a.p.time.localeCompare(b.p.time)).map(({ e, p }) => {
    const start = minute(p.time), end = p.endTime ? minute(p.endTime) : start + 30;
    let lane = laneEnds.findIndex(until => until <= start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = end;
    return { e, p, lane, top: (start - from * 60) * .8, height: Math.max(28, (end - start) * .8) };
  });
  for (const b of blocks) {
    const block = h('button', { class: 'daily-time-block', type: 'button', style: `top:${b.top}px;height:${b.height}px;left:calc(60px + (100% - 64px) * ${b.lane / laneEnds.length});width:calc((100% - 64px) / ${laneEnds.length} - 4px)`, title: `${b.e.title} · ${timeRangeLabel(b.p.time, b.p.endTime)}${b.p.endTime ? '' : '（结束时间未设）'}` }, `${timeRangeLabel(b.p.time, b.p.endTime)} ${b.e.title}`);
    block.onclick = () => onEdit(b.e); grid.append(block);
  }
  wrap.append(grid); return wrap;
}
