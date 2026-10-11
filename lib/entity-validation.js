'use strict';
const { isValidDateStr } = require('./dates');
const fail = field => { throw Object.assign(new Error(`invalid ${field}`), { status: 400 }); };
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);

const TEXT = {
  task: ['title', 'note'], item: ['title', 'desc'], project: ['name', 'goal', 'desc', 'icon', 'cover', 'owner', 'blockedBy'],
  book: ['title', 'author', 'review'], idea: ['title', 'desc'], exercise: ['name', 'part'],
  memo: ['text'], block: ['text'], note: ['excerpt', 'thought'], log: ['note', 'duration']
};
const ENUMS = {
  task: { priority: ['low', 'medium', 'high'] },
  project: { priority: ['low', 'medium', 'high'], status: ['active', 'paused', 'done'], category: ['work', 'temporary'] },
  book: { status: ['want', 'reading', 'done'], unit: ['page', 'percent'] },
  idea: { status: ['idea', 'planning', 'doing', 'done', 'dropped'] },
  preferences: { theme: ['light', 'dark'], weekStart: ['mon', 'sun'], defaultHome: ['home', 'today', 'projects', 'reading', 'fitness', 'ideas', 'settings'] }
};

function validateEntityPatch(type, body) {
  for (const field of TEXT[type] || []) {
    if (field in body && typeof body[field] !== 'string') fail(field);
  }
  for (const field of ['title', 'name', 'text']) {
    if ((TEXT[type] || []).includes(field) && field in body && type !== 'block' && !body[field].trim()) fail(field);
  }
  for (const [field, options] of Object.entries(ENUMS[type] || {})) {
    if (field in body && !options.includes(body[field])) fail(field);
  }
  if (['task', 'item', 'project', 'log', 'body'].includes(type)) {
    for (const field of ['date', 'startDate', 'dueDate', 'endDate']) {
      if (!(field in body)) continue;
      if (field !== 'date' && (body[field] === null || body[field] === '')) { body[field] = null; continue; }
      if (!isValidDateStr(body[field])) fail(field);
    }
    for (const field of ['time', 'startTime', 'dueTime', 'endTime']) {
      if (!(field in body)) continue;
      if (body[field] === null || body[field] === '') { body[field] = null; continue; }
      if (typeof body[field] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body[field])) fail(field);
    }
  }
  for (const field of ['done', 'finishSeries', 'checked']) {
    if (field in body && typeof body[field] !== 'boolean') fail(field);
  }
  if ('order' in body && type !== 'block' && (typeof body.order !== 'number' || !Number.isFinite(body.order))) fail('order');
  if (type === 'block' && 'order' in body && (!Array.isArray(body.order) || body.order.some(id => typeof id !== 'string'))) fail('block order');
  if (type === 'task' && 'repeat' in body && body.repeat !== null) {
    const rule = body.repeat;
    if (!['daily', 'weekly'].includes(rule)
      && !(record(rule) && Number.isInteger(rule.interval) && rule.interval >= 1 && ['day', 'week'].includes(rule.unit))) fail('repeat');
  }
  if (type === 'task' && body.source !== undefined && body.source !== null) {
    if (!record(body.source) || typeof body.source.type !== 'string'
      || (body.source.id !== null && typeof body.source.id !== 'string')) fail('source');
  }
  if (type === 'idea' && 'tags' in body && (!Array.isArray(body.tags) || body.tags.some(tag => typeof tag !== 'string'))) fail('tags');
  for (const field of type === 'book' ? ['current', 'total'] : type === 'exercise' ? ['sets', 'reps'] : []) {
    if (!(field in body) || (field === 'total' && body[field] === null)) continue;
    if (typeof body[field] !== 'number' || !Number.isFinite(body[field]) || body[field] < 0) fail(field);
  }
}

function validateProjectParent(projects, id, parentId) {
  if (parentId !== null && typeof parentId !== 'string') fail('parentId');
  const indexed = new Map(projects.map(project => [project.id, project]));
  if (parentId && !indexed.has(parentId)) fail('parent not found');
  const visited = new Set([id]);
  for (let cursor = parentId; cursor; cursor = indexed.get(cursor)?.parentId) {
    if (visited.has(cursor)) fail('project parent cycle');
    visited.add(cursor);
  }
}

module.exports = { validateEntityPatch, validateProjectParent };
