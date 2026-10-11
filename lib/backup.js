'use strict';
const { normalize } = require('../store');
const { migrateDateFormats, migrateBlocksToDesc } = require('./migrate');
const { validateEntityPatch, validateProjectParent } = require('./entity-validation');
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = field => { throw Object.assign(new Error(`无效备份：${field}`), { status: 400 }); };

function entries(value, field, inspect = () => {}) {
  if (!Array.isArray(value)) invalid(`${field} 必须是数组`);
  const ids = new Set();
  for (const [index, item] of value.entries()) {
    const key = `${field}[${index}]`;
    if (!record(item) || typeof item.id !== 'string' || !item.id.trim()) invalid(`${key}.id`);
    if (ids.has(item.id)) invalid(`${key}.id 重复`);
    ids.add(item.id);
    inspect(item, key);
  }
}

function optionalArray(item, field, key, inspect) {
  if (field in item) entries(item[field], `${key}.${field}`, inspect);
}

function content(item, key) {
  for (const field of ['desc', 'note']) {
    if (field in item && typeof item[field] !== 'string') invalid(`${key}.${field}`);
  }
  optionalArray(item, 'blocks', key, (block, path) => {
    if ('text' in block && typeof block.text !== 'string') invalid(`${path}.text`);
  });
}

function taskTree(item, key, depth = 1) {
  if (depth > 5) invalid(`${key} 超过支持的任务层级`);
  if (typeof item.title !== 'string') invalid(`${key}.title`);
  content(item, key);
  validateEntityPatch('item', item);
  optionalArray(item, 'subtasks', key, (child, path) => taskTree(child, path, depth + 1));
}

// 接受当前完整备份与旧版集合结构，拒绝把任意 JSON 当作空备份覆盖数据。
function prepareBackup(input) {
  if (!record(input)) invalid('需要对象');
  if ('version' in input && input.version !== 1) invalid('不支持的 version');
  if (!Array.isArray(input.tasks) || !Array.isArray(input.projects)) invalid('缺少 tasks/projects 集合');
  for (const key of ['preferences', 'migrations']) {
    if (key in input && !record(input[key])) invalid(key);
  }
  entries(input.tasks, 'tasks', (task, key) => {
    if (typeof task.title !== 'string') invalid(`${key}.title`);
    content(task, key);
    validateEntityPatch('task', { ...task });
    if ('repeatSkippedDates' in task && (!Array.isArray(task.repeatSkippedDates) || task.repeatSkippedDates.some(date => typeof date !== 'string'))) invalid(`${key}.repeatSkippedDates`);
  });
  entries(input.projects, 'projects', (project, key) => {
    if (typeof project.name !== 'string') invalid(`${key}.name`);
    content(project, key);
    validateEntityPatch('project', { ...project });
    if (project.parentId) validateProjectParent(input.projects, project.id, project.parentId);
    optionalArray(project, 'tasks', key, taskTree);
  });
  optionalArray(input, 'memos', 'backup', (memo, key) => { if (typeof memo.text !== 'string') invalid(`${key}.text`); });
  optionalArray(input, 'books', 'backup', (book, key) => {
    if (typeof book.title !== 'string') invalid(`${key}.title`);
    validateEntityPatch('book', book);
    optionalArray(book, 'notes', key, note => validateEntityPatch('note', note));
  });
  optionalArray(input, 'ideas', 'backup', (idea, key) => {
    if (typeof idea.title !== 'string') invalid(`${key}.title`);
    if ('tags' in idea && (!Array.isArray(idea.tags) || idea.tags.some(tag => typeof tag !== 'string'))) invalid(`${key}.tags`);
    validateEntityPatch('idea', idea);
  });
  if ('workouts' in input) {
    if (!record(input.workouts)) invalid('workouts');
    for (const key of ['exercises', 'logs', 'bodyData']) optionalArray(input.workouts, key, 'workouts');
    if ('schedule' in input.workouts) {
      if (!record(input.workouts.schedule)) invalid('workouts.schedule');
      for (const [day, ids] of Object.entries(input.workouts.schedule)) {
        if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) invalid(`workouts.schedule.${day}`);
      }
    }
    for (const [index, log] of (input.workouts.logs || []).entries()) {
      if ('exercises' in log && (!Array.isArray(log.exercises) || log.exercises.some(ex => !record(ex)))) invalid(`workouts.logs[${index}].exercises`);
    }
  }
  const data = normalize(structuredClone(input));
  const completeItems = items => {
    for (const item of items) {
      item.subtasks ||= [];
      item.blocks ||= [];
      completeItems(item.subtasks);
    }
  };
  for (const project of data.projects) {
    project.tasks ||= [];
    project.blocks ||= [];
    completeItems(project.tasks);
  }
  for (const book of data.books) book.notes ||= [];
  for (const idea of data.ideas) idea.tags ||= [];
  const store = { get: () => data };
  migrateDateFormats(store);
  migrateBlocksToDesc(store);
  return data;
}

module.exports = { prepareBackup };
