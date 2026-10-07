import { test } from 'node:test';
import assert from 'node:assert';
import { partitionTasks, repeatLabel, sourceLabel, decodeRepeat, repeatCode } from '../public/js/views/today.js';

test('partitionTasks 分区：已完成 / 有时间 / 未安排时间', () => {
  const tasks = [
    { id: '1', title: '无时间', time: null, done: false },
    { id: '2', title: '有时间', time: '09:00', done: false },
    { id: '3', title: '已完成', time: null, done: true },
    { id: '4', title: '无时间2', time: null, done: false }
  ];
  const s = partitionTasks(tasks);
  assert.deepEqual(s.timed.map((t) => t.id), ['2']);
  assert.deepEqual(s.untimed.map((t) => t.id), ['1', '4']);
  assert.deepEqual(s.done.map((t) => t.id), ['3']);
});

test('repeatLabel 显示中文重复规则', () => {
  assert.equal(repeatLabel('daily'), '每天');
  assert.equal(repeatLabel('weekly'), '每周');
  assert.equal(repeatLabel({ interval: 2, unit: 'day' }), '每2天');
  assert.equal(repeatLabel({ interval: 3, unit: 'week' }), '每3周');
  assert.equal(repeatLabel(null), '');
});

test('repeatCode/decodeRepeat 往返一致', () => {
  assert.equal(repeatCode(decodeRepeat('daily')), 'daily');
  assert.equal(repeatCode(decodeRepeat('weekly')), 'weekly');
  assert.equal(repeatCode(decodeRepeat('d2')), 'd2');
  assert.equal(repeatCode(decodeRepeat('w2')), 'w2');
  assert.equal(decodeRepeat(''), null);
});

test('sourceLabel 显示来源标签', () => {
  assert.equal(sourceLabel('project'), '📁 项目');
  assert.equal(sourceLabel('book'), '📚 阅读');
  assert.equal(sourceLabel('workout'), '💪 健身');
  assert.equal(sourceLabel('idea'), '💡 灵感');
  assert.equal(sourceLabel(''), '');
});
