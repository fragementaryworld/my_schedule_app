'use strict';
const fs = require('fs');
const path = require('path');

function defaultData() {
  return {
    version: 1,
    preferences: { defaultHome: 'home', theme: 'light', weekStart: 'mon' },
    memos: [],
    tasks: [],
    projects: [],
    books: [],
    workouts: {
      exercises: [],
      schedule: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      logs: [],
      bodyData: []
    },
    ideas: []
  };
}

const ARRAY_KEYS = ['memos', 'tasks', 'projects', 'books', 'ideas'];

// 补齐缺失/类型错误的顶层字段，保证数据结构完整
function normalize(data) {
  const def = defaultData();
  if (!data || typeof data !== 'object' || Array.isArray(data)) return def;

  if (!data.preferences || typeof data.preferences !== 'object') {
    data.preferences = def.preferences;
  }
  for (const k of Object.keys(def.preferences)) {
    if (data.preferences[k] === undefined) data.preferences[k] = def.preferences[k];
  }

  for (const k of ARRAY_KEYS) {
    if (!Array.isArray(data[k])) data[k] = def[k];
  }

  if (!data.workouts || typeof data.workouts !== 'object' || Array.isArray(data.workouts)) {
    data.workouts = def.workouts;
  }
  for (const k of Object.keys(def.workouts)) {
    if (data.workouts[k] === undefined || data.workouts[k] === null) {
      data.workouts[k] = def.workouts[k];
    }
  }
  if (!Array.isArray(data.workouts.exercises)) data.workouts.exercises = [];
  if (!Array.isArray(data.workouts.logs)) data.workouts.logs = [];
  if (!Array.isArray(data.workouts.bodyData)) data.workouts.bodyData = [];
  if (!data.workouts.schedule || typeof data.workouts.schedule !== 'object') {
    data.workouts.schedule = def.workouts.schedule;
  }
  for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    if (!Array.isArray(data.workouts.schedule[day])) data.workouts.schedule[day] = [];
  }

  return data;
}

function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (e) {
    // Windows 上某些情况下 rename 覆盖失败，退化为先删后改名
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    fs.renameSync(tmp, filePath);
  }
}

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
    this.recoveredFromBackup = false;
  }

  load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = normalize(JSON.parse(raw));
        return true;
      } catch (e) {
        // 主文件损坏：尝试从自动备份恢复
        this._quarantineCorrupt();
        const bak = this.filePath + '.bak';
        if (fs.existsSync(bak)) {
          try {
            const rawBak = fs.readFileSync(bak, 'utf8');
            this.data = normalize(JSON.parse(rawBak));
            this.recoveredFromBackup = true;
          } catch (e2) {
            this.data = defaultData();
          }
        } else {
          this.data = defaultData();
        }
        this.save();
        return true;
      }
    }
    this.data = defaultData();
    this.save();
    return true;
  }

  _quarantineCorrupt() {
    const ts = Date.now();
    try {
      fs.renameSync(this.filePath, `${this.filePath}.corrupt-${ts}`);
    } catch (e) {
      /* 忽略：无法改名则保持原样 */
    }
  }

  get() {
    return this.data;
  }

  save() {
    // 先留一份上一步的自动备份
    if (fs.existsSync(this.filePath)) {
      try {
        fs.copyFileSync(this.filePath, this.filePath + '.bak');
      } catch (e) {
        /* 忽略备份失败 */
      }
    }
    atomicWrite(this.filePath, JSON.stringify(this.data, null, 2));
  }

  snapshot() {
    return JSON.stringify(this.data, null, 2);
  }

  replace(newData) {
    this.data = normalize(newData);
    this.save();
  }
}

module.exports = { Store, defaultData, normalize, atomicWrite };
