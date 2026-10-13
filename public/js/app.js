'use strict';
import { api } from './api.js';
import { toast, h, confirmDialog } from './ui.js';
import { flushPendingEdits, waitForPendingWrites } from './saving.js';
import { retireView } from './view-lifecycle.js';
import { webdav } from './webdav.js';
import { cancelCalendarDrag } from './calendar-drag.js';
import * as home from './views/home.js';
import * as today from './views/today.js';
import * as projects from './views/projects.js';
import * as reading from './views/reading.js';
import * as fitness from './views/fitness.js';
import * as ideas from './views/ideas.js';
import * as settings from './views/settings.js';
import * as page from './views/page.js';
import * as task from './views/item.js';
import * as plan from './views/plan.js';

export const views = { home, today, projects, reading, fitness, ideas, settings, page, task, plan };

export const titles = {
  home: '首页',
  today: '今日计划',
  projects: '工作项目进展',
  reading: '阅读计划',
  fitness: '健身计划',
  ideas: '灵感',
  settings: '数据与设置',
  page: '项目页面',
  task: '任务',
  plan: '计划任务'
};

async function savedAction(path, body) {
  try {
    await flushPendingEdits();
    await waitForPendingWrites();
    return await api.post(path, body);
  } catch (error) {
    // 等其他编辑结束并消费本次已报告的错误，处理问题后一次重试即可。
    await waitForPendingWrites().catch(() => {});
    throw error;
  }
}

export async function saveNow() {
  return savedAction('/api/save');
}

export async function shutdownNow() {
  return savedAction('/api/shutdown', {});
}

let ending = false;
export async function endService() {
  if (ending) return;
  ending = true;
  const button = document.getElementById('shutdownBtn');
  const shell = document.getElementById('app');
  const fab = document.getElementById('fab');
  try {
    if (!await confirmDialog('将保存当前编辑并结束本地服务。下次使用请重新运行启动脚本。', { confirmText: '保存并结束' })) return;
    webdav.stop();
    button.disabled = true;
    button.textContent = '正在保存…';
    shell.inert = true;
    fab.disabled = true;
    await shutdownNow();
    const content = document.getElementById('content');
    content.innerHTML = '';
    content.append(h('div', { class: 'service-ended card', role: 'status' },
      h('span', { class: 'service-ended-icon', 'aria-hidden': 'true' }, '✓'),
      h('h2', {}, '已保存，服务已结束'),
      h('p', { class: 'muted' }, '数据已保存在本机，可以关闭此页面。'),
      h('p', { class: 'small muted' }, '下次使用请双击「启动.bat」或运行 npm start，然后刷新页面。')));
    shell.inert = false;
    shell.querySelector?.('aside')?.setAttribute('inert', '');
    document.getElementById('saveBtn').disabled = true;
    button.textContent = '服务已结束';
    fab.style.display = 'none';
    window.removeEventListener('hashchange', navigate);
  } catch (error) {
    shell.inert = false;
    button.disabled = false;
    button.textContent = '保存并结束服务';
    fab.disabled = false;
    toast('未结束服务：' + error.message, 'error');
    webdav.start();
  } finally {
    ending = false;
  }
}

let currentView = null;
let currentParams = {};
let navigationVersion = 0;
let displayedHash = '';

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  return {
    route: parts[0] || 'home',
    id: parts[1] || null,
    subId: parts[2] || null,
    subId2: parts[3] || null,
    chain: parts.slice(2)
  };
}

export async function navigate() {
  const version = ++navigationVersion;
  const requestedHash = location.hash;
  const { route, id, subId, subId2, chain } = parseHash();
  const view = views[route] || views.home;
  try {
    await flushPendingEdits();
  } catch (error) {
    if (version !== navigationVersion) return;
    await waitForPendingWrites().catch(() => {});
    if (displayedHash && typeof history !== 'undefined') history.replaceState(null, '', displayedHash);
    toast('无法离开页面，编辑尚未保存：' + error.message, 'error');
    return;
  }
  if (version !== navigationVersion || ending) return;
  const previous = document.getElementById('content');
  retireView(previous);
  cancelCalendarDrag();
  const content = h('div', { id: 'content' });
  previous.replaceWith(content);
  currentView = view;
  currentParams = { id, subId, subId2, chain };
  displayedHash = requestedHash;
  const navRoute = (route === 'page' || route === 'task') ? 'projects' : (route === 'plan' ? 'today' : route);
  document.querySelectorAll('#nav a, .sidebar-foot a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === navRoute);
    if (a.dataset.route === navRoute) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.getElementById('pageTitle').textContent = titles[route] || titles.home;
  try {
    await view.render(content, currentParams);
  } catch (error) {
    if (version !== navigationVersion) return;
    content.innerHTML = '';
    const retry = h('button', { class: 'btn' }, '重新加载');
    retry.onclick = navigate;
    content.append(h('div', { class: 'empty', role: 'alert' }, h('p', {}, '页面加载失败：' + error.message), retry));
  }
  if (version !== navigationVersion) return;
  content.scrollTop = 0;
  window.scrollTo(0, 0);
}

export async function refreshAfterWebdav() {
  if (ending) return;
  try {
    const prefs = await api.get('/api/preferences');
    document.documentElement.dataset.theme = prefs.theme || 'light';
  } finally { await navigate(); }
}

function init() {
  const cloudStatus = document.getElementById('webdavStatus');
  if (cloudStatus) {
    cloudStatus.onclick = () => { location.hash = '#/settings'; };
    webdav.subscribe(state => {
      cloudStatus.hidden = !state.config?.configured && state.phase !== 'error';
      cloudStatus.dataset.phase = state.phase;
      cloudStatus.textContent = `☁ ${({ syncing: '正在同步', conflict: '同步有冲突', error: '同步失败', waiting: '等待编辑完成', ready: '云同步', disabled: state.config?.configured ? '同步已关闭' : '未配置' })[state.phase] || '云同步'}`;
      cloudStatus.title = state.message || '打开同步设置';
    });
  }
  webdav.start();
  window.addEventListener('hashchange', navigate);
  document.getElementById('fab').addEventListener('click', () => {
    if (currentView && typeof currentView.add === 'function') currentView.add(currentParams);
  });
  document.getElementById('saveBtn').addEventListener('click', async () => {
    try {
      await saveNow();
      toast('已保存');
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  document.getElementById('shutdownBtn')?.addEventListener('click', endService);
  (async () => {
    try {
      const p = await api.get('/api/preferences');
      document.documentElement.dataset.theme = p.theme || 'light';
      if (!location.hash) {
        const home = p.defaultHome && views[p.defaultHome] ? p.defaultHome : 'home';
        location.hash = '#/' + home;
        // hashchange 会负责渲染；重复调用会并发追加两套首页卡片。
        return;
      }
    } catch (e) {
      /* 忽略 */
    }
    navigate();
  })();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  init();
}
