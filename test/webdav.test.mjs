import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { apiFixture } from '../test-helpers/api-fixture.js';
import { webdavFixture } from '../test-helpers/webdav-fixture.js';
import { WebdavService, fingerprint } from '../lib/webdav.js';
import { prepareBackup } from '../lib/backup.js';

const data = title => prepareBackup({ tasks: title ? [{ id: 't1', title }] : [], projects: [] });
async function fixture(t, options) {
  const dav = await webdavFixture(t), app = await apiFixture(t, options);
  assert.equal((await app.request('PUT', '/api/webdav/config', dav.config())).status, 200);
  const sync = body => app.request('POST', '/api/webdav/sync', body || {});
  const local = () => app.server.store.get();
  const seed = value => app.request('POST', '/api/backup/import', value);
  return { ...app, dav, sync, local, seed };
}

test('配置独立持久化且不泄露密码，修改账号后不复用密码', async t => {
  const f = await fixture(t);
  const config = (await f.request('GET', '/api/webdav/config')).body;
  assert.equal(config.hasPassword, true); assert.equal('password' in config, false);
  assert.equal(JSON.stringify(f.local()).includes('synthetic-password'), false);
  const service = new WebdavService({ store: f.server.store, run: fn => fn(), dataFile: f.file });
  assert.equal(service.publicConfig().configured, true);
  assert.equal((await f.request('PUT', '/api/webdav/config', { intervalMinutes: 10 })).body.hasPassword, true);
  assert.equal((await f.request('PUT', '/api/webdav/config', { username: 'new-account' })).body.hasPassword, false);
  assert.equal((await f.request('PUT', '/api/webdav/config', { password: 'new-secret', url: 'https://different.example/dav/' })).body.hasPassword, true);
  assert.equal((await f.request('PUT', '/api/webdav/config', { url: f.dav.url })).body.hasPassword, false);
});

test('拒绝危险地址、路径和无效配置，原配置不变', async t => {
  const f = await fixture(t);
  for (const patch of [{ url: 'file:///tmp/' }, { url: 'https://u:p@example.com/' }, { url: 'https://example.com/?key=x' }, { fileName: '../x.json' }, { username: 'u:p' }, { intervalMinutes: 2 }, { enabled: 'true' }, { unknown: 1 }]) {
    assert.equal((await f.request('PUT', '/api/webdav/config', patch)).status, 400);
  }
  assert.equal((await f.request('GET', '/api/webdav/config')).body.url, f.dav.url);
});

test('连接测试使用 PROPFIND，身份验证和重定向错误不会暴露密码', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('POST', '/api/webdav/test', {})).body.ok, true);
  assert.equal(f.dav.state.calls[0].method, 'PROPFIND'); assert.equal(f.dav.state.calls[0].headers.depth, '0');
  await f.request('PUT', '/api/webdav/config', { password: 'wrong' });
  const auth = await f.request('POST', '/api/webdav/test', {}); assert.equal(auth.status, 401); assert.equal(JSON.stringify(auth.body).includes('wrong'), false);
  await f.request('PUT', '/api/webdav/config', { password: 'synthetic-password' }); f.dav.state.status = 302;
  assert.equal((await f.sync()).status, 400); assert.equal(f.dav.state.calls.some(call => call.url === '/elsewhere/'), false);
});

test('首次上传使用 If-None-Match 并核对完整备份，重复同步不写远端', async t => {
  const f = await fixture(t); await f.seed(data('本机任务'));
  assert.equal((await f.sync()).body.status, 'uploaded');
  const put = f.dav.state.calls.find(call => call.method === 'PUT'); assert.equal(put.headers['if-none-match'], '*');
  assert.equal(JSON.parse(put.body).tasks[0].title, '本机任务'); assert.equal(put.body.includes('synthetic-password'), false);
  assert.equal((await f.sync()).body.status, 'unchanged');
  assert.equal(f.dav.state.calls.filter(call => call.method === 'PUT').length, 1);
});

test('首次空本机自动下载，替换前保存可下载的本机备份', async t => {
  const f = await fixture(t); f.dav.set(data('云端任务'));
  assert.equal((await f.sync()).body.status, 'downloaded'); assert.equal(f.local().tasks[0].title, '云端任务');
  const config = (await f.request('GET', '/api/webdav/config')).body;
  assert.equal(config.backups[0].kind, 'local');
  const saved = await f.request('GET', `/api/webdav/backups/${config.backups[0].id}`); assert.equal(saved.status, 200); assert.deepEqual(saved.body.tasks, []);
  assert.equal((await f.request('GET', '/api/webdav/backups/../../data.json')).status >= 400, true);
});

