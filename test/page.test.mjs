import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const src = fs.readFileSync(path.join(process.cwd(), 'public', 'js', 'views', 'page.js'), 'utf8');
const pageUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'page.js')).href;
const page = await import(pageUrl);

test('问题3：子页面能力已移除', () => {
  assert.equal(page.pageAncestors, undefined);
  assert.equal(page.pageChildren, undefined);
  assert.equal(page.pageBreadcrumb, undefined);
  assert.equal(page.buildPageTree, undefined);
  assert.equal(page.buildSubpages, undefined);
});

test('问题3：页面源码不再出现 子页面 / 封面 / parentId', () => {
  assert.ok(!src.includes('子页面'), '不应再有子页面区块');
  assert.ok(!src.includes('添加封面'), '不应再有添加封面');
  assert.ok(!src.includes('parentId'), '不应再使用 parentId');
});

test('问题3：页面核心能力仍在', () => {
  assert.equal(typeof page.render, 'function');
  assert.equal(typeof page.add, 'function');
  assert.equal(typeof page.buildBlocksEditor, 'function');
  assert.equal(typeof page.buildIconTitle, 'function');
  assert.equal(typeof page.isFreshPage, 'function');
});
