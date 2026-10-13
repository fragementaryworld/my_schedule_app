import { api } from './api.js';
import { flushPendingEdits, waitForPendingWrites } from './saving.js';

export function editingNow(doc = typeof document === 'undefined' ? null : document) {
  if (doc?.querySelector?.('.modal-backdrop')) return true;
  const focused = doc?.activeElement;
  if (!focused) return false;
  return focused.hasAttribute?.('contenteditable') || (['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName)
    && !['button', 'submit', 'checkbox', 'radio', 'file'].includes(focused.type));
}

export function createWebdavController({ getConfig = () => api.get('/api/webdav/config'),
  request = body => api.action('/api/webdav/sync', body), flush = flushPendingEdits, wait = waitForPendingWrites,
  isEditing = editingNow, blur = () => document.activeElement?.blur?.(),
  setTimer = setTimeout, clearTimer = clearTimeout, lock = () => () => {}, onDownloaded = async () => {} } = {}) {
  let timer = null, generation = 0, running = false, stopped = true, config = null, result = null;
  let state = { phase: 'disabled', message: '未配置 WebDAV', config, result };
  const listeners = new Set();
  const emit = (phase, message = '') => {
    state = { phase, message, config, result, running };
    for (const listener of [...listeners]) listener(state);
  };
  const cancel = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const schedule = delay => {
    cancel();
    if (stopped || !config?.configured || !config.enabled || result?.status === 'conflict') return;
    timer = setTimer(() => { timer = null; sync('auto', null, true); }, delay ?? config.intervalMinutes * 60000);
    timer?.unref?.();
  };
  async function sync(direction = 'auto', token = null, automatic = false) {
    if (running) return { status: 'busy' };
    if (!config?.configured) return { status: 'disabled' };
    if (automatic && isEditing()) { emit('waiting', '正在编辑，稍后自动同步'); schedule(60000); return { status: 'waiting' }; }
    cancel(); const version = generation; running = true;
    const unlock = lock(); emit('syncing', '正在同步，请稍候…');
    try {
      if (!automatic && isEditing()) { blur(); await Promise.resolve(); }
      await flush(); await wait();
      const received = await request({ direction, ...(token ? { token } : {}) });
      if (version !== generation) return received;
      result = received;
      // Refresh immediately after replacement, even if reading sync metadata fails.
      if (received.status === 'downloaded') await onDownloaded(received);
      if (version !== generation) return received;
      const latest = await getConfig(); if (version !== generation) return received;
      config = latest;
      if (received.status === 'conflict') emit('conflict', '两端数据有冲突，请到设置中选择保留版本');
      else {
        emit('ready', ({ uploaded: '已上传本机数据', downloaded: '已下载远端数据', unchanged: '两端数据一致' })[received.status] || '同步完成');
      }
      return received;
    } catch (error) {
      if (version === generation) emit('error', error.message || '同步失败');
      return { status: 'error', message: error.message || '同步失败' };
    } finally {
      unlock();
      running = false;
      emit(state.phase, state.message);
      if (version === generation) schedule();
    }
  }
  return {
    async start() {
      cancel(); stopped = false; const version = ++generation;
      try {
        const latest = await getConfig(); if (version !== generation) return;
        config = latest; result = null;
        if (!config?.configured) { emit(config?.configurationError ? 'error' : 'disabled', config?.configurationError || '未配置 WebDAV'); return; }
        emit('ready', config.enabled ? '已开启自动同步' : '自动同步已关闭，可手动同步');
        if (config.enabled) {
          if (running) schedule(); else await sync('auto', null, true);
        }
      } catch (error) { if (version === generation) emit('error', error.message || '无法读取同步设置'); }
    },
    stop() { stopped = true; generation++; cancel(); },
    sync,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    get state() { return state; }
  };
}

export function lockSyncInterface(doc = typeof document === 'undefined' ? null : document) {
  // A download can replace the whole database. Keep new drafts from being created
  // between the final save and the refresh, including editors in open dialogs.
  const nodes = doc ? [doc.getElementById('app'), doc.getElementById('fab'), ...doc.querySelectorAll('.modal-backdrop')].filter(Boolean) : [];
  const previous = nodes.map(node => node.inert);
  nodes.forEach(node => { node.inert = true; });
  return () => nodes.forEach((node, index) => { node.inert = previous[index]; });
}

export const webdav = createWebdavController({
  lock: lockSyncInterface,
  onDownloaded: async () => {
    const { refreshAfterWebdav } = await import('./app.js');
    await refreshAfterWebdav();
  }
});
