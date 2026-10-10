'use strict';
// 预计用时输入：手动填写小时数
// 用文本输入而不是 type="number"：number 输入框会静默丢弃中文输入法打出的全角数字，
// 导致"输不进数字"。这里改成文本 + decimal 键盘 + 宽容解析（全角/单位后缀都能认）。
import { h, toast } from './ui.js';
import { estimateHours, normalizeEstimate, parseEstimateInput } from './utils.js';
import { registerEditor, serializeSave } from './saving.js';

export function buildEstimateField({ value, onSave, key, debounceMs = 500 }) {
  let current = normalizeEstimate(value);

  const wrap = h('div', { class: 'row estimate-field' });
  const num = h('input', {
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    spellcheck: 'false',
    class: 'input estimate-hours',
    placeholder: '未设置',
    title: '手动输入预计用时（小时）；输入 0 取消设置',
    'aria-label': '预计用时（小时）',
    'data-focus-key': key
  });
  const unit = h('span', { class: 'small muted estimate-unit' }, 'h');

  const syncInput = (minutes) => {
    num.value = minutes ? String(estimateHours(minutes)) : '';
  };
  syncInput(current);

  // rewrite=true 时会把输入框内容归一化；自动保存那条路径不动用户正在敲的字
  const commit = serializeSave(async ({ rewrite = true } = {}) => {
    const raw = String(num.value).trim();
    // 留空 = 不改动（输入 0 才是取消）。
    // 这样即使重绘把输入框清空过一次，也不会把已有值误清掉。
    if (!raw) {
      if (rewrite) syncInput(current);
      return;
    }
    const minutes = parseEstimateInput(raw);
    if (minutes === undefined) {
      if (rewrite) syncInput(current); // 看不懂的输入就还原，不要写坏数据
      return;
    }
    if (minutes === current) return; // 没变化就不重复提交
    if (rewrite) syncInput(minutes);
    await onSave(minutes);
    current = minutes;
  });

  let timer = null;
  const cancelTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const flush = () => {
    cancelTimer();
    return commit();
  };
  registerEditor(num, flush);

  // 边输入边自动保存：浏览器返回键/快捷键离开时，输入框是被直接移除的，
  // 浏览器不会派发 change，靠它兜底才不会把刚敲的值丢掉。
  num.addEventListener('input', () => {
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      commit({ rewrite: false }).catch((err) => toast(err.message, 'error'));
    }, debounceMs);
  });
  const flushWithFeedback = () => flush().catch((err) => toast(err.message, 'error'));
  num.addEventListener('change', flushWithFeedback);
  num.addEventListener('blur', flushWithFeedback);
  num.addEventListener('keydown', (ev) => {
    if (ev && ev.key === 'Enter') {
      if (ev.preventDefault) ev.preventDefault();
      flushWithFeedback();
    }
  });

  wrap.append(num, unit);
  return wrap;
}
