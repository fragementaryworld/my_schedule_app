'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, defaultData, normalize } = require('../store');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-test-'));
  return path.join(dir, 'data.json');
}

test('load 在文件不存在时创建默认数据并落盘', () => {
  const f = tmpFile();
  const store = new Store(f);
  store.load();
  assert.ok(fs.existsSync(f), '应生成数据文件');
  const d = store.get();
  assert.equal(d.version, 1);
  assert.ok(Array.isArray(d.tasks));
  assert.deepEqual(Object.keys(d.workouts.schedule).sort(), ['fri', 'mon', 'sat', 'sun', 'thu', 'tue', 'wed'].sort());
});

test('save 后新实例能读回相同数据（持久化）', () => {
  const f = tmpFile();
  const s1 = new Store(f);
  s1.load();
  s1.get().memos.push({ id: 'm1', text: 'hello', createdAt: 'x' });
  s1.save();

  const s2 = new Store(f);
  s2.load();
  assert.equal(s2.get().memos.length, 1);
  assert.equal(s2.get().memos[0].text, 'hello');
});

test('原子写入：保存后不残留 .tmp 临时文件', () => {
  const f = tmpFile();
  const s = new Store(f);
  s.load();
  s.save();
  assert.equal(fs.existsSync(f + '.tmp'), false);
});

test('损坏文件从自动备份恢复', () => {
  const f = tmpFile();
  const s1 = new Store(f);
  s1.load();
  s1.get().memos.push({ id: 'm1', text: 'keep', createdAt: 'x' });
  s1.save(); // 文件=keep，.bak=默认
  s1.save(); // .bak=keep，文件=keep

  fs.writeFileSync(f, '{{{ not valid json', 'utf8');

  const s2 = new Store(f);
  s2.load();
  assert.equal(s2.recoveredFromBackup, true);
  assert.equal(s2.get().memos.length, 1);
  assert.equal(s2.get().memos[0].text, 'keep');
  // 损坏文件被隔离
  assert.ok(fs.readdirSync(path.dirname(f)).some((n) => n.includes('.corrupt-')));
});

test('无备份时损坏文件回退为默认数据', () => {
  const f = tmpFile();
  fs.writeFileSync(f, 'not json', 'utf8');
  const s = new Store(f);
  s.load();
  assert.equal(s.recoveredFromBackup, false);
  assert.equal(s.get().version, 1);
  assert.deepEqual(s.get().memos, []);
});

test('normalize 补齐缺失字段', () => {
  const d = normalize({ version: 1 });
  assert.ok(Array.isArray(d.tasks));
  assert.ok(Array.isArray(d.books));
  assert.ok(d.workouts.schedule.mon);
});

test('replace 用新数据整体替换并落盘', () => {
  const f = tmpFile();
  const s = new Store(f);
  s.load();
  const fresh = defaultData();
  fresh.memos.push({ id: 'x', text: 'replaced', createdAt: 'y' });
  s.replace(fresh);
  const s2 = new Store(f);
  s2.load();
  assert.equal(s2.get().memos.length, 1);
  assert.equal(s2.get().memos[0].text, 'replaced');
});

test('snapshot 返回完整 JSON 字符串', () => {
  const s = new Store(tmpFile());
  s.load();
  const snap = s.snapshot();
  assert.equal(JSON.parse(snap).version, 1);
});
