'use strict';
// 一次性数据迁移：把历史上默认写入的「完整日期」统一改成现在的默认「年/月/日」。
// 只改 full → ymd，用户明确选过的其它格式（iso/short/mdy/relative）保持不动；
// 迁移过一次后就打标记，之后用户若主动选回「完整日期」不会被再次改掉。

const LEGACY_FORMAT = 'full';
const NEW_FORMAT = 'ymd';
const FLAG = 'dateFormatYmd';

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

module.exports = { migrateDateFormats, LEGACY_FORMAT, NEW_FORMAT, FLAG };
