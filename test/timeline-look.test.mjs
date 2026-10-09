import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByTag, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/projects' };

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const method = opts.method || 'GET';
  calls.push({ url: String(url), method });
  if (method === 'GET') return { ok: true, status: 200, json: async () => PROJECTS };
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const PROJECTS = [
  {
    id: 'p1', name: '项目A', icon: '📁', status: 'active', priority: 'medium', progress: 0,
    startDate: '2024-05-01', dueDate: '2024-05-31', dateFormat: 'iso', blocks: [], tasks: []
  },
  {
    id: 'p2', name: '项目B', icon: '📁', status: 'paused', priority: 'low', progress: 0,
    startDate: '2024-05-10', dueDate: '2024-06-10', dateFormat: 'iso', blocks: [], tasks: []
  }
];

const projectsUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href;
const projects = await import(projectsUrl);
const tick = () => new Promise((r) => setTimeout(r, 10));

// ——— 纯函数 ———

test('美化：lastDayOfMonth 处理闰年与月长', () => {
  assert.equal(projects.lastDayOfMonth(2024, 2), 29);
  assert.equal(projects.lastDayOfMonth(2023, 2), 28);
  assert.equal(projects.lastDayOfMonth(2024, 4), 30);
  assert.equal(projects.lastDayOfMonth(2024, 5), 31);
});

test('美化：axisStep 随范围变稀，避免臃肿', () => {
  assert.equal(projects.axisStep(7), 1);
  assert.equal(projects.axisStep(31), 1);
  assert.equal(projects.axisStep(60), 2);
  assert.equal(projects.axisStep(120), 7);
  assert.equal(projects.axisStep(365), 14);
});

test('美化：timelineAxis 分出月份段与日期格', () => {
  const a = projects.timelineAxis('2024-05-20', '2024-06-10');
  assert.equal(a.totalDays, 21);
  assert.deepEqual(a.months.map((m) => m.label), ['2024年5月', '2024年6月']);

  assert.equal(a.months[0].left, 0, '五月段从范围起点开始');
  assert.ok(Math.abs(a.months[0].width - (12 / 21) * 100) < 0.001, '五月段到 6/1 截止');
  assert.ok(Math.abs(a.months[1].left - (12 / 21) * 100) < 0.001, '六月段从 6/1 开始');
  assert.equal(Math.round(a.months[1].width + a.months[1].left), 100, '月份段首尾相接铺满');

  assert.equal(a.step, 1);
  assert.equal(a.days.length, 21);
  assert.equal(a.days[0].day, 20);
  assert.equal(a.days[0].left, 0);
  assert.equal(a.days[1].day, 21);
});

test('美化：范围越长日期格越稀', () => {
  assert.equal(projects.timelineAxis('2024-01-01', '2024-01-20').step, 1);
  assert.equal(projects.timelineAxis('2024-01-01', '2024-03-01').step, 2);
  assert.equal(projects.timelineAxis('2024-01-01', '2024-06-01').step, 7);
  const year = projects.timelineAxis('2024-01-01', '2024-12-31');
  assert.equal(year.step, 14);
  assert.equal(year.days.length, Math.ceil(365 / 14));
  assert.equal(year.months.length, 12);
});

test('美化：每天一条分格线（短范围）', () => {
  const a = projects.timelineAxis('2024-05-01', '2024-05-10');
  assert.equal(a.step, 1);
  assert.equal(a.days.length, 9, '范围 10 天 → 9 个日格');
  assert.equal(a.days[0].left, 0);
  assert.ok(Math.abs(a.days[1].left - 100 / 9) < 0.001);
});

test('美化：颜色按 id 稳定、不同条目尽量不同', () => {
  assert.equal(projects.timelineColor('p1'), projects.timelineColor('p1'), '同一 id 颜色稳定');
  assert.equal(projects.timelineColorIndex('p1'), projects.timelineColorIndex('p1'));
  assert.ok(projects.TIMELINE_COLORS.includes(projects.timelineColor('whatever')));
  assert.equal(projects.TIMELINE_COLORS.length, 10);

  const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  const seen = new Set(ids.map((id) => projects.timelineColor(id)));
  assert.ok(seen.size >= 4, `不同条目应拿到不同颜色，实际 ${seen.size} 种`);
});

// ——— 项目时间线 ———

async function projectTimeline() {
  const container = document.createElement('div');
  await projects.render(container, {});
  findAllByTag(container, 'button').find((b) => textOf(b) === '时间线').click();
  await tick();
  return container;
}

