import { test } from 'node:test';
import assert from 'node:assert';
import { otherProjectNames, blockedByOptions, projectFields } from '../public/js/views/projects.js';

test('问题3：otherProjectNames 排除自身、只取名称', () => {
  const projects = [
    { id: 'a', name: '项目A' },
    { id: 'b', name: '项目B' },
    { id: 'c', name: '' }
  ];
  assert.deepEqual(otherProjectNames(projects, 'a'), ['项目B']);
  assert.deepEqual(otherProjectNames(projects, null), ['项目A', '项目B']);
});

test('问题3：blockedByOptions 首项为「无」且包含其他项目', () => {
  const projects = [{ id: 'a', name: '项目A' }, { id: 'b', name: '项目B' }];
  const opts = blockedByOptions(projects, '', 'a');
  assert.deepEqual(opts, [
    { value: '', label: '无' },
    { value: '项目B', label: '项目B' }
  ]);
});

test('问题3：blockedByOptions 保留无法匹配的历史值', () => {
  const opts = blockedByOptions([{ id: 'a', name: '项目A' }], '旧的手填值', 'a');
  assert.ok(opts.some((o) => o.value === '旧的手填值'), '历史值应保留');
});

test('问题3：阻塞字段为下拉选项框', () => {
  const f = projectFields({ id: 'x', name: '当前', blockedBy: '' }).find((x) => x.name === 'blockedBy');
  assert.equal(f.type, 'select');
  assert.ok(Array.isArray(f.options));
  assert.equal(f.options[0].value, '');
});
