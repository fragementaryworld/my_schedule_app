'use strict';
import { api } from './api.js';
import * as home from './views/home.js';
import * as today from './views/today.js';
import * as projects from './views/projects.js';
import * as reading from './views/reading.js';
import * as fitness from './views/fitness.js';
import * as ideas from './views/ideas.js';
import * as settings from './views/settings.js';

export const views = { home, today, projects, reading, fitness, ideas, settings };

export const titles = {
  home: '首页',
  today: '今日计划',
  projects: '工作项目进展',
  reading: '阅读计划',
  fitness: '健身计划',
  ideas: '灵感',
  settings: '数据与设置'
};

let currentView = null;
let currentParams = {};

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  return { route: parts[0] || 'home', id: parts[1] || null };
}

export async function navigate() {
  const { route, id } = parseHash();
  const view = views[route] || views.home;
  currentView = view;
  currentParams = { id };
  document.querySelectorAll('#nav a, .sidebar-foot a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === route);
  });
  document.getElementById('pageTitle').textContent = titles[route] || titles.home;
  const content = document.getElementById('content');
  content.innerHTML = '';
  await view.render(content, currentParams);
  window.scrollTo(0, 0);
}

function init() {
  window.addEventListener('hashchange', navigate);
  document.getElementById('fab').addEventListener('click', () => {
    if (currentView && typeof currentView.add === 'function') currentView.add(currentParams);
  });
  (async () => {
    try {
      const p = await api.get('/api/preferences');
      document.documentElement.dataset.theme = p.theme || 'light';
      if (!location.hash) {
        const home = p.defaultHome && views[p.defaultHome] ? p.defaultHome : 'home';
        location.hash = '#/' + home;
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
