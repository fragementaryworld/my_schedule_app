import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { makeDocument, findByTag, findAllByTag } from '../test-helpers/dom-shim.mjs';

globalThis.document = makeDocument();

const uiUrl = pathToFileURL(path.join(process.cwd(), 'public', 'js', 'ui.js')).href;
const { openModal } = await import(uiUrl);

test('问题2：弹窗保存按钮通过 form 属性关联表单并可提交', async () => {
  let called = null;
  const p = openModal({
    title: '新增任务',
    fields: [{ name: 'title', label: '标题', type: 'text', required: true }],
    onSubmit: async (v) => { called = v; }
  });

  const form = findByTag(document.body, 'form');
  assert.ok(form, '弹窗应包含表单');
  assert.ok(form.id, '表单应有唯一 id（修复：保存按钮需借此关联）');

  const submit = findAllByTag(document.body, 'button').find((b) => b.getAttribute('type') === 'submit');
  assert.ok(submit, '弹窗应包含提交按钮');
  assert.equal(submit.getAttribute('form'), form.id, '提交按钮的 form 属性应指向表单 id');

  // 模拟填写并提交，验证提交值能传给 onSubmit
  const input = findAllByTag(form, 'input')[0];
  input.value = '测试标题';
  form.dispatchEvent('submit');
  await p;
  assert.deepEqual(called, { title: '测试标题' }, '提交应把表单值传给 onSubmit');
});

test('问题2：必填字段为空时不触发 onSubmit', async () => {
  let called = false;
  const p = openModal({
    title: '新增',
    fields: [{ name: 'title', label: '标题', type: 'text', required: true }],
    onSubmit: async () => { called = true; }
  });
  const form = findByTag(document.body, 'form');
  form.dispatchEvent('submit');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(called, false, '空值应被校验拦截');
  // 关闭弹窗，避免残留
  const cancel = findAllByTag(document.body, 'button').find((b) => b.getAttribute('type') === 'button');
  cancel.click();
  await p;
});
