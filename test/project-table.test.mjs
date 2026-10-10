import { test } from 'node:test';
import assert from 'node:assert';
import { projectRowData, formatProjectDates } from '../public/js/views/projects.js';

test('问题2：formatProjectDates 按选定格式组合起止日期', () => {
  assert.equal(formatProjectDates({ startDate: '2024-05-01', dueDate: '2024-05-31' }), '2024/05/01 → 2024/05/31');
  assert.equal(formatProjectDates({ startDate: '', dueDate: '2024-05-31' }), '2024/05/31');
  assert.equal(formatProjectDates({ startDate: '2024-05-01', dueDate: '' }), '2024/05/01');
  assert.equal(formatProjectDates({ startDate: '2024-05-01', dueDate: '2024-05-31', dateFormat: 'iso' }), '2024-05-01 → 2024-05-31');
  assert.equal(formatProjectDates({ startDate: '2024-05-01', dueDate: '2024-05-31', dateFormat: 'mdy' }), '05/01/2024 → 05/31/2024');
  assert.equal(formatProjectDates({ startDate: '2024-05-01', dueDate: '2024-05-31', dateFormat: 'full' }), '2024年5月1日 周三 → 2024年5月31日 周五');
  assert.equal(formatProjectDates({}), '—');
});

test('问题2：projectRowData 输出表格所需字段（含颜色分类）', () => {
  const d = projectRowData({
    name: '项目A',
    status: 'paused',
    owner: 'jun',
    priority: 'high',
    startDate: '2024-05-01',
    dueDate: '2024-05-31',
    progress: 40,
    blockedBy: '等待审批'
  });
  assert.equal(d.name, '项目A');
  assert.equal(d.statusLabel, '暂停');
  assert.equal(d.statusCls, 'paused');
  assert.equal(d.owner, 'jun');
  assert.equal(d.dates, '2024/05/01 → 2024/05/31');
  assert.equal(d.priorityLabel, '高');
  assert.equal(d.priorityCls, 'high');
  assert.equal(d.completion, 40);
  assert.equal(d.blockedBy, '等待审批');
});

test('问题2：projectRowData 默认值', () => {
  const d = projectRowData({ name: 'B', status: 'active' });
  assert.equal(d.owner, '');
  assert.equal(d.completion, 0);
  assert.equal(d.blockedBy, '');
  assert.equal(d.priorityLabel, '中');
});
