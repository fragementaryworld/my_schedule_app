import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, findAllByClass, findAllByTag } from '../test-helpers/dom-shim.mjs';
import { buildDailyBoard, dailyEntries } from '../public/js/daily.js';

function setup() {
  globalThis.document = makeDocument();
  globalThis.location = { hash: '#/today' };
  const entries = dailyEntries([
    { id: 'a', title: '上午任务', date: '2026-10-11', planPeriod: 'morning' },
    { id: 'b', title: '下午任务', date: '2026-10-11', planPeriod: 'afternoon' }
  ], []);
  const build = () => buildDailyBoard(entries, '2026-10-11', async () => {});
  const board = build(); document.body.append(board);
  const menus = findAllByClass(board, 'daily-task-menu');
  return { board, menus, build };
}

test('点击任务外、看板空白和页面外部控件均收起更多操作菜单', () => {
  const { board, menus } = setup();
  const outside = document.createElement('button'); document.body.append(outside);
  for (const target of [board, outside, findAllByClass(board, 'daily-task-title')[1]]) {
    menus[0].open = true; target.click(); assert.equal(menus[0].open, false);
  }
});

test('点击菜单内部内容不误关闭，打开另一个菜单会关闭原菜单', () => {
  const { menus } = setup(); menus[0].open = true;
  findAllByClass(menus[0], 'daily-task-menu-items')[0].click();
  assert.equal(menus[0].open, true);
  findAllByTag(menus[1], 'summary')[0].click();
  assert.equal(menus[0].open, false);
  menus[1].open = true; menus[1].fire('toggle');
  assert.equal(menus[1].open, true);
});

test('键盘打开菜单互斥，Escape 收起并把焦点交还给更多操作按钮', () => {
  const { menus } = setup(); menus[0].open = true; menus[1].open = true;
  menus[1].fire('toggle'); assert.equal(menus[0].open, false);
  document.dispatchEvent('keydown', { key: 'Escape' });
  assert.equal(menus[1].open, false);
  assert.equal(document.activeElement, findAllByTag(menus[1], 'summary')[0]);
});

test('多次重绘只有一组文档监听器，仍可关闭新菜单', () => {
  const { board, build } = setup(); board.remove();
  for (let i = 0; i < 20; i++) {
    const next = build(); document.body.append(next);
    const menu = findAllByClass(next, 'daily-task-menu')[0]; menu.open = true;
    document.body.click(); assert.equal(menu.open, false); next.remove();
  }
  assert.equal(document.listenerCount('click'), 1);
  assert.equal(document.listenerCount('keydown'), 1);
});

test('外部点击使用捕获监听，页面阻止冒泡也能关闭菜单', () => {
  const { menus } = setup();
  const outside = document.createElement('button'); document.body.append(outside);
  outside.onclick = event => event.stopPropagation();
  menus[0].open = true; outside.click();
  assert.equal(menus[0].open, false);
});