test('美化：项目时间线有月份行 + 日期行两级标尺', async () => {
  const el = await projectTimeline();
  assert.equal(findAllByClass(el, 'timeline-ruler').length, 1);
  assert.equal(findAllByClass(el, 'timeline-axis').length, 1);

  const months = findAllByClass(el, 'timeline-month-label');
  const days = findAllByClass(el, 'timeline-day-label');
  assert.deepEqual(months.map((m) => textOf(m)), ['2024年5月', '2024年6月'], '上面是月');
  assert.ok(days.length >= 20, '下面是日');
  assert.ok(days.every((d) => /^\d+$/.test(textOf(d))), '日格只显示日号');

  assert.ok(findAllByClass(el, 'timeline-tick-label').length >= 2, '旧断言用的类名仍然存在');
});

test('美化：项目时间线日与日之间有极浅分格线', async () => {
  const el = await projectTimeline();
  const rulerLines = findAllByClass(findAllByClass(el, 'timeline-grid')[0], 'timeline-gridline');
  const a = projects.timelineAxis('2024-05-01', '2024-06-10');
  assert.equal(rulerLines.length, a.days.length, '标尺分格数与日格数一致');

  const trackGrids = findAllByClass(el, 'timeline-track-grid');
  assert.equal(trackGrids.length, 2, '每个条目的轨道都有同款分格');
  for (const g of trackGrids) {
    assert.equal(findAllByClass(g, 'timeline-gridline').length, a.days.length, '轨道分格与标尺对齐');
  }
});

test('美化：每个项目一个颜色方框 + 色点', async () => {
  const el = await projectTimeline();
  const bars = findAllByClass(el, 'timeline-bar');
  assert.equal(bars.length, 2);

  const colors = bars.map((b) => {
    const m = /background:(#[0-9a-f]{6})/i.exec(String(b.getAttribute('style')));
    return m && m[1];
  });
  assert.ok(colors.every(Boolean), '时间条应带自己的颜色');
  assert.notEqual(colors[0], colors[1], '两个项目颜色不同');

  const dots = findAllByClass(el, 'timeline-dot');
  assert.equal(dots.length, 2, '名目前面有色点');
  assert.ok(String(dots[0].getAttribute('style')).includes(colors[0]), '色点与时间条同色');
});

test('美化：长范围轨道会加宽并可横向滚动', async () => {
  const el = await projectTimeline();
  const ruler = findAllByClass(el, 'timeline-ruler')[0];
  assert.ok(String(ruler.getAttribute('style')).includes('min-width'), '标尺有最小宽度');
  const row = findAllByClass(el, 'timeline-row')[0];
  assert.ok(String(row.getAttribute('style')).includes('min-width'), '行与标尺同宽');
});

// ——— 任务/子任务时间线 ———

function itemTimeline() {
  const item = {
    id: 't1', title: '任务', done: false, dateFormat: 'iso',
    startDate: '2024-05-01', dueDate: '2024-05-10',
    subtasks: [
      { id: 's1', title: '子任务A', done: false, startDate: '2024-05-02', dueDate: '2024-05-06', subtasks: [] },
      { id: 's2', title: '子任务B', done: true, startDate: '2024-05-05', dueDate: '2024-05-09', subtasks: [] }
    ]
  };
  const el = document.createElement('div');
  const refresh = () => {
    el.innerHTML = '';
    el.append(projects.buildChildViews({
      projectId: 'p1', parentChain: ['t1'], items: item.subtasks, rangeNode: item, refresh,
      deep: true, defaultExpanded: true
    }));
  };
  refresh();
  findAllByTag(el, 'button').find((b) => textOf(b) === '时间线').click();
  return el;
}

test('美化：任务时间线同样有月/日两级标尺与色块', () => {
  const el = itemTimeline();
  assert.equal(findAllByClass(el, 'timeline-ruler').length, 1);
  assert.deepEqual(findAllByClass(el, 'timeline-month-label').map((m) => textOf(m)), ['2024年5月']);
  assert.ok(findAllByClass(el, 'timeline-day-label').length >= 5);

  const bars = findAllByClass(el, 'timeline-bar');
  assert.equal(bars.length, 2);
  const colors = bars.map((b) => (/background:(#[0-9a-f]{6})/i.exec(String(b.getAttribute('style'))) || [])[1]);
  assert.ok(colors.every(Boolean));
  assert.notEqual(colors[0], colors[1], '两个任务颜色不同');
  assert.equal(findAllByClass(el, 'timeline-dot').length, 2);
});

test('美化：已完成任务的时间条淡一些', () => {
  const el = itemTimeline();
  assert.equal(findAllByClass(el, 'timeline-bar')[1].className.includes('bar-done'), true);
});
