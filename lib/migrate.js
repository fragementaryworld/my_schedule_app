'use strict';
// 一次性数据迁移：把历史上默认写入的「完整日期」统一改成现在的默认「年/月/日」。
// 只改 full → ymd，用户明确选过的其它格式（iso/short/mdy/relative）保持不动；
// 迁移过一次后就打标记，之后用户若主动选回「完整日期」不会被再次改掉。

const LEGACY_FORMAT = 'full';
const NEW_FORMAT = 'ymd';
const FLAG = 'dateFormatYmd';
const BLOCKS_FLAG = 'blocksToDesc';

// 内容块 → Markdown（保证迁移后语义不丢）
function blocksToMarkdown(blocks) {
  const lines = [];
  let numberIndex = 0;
  (blocks || []).forEach((block) => {
    const type = (block && block.type) || 'text';
    const text = String((block && block.text) || '').trim();
    if (type === 'divider') { lines.push('---'); numberIndex = 0; return; }
    if (!text) return;
    if (type !== 'number') numberIndex = 0;
    switch (type) {
      case 'h1': lines.push(`# ${text}`); break;
      case 'h2': lines.push(`## ${text}`); break;
      case 'h3': lines.push(`### ${text}`); break;
      case 'bullet': lines.push(`- ${text}`); break;
      case 'number': numberIndex += 1; lines.push(`${numberIndex}. ${text}`); break;
      case 'todo': lines.push(`- [${block.checked ? 'x' : ' '}] ${text}`); break;
      case 'quote': lines.push(`> ${text}`); break;
      default: lines.push(text);
    }
  });
  return lines.join('\n');
}

// 一次性迁移：内容改成整篇一个 Markdown，把旧的多行内容块并进 desc
function migrateBlocksToDesc(store) {
  const data = store.get() || {};
  if (data.migrations && data.migrations[BLOCKS_FLAG]) return { changed: false, count: 0 };

  let count = 0;
  const fix = (obj) => {
    if (!obj) return;
    const markdown = blocksToMarkdown(obj.blocks);
    if (!markdown) return;
    const current = String(obj.desc || '').trim();
    obj.desc = current ? `${current}\n\n${markdown}` : markdown;
    count += 1;
  };
  const walkItems = (list) => {
    for (const item of list || []) {
      fix(item);
      walkItems(item && item.subtasks);
    }
  };

  for (const project of data.projects || []) {
    fix(project);
    walkItems(project.tasks);
  }

  data.migrations = Object.assign({}, data.migrations, { [BLOCKS_FLAG]: true });
  return { changed: true, count };
}

module.exports = { migrateDateFormats, migrateBlocksToDesc, blocksToMarkdown, LEGACY_FORMAT, NEW_FORMAT, FLAG, BLOCKS_FLAG };

function migrateDateFormats(store) {
  const data = store.get() || {};
  if (data.migrations && data.migrations[FLAG]) return { changed: false, count: 0 };

  let count = 0;
  const fix = (obj) => {
    if (obj && obj.dateFormat === LEGACY_FORMAT) {
      obj.dateFormat = NEW_FORMAT;
      count += 1;
    }
  };
  const walkItems = (list) => {
    for (const item of list || []) {
      fix(item);
      walkItems(item && item.subtasks);
    }
  };

  for (const project of data.projects || []) {
    fix(project);
    walkItems(project.tasks);
  }
  for (const task of data.tasks || []) fix(task);

  data.migrations = Object.assign({}, data.migrations, { [FLAG]: true });
  return { changed: true, count };
}

module.exports = { migrateDateFormats, migrateBlocksToDesc, blocksToMarkdown, LEGACY_FORMAT, NEW_FORMAT, FLAG, BLOCKS_FLAG };
