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
    // 真实 DOM 里被移除的节点会脱离文档（parentNode 变 null），这里也要照做
    for (const c of this.children) c.parentNode = null;
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
  hasAttribute(k) {
    return Object.prototype.hasOwnProperty.call(this.attrs, k);
  }
  removeAttribute(k) {
    delete this.attrs[k];
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
  blur() {
    this.dispatchEvent('blur');
  }
  // 同时触发 addEventListener 监听器与 on<type> 属性处理器，并按浏览器行为向父级冒泡
  fire(type, event = {}) {
    const e = {
      type,
      target: this,
      preventDefault() {},
      stopPropagation() { e._stopped = true; },
      ...event
    };
    const doc = typeof document === 'undefined' ? null : document;
    // 传播路径在派发时就固定下来：即使处理函数中途把节点移出文档，事件仍沿原路径继续冒泡
    const path = [];
    let reachedBody = false;
    let node = this;
    while (node) {
      path.push(node);
      if (doc && node === doc.body) reachedBody = true;
      node = node.parentNode || null;
    }
    for (const n of path) {
      for (const fn of n._listeners[type] || []) fn(e);
      const prop = n['on' + type];
      if (typeof prop === 'function') prop(e);
      if (e._stopped) return;
    }
    // 只有挂在文档上的元素，事件才会继续冒泡到 document
    if (reachedBody && doc && typeof doc.dispatchEvent === 'function') doc.dispatchEvent(type, e);
  }
  click() {
    this.fire('click');
  }
}

export function makeDocument() {
  const listeners = {};
  const document = {
    createElement: (t) => new Element(t),
    createTextNode: (t) => ({ nodeType: 3, text: String(t), children: [], parentNode: null }),
    body: new Element('body'),
    documentElement: new Element('html'),
    getElementById: (id) => findById(document.body, id),
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    dispatchEvent(type, event = {}) {
      const e = { type, preventDefault() {}, stopPropagation() {}, ...event };
      for (const fn of [...(listeners[type] || [])]) fn(e);
    },
    listenerCount(type) {
      return (listeners[type] || []).length;
    }
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

export function findAllByClass(root, cls) {
  const out = [];
  const walk = (n) => {
    if (String(n.className || '').split(/\s+/).includes(cls)) out.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  return out;
}

export function textOf(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.text || '';
  let s = '';
  for (const c of node.children || []) s += textOf(c);
  // 没有子元素时，回退读取 textContent（代码里常用 el.textContent = '…' 赋值）
  if (!s && typeof node.textContent === 'string') return node.textContent;
  return s;
}
