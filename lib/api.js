'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
const { Store } = require('../store');
const { readBody, createDispatcher } = require('./request-dispatch');
const { apiSegments } = require('./api-path');
const { prepareBackup } = require('./backup');
const { migrateDateFormats, migrateBlocksToDesc } = require('./migrate');
const { todayStr, isValidDateStr, weekdayIndex, addDays, daysBetween } = require('./dates');
const { materializeTasksForDate } = require('./task-recurrence');
const { PLAN_FIELDS, normalizePlanPatch } = require('./planning');

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

// 任务层级（任务 → 子任务 → 子子任务 …）统一处理，最多 5 层
const MAX_ITEM_DEPTH = 5;
// 预计用时（分钟）：空/0 → null，非法 → 报错
function normEstimate(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw httpError(400, 'invalid estimate');
  const rounded = Math.round(n);
  return rounded > 0 ? rounded : null;
}

const ITEM_EDITABLE = ['title', 'done', 'order', 'dueDate', 'startDate', 'startTime', 'dueTime', 'dateFormat', 'desc', 'estimate', ...PLAN_FIELDS];

function validatePlanDate(b) {
  if ('planDate' in b && b.planDate !== null && !isValidDateStr(b.planDate)) throw httpError(400, 'invalid planDate');
}

function validateOrganization(b, data) {
  validatePlanDate(b);
  if ('projectId' in b && b.projectId !== null && !findById(data.projects, b.projectId)) throw httpError(400, 'project not found');
  if ('listId' in b && b.listId !== null && !['inbox', 'work', 'personal'].includes(b.listId)) throw httpError(400, 'invalid listId');
  if (b.listId && b.projectId) throw httpError(400, 'choose one task owner');
  if ('routineTag' in b && !['', 'admin', 'communication', 'organizing'].includes(b.routineTag)) throw httpError(400, 'invalid routineTag');
}

function validateCategory(b) {
  if ('category' in b && !['work', 'temporary'].includes(b.category)) throw httpError(400, 'invalid category');
}

// 默认日期格式：年/月/日
const DEFAULT_DATE_FORMAT = 'ymd';

function newItem(b) {
  validatePlanDate(b);
  return {
    id: newId(),
    title: String(b.title).trim(),
    done: false,
    startDate: b.startDate || null,
    dueDate: b.dueDate || null,
    startTime: b.startTime || null,
    dueTime: b.dueTime || null,
    dateFormat: b.dateFormat || DEFAULT_DATE_FORMAT,
    desc: b.desc || '',
    estimate: normEstimate(b.estimate),
    planDate: b.planDate || null,
    ...normalizePlanPatch(b),
    subtasks: [],
    blocks: [],
    createdAt: nowIso()
  };
}

