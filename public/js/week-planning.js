import { planningFor, isPlannedOn, comparePlan } from './planning.js';
import { spanDays, dragRangePatch } from './calendar.js';
import { timeRangeLabel } from './daytask.js';

// Execution periods come from planning fields, never from a project's deadline time.
export function weekPlanningModel(entries, dates) {
  const days = new Map(dates.map(date => [date, []]));
  const contexts = [];
  const spans = new Map();
  for (const entry of entries) {
    const raw = entry.raw || entry;
    if (!raw.planDate && (entry.spanDays > 1 || (entry.kind === 'project' && !entry.dueDate && entry.startDate))) {
      contexts.push({ ...entry, date: entry.spanTo, time: '', weekContext: true, original: entry });
      continue;
    }
    for (const date of dates) {
      const planned = isPlannedOn(entry, date) || (!raw.planDate && entry.kind === 'day' && entry.date === date);
      const due = (entry.kind === 'project' ? entry.dueDate : entry.endDate) === date;
      if (!planned && !due) continue;
      const p = planned ? planningFor(entry, date) : { period: '', time: '', endTime: '' };
      const from = planned && raw.planDate ? raw.planDate : date;
      const to = planned && raw.planDate ? raw.planEndDate || from : from;
      const event = { ...entry, original: entry, planOnly: true, date: from, planDate: from,
        planEndDate: to !== from ? to : null, spanFrom: from, spanTo: to,
        spanDays: spanDays({ from, to }), weekPeriod: p.period, deadlineOnly: !planned,
        time: timeRangeLabel(p.time, p.endTime), planTime: p.time, planEndTime: p.endTime };
      days.get(date).push(event);
      if (event.spanDays > 1) spans.set(entry.base, event);
    }
  }
  for (const [date, list] of days) list.sort((a, b) => comparePlan(a.original, b.original, date));
  return { days, spans: [...spans.values()], contexts };
}

// A horizontal move preserves exact times. Changing period intentionally replaces them;
// the view asks the user to review timed changes before saving.
export function weekMovePatch(entry, delta, period = entry.weekPeriod, mode = 'move') {
  const changedPeriod = mode === 'move' && period !== entry.weekPeriod;
  const patch = dragRangePatch(entry, delta, mode);
  if (!patch && !changedPeriod) return null;
  const result = patch || { planDate: entry.spanFrom };
  if (!entry.raw?.planDate || entry.deadlineOnly) {
    Object.assign(result, { planPeriod: entry.weekPeriod || null, planTime: entry.planTime || null,
      planEndTime: entry.planEndTime || null, planOrder: null });
    if (entry.deadlineOnly) result.planEndDate = null;
  }
  if (changedPeriod) Object.assign(result, { planPeriod: period || null, planTime: null, planEndTime: null, planOrder: null });
  return result;
}
