import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeDocument, findAllByTag, findAllByClass } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();
globalThis.location = { hash: '#/projects' };

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });

const src = fs.readFileSync(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js'), 'utf8');
const projectsUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'views', 'projects.js')).href;
const projects = await import(projectsUrl);

test('问题1：编辑弹窗表单已移除', () => {
  assert.equal(projects.projectFields, undefined, '不应再导出 projectFields');
  assert.ok(!src.includes('projectModal'), '源码不应再有 projectModal');
  assert.ok(!src.includes('openModal'), '源码不应再使用 openModal');
});

test('问题1：表格编辑标识点击后进入项目页面', () => {
  globalThis.location.hash = '#/projects';
  const table = projects.buildProjectTable([{ id: 'p9', name: '某项目', status: 'active', tasks: [] }]);
  const editBtn = findAllByTag(table, 'button').find((b) => b.getAttribute('title') === '编辑');
  assert.ok(editBtn, '表格行应有编辑标识');
  editBtn.click();
  assert.equal(globalThis.location.hash, '#/page/p9', '应跳转到项目页面而不是弹窗');
});

test('问题1：点击编辑不会弹出任何窗口', () => {
  const table = projects.buildProjectTable([{ id: 'p10', name: '项目', status: 'active', tasks: [] }]);
  findAllByTag(table, 'button').find((b) => b.getAttribute('title') === '编辑').click();
  const backdrops = document.body.children.filter((c) => String(c.className).includes('modal-backdrop'));
  assert.equal(backdrops.length, 0, '不应出现弹窗');
});

test('问题1：表格仍提供删除按钮', () => {
  const table = projects.buildProjectTable([{ id: 'p11', name: '项目', status: 'active', tasks: [] }]);
  const delBtn = findAllByTag(table, 'button').find((b) => b.getAttribute('title') === '删除');
  assert.ok(delBtn, '删除按钮应保留');
  assert.equal(findAllByClass(table, 'block-type-select').length, 0);
});