// 解析 ['tasks', t1, 'subtasks', s1, 'subtasks', s2, …] 链
// 返回 { node, parent, key, chain, rest }
function resolveItemChain(project, spec) {
  if (!project || !Array.isArray(spec) || spec[0] !== 'tasks' || !spec[1]) return null;
  let node = findById(project.tasks || [], spec[1]);
  if (!node) return null;
  let parent = project;
  let key = 'tasks';
  const chain = [spec[1]];
  let i = 2;
  while (spec[i] === 'subtasks' && spec[i + 1]) {
    const childId = spec[i + 1];
    const child = findById(node.subtasks || [], childId);
    if (!child) return null;
    parent = node;
    key = 'subtasks';
    node = child;
    chain.push(childId);
    i += 2;
  }
  // 尾巴可能是 []、['subtasks']（在这一层下新建）或 ['blocks', bid]
  return { node, parent, key, chain, rest: spec.slice(i) };
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

  const parts = apiSegments(pathname); // 每段分别解码，编码后的斜杠不能改变路由层级。
  const seg = parts.slice(1);
  const [resource, id, sub, subId] = seg;
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

  if (resource === 'planning' && id === 'batch' && method === 'POST') {
    const b = await readBody(req);
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 200) throw httpError(400, 'invalid planning batch');
    const seen = new Set();
    const changes = b.items.map(change => {
      if (typeof change.base !== 'string' || !change.patch || typeof change.patch !== 'object') throw httpError(400, 'invalid planning item');
      if (seen.has(change.base) || Object.keys(change.patch).some(k => !PLAN_FIELDS.includes(k))) throw httpError(400, 'invalid planning patch');
      seen.add(change.base);
      const parts = apiSegments(change.base);
      let node;
      if (parts[0] === 'api' && parts[1] === 'tasks' && parts.length === 3) node = findById(data.tasks, parts[2]);
      else if (parts[0] === 'api' && parts[1] === 'projects') {
        const info = resolveItemChain(findById(data.projects, parts[2]), parts.slice(3));
        if (info && !info.rest.length) node = info.node;
      }
      if (!node) throw httpError(404, 'task not found');
      return { node, patch: normalizePlanPatch(change.patch, node) };
    });
    // 所有任务验证通过后再一起修改和保存，排序和批量安排不会只成功一半。
    for (const change of changes) Object.assign(change.node, change.patch);
    store.save();
    return sendJson(res, 200, { ok: true, updated: changes.length });
  }

  if (resource === 'tasks') {
    if (method === 'GET' && !id) {
      const from = u.searchParams.get('from');
      const to = u.searchParams.get('to');
      if (from || to) {
        if (!isValidDateStr(from) || !isValidDateStr(to)) throw httpError(400, 'invalid range');
        if (to < from) throw httpError(400, 'invalid range');
        if (daysBetween(from, to) > 62) throw httpError(400, 'range too large');
        const out = [];
        const seen = new Set();
        for (let d = from; d <= to; d = addDays(d, 1)) {
          for (const t of materializeTasksForDate(store, d)) {
            if (seen.has(t.id)) continue;
            seen.add(t.id);
            out.push(t);
          }
        }
        // 跨多天的任务：开始日可能早于区间，只要与区间有交集就要带出来
        for (const t of data.tasks) {
          if (seen.has(t.id)) continue;
          const end = t.endDate || t.date;
          if ((t.date <= to && end >= from) || (t.planDate >= from && t.planDate <= to)) {
            seen.add(t.id);
            out.push(t);
          }
        }
        return sendJson(res, 200, u.searchParams.get('includePool') === '1' ? data.tasks : out);
      }
      const date = u.searchParams.get('date') || todayStr();
      if (!isValidDateStr(date)) throw httpError(400, 'invalid date');
      return sendJson(res, 200, materializeTasksForDate(store, date));
    }
    if (method === 'GET' && id) {
      const t = findById(data.tasks, id);
      if (!t) throw httpError(404, 'task not found');
      return sendJson(res, 200, t);
    }
    if (method === 'POST' && !id) {
      const b = await readBody(req);
      if (!b.title || !String(b.title).trim()) throw httpError(400, 'title required');
      if (!isValidDateStr(b.date)) throw httpError(400, 'invalid date');
      if (b.endDate !== undefined && b.endDate !== null && !isValidDateStr(b.endDate)) throw httpError(400, 'invalid endDate');
      validateOrganization(b, data);
      const task = {
        id: newId(),
        title: String(b.title).trim(),
        date: b.date,
        time: b.time || null,
        endDate: b.endDate || null,
        endTime: b.endTime || null,
        priority: b.priority || 'medium',
        repeat: b.repeat || null,
        source: b.source || null,
        note: b.note || '',
        dateFormat: b.dateFormat || DEFAULT_DATE_FORMAT,
        estimate: normEstimate(b.estimate),
        projectId: b.projectId || null,
        listId: b.projectId ? null : (b.listId || 'inbox'),
        routineTag: b.routineTag || '',
        planDate: b.planDate || null,
        ...normalizePlanPatch(b, { date: b.date }),
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
      if ('endDate' in b && b.endDate !== null && !isValidDateStr(b.endDate)) throw httpError(400, 'invalid endDate');
      validateOrganization(b, data);
      Object.assign(b, normalizePlanPatch(b, t));
      const editable = ['title', 'date', 'time', 'endDate', 'endTime', 'priority', 'repeat', 'source', 'note', 'order', 'dateFormat', 'projectId', 'listId', 'routineTag', ...PLAN_FIELDS];
      for (const k of editable) {
        if (k in b) t[k] = b[k];
      }
      if (b.projectId) t.listId = null;
      else if (b.listId) t.projectId = null;
      if ('estimate' in b) t.estimate = normEstimate(b.estimate);
      if ('done' in b) {
        t.done = !!b.done;
        t.doneAt = b.done ? nowIso() : null;
      }
      if (b.done && b.finishSeries) {
        const rootId = t.repeatOf || t.id;
        const root = findById(data.tasks, rootId);
        if (root && root.repeat) root.repeatFinishedAt = nowIso();
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
        if (t.repeatOf) {
          const root = findById(data.tasks, t.repeatOf);
          // 改期后的实例也要跳过原发生日，否则下一次查询会复活。
          const occurrenceDate = t.id.slice(t.repeatOf.length + 1);
          if (root && isValidDateStr(occurrenceDate)) {
            root.repeatSkippedDates = [...new Set([...(root.repeatSkippedDates || []), occurrenceDate])];
          }
        }
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
      validateCategory(b);
      const parentId = b.parentId || null;
      if (parentId && !findById(data.projects, parentId)) throw httpError(400, 'parent not found');
      const project = {
        id: newId(),
        name: String(b.name).trim(),
        category: b.category || 'work',
        icon: b.icon || DEFAULT_ICON,
        cover: b.cover || '',
        parentId,
        goal: b.goal || '',
        desc: b.desc || '',
        status: b.status || 'active',
        startDate: b.startDate || todayStr(),
        dueDate: b.dueDate || null,
        startTime: b.startTime || null,
        dueTime: b.dueTime || null,
        dateFormat: b.dateFormat || DEFAULT_DATE_FORMAT,
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
      validateCategory(b);
      const editable = ['name', 'goal', 'desc', 'status', 'startDate', 'dueDate', 'startTime', 'dueTime', 'dateFormat', 'priority', 'owner', 'blockedBy', 'icon', 'cover', 'category'];
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
    // 在项目下新建任务（第 1 层）
    if (method === 'POST' && id && sub === 'tasks' && !subId) {
      const p = findById(data.projects, id);
      if (!p) throw httpError(404, 'project not found');
      const b = await readBody(req);
      if (!b.title || !String(b.title).trim()) throw httpError(400, 'title required');
      const t = newItem(b);
      t.order = p.tasks.length;
      p.tasks.push(t);
      store.save();
      return sendJson(res, 201, t);
    }
    // 任意层级：/tasks/:t1[/subtasks/:s1[/subtasks/:s2 …]] 以及其 /blocks
    if (id && sub === 'tasks' && subId) {
      const p = findById(data.projects, id);
      if (!p) throw httpError(404, 'project not found');
      const info = resolveItemChain(p, seg.slice(2));
      if (!info) throw httpError(404, 'item not found');

      if (info.rest[0] === 'blocks') {
        const r = await blockCrud(req, method, info.node, info.rest[1], store);
        return sendJson(res, r.status, r.body);
      }
      // 以 /subtasks 结尾 = 在这一层下面再建一层
      if (info.rest.length === 1 && info.rest[0] === 'subtasks') {
        if (method !== 'POST') throw httpError(405, 'method not allowed');
        if (info.chain.length >= MAX_ITEM_DEPTH) {
          throw httpError(400, `max depth ${MAX_ITEM_DEPTH} reached`);
        }
        const b = await readBody(req);
        if (!b.title || !String(b.title).trim()) throw httpError(400, 'title required');
        const child = newItem(b);
        if (!Array.isArray(info.node.subtasks)) info.node.subtasks = [];
        info.node.subtasks.push(child);
        store.save();
        return sendJson(res, 201, child);
      }
      if (info.rest.length) throw httpError(404, 'not found');

      if (method === 'GET') return sendJson(res, 200, info.node);
      if (method === 'PUT') {
        const b = await readBody(req);
        Object.assign(b, normalizePlanPatch(b, info.node));
        for (const k of ITEM_EDITABLE) if (k in b) info.node[k] = b[k];
        if ('estimate' in b) info.node.estimate = normEstimate(b.estimate);
        store.save();
        return sendJson(res, 200, info.node);
      }
      if (method === 'DELETE') {
        info.parent[info.key] = (info.parent[info.key] || []).filter((x) => x.id !== info.node.id);
        store.save();
        return sendJson(res, 200, { ok: true });
      }
      throw httpError(405, 'method not allowed');
    }
    if (id && sub === 'blocks') {
      const p = findById(data.projects, id);
      if (!p) throw httpError(404, 'project not found');
      const r = await blockCrud(req, method, p, subId, store);
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
    if (method === 'PUT' && id === 'exercises' && sub && !subId) {
      const ex = findById(data.workouts.exercises, sub);
      if (!ex) throw httpError(404, 'exercise not found');
      const b = await readBody(req);
      for (const k of ['name', 'part', 'sets', 'reps', 'weight']) if (k in b) ex[k] = b[k];
      store.save();
      return sendJson(res, 200, ex);
    }
    if (method === 'DELETE' && id === 'exercises' && sub && !subId) {
      if (!findById(data.workouts.exercises, sub)) throw httpError(404, 'exercise not found');
      data.workouts.exercises = data.workouts.exercises.filter((x) => x.id !== sub);
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
      const b = await readBody(req);
      validateCategory(b);
      const project = {
        id: newId(),
        name: idea.title,
        category: b.category || 'work',
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
      validateOrganization(b, data);
      const date = b.date && isValidDateStr(b.date) ? b.date : todayStr();
      const task = {
        id: newId(),
        title: idea.title,
        date,
        time: b.time || null,
        priority: b.priority || 'medium',
        repeat: null,
        source: { type: 'idea', id: idea.id },
        projectId: b.projectId || null,
        listId: b.projectId ? null : (b.listId || 'inbox'),
        routineTag: b.routineTag || '',
        ...normalizePlanPatch(b, { date }),
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
      store.replace(prepareBackup(b));
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

function createApp({ dataFile = DEFAULT_DATA_FILE, onShutdown = () => {} } = {}) {
  const store = new Store(dataFile);
  store.load();
  // 历史数据里的「完整日期」统一迁移成默认的「年/月/日」（只做一次）
  const migration = migrateDateFormats(store);
  // 内容从"多行内容块"改成"整篇 Markdown"，旧内容并进 desc（只做一次）
  const contentMigration = migrateBlocksToDesc(store);
  if (migration.changed || contentMigration.changed) store.save();
  const dispatch = createDispatcher(store, handle);
  let stopping = false;
  const active = new Set();
  const reportError = (res, e) => {
    if (!res.destroyed && !res.headersSent) {
      const status = e.status || 500;
      sendJson(res, status, { error: e.message || 'server error' });
    }
  };
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/shutdown') {
      if (stopping) return sendJson(res, 409, { error: '服务正在结束，请稍候。' });
      try {
        if (req.method !== 'POST') throw httpError(405, 'method not allowed');
        const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        const host = new URL(`http://${req.headers.host}`);
        if (!local || !['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) throw httpError(403, '仅允许本机结束服务。');
        if (req.headers.origin && req.headers.origin !== host.origin) throw httpError(403, '不允许其他网站结束服务。');
        if ((req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') throw httpError(415, '结束服务需要 JSON 请求。');
      } catch (e) {
        return reportError(res, e);
      }
      stopping = true;
      (async () => {
        await readBody(req);
        // 等已接收的操作完成后保存；保存失败则恢复接收请求，保持服务运行。
        await Promise.allSettled([...active]);
        store.save();
        res.once('finish', () => server.close(onShutdown));
        sendJson(res, 200, { ok: true, message: '已保存，服务已结束' });
      })().catch((e) => {
        stopping = false;
        reportError(res, e);
      });
      return;
    }
    if (stopping) return sendJson(res, 503, { error: '服务正在保存并结束。' });
    const operation = dispatch(req, res).catch((e) => reportError(res, e));
    active.add(operation);
    operation.finally(() => active.delete(operation));
  });
  server.store = store;
  server.migration = migration;
  return server;
}

module.exports = { createApp, DEFAULT_DATA_FILE };
