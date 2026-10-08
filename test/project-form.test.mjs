import { test } from 'node:test';
import assert from 'node:assert';
import { projectFields } from '../public/js/views/projects.js';

test('问题1：项目表单不再包含完成度字段', () => {
  const names = projectFields(null).map((f) => f.name);
  assert.ok(!names.includes('progress'), '表单不应再有「完成度」字段');
  assert.ok(names.includes('name'));
  assert.ok(names.includes('status'));
  assert.ok(names.includes('dueDate'));
});
