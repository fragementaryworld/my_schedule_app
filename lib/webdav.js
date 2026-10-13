'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { prepareBackup } = require('./backup');

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const INTERVALS = [1, 5, 10, 15, 30, 60];
const defaults = () => ({ url: '', username: '', password: '', fileName: 'schedule-app.json', syncEnabled: true, enabled: false, intervalMinutes: 5 });
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const fingerprint = data => crypto.createHash('sha256').update(JSON.stringify(canonical(data))).digest('hex');
function summary(data) {
  return data ? Object.fromEntries(['tasks', 'projects', 'books', 'ideas', 'memos'].map(key => [key, (data[key] || []).length])) : null;
}
function empty(data) {
  return Object.values(summary(data)).every(n => !n) && ['exercises', 'logs', 'bodyData'].every(key => !data.workouts[key].length)
    && Object.values(data.workouts.schedule).every(ids => !ids.length);
}
function configPatch(previous, patch) {
  const next = { ...previous };
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail(400, '无效 WebDAV 配置。');
  for (const key of Object.keys(patch)) if (!Object.keys(defaults()).includes(key)) fail(400, '包含未知 WebDAV 配置项。');
  for (const key of ['url', 'username', 'password', 'fileName']) {
    if (key in patch) {
      if (typeof patch[key] !== 'string' || patch[key].length > 2048) fail(400, '无效 WebDAV 配置字段。');
      next[key] = key === 'password' ? patch[key] : patch[key].trim();
    }
  }
  if ('enabled' in patch) { if (typeof patch.enabled !== 'boolean') fail(400, '自动同步开关必须是布尔值。'); next.enabled = patch.enabled; }
  if ('syncEnabled' in patch) { if (typeof patch.syncEnabled !== 'boolean') fail(400, 'WebDAV 同步开关必须是布尔值。'); next.syncEnabled = patch.syncEnabled; }
  if ('intervalMinutes' in patch) { if (!INTERVALS.includes(patch.intervalMinutes)) fail(400, '同步间隔应为 1、5、10、15、30 或 60 分钟。'); next.intervalMinutes = patch.intervalMinutes; }
  if (!next.fileName || !/^[^/\\\u0000-\u001f?#]+\.json$/i.test(next.fileName) || ['.json', '..json'].includes(next.fileName)) fail(400, '同步文件名必须是单个 JSON 文件名，不能包含路径。');
  if (next.username.includes(':') || /[\r\n]/.test(next.username)) fail(400, '用户名不能包含冒号或换行。');
  const parse = input => {
    let url; try { url = new URL(input); } catch { fail(400, '请输入完整的 WebDAV 目录地址。'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail(400, '目录地址仅支持 HTTP/HTTPS，不能内含密码、查询参数或片段。');
    url.pathname = url.pathname.replace(/\/?$/, '/'); return url;
  };
  const url = next.url ? parse(next.url) : null;
  if (next.syncEnabled && next.enabled && !url) fail(400, '启用自动同步前请填写 WebDAV 地址。');
  const changedAccount = next.username !== previous.username || (url?.origin || '') !== (previous.url ? new URL(previous.url).origin : '');
  // Never silently forward a stored password to a different server or account.
  if (changedAccount && !('password' in patch)) next.password = '';
  if (url) next.url = url.href;
  return next;
}

class WebdavService {
  constructor({ store, run, dataFile, fetchImpl = (...args) => fetch(...args), timeoutMs = 15000, maxBytes = 5 * 1024 * 1024 }) {
    Object.assign(this, { store, run, fetchImpl, timeoutMs, maxBytes });
    this.file = dataFile + '.webdav.json'; this.backupDir = dataFile + '.webdav-backups'; this.busy = false; this.conflict = null;
    this.saved = null;
    try { this.saved = fs.readFileSync(this.file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (this.saved) {
      try {
        this.document = JSON.parse(this.saved);
        if (this.document.version !== 1 || !this.document.config || !Array.isArray(this.document.backups)
          || (this.document.state != null && (typeof this.document.state !== 'object' || Array.isArray(this.document.state)))
          || this.document.backups.some(backup => !backup || typeof backup !== 'object' || typeof backup.id !== 'string')) throw new Error();
        this.document.config = configPatch(defaults(), this.document.config);
      } catch {
        this.document = { version: 1, config: defaults(), state: {}, backups: [] };
        this.configurationError = '本机 WebDAV 配置文件无效；本机功能仍可使用，请重新保存同步设置。';
      }
    } else this.document = { version: 1, config: defaults(), state: {}, backups: [] };
    this.document.state ||= {};
  }
  persist() {
    let previous = null;
    try { previous = fs.readFileSync(this.file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous !== this.saved) fail(409, 'WebDAV 配置被其他进程修改，请重启服务后继续。');
    const text = JSON.stringify(this.document, null, 2), tmp = this.file + '.' + crypto.randomUUID() + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    try { fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 }); fs.renameSync(tmp, this.file); }
    finally { try { fs.unlinkSync(tmp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    this.saved = text;
  }
  publicConfig() {
    const { password, ...config } = this.document.config;
    return { ...config, hasPassword: !!password, configured: !!config.url, busy: this.busy,
      ...this.document.state, configurationError: this.configurationError || '', backups: this.document.backups.map(({ id, kind, createdAt, summary }) => ({ id, kind, createdAt, summary })) };
  }
  configure(patch) {
    if (this.busy) fail(409, '正在同步，请稍后修改连接设置。');
    const previous = structuredClone(this.document), config = configPatch(previous.config, patch);
    if (['url', 'username', 'fileName'].some(key => config[key] !== previous.config[key])) { this.document.state = {}; this.conflict = null; }
    this.document.config = config;
    try { this.persist(); } catch (error) { this.document = previous; throw error; }
    this.configurationError = ''; return this.publicConfig();
  }
  clear() {
    if (this.busy) fail(409, '正在同步，请稍后清除连接设置。');
    const previous = this.document;
    this.document = { version: 1, config: defaults(), state: {}, backups: previous.backups };
    try { this.persist(); } catch (error) { this.document = previous; throw error; }
    this.conflict = null; this.configurationError = ''; return this.publicConfig();
  }
  target() {
    const config = this.document.config;
    if (!config.syncEnabled) fail(409, 'WebDAV 同步已关闭，请先打开同步开关。');
    if (!config.url) fail(400, '请先保存 WebDAV 连接设置。');
    return new URL(encodeURIComponent(config.fileName), config.url).href;
  }
  async request(url, options = {}, missing = false) {
    const { username, password } = this.document.config;
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { ...options, redirect: 'manual', signal: abort.signal,
        headers: { ...(username || password ? { Authorization: 'Basic ' + Buffer.from(`${username}:${password}`, 'utf8').toString('base64') } : {}), ...options.headers } });
      if (missing && response.status === 404) { await response.body?.cancel(); return null; }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401) fail(401, 'WebDAV 身份验证失败，请检查用户名和密码。');
        if (response.status === 403) fail(403, 'WebDAV 权限不足，请检查目录读写权限。');
        if (response.status === 412) fail(409, '远端文件已被其他设备修改，请重新同步。');
        if (response.status >= 300 && response.status < 400) fail(400, 'WebDAV 地址发生重定向，请填写最终目录地址。');
        fail(502, `WebDAV 请求失败（HTTP ${response.status}）。`);
      }
      const length = Number(response.headers.get('content-length'));
      if (length > this.maxBytes) { await response.body?.cancel(); fail(413, '远端文件超过 5 MB 同步上限。'); }
      const chunks = []; let size = 0;
      if (response.body) for await (const chunk of response.body) {
        size += chunk.length; if (size > this.maxBytes) { abort.abort(); fail(413, '远端文件超过 5 MB 同步上限。'); } chunks.push(Buffer.from(chunk));
      }
      return { text: Buffer.concat(chunks).toString('utf8'), etag: response.headers.get('etag') };
    } catch (error) {
      if (error.status) throw error;
      fail(502, abort.signal.aborted ? 'WebDAV 请求超时，请检查连接后重试。' : '无法连接 WebDAV 服务，请检查地址、网络和 HTTPS 证书。');
    } finally { clearTimeout(timer); }
  }
  async remote() {
    const response = await this.request(this.target(), { headers: { 'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity' } }, true);
    if (!response) return null;
    let data;
    try { data = prepareBackup(JSON.parse(response.text)); } catch { fail(400, '远端文件不是有效的项目 JSON 备份，未覆盖任何数据。'); }
    return { ...response, data, hash: fingerprint(data) };
  }
  async exclusive(operation) {
    if (this.busy) fail(409, '已有 WebDAV 操作正在执行，请稍后重试。');
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }
  test() {
    return this.exclusive(async () => {
      this.target();
      await this.request(this.document.config.url, { method: 'PROPFIND', headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>' });
      return { ok: true, message: 'WebDAV 连接成功。' };
    });
  }
  backup(data, kind) {
    if (fs.existsSync(this.backupDir) && fs.lstatSync(this.backupDir).isSymbolicLink()) fail(500, '同步备份目录不能是符号链接。');
    fs.mkdirSync(this.backupDir, { recursive: true });
    const id = crypto.randomUUID(), file = path.join(this.backupDir, id + '.json');
    fs.writeFileSync(file, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const previous = this.document.backups;
    this.document.backups = [{ id, kind, createdAt: new Date().toISOString(), summary: summary(data) }, ...previous].slice(0, 20);
    try { this.persist(); } catch (error) { this.document.backups = previous; throw error; }
    for (const removed of previous.slice(19)) {
      if (!/^[a-f0-9-]{36}$/.test(removed.id)) continue;
      try { fs.unlinkSync(path.join(this.backupDir, removed.id + '.json')); } catch { /* Retry cleanup manually if the disk refuses; never delete unrelated files. */ }
    }
  }
  backupText(id) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !this.document.backups.some(backup => backup.id === id)) fail(404, '同步备份不存在。');
    if (fs.lstatSync(this.backupDir).isSymbolicLink()) fail(500, '同步备份目录不能是符号链接。');
    const file = path.join(this.backupDir, id + '.json');
    if (fs.lstatSync(file).isSymbolicLink()) fail(500, '同步备份文件不能是符号链接。');
    return fs.readFileSync(file, 'utf8');
  }
  result(status, hash, extra = {}) {
    const previous = structuredClone(this.document.state);
    this.document.state = { baselineHash: hash, lastStatus: status, lastSuccessAt: new Date().toISOString(), lastMessage: '', ...extra };
    try { this.persist(); } catch (error) { this.document.state = previous; throw error; }
    this.conflict = null; return { status, ...extra };
  }
  conflictResult(local, remote, reason) {
    this.conflict = { token: crypto.randomUUID(), localHash: local.hash, remoteHash: remote?.hash || null, etag: remote?.etag || null, expires: Date.now() + 15 * 60000 };
    this.document.state.lastStatus = 'conflict'; this.document.state.lastMessage = '两端数据需要确认，自动同步已暂停。'; this.persist();
    return { status: 'conflict', token: this.conflict.token, reason, local: summary(local.data), remote: summary(remote?.data) };
  }
  synchronize(body = {}) {
    return this.exclusive(async () => {
      try {
        const direction = body.direction || 'auto';
        if (!['auto', 'upload', 'download'].includes(direction)) fail(400, '无效同步方向。');
        this.target();
        const local = await this.run(() => { const data = prepareBackup(this.store.get()); return { data, hash: fingerprint(data) }; });
        const remote = await this.remote(), baseline = this.document.state.baselineHash;
        if (remote?.hash === local.hash) return this.result('unchanged', local.hash);
        let action = direction;
        if (direction !== 'auto') {
          const expected = this.conflict;
          if (!expected || body.token !== expected.token || Date.now() > expected.expires) fail(409, '冲突确认已失效，请重新点击立即同步。');
          if (expected.localHash !== local.hash || expected.remoteHash !== (remote?.hash || null) || expected.etag !== (remote?.etag || null)) return this.conflictResult(local, remote, 'changed');
        } else if (!remote) {
          if (baseline) return this.conflictResult(local, remote, 'remote_missing');
          action = 'upload';
        } else if (empty(local.data) !== empty(remote.data)) {
          if (baseline) return this.conflictResult(local, remote, 'empty');
          action = empty(local.data) ? 'download' : 'upload';
        } else if (!baseline) return this.conflictResult(local, remote, 'first_sync');
        else if (local.hash === baseline) action = 'download';
        else if (remote.hash === baseline) action = 'upload';
        else return this.conflictResult(local, remote, 'both_changed');
        if (action === 'download') {
          if (!remote) fail(409, '远端文件不存在，不能下载。');
          await this.run(() => this.store.transaction(() => {
            if (fingerprint(prepareBackup(this.store.get())) !== local.hash) fail(409, '本机数据在同步期间发生变化，未覆盖；请重新同步。');
            this.backup(this.store.get(), 'local'); this.store.replace(remote.data);
          }));
          return this.result('downloaded', remote.hash);
        }
        if (remote && !/^"[^"\r\n]*"$/.test(remote.etag || '')) fail(409, '远端未提供可用的 ETag 版本标记，为避免覆盖，已停止上传。');
        await this.run(() => { if (fingerprint(prepareBackup(this.store.get())) !== local.hash) fail(409, '本机数据在同步期间发生变化，请重新同步。'); });
        if (remote) this.backup(remote.data, 'remote');
        const text = JSON.stringify(local.data, null, 2);
        if (Buffer.byteLength(text) > this.maxBytes) fail(413, '本机数据超过 5 MB 同步上限。');
        await this.request(this.target(), { method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8',
          ...(remote ? { 'If-Match': remote.etag } : { 'If-None-Match': '*' }) }, body: text });
        const verified = await this.remote();
        if (verified?.hash !== local.hash) fail(409, '上传后远端数据未通过核对，请重新同步。');
        return this.result('uploaded', local.hash);
      } catch (error) {
        this.document.state.lastStatus = 'error'; this.document.state.lastMessage = error.message;
        try { this.persist(); } catch { /* Preserve the original operation error. */ }
        throw error;
      }
    });
  }
}
module.exports = { WebdavService, fingerprint, configPatch };
