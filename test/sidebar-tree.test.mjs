import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findAllByClass, textOf } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/projects' };

const PROJECTS = [
  { id: 'root', name: '根项目', icon: '📘', parentId: null },
  { id: 'child', name: '子页面', icon: '📄', parentId: 'root' },
  { id: 'other', name: '另一项目', icon: '📁', parentId: null }
];

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => PROJECTS });

const box = document.createElement('div');
box.setAttribute('id', 'pageTree');
document.body.appendChild(box);

const sidebarUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'sidebar.js')).href;
const { renderPageTree } = await import(sidebarUrl);

test('增量3：页面树默认显示根页面，子页面折叠', async () => {
  await renderPageTree();
  const links = findAllByClass(box, 'tree-link');
  assert.equal(links.length, 2, '默认只显示两个根页面');
  assert.ok(textOf(links[0]).includes('根项目'));
});

test('增量3：点击箭头展开子页面', async () => {
  await renderPageTree();
  const carets = findAllByClass(box, 'tree-caret');
  assert.equal(textOf(carets[0]), '▸', '有子节点时应显示折叠箭头');
  carets[0].click();
  await new Promise((r) => setTimeout(r, 10));
  const links = findAllByClass(box, 'tree-link');
  assert.equal(links.length, 3, '展开后应出现子页面');
  assert.ok(links.some((a) => textOf(a).includes('子页面')));
});

test('增量3：页面链接指向 #/page/:id', () => {
  const hrefs = findAllByClass(box, 'tree-link').map((a) => a.getAttribute('href'));
  assert.ok(hrefs.includes('#/page/root'), '应包含根页面链接');
  assert.ok(hrefs.includes('#/page/child'), '应包含子页面链接');
});
