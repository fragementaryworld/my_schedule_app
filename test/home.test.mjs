import { test } from 'node:test';
import assert from 'node:assert';
import { summarize } from '../public/js/views/home.js';
import { todayStr, addDays } from '../public/js/utils.js';

function fixture(today) {
  const yest = addDays(today, -1);
  return {
    tasks: [
      { id: '1', title: '低优先', priority: 'low', order: 0, done: false, date: today, time: null },
      { id: '2', title: '高优先', priority: 'high', order: 1, done: false, date: today, time: null },
      { id: '3', title: '已逾期', priority: 'medium', order: 2, done: false, date: yest, planDate: today, time: null },
      { id: '4', title: '已完成', priority: 'high', order: 3, done: true, date: today, time: null }
    ],
    memos: [{ id: 'm1', text: '买牛奶', createdAt: 'x' }],
    projects: [
      { id: 'p1', name: '项目A', status: 'active', progress: 40 },
      { id: 'p2', name: '项目B', status: 'paused', progress: 10 }
    ],
    books: [
      { id: 'b1', title: '在读1', status: 'reading', current: 50, total: 200, unit: 'page' },
      { id: 'b2', title: '读完', status: 'done', current: 100, total: 100, unit: 'page' }
    ],
    workouts: {
      exercises: [{ id: 'e1', name: '深蹲' }],
      schedule: { mon: ['e1'], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      logs: [{ id: 'l1', date: today, exercises: [] }]
    },
    ideas: [
      { id: 'i1', title: '灵感1', status: 'idea' },
      { id: 'i2', title: '灵感2', status: 'done' }
    ]
  };
}

test('summarize 统计待办、完成与逾期', () => {
  const today = todayStr();
  const s = summarize(fixture(today), today);
  assert.equal(s.pending.length, 3);
  assert.equal(s.doneCount, 1);
  assert.equal(s.overdue.length, 1);
  assert.equal(s.overdue[0].title, '已逾期');
});

test('summarize 优先级排序取 top3', () => {
  const today = todayStr();
  const s = summarize(fixture(today), today);
  assert.deepEqual(s.top3.map((t) => t.title), ['高优先', '已逾期', '低优先']);
});

test('summarize 汇总各模块摘要', () => {
  const today = todayStr();
  const s = summarize(fixture(today), today);
  assert.equal(s.memos.length, 1);
  assert.equal(s.activeProjects.length, 1);
  assert.equal(s.activeProjects[0].name, '项目A');
  assert.equal(s.readingBooks.length, 1);
  assert.equal(s.readingBooks[0].title, '在读1');
  assert.equal(s.weekLogCount, 1);
  assert.equal(s.ideasOpen, 1);
  assert.equal(s.latestIdeas.length, 2);
});

test('summarize 计算今日训练名称', () => {
  const today = todayStr();
  const s = summarize(fixture(today), today);
  // 只有周一安排了深蹲，其他星期为空
  const isMon = new Date(today).getDay() === 1;
  assert.deepEqual(s.todayTraining, isMon ? ['深蹲'] : []);
});

test('首页与今日看板统一统计：归属项目、改期及深层任务参与，候选和暂停项目不计入', () => {
  const today = todayStr();
  const future = addDays(today, 5);
  const input = {
    tasks: [
      { id: 'moved', title: '今天移走', date: today, planDate: future },
      { id: 'planned', title: '从别天安排过来', date: future, planDate: today },
      { id: 'candidate', title: '未安排旧任务', date: addDays(today, -1) },
      { id: 'done', title: '当天完成', date: today, done: true }
    ],
    projects: [
      { id: 'p', name: '工作', status: 'active', tasks: [
        { id: 'parent', title: '未安排父任务', dueDate: future, subtasks: [
          { id: 'child', title: '当天截止子任务', dueDate: today }
        ] },
        { id: 'scheduled', title: '今天安排，之后截止', planDate: today, dueDate: future },
        { id: 'both', title: '当天安排与截止', planDate: today, dueDate: today }
      ] },
      { id: 'paused', name: '暂停', status: 'paused', tasks: [{ id: 'hidden', title: '暂停工作', planDate: today }] }
    ]
  };
  const s = summarize(input, today);
  assert.deepEqual(s.pending.map(task => task.id).sort(), ['both', 'child', 'planned', 'scheduled']);
  assert.equal(s.doneCount, 1);
  assert.equal(new Set(s.pending.map(task => task.base)).size, s.pending.length);
});
