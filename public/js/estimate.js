'use strict';
// 预计用时输入：手动填写小时数
// 用文本输入而不是 type="number"：number 输入框会静默丢弃中文输入法打出的全角数字，
// 导致"输不进数字"。这里改成文本 + decimal 键盘 + 宽容解析（全角/单位后缀都能认）。
import { h } from './ui.js';
import { estimateHours, normalizeEstimate, parseEstimateInput } from './utils.js';

export function buildEstimateField({ value, onSave, key }) {
  let current = normalizeEstimate(value);

  const wrap = h('div', { class: 'row estimate-field' });
  const num = h('input', {
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    spellcheck: 'false',
    class: 'input estimate-hours',
    placeholder: '0',
    title: '手动输入预计用时（小时）',
    'aria-label': '预计用时（小时）',
    'data-focus-key': key
  });
  const unit = h('span', { class: 'small muted estimate-unit' }, 'h');

  const syncInput = (minutes) => {
    num.value = minutes ? String(estimateHours(minutes)) : '';
  };
  syncInput(current);

  const commit = async () => {
    const minutes = parseEstimateInput(num.value);
    if (minutes === undefined) {
      syncInput(current); // 看不懂的输入就还原，不要写坏数据
      return;
    }
    current = minutes;
    syncInput(minutes);
    await onSave(minutes);
  };

  num.addEventListener('change', commit);
  num.addEventListener('keydown', (ev) => {
    if (ev && ev.key === 'Enter') {
      if (ev.preventDefault) ev.preventDefault();
      commit();
    }
  });

  wrap.append(num, unit);
  return wrap;
}
