import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDocument, findAllByClass, findAllByTag, textOf } from '../test-helpers/dom-shim.mjs';
import { buildDailyBoard, dailyEntries } from '../public/js/daily.js';

const css = readFileSync(new URL('../public/css/modules.css', import.meta.url), 'utf8');
function variables(selector) {
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(x => x[1].trim() === selector);
  assert.ok(rule, `缺少主题规则 ${selector}`);
  return Object.fromEntries([...rule[2].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map(x => [x[1], x[2]]));
}
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255)
    .map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}

test('时段标题在浅色、深色背景上的文字对比度达到 4.5:1，四种分区底色不同', () => {
  for (const prefix of ['', '[data-theme="dark"] ']) {
    const palettes = ['.daily-period', '.daily-period-morning', '.daily-period-afternoon', '.daily-period-evening'].map(s => variables(prefix + s));
    assert.equal(new Set(palettes.map(p => p['period-bg'])).size, 4);
    for (const p of palettes) {
      const a = luminance(p['period-bg']), b = luminance(p['period-ink']);
      assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, JSON.stringify(p));
    }
  }
});

test('配色后的四时段保持标签、计数、任务和操作完整，完成任务仍默认折叠', () => {
  globalThis.document = makeDocument();
  const date = '2026-10-11';
  const tasks = ['morning', 'afternoon', 'evening', ''].map((p, i) => ({ id: String(i), title: `事项${i}`, date, planPeriod: p }));
  tasks.push({ id: 'done', title: '完成任务', date, done: true });
  const root = buildDailyBoard(dailyEntries(tasks, []), date, async () => {});
  const periods = findAllByClass(root, 'daily-period');
  assert.equal(periods.length, 4);
  periods.forEach((section, i) => {
    assert.equal(findAllByClass(section, 'daily-task').length, 1);
    assert.ok(textOf(section).includes(`事项${i}`));
    assert.ok(textOf(findAllByTag(section, 'h2')[0]).includes(['上午', '下午', '晚上', '待安排'][i]));
    assert.equal(textOf(findAllByClass(section, 'daily-count')[0]), '1');
    assert.equal(findAllByTag(section, 'select').length, 1);
    assert.equal(findAllByClass(section, 'daily-task-menu').length, 1);
  });
  const done = findAllByClass(root, 'daily-done')[0];
  assert.equal(done.hasAttribute('open'), false);
  assert.ok(textOf(done).includes('完成任务'));
});
