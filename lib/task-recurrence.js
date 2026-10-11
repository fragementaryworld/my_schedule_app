'use strict';
const { todayStr, addDays, daysBetween } = require('./dates');
const { occursOn } = require('./repeat');
const DEFAULT_DATE_FORMAT = 'ymd';
const nowIso = () => new Date().toISOString();
function sortTasks(list) {
  return list.sort((a, b) => Number(!!a.done) - Number(!!b.done)
    || String(a.time || '99:99').localeCompare(String(b.time || '99:99'))
    || (a.order || 0) - (b.order || 0));
}
// 重复任务按需生成：请求某日期时，补齐该日期的重复实例（只生成今天及以前）
function materializeTasksForDate(store, dateStr) {
  const data = store.get();
  const today = todayStr();
  const result = new Map();
  const indexed = new Map(data.tasks.map(task => [task.id, task]));
  let added = false;

  for (const t of [...data.tasks]) {
    if (!t.repeat) {
      if (t.date === dateStr) result.set(t.id, t);
      continue;
    }
    if (occursOn(t.repeat, t.date, dateStr)) {
      if ((t.repeatSkippedDates || []).includes(dateStr)) continue;
      if (t.date === dateStr) {
        result.set(t.id, t);
        continue;
      }
      if (dateStr <= today) {
        const instId = `${t.id}@${dateStr}`;
        let inst = indexed.get(instId);
        if (!inst) {
          inst = {
            id: instId,
            title: t.title,
            date: dateStr,
            time: t.time || null,
            endDate: t.endDate ? addDays(t.endDate, daysBetween(t.date, dateStr)) : null,
            endTime: t.endTime || null,
            priority: t.priority || 'medium',
            repeat: null,
            repeatOf: t.id,
            source: t.source || null,
            note: t.note || '',
            dateFormat: t.dateFormat || DEFAULT_DATE_FORMAT,
            estimate: t.estimate || null,
            ...(t.projectId !== undefined ? { projectId: t.projectId } : {}),
            ...(t.listId !== undefined ? { listId: t.listId } : {}),
            planPeriod: t.planPeriod || null,
            planTime: t.planTime || null,
            planEndTime: t.planEndTime || null,
            routineTag: t.routineTag || '',
            planDate: (t.planPeriod || t.planTime || t.planDate) ? dateStr : null,
            planEndDate: t.planEndDate ? addDays(dateStr, daysBetween(t.planDate || t.date, t.planEndDate)) : null,
            done: !!t.repeatFinishedAt,
            doneAt: t.repeatFinishedAt || null,
            order: t.order || 0,
            createdAt: nowIso()
          };
          data.tasks.push(inst);
          added = true;
        }
        result.set(inst.id, inst);
      }
    }
  }
  if (added) store.save();
  return sortTasks([...result.values()]);
}

module.exports = { materializeTasksForDate };
