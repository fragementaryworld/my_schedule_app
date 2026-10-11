'use strict';
const { isValidDateStr, addDays, daysBetween } = require('./dates');
const PLAN_FIELDS = ['planDate', 'planEndDate', 'planPeriod', 'planTime', 'planEndTime', 'planOrder'];
const fail = message => { const e = new Error(message); e.status = 400; throw e; };

function normalizePlanPatch(body, current = {}) {
  const patch = {};
  for (const k of PLAN_FIELDS) if (k in body) patch[k] = body[k];
  if ('planDate' in patch && patch.planDate !== null && !isValidDateStr(patch.planDate)) fail('安排日期无效');
  if ('planEndDate' in patch && patch.planEndDate !== null && !isValidDateStr(patch.planEndDate)) fail('安排结束日期无效');
  if ('planPeriod' in patch && patch.planPeriod !== null && !['morning', 'afternoon', 'evening'].includes(patch.planPeriod)) fail('安排时段无效');
  for (const k of ['planTime', 'planEndTime']) {
    if (k in patch && patch[k] !== null && (typeof patch[k] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch[k]))) fail('安排时间无效');
  }
  if ('planOrder' in patch && patch.planOrder !== null && (typeof patch.planOrder !== 'number' || !Number.isFinite(patch.planOrder) || patch.planOrder < 0)) fail('安排顺序无效');
  if (!Object.keys(patch).length) return patch;
  if (patch.planDate === null) return { ...patch, planEndDate: null, planPeriod: null, planTime: null, planEndTime: null, planOrder: null };
  // 改期默认平移整个安排区间；显式传结束日期时允许调整长度。
  if (patch.planDate && patch.planDate !== current.planDate && current.planEndDate && isValidDateStr(current.planDate) && !('planEndDate' in patch)) {
    patch.planEndDate = addDays(current.planEndDate, daysBetween(current.planDate, patch.planDate));
  }
  // 只选时段意味着恢复灵活安排，不制造具体开始时间。
  if ('planPeriod' in patch && !('planTime' in patch)) Object.assign(patch, { planTime: null, planEndTime: null });
  if (patch.planTime === null) patch.planEndTime = null;
  if ('planDate' in patch && patch.planDate !== current.planDate && !('planOrder' in patch)) patch.planOrder = null;
  const next = { ...current, ...patch };
  if (!next.planDate && (next.planEndDate || next.planPeriod || next.planTime || next.planOrder != null)) {
    if (isValidDateStr(current.date || body.date)) next.planDate = patch.planDate = current.date || body.date;
    else fail('请先选择安排日期');
  }
  if (next.planEndDate && next.planEndDate < next.planDate) fail('安排结束日期不能早于开始日期');
  if (next.planEndDate && next.planEndDate === next.planDate) patch.planEndDate = null;
  if (next.planEndTime && (!next.planTime || next.planEndTime <= next.planTime)) fail('结束时间必须晚于开始时间，请安排在同一天内');
  if (next.planTime) {
    const hour = Number(next.planTime.slice(0, 2));
    patch.planPeriod = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  }
  return patch;
}
module.exports = { PLAN_FIELDS, normalizePlanPatch };
