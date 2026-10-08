import { test } from 'node:test';
import assert from 'node:assert';
import { collectOwners, projectFields } from '../public/js/views/projects.js';

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

test('问题2：负责人字段为可输入下拉(datalist)', () => {
  const f = projectFields(null).find((x) => x.name === 'owner');
  assert.ok(f, '应存在负责人字段');
  assert.equal(f.type, 'datalist');
  assert.ok(Array.isArray(f.options), '带候选选项');
});
