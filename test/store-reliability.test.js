'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, defaultData, normalize, atomicWrite } = require('../store');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-reliability-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'data.json');
}

test('保存失败时保留原文件，并清理临时文件', (t) => {
  const file = fixture(t);
  fs.writeFileSync(file, 'original');
  const failure = Object.assign(new Error('file locked'), { code: 'EPERM' });
  t.mock.method(fs, 'renameSync', () => { throw failure; });
  assert.throws(() => atomicWrite(file, 'replacement'), (err) => err === failure);
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  assert.equal(fs.existsSync(file + '.tmp'), false);
  t.mock.restoreAll();
});

test('导入写盘失败时，内存与磁盘仍保留导入前的数据', (t) => {
  const file = fixture(t);
  const store = new Store(file);
  store.load();
  store.get().memos.push({ id: 'keep', text: '保留这条备忘' });
  store.save();
  const before = store.snapshot();
  t.mock.method(fs, 'renameSync', () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); });
  assert.throws(() => store.replace(defaultData()), /locked/);
  assert.equal(store.snapshot(), before);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  t.mock.restoreAll();
});

test('读取权限错误应直接报错，不能把有效数据当成损坏文件覆盖', (t) => {
  const file = fixture(t);
  const original = JSON.stringify(defaultData());
  fs.writeFileSync(file, original);
  const realRead = fs.readFileSync;
  const failure = Object.assign(new Error('access denied'), { code: 'EACCES' });
  t.mock.method(fs, 'readFileSync', (target, ...args) => {
    if (target === file) throw failure;
    return realRead(target, ...args);
  });
  assert.throws(() => new Store(file).load(), (err) => err === failure);
  t.mock.restoreAll();
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['data.json']);
});

test('备份中的数组偏好与周计划应纠正为对象，落盘再读取后仍有完整默认值', (t) => {
  const file = fixture(t);
  const store = new Store(file);
  store.load();
  store.replace({ preferences: [], workouts: { schedule: [] } });
  const reloaded = new Store(file);
  reloaded.load();
  assert.deepEqual(reloaded.get().preferences, defaultData().preferences);
  assert.deepEqual(reloaded.get().workouts.schedule, defaultData().workouts.schedule);
  assert.equal(Array.isArray(normalize({ preferences: [], workouts: [] }).preferences), false);
});

test('损坏文件无法隔离时停止恢复，不覆盖有效备份', (t) => {
  const file = fixture(t);
  fs.writeFileSync(file, 'broken json');
  const backup = JSON.stringify({ ...defaultData(), memos: [{ text: '有效备份' }] });
  fs.writeFileSync(file + '.bak', backup);
  t.mock.method(fs, 'renameSync', () => { throw new Error('quarantine blocked'); });
  assert.throws(() => new Store(file).load(), /quarantine blocked/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'broken json');
  assert.equal(fs.readFileSync(file + '.bak', 'utf8'), backup);
  t.mock.restoreAll();
});
