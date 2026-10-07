'use strict';
const { daysBetween, weekdayIndex } = require('./dates');

/**
 * 判断某个重复规则，从 startDate 开始，在 dateStr 这天是否会发生。
 * repeat 取值：
 *   null / undefined        —— 不重复
 *   'daily'                 —— 每天
 *   'weekly'                —— 每周同一天
 *   { interval, unit }      —— 自定义间隔，unit 为 'day' 或 'week'
 */
function occursOn(repeat, startDate, dateStr) {
  if (!repeat) return false;
  const diff = daysBetween(startDate, dateStr);
  if (diff < 0) return false; // 早于开始日期

  if (repeat === 'daily') return true;
  if (repeat === 'weekly') {
    return weekdayIndex(startDate) === weekdayIndex(dateStr);
  }
  if (repeat && typeof repeat === 'object') {
    const interval =
      Number.isInteger(repeat.interval) && repeat.interval >= 1 ? repeat.interval : 1;
    if (repeat.unit === 'week') {
      if (weekdayIndex(startDate) !== weekdayIndex(dateStr)) return false;
      const weeks = Math.floor(diff / 7);
      return weeks % interval === 0;
    }
    // 默认按天
    return diff % interval === 0;
  }
  return false;
}

module.exports = { occursOn };
