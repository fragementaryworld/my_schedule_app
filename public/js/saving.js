'use strict';

const editors = new WeakMap();
const pendingWrites = new Set();
const pendingRequests = new Set();
const failures = new Map();

// 失焦和显式保存可能同时发生，串行提交后再判断内容，避免重复创建或旧写入覆盖新写入。
export function serializeSave(operation) {
  let previous = Promise.resolve();
  return (...args) => {
    const next = previous.catch(() => {}).then(() => operation(...args));
    previous = next;
    return next;
  };
}

export function trackRequest(promise) {
  pendingRequests.add(promise);
  const done = () => pendingRequests.delete(promise);
  promise.then(done, done);
  return promise;
}

// 保存/结束操作要能立即提交还在防抖计时中的编辑，而不是只保存服务器旧数据。
export function registerEditor(element, flush) {
  element.setAttribute('data-save-editor', 'true');
  editors.set(element, flush);
}

export async function flushPendingEdits() {
  if (typeof document === 'undefined') return;
  const elements = [...document.querySelectorAll('[data-save-editor="true"]')];
  const results = await Promise.allSettled(elements.map((element) => editors.get(element)?.()));
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
}

export function trackWrite(key, promise) {
  trackRequest(promise);
  pendingWrites.add(promise);
  promise.then(() => {
    failures.delete(key);
    pendingWrites.delete(promise);
  }, (error) => {
    failures.set(key, error);
    pendingWrites.delete(promise);
  });
  return promise;
}

export async function waitForPendingWrites() {
  // 写入后的视图刷新也要结束，防止结束提示被迟到的渲染覆盖。
  while (pendingRequests.size || pendingWrites.size) await Promise.allSettled([...pendingRequests]);
  if (failures.size) {
    const error = failures.values().next().value;
    failures.clear();
    throw error;
  }
}