test('首次两端不同需显式冲突确认，过期或变化后的选择不能覆盖', async t => {
  const f = await fixture(t); await f.seed(data('本机')); f.dav.set(data('远端'));
  const conflict = (await f.sync()).body; assert.equal(conflict.status, 'conflict'); assert.equal(conflict.reason, 'first_sync');
  assert.equal((await f.sync({ direction: 'upload', token: 'invalid' })).status, 409);
  f.dav.set(data('远端新编辑'));
  const changed = (await f.sync({ direction: 'upload', token: conflict.token })).body;
  assert.equal(changed.reason, 'changed'); assert.notEqual(changed.token, conflict.token);
  assert.equal(f.dav.state.calls.some(call => call.method === 'PUT'), false);
  assert.equal((await f.sync({ direction: 'upload', token: changed.token })).body.status, 'uploaded');
  assert.equal((await f.request('GET', '/api/webdav/config')).body.backups[0].kind, 'remote');
});

test('基线识别单端修改，两端都修改则暂停', async t => {
  const f = await fixture(t); await f.seed(data('初始')); await f.sync();
  await f.request('PUT', '/api/tasks/t1', { title: '本机改动' });
  assert.equal((await f.sync()).body.status, 'uploaded');
  f.dav.set(data('远端改动')); assert.equal((await f.sync()).body.status, 'downloaded');
  assert.equal(f.local().tasks[0].title, '远端改动');
  await f.request('PUT', '/api/tasks/t1', { title: '本机再次改动' }); f.dav.set(data('远端再次改动'));
  const conflict = (await f.sync()).body; assert.equal(conflict.reason, 'both_changed');
  assert.equal((await f.sync({ direction: 'download', token: conflict.token })).body.status, 'downloaded');
  assert.equal(f.local().tasks[0].title, '远端再次改动');
});

test('远端丢失或一端意外清空时不自动传播删除', async t => {
  const f = await fixture(t); await f.seed(data('任务')); await f.sync();
  f.dav.set(null); assert.equal((await f.sync()).body.reason, 'remote_missing');
  f.dav.set(data(null)); assert.equal((await f.sync()).body.reason, 'empty'); assert.equal(f.local().tasks.length, 1);
});

test('弱 ETag 拒绝覆盖，If-Match 拦截其他设备并发修改', async t => {
  const f = await fixture(t); await f.seed(data('任务')); await f.sync();
  await f.request('PUT', '/api/tasks/t1', { title: '本机编辑' }); f.dav.state.etagStyle = 'weak';
  assert.equal((await f.sync()).status, 409); assert.equal(JSON.parse(f.dav.state.text).tasks[0].title, '任务');
  f.dav.state.etagStyle = 'strong'; f.dav.state.beforePut = () => f.dav.set(data('其他设备编辑'));
  assert.equal((await f.sync()).status, 409); assert.equal(JSON.parse(f.dav.state.text).tasks[0].title, '其他设备编辑');
  assert.equal(f.local().tasks[0].title, '本机编辑');
});

test('远端错误、超限文件、超时保持本机数据不变', async t => {
  const f = await fixture(t, { webdavOptions: { maxBytes: 1024, timeoutMs: 100 } }); await f.seed(data('本机'));
  for (const text of ['not-json', JSON.stringify({ arbitrary: true }), 'x'.repeat(2048)]) {
    f.dav.state.text = text; const response = await f.sync(); assert.equal(response.status, text.length > 1024 ? 413 : 400); assert.equal(f.local().tasks[0].title, '本机');
  }
  const hold = f.dav.hold(); const pending = f.sync(); await hold.entered;
  assert.equal((await pending).status, 502); hold.release(); assert.equal(f.local().tasks[0].title, '本机');
});

test('网络等待不占用数据队列，期间新增本机编辑会阻止下载', async t => {
  const f = await fixture(t); await f.seed(data('初始')); await f.sync(); f.dav.set(data('云端修改'));
  const hold = f.dav.hold(), pending = f.sync(); await hold.entered;
  assert.equal((await f.request('PUT', '/api/webdav/config', { intervalMinutes: 10 })).status, 409);
  assert.equal((await f.sync()).status, 409);
  assert.equal((await f.request('PUT', '/api/tasks/t1', { title: '等待时本机编辑' })).status, 200);
  hold.release(); assert.equal((await pending).status, 409); assert.equal(f.local().tasks[0].title, '等待时本机编辑');
});

