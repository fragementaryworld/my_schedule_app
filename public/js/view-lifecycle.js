'use strict';
const states = new WeakMap();

// 一次重绘只拥有自己的容器和版本；退役页面不能再提交迟到的数据。
export function beginRender(container) {
  if (!container) return () => false;
  let state = states.get(container);
  if (!state) states.set(container, state = { version: 0, retired: false });
  const version = ++state.version;
  return () => !state.retired && state.version === version;
}

export function retireView(container) {
  if (!container) return;
  const state = states.get(container);
  if (state) state.retired = true;
  else states.set(container, { version: 0, retired: true });
}
