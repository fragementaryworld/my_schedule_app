'use strict';

function pad(n) {
  return String(n).padStart(2, '0');
}

// Date -> 'YYYY-MM-DD'（使用本地时间）
function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayStr() {
  return toDateStr(new Date());
}

// 'YYYY-MM-DD' -> 本地时区的 Date（当天 00:00）
function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isValidDateStr(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const dt = parseDate(str);
  return (
    dt.getFullYear() === Number(str.slice(0, 4)) &&
    dt.getMonth() === Number(str.slice(5, 7)) - 1 &&
    dt.getDate() === Number(str.slice(8, 10))
  );
}

function addDays(str, n) {
  const d = parseDate(str);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

// 两个日期相差的天数（to - from）
function daysBetween(fromStr, toStr) {
  const a = parseDate(fromStr);
  const b = parseDate(toStr);
  return Math.round((b - a) / 86400000);
}

// 星期索引，周一 = 0
function weekdayIndex(str) {
  return (parseDate(str).getDay() + 6) % 7;
}

module.exports = {
  pad,
  toDateStr,
  todayStr,
  parseDate,
  isValidDateStr,
  addDays,
  daysBetween,
  weekdayIndex
};
