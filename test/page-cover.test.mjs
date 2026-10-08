import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeDocument, findAllByClass } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/page/p1' };

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({
    url: String(url),
    method: opts.method || 'GET',
    body: opts.body ? JSON.parse(opts.body) : null
  });
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const src = fs.readFileSync(path.join(process.cwd(), 'public', 'js', 'views', 'page.js'), 'utf8');
const pageUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'page.js')).href;
const page = await import(pageUrl);

test('问题3：封面功能已移除', () => {
  assert.equal(page.buildCover, undefined);
  assert.equal(page.PAGE_COVERS, undefined);
  assert.equal(page.coverCss, undefined);
  assert.ok(!src.includes('page-cover'), '源码不应再出现封面样式类');
  assert.ok(!src.includes('封面'), '源码不应再出现「封面」字样');
});

test('问题3：图标选择器保留可用', async () => {
  calls.length = 0;
  const head = page.buildIconTitle({ id: 'p1', name: 'P', icon: '📁' });
  findAllByClass(head, 'page-icon')[0].click();
  const choices = findAllByClass(head, 'icon-choice');
  assert.equal(choices.length, page.PAGE_ICONS.length, '应显示全部图标');
  choices[0].click();
  await new Promise((r) => setTimeout(r, 10));
  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/api/projects/p1'));
  assert.ok(put, '应保存图标');
  assert.deepEqual(put.body, { icon: page.PAGE_ICONS[0] });
});
