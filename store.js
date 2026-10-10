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
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// 补齐缺失/类型错误的顶层字段，保证数据结构完整
function normalize(data) {
  const def = defaultData();
  if (!isRecord(data)) return def;

  if (!isRecord(data.preferences)) {
    data.preferences = def.preferences;
  }
  for (const k of Object.keys(def.preferences)) {
    if (data.preferences[k] === undefined) data.preferences[k] = def.preferences[k];
  }

  for (const k of ARRAY_KEYS) {
    if (!Array.isArray(data[k])) data[k] = def[k];
  }

  if (!isRecord(data.workouts)) {
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
  if (!isRecord(data.workouts.schedule)) {
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
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (e) {
    // 覆盖失败时保留原文件；先删原文件会在第二次 rename 失败时丢失数据。
    try { fs.rmSync(tmp, { force: true }); } catch { /* 保留原始写入错误 */ }
    throw e;
  }
}

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
    this.recoveredFromBackup = false;
    this._diskContent = null;
  }

  load() {
    this.recoveredFromBackup = false;
    this._diskContent = null;
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this._diskContent = raw;
        this.data = normalize(JSON.parse(raw));
        return true;
      } catch (e) {
        // 权限/磁盘错误不表示 JSON 损坏，不能据此隔离并覆盖原数据。
        if (!(e instanceof SyntaxError)) throw e;
        // 主文件损坏：尝试从自动备份恢复
        this._quarantineCorrupt();
        const bak = this.filePath + '.bak';
        if (fs.existsSync(bak)) {
          try {
            const rawBak = fs.readFileSync(bak, 'utf8');
            this.data = normalize(JSON.parse(rawBak));
            this.recoveredFromBackup = true;
          } catch (e2) {
            if (!(e2 instanceof SyntaxError)) throw e2;
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
    // 隔离失败就停止恢复，避免 save() 把损坏文件复制到有效备份上。
    fs.renameSync(this.filePath, `${this.filePath}.corrupt-${ts}`);
    this._diskContent = null;
  }

  get() {
    return this.data;
  }

  save() {
    // 另一进程或外部编辑写入了新数据时，拒绝用本服务的旧内存快照覆盖。
    let diskContent = null;
    try { diskContent = fs.readFileSync(this.filePath, 'utf8'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (diskContent !== this._diskContent) {
      const error = new Error('数据文件已被其他进程修改，请重启服务后再保存。');
      error.status = 409;
      throw error;
    }
    const content = JSON.stringify(this.data, null, 2);
    // 先留一份上一步的自动备份
    if (fs.existsSync(this.filePath)) {
      try {
        fs.copyFileSync(this.filePath, this.filePath + '.bak');
      } catch (e) {
        /* 忽略备份失败 */
      }
    }
    atomicWrite(this.filePath, content);
    this._diskContent = content;
  }

  snapshot() {
    return JSON.stringify(this.data, null, 2);
  }

  replace(newData) {
    const previous = this.data;
    this.data = normalize(newData);
    try {
      this.save();
    } catch (e) {
      this.data = previous;
      throw e;
    }
  }
}

module.exports = { Store, defaultData, normalize, atomicWrite };
