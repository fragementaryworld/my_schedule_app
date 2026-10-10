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

  const commit = async () => {
    const raw = String(num.value).trim();
    // 留空 = 不改动（输入 0 才是取消）。
    // 这样即使重绘把输入框清空过一次，也不会把已有值误清掉。
    if (!raw) {
      syncInput(current);
      return;
    }
    const minutes = parseEstimateInput(raw);
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
