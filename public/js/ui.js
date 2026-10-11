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

// 重绘会先清空内容，浏览器会把滚动条弹回顶部；重绘前后保住滚动位置。
// 注意：本应用真正滚动的是 #content（shell.css 里 overflow:auto），不是 window。
export function scrollBox() {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return null;
  return document.getElementById('content');
}

export function scrollPos() {
  const box = scrollBox();
  const win = (typeof window === 'undefined') ? null : { x: window.scrollX || 0, y: window.scrollY || 0 };
  if (!box && !win) return null;
  return { box, boxTop: box ? (box.scrollTop || 0) : 0, win };
}

export function restoreScroll(pos) {
  if (!pos) return;
  if (pos.box) pos.box.scrollTop = pos.boxTop;
  if (pos.win && typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
    window.scrollTo(pos.win.x, pos.win.y);
  }
}

// 整页重绘会把 DOM 全换掉，焦点也随之丢失：
// 例如"改完标题再点预计用时输入框"——标题失焦触发保存→重绘→刚点进去的输入框被换掉、
// 焦点掉到 body，之后敲键盘全都落空。这里和滚动位置一样：重绘前记录、重绘后恢复。
// 需要被记住的控件加一个稳定的 data-focus-key 即可。
export function focusSnapshot() {
  if (typeof document === 'undefined' || !document.activeElement) return null;
  const el = document.activeElement;
  if (!el || !el.tagName || el === document.body) return null;
  const key = typeof el.getAttribute === 'function' ? el.getAttribute('data-focus-key') : null;
  if (!key) return null;
  const snap = { key };
  // 重点：把"用户已经敲进去的内容"一起带走。
  // 否则保存引起的重绘会把正在输入的字丢掉，输入框看起来被清空/变成 0。
  if (typeof el.value === 'string') snap.value = el.value;
  if (typeof el.selectionStart === 'number') snap.start = el.selectionStart;
  if (typeof el.selectionEnd === 'number') snap.end = el.selectionEnd;
  if (typeof el.getAttribute === 'function' && el.getAttribute('contenteditable') === 'true'
    && typeof el.textContent === 'string') {
    snap.text = el.textContent;
  }
  return snap;
}

export function focusRestore(snap) {
  if (!snap || typeof document === 'undefined') return;
  const selector = `[data-focus-key="${snap.key}"]`;
  let target = null;
  if (typeof document.querySelectorAll === 'function') {
    target = [...document.querySelectorAll(selector)].find(isFocusable) || null;
  } else if (typeof document.querySelector === 'function') {
    const one = document.querySelector(selector);
    target = isFocusable(one) ? one : null;
  }
  if (!target) return;

  // 先把内容接回去，再聚焦，保证光标落在正确位置
  if (typeof snap.value === 'string' && typeof target.value === 'string' && target.value !== snap.value) {
    target.value = snap.value;
  }
  if (typeof snap.text === 'string' && typeof target.textContent === 'string' && target.textContent !== snap.text) {
    target.textContent = snap.text;
  }
  target.focus();

  const len = typeof target.value === 'string' ? target.value.length : null;
  if (typeof snap.start === 'number' && typeof target.setSelectionRange === 'function' && len !== null) {
    try {
      target.setSelectionRange(Math.min(snap.start, len), Math.min(typeof snap.end === 'number' ? snap.end : snap.start, len));
    } catch (err) { /* 该控件不支持选区 */ }
  } else if (typeof target.setSelectionRange === 'function' && len !== null) {
    // 光标移到末尾，接着敲键盘就接在已有内容后面
    try { target.setSelectionRange(len, len); } catch (err) { /* 该控件不支持选区 */ }
  }
}

// 只有真正能接收焦点的元素才值得恢复（容器 div、隐藏元素都不行）
function isFocusable(el) {
  if (!el || typeof el.focus !== 'function') return false;
  if (el.style && el.style.display === 'none') return false;
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return true;
  if (typeof el.getAttribute !== 'function') return false;
  if (el.getAttribute('contenteditable') === 'true') return true;
  const tabindex = el.getAttribute('tabindex');
  return tabindex !== null && tabindex !== undefined && tabindex !== '-1';
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

export function confirmDialog(msg, { danger = false, confirmText = '确认' } = {}) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'modal-backdrop' });
    const modal = h('div', { class: 'modal modal-sm' });
    const body = h('div', { class: 'modal-body' }, h('p', { html: escapeHtml(msg) }));
    const foot = h('div', { class: 'modal-foot' });
    const cancel = h('button', { class: 'btn' }, '取消');
    const ok = h('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary' }, confirmText);
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
    const formId = 'modal-form-' + Math.random().toString(36).slice(2, 10);
    const form = h('form', { class: 'modal-form', id: formId });
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
        c.value = f.value ?? (f.options && f.options[0] && f.options[0].value);
      } else if (f.type === 'datalist') {
        wrap.append(h('label', {}, f.label || ''));
        const listId = `dl-${f.name}-${Math.random().toString(36).slice(2, 8)}`;
        c = h('input', { type: 'text', list: listId, placeholder: f.placeholder || '' });
        c.value = f.value || '';
        const dl = h('datalist', { id: listId });
        for (const o of f.options || []) dl.append(h('option', { value: typeof o === 'string' ? o : o.value }));
        wrap.append(dl);
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
      if (f.onChange) c.addEventListener('change', () => f.onChange(c.value, controls));
      return wrap;
    };

    fields.forEach((f) => form.append(addField(f)));
    const errBox = h('div', { class: 'field-error' });
    form.append(errBox);

    const foot = h('div', { class: 'modal-foot' });
    const cancel = h('button', { type: 'button', class: 'btn' }, '取消');
    const submit = h('button', { type: 'submit', class: 'btn btn-primary', form: formId }, submitText);
    foot.append(cancel, submit);
    modal.append(h('div', { class: 'modal-title' }, title), h('div', { class: 'modal-body' }, form), foot);
    backdrop.append(modal);
    document.body.appendChild(backdrop);

    const close = (result) => { backdrop.remove(); resolve(result); };
    cancel.onclick = () => close(null);
    // 点击遮罩不关闭弹窗，避免误触丢失已填内容

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
