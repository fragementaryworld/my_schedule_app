// 极简 DOM 桩，供无浏览器环境下的前端行为测试使用（仅覆盖本项目用到的 DOM API 子集）。
'use strict';

export class Element {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this._class = '';
    this.dataset = {};
    this.style = {};
    this.value = '';
    this.checked = false;
    this.textContent = '';
    this.disabled = false;
    this._innerHTML = '';
    this._listeners = {};
    this.id = '';
  }

  get className() {
    return this._class;
  }
  set className(v) {
    this._class = String(v);
  }

  get classList() {
    const self = this;
    const set = () => new Set(self._class.split(/\s+/).filter(Boolean));
    return {
      add(...c) { const s = set(); c.forEach((x) => s.add(x)); self._class = [...s].join(' '); },
      remove(...c) { const s = set(); c.forEach((x) => s.delete(x)); self._class = [...s].join(' '); },
      toggle(c, force) { const s = set(); const on = force === undefined ? !s.has(c) : !!force; on ? s.add(c) : s.delete(c); self._class = [...s].join(' '); return on; },
      contains(c) { return set().has(c); }
    };
  }

  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(v) {
    this._innerHTML = String(v);
    this.children = [];
  }

  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'class') this._class = String(v);
    if (k === 'id') this.id = String(v);
    if (k === 'type') this.type = String(v);
  }
  getAttribute(k) {
    return this.attrs[k];
  }

  addEventListener(type, fn) {
    (this._listeners[type] ||= []).push(fn);
  }
  dispatchEvent(type, event = {}) {
    const e = { preventDefault() {}, stopPropagation() {}, target: this, ...event };
    for (const fn of this._listeners[type] || []) fn(e);
  }

  append(...nodes) {
    for (const n of nodes.flat()) {
      if (n === null || n === undefined) continue;
      n.parentNode = this;
      this.children.push(n);
    }
  }
  appendChild(n) {
    n.parentNode = this;
    this.children.push(n);
    return n;
  }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    }
    this.parentNode = null;
  }
  focus() {}
  click() {
    this.dispatchEvent('click');
  }
}

export function makeDocument() {
  const document = {
    createElement: (t) => new Element(t),
    createTextNode: (t) => ({ nodeType: 3, text: String(t), children: [], parentNode: null }),
    body: new Element('body'),
    documentElement: new Element('html'),
    getElementById: (id) => findById(document.body, id)
  };
  return document;
}

function findById(root, id) {
  if (root.id === id) return root;
  for (const c of root.children || []) {
    const r = findById(c, id);
    if (r) return r;
  }
  return null;
}

export function findByTag(root, tag) {
  const T = String(tag).toUpperCase();
  if ((root.tagName || '') === T) return root;
  for (const c of root.children || []) {
    const r = findByTag(c, tag);
    if (r) return r;
  }
  return null;
}

export function findAllByTag(root, tag) {
  const T = String(tag).toUpperCase();
  const out = [];
  const walk = (n) => {
    if ((n.tagName || '') === T) out.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  return out;
}
