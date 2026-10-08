'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
const { Store } = require('../store');
const { todayStr, isValidDateStr, weekdayIndex } = require('./dates');
const { occursOn } = require('./repeat');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEFAULT_DATA_FILE = path.join(__dirname, '..', 'data', 'data.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// 页面内容块类型（Notion 式）
const BLOCK_TYPES = ['text', 'h1', 'h2', 'h3', 'todo', 'bullet', 'number', 'quote', 'divider'];
const DEFAULT_ICON = '📁';

function newId() {
  return crypto.randomUUID();
}
function nowIso() {
  return new Date().toISOString();
}
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function findById(arr, id) {
  return arr.find((x) => x.id === id);
}

// 项目完成度由任务完成数量计算（百分比）
function computeProgress(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return 0;
  const done = tasks.filter((t) => t.done).length;
  return Math.round((done / tasks.length) * 100);
}

// 内容块通用 CRUD（页面与任务共用）
async function blockCrud(req, method, owner, blockId, store) {
  if (!Array.isArray(owner.blocks)) owner.blocks = [];

  if (method === 'PUT' && !blockId) {
    const b = await readBody(req);
    if (Array.isArray(b.order)) {
      const map = new Map(owner.blocks.map((x) => [x.id, x]));
      owner.blocks = b.order.map((bid) => map.get(bid)).filter(Boolean);
    }
    store.save();
    return { status: 200, body: owner.blocks };
  }
  if (method === 'POST' && !blockId) {
    const b = await readBody(req);
    const type = BLOCK_TYPES.includes(b.type) ? b.type : 'text';
    const block = { id: newId(), type, text: b.text || '', checked: !!b.checked };
    if (b.afterId) {
      const idx = owner.blocks.findIndex((x) => x.id === b.afterId);
      if (idx >= 0) owner.blocks.splice(idx + 1, 0, block);
      else owner.blocks.push(block);
    } else {
      owner.blocks.push(block);
    }
    store.save();
    return { status: 201, body: block };
  }
  if (method === 'PUT' && blockId) {
    const block = findById(owner.blocks, blockId);
    if (!block) throw httpError(404, 'block not found');
    const b = await readBody(req);
    if ('type' in b && BLOCK_TYPES.includes(b.type)) block.type = b.type;
    if ('text' in b) block.text = b.text;
    if ('checked' in b) block.checked = !!b.checked;
    store.save();
    return { status: 200, body: block };
  }
  if (method === 'DELETE' && blockId) {
    owner.blocks = owner.blocks.filter((x) => x.id !== blockId);
    store.save();
    return { status: 200, body: { ok: true } };
  }
  throw httpError(405, 'method not allowed');
}

function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(httpError(413, 'body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) return resolve({});
      try {
        resolve(JSON.parse(buf.toString('utf8')));
      } catch (e) {
        reject(httpError(400, 'invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(PUBLIC_DIR + path.sep) && normalized !== path.join(PUBLIC_DIR, 'index.html')) {
    return sendJson(res, 404, { error: 'not found' });
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, buf) => {
    if (err) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': type });
    res.end(buf);
  });
}

function sortTasks(list) {
  return list.slice().sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    const at = a.time || '99:99';
    const bt = b.time || '99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    return (a.order || 0) - (b.order || 0);
  });
}

// 重复任务按需生成：请求某日期时，补齐该日期的重复实例（只生成今天及以前）
function materializeTasksForDate(store, dateStr) {
  const data = store.get();
  const today = todayStr();
  const result = [];
  let added = false;

  for (const t of data.tasks) {
    if (!t.repeat) {
      if (t.date === dateStr) result.push(t);
      continue;
    }
    if (occursOn(t.repeat, t.date, dateStr)) {
      if (t.date === dateStr) {
        result.push(t);
        continue;
      }
      if (dateStr <= today) {
        const instId = `${t.id}@${dateStr}`;
        let inst = findById(data.tasks, instId);
        if (!inst) {
          inst = {
            id: instId,
            title: t.title,
            date: dateStr,
            time: t.time || null,
            priority: t.priority || 'medium',
            repeat: null,
            repeatOf: t.id,
            source: t.source || null,
            note: t.note || '',
            done: false,
            doneAt: null,
            order: t.order || 0,
            createdAt: nowIso()
          };
          data.tasks.push(inst);
          added = true;
        }
        result.push(inst);
      }
    }
  }
  if (added) store.save();
  return sortTasks(result);
}

function metaInfo(store) {
  let sizeBytes = null;
  try {
    sizeBytes = fs.statSync(store.filePath).size;
  } catch (e) {
    /* 文件不存在 */
  }
  return { filePath: store.filePath, sizeBytes };
}

async function handle(req, res, store) {
  const u = new URL(req.url, 'http://localhost');
  const pathname = u.pathname;
  const method = req.method || 'GET';

  if (pathname === '/' || !pathname.startsWith('/api/')) {
    return serveStatic(req, res, pathname);
  }

  const parts = pathname.split('/').filter(Boolean); // ['api','tasks','id', ...]
  const seg = parts.slice(1);
  const resource = seg[0];
  const id = seg[1];
  const sub = seg[2];
  const subId = seg[3];
  const subSub = seg[4];
  const subSubId = seg[5];
  const data = store.get();

  if (resource === 'meta') {
    if (method !== 'GET') throw httpError(405, 'method not allowed');
    return sendJson(res, 200, metaInfo(store));
  }

  if (resource === 'preferences') {
    if (method === 'GET') return sendJson(res, 200, data.preferences);
    if (method === 'PUT') {
      const b = await readBody(req);
      for (const k of Object.keys(b)) data.preferences[k] = b[k];
      store.save();
      return sendJson(res, 200, data.preferences);
    }
    throw httpError(405, 'method not allowed');
  }

  if (resource === 'memos') {
    if (method === 'GET') return sendJson(res, 200, data.memos);
    if (method === 'POST') {
      const b = await readBody(req);
      if (!b.text || !String(b.text).trim()) throw httpError(400, 'text required');
      const memo = { id: newId(), text: String(b.text).trim(), createdAt: nowIso() };
      data.memos.push(memo);
      store.save();
      return sendJson(res, 201, memo);
    }
    if ((method === 'PUT' || method === 'DELETE') && id) {
      const memo = findById(data.memos, id);
      if (!memo) throw httpError(404, 'memo not found');
      if (method === 'DELETE') {
        data.memos = data.memos.filter((x) => x.id !== id);
        store.save();
        return sendJson(res, 200, { ok: true });
      }
      const b = await readBody(req);
      if (b.text !== undefined) {
        if (!String(b.text).trim()) throw httpError(400, 'text required');
        memo.text = String(b.text).trim();
      }
      store.save();
      return sendJson(res, 200, memo);
    }
    throw httpError(405, 'method not allowed');
  }

  if (resource === 'tasks') {
    if (method === 'GET' && !id) {
      const date = u.searchParams.get('date') || todayStr();
      if (!isValidDateStr(date)) throw httpError(400, 'invalid date');
      return sendJson(res, 200, materializeTasksForDate(store, date));
    }
    if (method === 'POST' && !id) {
      const b = await readBody(req);
      if (!b.title || !String(b.title).trim()) throw httpError(400, 'title required');
      if (!isValidDateStr(b.date)) throw httpError(400, 'invalid date');
      const task = {
        id: newId(),
        title: String(b.title).trim(),
        date: b.date,
        time: b.time || null,
        priority: b.priority || 'medium',
        repeat: b.repeat || null,
        source: b.source || null,
        note: b.note || '',
        done: false,
        doneAt: null,
        order: typeof b.order === 'number' ? b.order : 0,
        createdAt: nowIso()
      };
      data.tasks.push(task);
      store.save();
      return sendJson(res, 201, task);
    }
    if (method === 'PUT' && id) {
      const t = findById(data.tasks, id);
      if (!t) throw httpError(404, 'task not found');
      const b = await readBody(req);
      const editable = ['title', 'date', 'time', 'priority', 'repeat', 'source', 'note', 'order'];
      for (const k of editable) {
        if (k in b) t[k] = b[k];
      }
      if ('done' in b) {
        t.done = !!b.done;
        t.doneAt = b.done ? nowIso() : null;
      }
      if (b.done && b.finishSeries) {
        const rootId = t.repeatOf || t.id;
        for (const x of data.tasks) {
          if (x.id === rootId || x.repeatOf === rootId) {
            x.done = true;
            x.doneAt = x.doneAt || nowIso();
          }
        }
      }
      store.save();
      return sendJson(res, 200, t);
    }
    if (method === 'DELETE' && id) {
      const t = findById(data.tasks, id);
      if (!t) throw httpError(404, 'task not found');
      if (t.repeat) {
        data.tasks = data.tasks.filter((x) => x.id !== id && x.repeatOf !== id);
      } else {
        data.tasks = data.tasks.filter((x) => x.id !== id);
      }
      store.save();
      return sendJson(res, 200, { ok: true });
    }
    throw httpError(405, 'method not allowed');
  }

  if (resource === 'projects') {
    if (method === 'GET' && !id) {
      const status = u.searchParams.get('status');
      const rootsOnly = u.searchParams.get('roots') === '1';
      let base = data.projects;
      if (rootsOnly) base = base.filter((p) => !p.parentId);
      if (status) base = base.filter((p) => p.status === status);
      const list = base.map((p) => ({ ...p, progress: computeProgress(p.tasks) }));
      return sendJson(res, 200, list);
    }
    if (method === 'POST' && !id) {
      const b = await readBody(req);
      if (!b.name || !String(b.name).trim()) throw httpError(400, 'name required');
      const parentId = b.parentId || null;
      if (parentId && !findById(data.projects, parentId)) throw httpError(400, 'parent not found');
      const project = {
        id: newId(),
        name: String(b.name).trim(),
        icon: b.icon || DEFAULT_ICON,
        cover: b.cover || '',
        parentId,
        goal: b.goal || '',
        status: b.status || 'active',
        startDate: b.startDate || todayStr(),
        dueDate: b.dueDate || null,
        priority: b.priority || 'medium',
        owner: b.owner || '',
        blockedBy: b.blockedBy || '',
        progress: 0,
        sourceIdeaId: b.sourceIdeaId || null,
        blocks: [],
        tasks: [],
        createdAt: nowIso()
      };
      data.projects.push(project);
      store.save();
      return sendJson(res, 201, project);
    }
    if (method === 'PUT' && id && !sub) {
      const p = findById(data.projects, id);
      if (!p) throw httpError(404, 'project not found');
      const b = await readBody(req);
      const editable = ['name', 'goal', 'status', 'startDate', 'dueDate', 'priority', 'owner', 'blockedBy', 'icon', 'cover'];
      for (const k of editable) if (k in b) p[k] = b[k];
      if ('parentId' in b) {
        const pid = b.parentId || null;
        if (pid === p.id) throw httpError(400, 'parent cannot be self');
        if (pid && !findById(data.projects, pid)) throw httpError(400, 'parent not found');
        p.parentId = pid;
      }
      store.save();
      return sendJson(res, 200, p);
    }
    if (method === 'DELETE' && id && !sub) {
      if (!findById(data.projects, id)) throw httpError(404, 'project not found');
      // 连同子孙页面一起删除
      const doomed = new Set([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const p of data.projects) {
          if (p.parentId && doomed.has(p.parentId) && !doomed.has(p.id)) {
            doomed.add(p.id);
            grew = true;
          }
        }
      }
      data.projects = data.projects.filter((x) => !doomed.has(x.id));
      store.save();
      return sendJson(res, 200, { ok: true, deleted: doomed.size });
    }
    if (method === 'POST' && id && sub === 'tasks' && !subSub) {
      const p = findById(data.projects, id);
      if (!p) throw httpError(404, 'project not found');
      const b = await readBody(req);
      if (!b.title || !String(b.title).trim()) throw httpError(400, 'title required');
      const t = { id: newId(), title: String(b.title).trim(), startDate: b.startDate || null, done: false, dueDate: b.dueDate || null, desc: b.desc || '', subtasks: [], blocks: [], order: p.tasks.length, createdAt: nowIso() };
      p.tasks.push(t);
      store.save();
      return sendJson(res, 201, t);
    }
    if (method === 'PUT' && id && sub === 'tasks' && subId && !subSub) {
      const p = findById(data.projects, id);
      if (!p) throw httpError(404, 'project not found');
      const t = findById(p.tasks, subId);
      if (!t) throw httpError(404, 'task not found');
      const b = await readBody(req);
      for (const k of ['title', 'done', 'order', 'dueDate', 'startDate', 'desc']) if (k in b) t[k] = b[k];
      store.save();
      return sendJson(res, 200, t);
    }
    if (method === 'DELETE' && id && sub === 'tasks' && subId && !subSub) {
      const p = findById(data.projects, id);
      if (!p) throw httpError(404, 'project not found');
      p.tasks = p.tasks.filter((x) => x.id !== subId);
      store.save();
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'POST' && id && sub === 'tasks' && subId && subSub === 'subtasks') {
      const p = findById(data.projects, id);
      if (!p) throw httpError(404, 'project not found');
      const t = findById(p.tasks, subId);
      if (!t) throw httpError(404, 'task not found');
      const b = await readBody(req);
      if (!b.title || !String(b.title).trim()) throw httpError(400, 'title required');
      const st = { id: newId(), title: String(b.title).trim(), done: false, createdAt: nowIso() };
      if (!Array.isArray(t.subtasks)) t.subtasks = [];
      t.subtasks.push(st);
      store.save();
      return sendJson(res, 201, st);
    }
    if (method === 'PUT' && id && sub === 'tasks' && subId && subSub === 'subtasks' && subSubId) {
      const p = findById(data.projects, id);
      if (!p) throw httpError(404, 'project not found');
      const t = findById(p.tasks, subId);
      if (!t) throw httpError(404, 'task not found');
      const st = findById(t.subtasks || [], subSubId);
      if (!st) throw httpError(404, 'subtask not found');
      const b = await readBody(req);
      for (const k of ['title', 'done']) if (k in b) st[k] = b[k];
      store.save();
      return sendJson(res, 200, st);
    }
    if (method === 'DELETE' && id && sub === 'tasks' && subId && subSub === 'subtasks' && subSubId) {
      const p = findById(data.projects, id);
      if (!p) throw httpError(404, 'project not found');
      const t = findById(p.tasks, subId);
      if (!t) throw httpError(404, 'task not found');
      t.subtasks = (t.subtasks || []).filter((x) => x.id !== subSubId);
      store.save();
      return sendJson(res, 200, { ok: true });
    }
    if (id && sub === 'blocks') {
      const p = findById(data.projects, id);
      if (!p) throw httpError(404, 'project not found');
      const r = await blockCrud(req, method, p, subId, store);
      return sendJson(res, r.status, r.body);
    }
    if (id && sub === 'tasks' && subId && subSub === 'blocks') {
      const p = findById(data.projects, id);
      if (!p) throw httpError(404, 'project not found');
      const t = findById(p.tasks, subId);
      if (!t) throw httpError(404, 'task not found');
      const r = await blockCrud(req, method, t, subSubId, store);
      return sendJson(res, r.status, r.body);
    }
    throw httpError(405, 'method not allowed');
  }

  if (resource === 'books') {
    if (method === 'GET' && !id) {
      const status = u.searchParams.get('status');
      const list = status ? data.books.filter((b) => b.status === status) : data.books;
      return sendJson(res, 200, list);
    }
    if (method === 'POST' && !id) {
      const b = await readBody(req);
      if (!b.title || !String(b.title).trim()) throw httpError(400, 'title required');
      const book = {
        id: newId(),
        title: String(b.title).trim(),
        author: b.author || '',
        status: b.status || 'want',
        current: typeof b.current === 'number' ? b.current : 0,
        total: typeof b.total === 'number' ? b.total : null,
        unit: b.unit || 'page',
        doneDate: null,
        review: '',
        notes: [],
        createdAt: nowIso()
      };
      data.books.push(book);
      store.save();
      return sendJson(res, 201, book);
    }
    if (method === 'PUT' && id && !sub) {
      const book = findById(data.books, id);
      if (!book) throw httpError(404, 'book not found');
      const b = await readBody(req);
      const editable = ['title', 'author', 'status', 'current', 'total', 'unit', 'review'];
      for (const k of editable) if (k in b) book[k] = b[k];
      if (book.status === 'done' && !book.doneDate) book.doneDate = todayStr();
      if (book.status !== 'done') book.doneDate = null;
      store.save();
      return sendJson(res, 200, book);
    }
    if (method === 'DELETE' && id && !sub) {
      if (!findById(data.books, id)) throw httpError(404, 'book not found');
      data.books = data.books.filter((x) => x.id !== id);
      store.save();
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'POST' && id && sub === 'notes') {
      const book = findById(data.books, id);
      if (!book) throw httpError(404, 'book not found');
      const b = await readBody(req);
      const note = {
        id: newId(),
        excerpt: b.excerpt || '',
        thought: b.thought || '',
        createdAt: nowIso()
      };
      book.notes.push(note);
      store.save();
      return sendJson(res, 201, note);
    }
    if (method === 'PUT' && id && sub === 'notes' && subId) {
      const book = findById(data.books, id);
      if (!book) throw httpError(404, 'book not found');
      const n = findById(book.notes, subId);
      if (!n) throw httpError(404, 'note not found');
      const b = await readBody(req);
      for (const k of ['excerpt', 'thought']) if (k in b) n[k] = b[k];
      store.save();
      return sendJson(res, 200, n);
    }
    if (method === 'DELETE' && id && sub === 'notes' && subId) {
      const book = findById(data.books, id);
      if (!book) throw httpError(404, 'book not found');
      book.notes = book.notes.filter((x) => x.id !== subId);
      store.save();
      return sendJson(res, 200, { ok: true });
    }
    throw httpError(405, 'method not allowed');
  }

  if (resource === 'workouts') {
    if (method === 'GET' && !id) {
      const todayKey = WEEKDAYS[weekdayIndex(todayStr())];
      const w = data.workouts;
      const todayExerciseIds = w.schedule[todayKey] || [];
      return sendJson(res, 200, {
        exercises: w.exercises,
        schedule: w.schedule,
        logs: w.logs,
        bodyData: w.bodyData,
        todayKey,
        todayExerciseIds
      });
    }
    if (method === 'POST' && id === 'exercises') {
      const b = await readBody(req);
      if (!b.name || !String(b.name).trim()) throw httpError(400, 'name required');
      const ex = {
        id: newId(),
        name: String(b.name).trim(),
        part: b.part || '',
        sets: b.sets || 0,
        reps: b.reps || 0,
        weight: b.weight || ''
      };
      data.workouts.exercises.push(ex);
      store.save();
      return sendJson(res, 201, ex);
    }
    if (method === 'PUT' && id === 'exercises' && subId) {
      const ex = findById(data.workouts.exercises, subId);
      if (!ex) throw httpError(404, 'exercise not found');
      const b = await readBody(req);
      for (const k of ['name', 'part', 'sets', 'reps', 'weight']) if (k in b) ex[k] = b[k];
      store.save();
      return sendJson(res, 200, ex);
    }
    if (method === 'DELETE' && id === 'exercises' && subId) {
      data.workouts.exercises = data.workouts.exercises.filter((x) => x.id !== subId);
      store.save();
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'PUT' && id === 'schedule') {
      const b = await readBody(req);
      for (const day of WEEKDAYS) {
        if (Array.isArray(b[day])) data.workouts.schedule[day] = b[day];
      }
      store.save();
      return sendJson(res, 200, data.workouts.schedule);
    }
    if (method === 'GET' && id === 'logs') {
      return sendJson(res, 200, data.workouts.logs);
    }
    if (method === 'POST' && id === 'logs') {
      const b = await readBody(req);
      const log = {
        id: newId(),
        date: b.date || todayStr(),
        exercises: Array.isArray(b.exercises) ? b.exercises : [],
        duration: b.duration || '',
        note: b.note || '',
        createdAt: nowIso()
      };
      data.workouts.logs.push(log);
      store.save();
      return sendJson(res, 201, log);
    }
    if (method === 'GET' && id === 'body') {
      return sendJson(res, 200, data.workouts.bodyData);
    }
    if (method === 'POST' && id === 'body') {
      const b = await readBody(req);
      const rec = {
        id: newId(),
        date: b.date || todayStr(),
        weight: b.weight || null,
        measurements: b.measurements || {},
        createdAt: nowIso()
      };
      data.workouts.bodyData.push(rec);
      store.save();
      return sendJson(res, 201, rec);
    }
    throw httpError(405, 'method not allowed');
  }

  if (resource === 'ideas') {
    if (method === 'GET' && !id) return sendJson(res, 200, data.ideas);
    if (method === 'POST' && !id) {
      const b = await readBody(req);
      if (!b.title || !String(b.title).trim()) throw httpError(400, 'title required');
      const idea = {
        id: newId(),
        title: String(b.title).trim(),
        desc: b.desc || '',
        tags: Array.isArray(b.tags) ? b.tags : [],
        status: b.status || 'idea',
        projectId: null,
        createdAt: nowIso()
      };
      data.ideas.push(idea);
      store.save();
      return sendJson(res, 201, idea);
    }
    if (method === 'PUT' && id && !sub) {
      const idea = findById(data.ideas, id);
      if (!idea) throw httpError(404, 'idea not found');
      const b = await readBody(req);
      const editable = ['title', 'desc', 'tags', 'status'];
      for (const k of editable) if (k in b) idea[k] = b[k];
      store.save();
      return sendJson(res, 200, idea);
    }
    if (method === 'DELETE' && id && !sub) {
      if (!findById(data.ideas, id)) throw httpError(404, 'idea not found');
      data.ideas = data.ideas.filter((x) => x.id !== id);
      store.save();
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'POST' && id && sub === 'to-project') {
      const idea = findById(data.ideas, id);
      if (!idea) throw httpError(404, 'idea not found');
      const project = {
        id: newId(),
        name: idea.title,
        icon: DEFAULT_ICON,
        cover: '',
        parentId: null,
        goal: idea.desc || '',
        status: 'active',
        startDate: todayStr(),
        dueDate: null,
        priority: 'medium',
        owner: '',
        blockedBy: '',
        progress: 0,
        sourceIdeaId: idea.id,
        blocks: [],
        tasks: [],
        createdAt: nowIso()
      };
      data.projects.push(project);
      idea.projectId = project.id;
      if (idea.status === 'idea') idea.status = 'planning';
      store.save();
      return sendJson(res, 201, project);
    }
    if (method === 'POST' && id && sub === 'to-task') {
      const idea = findById(data.ideas, id);
      if (!idea) throw httpError(404, 'idea not found');
      const b = await readBody(req);
      const date = b.date && isValidDateStr(b.date) ? b.date : todayStr();
      const task = {
        id: newId(),
        title: idea.title,
        date,
        time: b.time || null,
        priority: b.priority || 'medium',
        repeat: null,
        source: { type: 'idea', id: idea.id },
        note: idea.desc || '',
        done: false,
        doneAt: null,
        order: data.tasks.filter((t) => t.date === date).length,
        createdAt: nowIso()
      };
      data.tasks.push(task);
      store.save();
      return sendJson(res, 201, task);
    }
    throw httpError(405, 'method not allowed');
  }

  if (resource === 'backup') {
    if (method === 'GET' && id === 'export') {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const body = store.snapshot();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="backup-${ts}.json"`
      });
      return res.end(body);
    }
    if (method === 'POST' && id === 'import') {
      const b = await readBody(req);
      if (!b || typeof b !== 'object' || Array.isArray(b)) throw httpError(400, 'invalid backup');
      store.replace(b);
      return sendJson(res, 200, { ok: true });
    }
    throw httpError(405, 'method not allowed');
  }

  if (resource === 'save') {
    if (method !== 'POST') throw httpError(405, 'method not allowed');
    store.save();
    return sendJson(res, 200, { ok: true, sizeBytes: metaInfo(store).sizeBytes });
  }

  throw httpError(404, 'not found');
}

function createApp({ dataFile = DEFAULT_DATA_FILE } = {}) {
  const store = new Store(dataFile);
  store.load();
  const server = http.createServer((req, res) => {
    handle(req, res, store).catch((e) => {
      const status = e.status || 500;
      sendJson(res, status, { error: e.message || 'server error' });
    });
  });
  server.store = store;
  return server;
}

module.exports = { createApp, DEFAULT_DATA_FILE };
