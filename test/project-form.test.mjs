import { test } from 'node:test';
import assert from 'node:assert';
import { projectFields } from '../public/js/views/projects.js';

test('问题1：项目表单包含 名称/状态/日期/优先级/负责人/阻塞 字段', () => {
  const names = projectFields(null).map((f) => f.name);
  assert.ok(!names.includes('progress'), '表单不应再有「完成度」字段');
  for (const n of ['name', 'icon', 'goal', 'status', 'startDate', 'dueDate', 'priority', 'owner', 'blockedBy']) {
    assert.ok(names.includes(n), `缺少字段 ${n}`);
  }
});

test('问题1：项目表单优先级默认值可选高/中/低', () => {
  const f = projectFields(null).find((x) => x.name === 'priority');
  assert.equal(f.value, 'medium');
  assert.deepEqual(f.options.map((o) => o.value), ['high', 'medium', 'low']);
});
