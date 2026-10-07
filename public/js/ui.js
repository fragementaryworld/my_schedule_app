'use strict';
import { escapeHtml } from './utils.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(msg, type = 'info') {
  const box = document.getElementById('toast');
  if (!box) return;
  const t = h('div', { class: `toast ${type}` }, msg);
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2200);
}

export function confirmDialog(msg, { danger = false } = {}) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'modal-backdrop' });
    const modal = h('div', { class: 'modal modal-sm' });
    const body = h('div', { class: 'modal-body' }, h('p', { html: escapeHtml(msg) }));
    const foot = h('div', { class: 'modal-foot' });
    const cancel = h('button', { class: 'btn' }, '取消');
    const ok = h('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary' }, '确认');
    foot.append(cancel, ok);
    modal.append(h('div', { class: 'modal-title' }, '请确认'), body, foot);
    backdrop.append(modal);
    document.body.appendChild(backdrop);
    const close = (val) => { backdrop.remove(); resolve(val); };
    cancel.onclick = () => close(false);
    ok.onclick = () => close(true);
    backdrop.onclick = (e) => { if (e.target === backdrop) close(false); };
    ok.focus();
  });
}

// 通用表单弹窗：fields = [{ name, label, type, value, options, required, placeholder, help, rows }]
export function openModal({ title, fields = [], submitText = '保存', onSubmit }) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'modal-backdrop' });
    const modal = h('div', { class: 'modal' });
    const form = h('form', { class: 'modal-form' });
    const controls = {};

    const addField = (f) => {
      const wrap = h('div', { class: 'field' });
      let c;
      if (f.type === 'textarea') {
        wrap.append(h('label', {}, f.label || ''));
        c = h('textarea', { rows: f.rows || 3, placeholder: f.placeholder || '' });
        c.value = f.value || '';
      } else if (f.type === 'select') {
        wrap.append(h('label', {}, f.label || ''));
        c = h('select', {});
        for (const o of f.options || []) c.append(h('option', { value: o.value }, o.label));
        c.value = f.value || (f.options && f.options[0] && f.options[0].value);
      } else if (f.type === 'checkbox') {
        c = h('input', { type: 'checkbox' });
        c.checked = !!f.value;
        wrap.append(h('label', { class: 'checkbox-label' }, c, f.label || ''));
      } else {
        wrap.append(h('label', {}, f.label || ''));
        c = h('input', { type: f.type || 'text', placeholder: f.placeholder || '' });
        c.value = f.value || '';
      }
      if (f.type !== 'checkbox') wrap.append(c);
      if (f.help) wrap.append(h('div', { class: 'small muted' }, f.help));
      controls[f.name] = c;
      return wrap;
    };

    fields.forEach((f) => form.append(addField(f)));
    const errBox = h('div', { class: 'field-error' });
    form.append(errBox);

    const foot = h('div', { class: 'modal-foot' });
    const cancel = h('button', { type: 'button', class: 'btn' }, '取消');
    const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, submitText);
    foot.append(cancel, submit);
    modal.append(h('div', { class: 'modal-title' }, title), h('div', { class: 'modal-body' }, form), foot);
    backdrop.append(modal);
    document.body.appendChild(backdrop);

    const close = (result) => { backdrop.remove(); resolve(result); };
    cancel.onclick = () => close(null);
    backdrop.onclick = (e) => { if (e.target === backdrop) close(null); };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = {};
      for (const f of fields) values[f.name] = f.type === 'checkbox' ? controls[f.name].checked : controls[f.name].value;
      for (const f of fields) {
        if (f.required && !String(values[f.name] ?? '').trim()) {
          errBox.textContent = `请填写「${f.label || f.name}」`;
          return;
        }
      }
      submit.disabled = true;
      try {
        const r = await onSubmit(values);
        if (r && r.ok === false) {
          errBox.textContent = r.error || '操作失败';
          submit.disabled = false;
          return;
        }
        close(r || values);
      } catch (err) {
        errBox.textContent = err.message || '操作失败';
        submit.disabled = false;
      }
    });

    const first = fields.find((f) => f.type !== 'checkbox');
    if (first && controls[first.name]) controls[first.name].focus();
  });
}
