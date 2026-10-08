import { test } from 'node:test';
import assert from 'node:assert';
import { pageAncestors, pageChildren, pageBreadcrumb, buildPageTree } from '../public/js/views/page.js';

const PROJECTS = [
  { id: 'root', name: '根项目', parentId: null },
  { id: 'a', name: '子页面A', parentId: 'root' },
  { id: 'b', name: '子页面B', parentId: 'a' },
  { id: 'other', name: '另一个项目', parentId: null }
];

test('增量2：pageAncestors 返回从根到父的祖先链', () => {
  assert.deepEqual(pageAncestors(PROJECTS, 'b').map((p) => p.id), ['root', 'a']);
  assert.deepEqual(pageAncestors(PROJECTS, 'a').map((p) => p.id), ['root']);
  assert.deepEqual(pageAncestors(PROJECTS, 'root').map((p) => p.id), []);
});

test('增量2：pageChildren 返回直接子页面', () => {
  assert.deepEqual(pageChildren(PROJECTS, 'root').map((p) => p.id), ['a']);
  assert.deepEqual(pageChildren(PROJECTS, 'a').map((p) => p.id), ['b']);
  assert.deepEqual(pageChildren(PROJECTS, 'other').map((p) => p.id), []);
});

test('增量2：pageBreadcrumb 为 祖先+自身', () => {
  assert.deepEqual(pageBreadcrumb(PROJECTS, 'b').map((p) => p.id), ['root', 'a', 'b']);
  assert.deepEqual(pageBreadcrumb(PROJECTS, 'root').map((p) => p.id), ['root']);
  assert.deepEqual(pageBreadcrumb(PROJECTS, 'missing'), []);
});

test('增量2：循环父链不会死循环', () => {
  const cyclic = [
    { id: 'x', name: 'X', parentId: 'y' },
    { id: 'y', name: 'Y', parentId: 'x' }
  ];
  const anc = pageAncestors(cyclic, 'x');
  assert.ok(anc.length <= 2, '循环时应能安全终止');
});

test('增量3：buildPageTree 构建嵌套页面树', () => {
  const tree = buildPageTree(PROJECTS);
  assert.deepEqual(tree.map((n) => n.page.id), ['root', 'other']);
  assert.deepEqual(tree[0].children.map((n) => n.page.id), ['a']);
  assert.deepEqual(tree[0].children[0].children.map((n) => n.page.id), ['b']);
});

test('增量3：孤儿节点当作根节点', () => {
  const tree = buildPageTree([
    { id: 'p1', name: 'P1', parentId: 'ghost' },
    { id: 'p2', name: 'P2', parentId: null }
  ]);
  assert.deepEqual(tree.map((n) => n.page.id).sort(), ['p1', 'p2']);
});

test('增量3：空列表返回空树', () => {
  assert.deepEqual(buildPageTree([]), []);
  assert.deepEqual(buildPageTree(null), []);
});
