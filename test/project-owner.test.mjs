import { test } from 'node:test';
import assert from 'node:assert';
import { collectOwners } from '../public/js/views/projects.js';

test('问题2：collectOwners 汇总已有负责人（去重、排序、忽略空值）', () => {
  const owners = collectOwners([
    { owner: 'jun' },
    { owner: 'amy' },
    { owner: 'jun' },
    { owner: '' },
    {},
    { owner: '   ' }
  ]);
  assert.deepEqual(owners, ['amy', 'jun']);
});

test('问题2：负责人候选来自已有负责人（供页面属性面板使用）', () => {
  const projects = [{ owner: 'jun' }, { owner: 'amy' }, { owner: 'jun' }];
  assert.deepEqual(collectOwners(projects), ['amy', 'jun']);
});
