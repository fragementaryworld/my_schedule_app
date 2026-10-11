import { beginRender } from '../view-lifecycle.js';
'use strict';
import { api } from '../api.js';
import { h, toast, confirmDialog } from '../ui.js';

let el = null;

const HOME_OPTIONS = [
  ['home', '首页'],
  ['today', '今日计划'],
  ['projects', '工作项目'],
  ['reading', '阅读计划'],
  ['fitness', '健身计划'],
  ['ideas', '灵感']
];

export async function render(container) {
  el = container;
  const active = beginRender(container);
  if (!active()) return;
  const [prefs, meta] = await Promise.all([api.get('/api/preferences'), api.get('/api/meta')]);
  if (!active()) return;
  container.innerHTML = '';
  container.append(buildDataGroup(meta));
  container.append(buildPrefsGroup(prefs));
  container.append(buildAbout());
}

function buildDataGroup(meta) {
  const group = h('div', { class: 'settings-group' });
  group.append(h('h3', {}, '💾 数据'));

  const exportBtn = h('button', { class: 'btn' }, '⬇ 导出备份');
  exportBtn.onclick = () => {
    const a = document.createElement('a');
    a.href = '/api/backup/export';
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('已开始导出备份');
  };

  const importLabel = h('label', { class: 'btn', style: 'cursor:pointer;margin:0' }, '⬆ 导入备份');
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  importLabel.append(fileInput);
  fileInput.onchange = async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('无效备份文件');
      if (await confirmDialog('导入会覆盖当前全部数据，确认继续？', { danger: true })) {
        await api.post('/api/backup/import', data);
        toast('已导入恢复');
        render(el);
      }
    } catch (err) {
      toast('导入失败：' + (err.message || '文件格式错误'), 'error');
    }
    fileInput.value = '';
  };

  const card = h('div', { class: 'card', style: 'padding:16px' });
  card.append(h('div', { class: 'row', style: 'flex-wrap:wrap' }, exportBtn, importLabel));
  card.append(h('div', { class: 'small muted', style: 'margin-top:12px' }, `数据文件：${meta.filePath || '—'}`));
  card.append(h('div', { class: 'small muted' }, `占用大小：${meta.sizeBytes != null ? meta.sizeBytes + ' 字节' : '—'}`));
  group.append(card);
  return group;
}

function buildPrefsGroup(prefs) {
  const group = h('div', { class: 'settings-group' });
  group.append(h('h3', {}, '⚙️ 偏好设置'));

  const defHome = h('select', { class: 'input' });
  for (const [v, label] of HOME_OPTIONS) defHome.append(h('option', { value: v }, label));
  defHome.value = prefs.defaultHome || 'home';
  defHome.onchange = async () => { await savePrefs({ defaultHome: defHome.value }); };

  const theme = h('select', { class: 'input' });
  theme.append(h('option', { value: 'light' }, '浅色'));
  theme.append(h('option', { value: 'dark' }, '深色'));
  theme.value = prefs.theme || 'light';
  theme.onchange = async () => {
    await savePrefs({ theme: theme.value });
    document.documentElement.dataset.theme = theme.value;
  };

  const weekStart = h('select', { class: 'input' });
  weekStart.append(h('option', { value: 'mon' }, '周一'));
  weekStart.append(h('option', { value: 'sun' }, '周日'));
  weekStart.value = prefs.weekStart || 'mon';
  weekStart.onchange = async () => { await savePrefs({ weekStart: weekStart.value }); };

  const card = h('div', { class: 'card', style: 'padding:16px' });
  for (const [id, label, ctrl] of [['default-home', '默认首页（启动后先打开）', defHome], ['theme', '界面主题', theme], ['week-start', '一周起始日', weekStart]]) {
    ctrl.setAttribute('id', id);
    card.append(h('div', { style: 'margin-bottom:12px' }, h('label', { for: id }, label), ctrl));
  }
  group.append(card);
  return group;
}

async function savePrefs(patch) {
  await api.put('/api/preferences', patch);
  toast('已保存');
}

function buildAbout() {
  const group = h('div', { class: 'settings-group' });
  group.append(h('h3', {}, 'ℹ️ 关于'));
  group.append(h('div', { class: 'card', style: 'padding:16px' },
    h('p', { class: 'muted', style: 'margin:0' }, '工作生活专属 App · v1.0.0 · 纯本地运行，无登录无联网')));
  return group;
}

export function add() {}