test('同步接口沿用本机来源保护', async t => {
  const f = await fixture(t);
  const res = await fetch(f.base + '/api/webdav/sync', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403); assert.equal(f.dav.state.calls.length, 0);
});

test('恢复备份保留最近 20 份，清除连接不删除数据和备份', async t => {
  const f = await fixture(t); await f.seed(data('初始')); await f.sync();
  const directory = f.file + '.webdav-backups'; fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, 'unrelated.txt'), 'keep');
  for (let i = 0; i < 22; i++) { f.dav.set(data(`编辑${i}`)); assert.equal((await f.sync()).body.status, 'downloaded'); }
  const config = (await f.request('DELETE', '/api/webdav/config')).body;
  assert.equal(config.configured, false); assert.equal(config.backups.length, 20);
  assert.equal(fs.readdirSync(directory).filter(file => file.endsWith('.json')).length, 20);
  assert.equal(fs.readFileSync(path.join(directory, 'unrelated.txt'), 'utf8'), 'keep'); assert.equal(f.local().tasks[0].title, '编辑21');
});

test('可选同步配置损坏不会阻止主功能启动，重存配置可恢复', async t => {
  const f = await fixture(t);
  for (const invalid of ['{broken', JSON.stringify({ version: 1, config: f.dav.config(), state: true, backups: [] }),
    JSON.stringify({ version: 1, config: f.dav.config(), state: {}, backups: [null] })]) {
    fs.writeFileSync(f.file + '.webdav.json', invalid);
    const service = new WebdavService({ store: f.server.store, run: fn => fn(), dataFile: f.file });
    assert.match(service.publicConfig().configurationError, /无效/); assert.equal(service.publicConfig().configured, false);
    assert.equal(fs.readFileSync(f.file + '.webdav.json', 'utf8'), invalid);
    assert.equal(service.configure(f.dav.config()).configurationError, '');
  }
});

test('语义指纹不受对象属性顺序影响且保留数组顺序', () => {
  assert.equal(fingerprint({ b: 2, a: 1 }), fingerprint({ a: 1, b: 2 }));
  assert.notEqual(fingerprint([1, 2]), fingerprint([2, 1]));
});

test('总开关关闭时阻止所有远端访问，保留连接、同步基线和备份，重启后仍关闭', async t => {
  const f = await fixture(t); await f.seed(data('本机')); await f.sync();
  f.dav.set(data('远端编辑')); await f.sync();
  const previous = (await f.request('GET', '/api/webdav/config')).body;
  const off = (await f.request('PUT', '/api/webdav/config', { syncEnabled: false })).body;
  assert.equal(off.syncEnabled, false); assert.equal(off.hasPassword, true); assert.equal(off.url, previous.url);
  assert.equal(off.baselineHash, previous.baselineHash); assert.deepEqual(off.backups, previous.backups);
  const calls = f.dav.state.calls.length;
  assert.equal((await f.sync()).status, 409); assert.equal((await f.request('POST', '/api/webdav/test', {})).status, 409);
  assert.equal(f.dav.state.calls.length, calls);
  const service = new WebdavService({ store: f.server.store, run: fn => fn(), dataFile: f.file });
  assert.equal(service.publicConfig().syncEnabled, false);
  assert.equal((await f.request('PUT', '/api/webdav/config', { syncEnabled: true })).status, 200);
  assert.equal((await f.sync()).body.status, 'unchanged');
});

test('总开关严格校验，历史配置缺失总开关时兼容原有同步行为', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('PUT', '/api/webdav/config', { syncEnabled: 'false' })).status, 400);
  const document = JSON.parse(fs.readFileSync(f.file + '.webdav.json', 'utf8')); delete document.config.syncEnabled;
  fs.writeFileSync(f.file + '.webdav.json', JSON.stringify(document));
  const service = new WebdavService({ store: f.server.store, run: fn => fn(), dataFile: f.file });
  assert.equal(service.publicConfig().syncEnabled, true);
  assert.equal(service.publicConfig().enabled, true); assert.equal((await service.test()).ok, true);
});
