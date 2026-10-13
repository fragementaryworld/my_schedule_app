import { h, toast, confirmDialog } from './ui.js';
import { api } from './api.js';
import { webdav } from './webdav.js';

const STATUS_LABELS = { uploaded: '已上传', downloaded: '已下载', unchanged: '两端一致', conflict: '需要处理冲突', error: '同步失败' };
const formatTime = time => time ? new Date(time).toLocaleString('zh-CN') : '尚未同步';
const summaryText = counts => counts ? `任务 ${counts.tasks} · 项目 ${counts.projects} · 书籍 ${counts.books} · 灵感 ${counts.ideas} · 备忘 ${counts.memos}` : '同步文件不存在';

export function buildWebdavSettings(initial, controller = webdav) {
  let config = initial, dirty = false, working = false;
  const group = h('section', { class: 'settings-group webdav-settings', 'aria-label': 'WebDAV 数据同步' });
  group.append(h('h3', {}, '☁ WebDAV 数据同步'));
  const master = h('input', { type: 'checkbox', id: 'webdav-syncEnabled', role: 'switch', 'aria-label': '启用 WebDAV 同步' });
  const masterLabel = h('span', { class: 'webdav-switch-state' });
  group.append(h('label', { class: 'webdav-switch', for: 'webdav-syncEnabled' }, master,
    h('span', { class: 'webdav-switch-track', 'aria-hidden': 'true' }), h('span', {}, '启用 WebDAV 同步'), masterLabel),
    h('p', { class: 'small muted' }, '开关立即生效。关闭后停止自动及手动同步，保留连接设置和恢复备份。'));
  const card = h('div', { class: 'card webdav-card' }), form = h('form', { class: 'webdav-fields' });
  const controls = {};
  const field = (name, label, type, value, help = '') => {
    const input = h('input', { class: 'input', type, id: `webdav-${name}`, 'aria-label': label, autocomplete: name === 'password' ? 'new-password' : 'off' });
    if (type === 'checkbox') input.checked = !!value; else input.value = value || '';
    controls[name] = input;
    form.append(h('div', { class: `webdav-field${name === 'url' ? ' webdav-field-wide' : ''}` },
      h('label', { for: `webdav-${name}` }, label), input, help ? h('p', { class: 'small muted' }, help) : null));
  };
  field('url', 'WebDAV 目录地址', 'url', config.url, '填写已存在的目录地址，建议使用 HTTPS。HTTP 不加密传输。');
  field('username', '用户名', 'text', config.username);
  field('password', '密码或应用专用密码', 'password', '');
  controls.password.placeholder = config.hasPassword ? '已保存，留空保持不变' : '填写密码';
  field('fileName', '同步文件名', 'text', config.fileName || 'schedule-app.json', '同一批设备填写相同文件名，仅支持 JSON 文件。');
  field('enabled', '启动及定时自动同步', 'checkbox', config.configured ? config.enabled : true);
  const interval = h('select', { class: 'input', id: 'webdav-interval', 'aria-label': '自动同步间隔' });
  for (const minutes of [1, 5, 10, 15, 30, 60]) interval.append(h('option', { value: String(minutes) }, `${minutes} 分钟`));
  interval.value = String(config.intervalMinutes || 5); controls.intervalMinutes = interval;
  form.append(h('div', { class: 'webdav-field' }, h('label', { for: 'webdav-interval' }, '自动同步间隔'), interval));
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, '保存同步设置'); form.append(save);
  const status = h('p', { class: 'webdav-message', role: 'status', 'aria-live': 'polite' });
  const last = h('p', { class: 'small muted webdav-last' });
  const test = h('button', { class: 'btn', type: 'button' }, '测试连接');
  const sync = h('button', { class: 'btn', type: 'button' }, '立即同步');
  const clear = h('button', { class: 'btn btn-ghost', type: 'button' }, '清除连接设置');
  const conflict = h('div', { class: 'webdav-conflict' }), backups = h('div', { class: 'webdav-backups' });
  let latestState = controller.state;
  const update = (state = latestState) => {
    latestState = state;
    if (state.config) config = state.config;
    const busy = working || state.running;
    const off = config.syncEnabled === false;
    master.checked = !off; master.disabled = busy; master.setAttribute('aria-checked', String(!off));
    masterLabel.textContent = off ? '已关闭' : '已开启';
    save.disabled = busy; test.disabled = sync.disabled = busy || dirty || off || !config.configured; clear.disabled = busy || !config.configured;
    for (const input of Object.values(controls)) input.disabled = busy;
    status.textContent = off ? 'WebDAV 同步已关闭，连接设置已保留。' : dirty ? '连接设置已修改，请先保存再同步。' : (state.message || config.configurationError || config.lastMessage || '填写连接设置后开始同步。');
    last.textContent = `上次成功同步：${formatTime(config.lastSuccessAt)}${config.lastStatus ? ` · ${STATUS_LABELS[config.lastStatus] || ''}` : ''}`;
    backups.innerHTML = '';
    if (config.backups?.length) {
      backups.append(h('span', { class: 'small muted' }, `本机保留最近 ${config.backups.length} 份同步覆盖前备份：`));
      const list = h('details'); list.append(h('summary', {}, '查看恢复备份'));
      for (const backup of config.backups) list.append(h('a', { class: 'webdav-backup-link', href: `/api/webdav/backups/${backup.id}`, download: '' },
        `${formatTime(backup.createdAt)} · ${backup.kind === 'local' ? '覆盖前本机' : '覆盖前远端'} · 导出`));
      backups.append(list);
    }
    conflict.innerHTML = '';
    if (!off && state.result?.status === 'conflict') {
      const result = state.result;
      conflict.append(h('h4', {}, '自动同步已暂停：请确认保留哪一端'),
        h('p', {}, `本机：${summaryText(result.local)}`), h('p', {}, `远端：${summaryText(result.remote)}`));
      for (const [direction, label, message] of [
        ['upload', '保留本机并上传', '将使用本机数据替换远端全部数据，覆盖前会保留远端的本机恢复备份。确认继续？'],
        ['download', '使用远端替换本机', '将使用远端数据替换本机全部数据，覆盖前会保留本机恢复备份。确认继续？']
      ]) {
        if (direction === 'download' && !result.remote) continue;
        const choose = h('button', { class: 'btn btn-sm', type: 'button', disabled: busy || dirty ? 'true' : null }, label);
        choose.onclick = async () => { if (await confirmDialog(message, { danger: true })) await controller.sync(direction, result.token); };
        conflict.append(choose);
      }
    }
  };
  master.addEventListener('change', async () => {
    if (working || controller.state.running) { update(); return; }
    const syncEnabled = master.checked;
    working = true; update(); let failure;
    try {
      config = await api.action('/api/webdav/config', { syncEnabled }, 'PUT');
      await controller.start();
    } catch (error) { failure = error.message; }
    finally { working = false; update({ ...controller.state, config }); if (failure) status.textContent = failure; }
  });
  for (const input of Object.values(controls)) {
    const changed = () => { dirty = true; update(); };
    input.addEventListener('input', changed); input.addEventListener('change', changed);
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (working || controller.state.running) return;
    working = true; update();
    const patch = { url: controls.url.value, username: controls.username.value, fileName: controls.fileName.value,
      enabled: controls.enabled.checked, intervalMinutes: Number(interval.value) };
    if (controls.password.value) patch.password = controls.password.value;
    let failure;
    try {
      config = await api.action('/api/webdav/config', patch, 'PUT'); controls.password.value = ''; dirty = false;
      controls.password.placeholder = config.hasPassword ? '已保存，留空保持不变' : '填写密码';
      toast('同步设置已保存'); await controller.start();
    } catch (error) { failure = error.message; }
    finally { working = false; update({ ...controller.state, config }); if (failure) status.textContent = failure; }
  });
  test.onclick = async () => {
    if (working || dirty) return; working = true; update();
    let message;
    try { message = (await api.action('/api/webdav/test', {})).message; } catch (error) { message = error.message; }
    finally { working = false; update(); status.textContent = message; }
  };
  sync.onclick = () => controller.sync();
  clear.onclick = async () => {
    if (!(await confirmDialog('清除本机 WebDAV 连接设置？不会删除本机数据、远端文件或恢复备份。'))) return;
    working = true; update();
    try {
      config = await api.action('/api/webdav/config', undefined, 'DELETE');
      controls.url.value = controls.username.value = controls.password.value = ''; controls.fileName.value = config.fileName;
      controls.enabled.checked = false; interval.value = String(config.intervalMinutes); dirty = false;
      await controller.start();
    } catch (error) { toast(error.message, 'error'); }
    finally { working = false; update({ ...controller.state, config }); }
  };
  card.append(h('p', { class: 'small muted' }, '以整份 JSON 备份同步全部应用数据；连接密码仅存本机，不进入同步文件。自动同步在页面打开期间运行，正在编辑时会延后。'),
    form, h('div', { class: 'row webdav-actions' }, test, sync, clear), status, last, conflict, backups);
  group.append(card); update();
  return { element: group, connect: active => {
    let unsubscribe;
    unsubscribe = controller.subscribe(state => { if (active()) update(state); else unsubscribe?.(); });
    if (!active()) unsubscribe();
    return unsubscribe;
  } };
}
