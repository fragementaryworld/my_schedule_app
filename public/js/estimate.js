'use strict';
// 预计用时输入：预设下拉（快速选）+ 手动按小时填写
import { h } from './ui.js';
import {
  ESTIMATE_OPTIONS, estimateLabel, estimateHours, hoursToMinutes, normalizeEstimate
} from './utils.js';

export function buildEstimateField({ value, onSave }) {
  const wrap = h('div', { class: 'row estimate-field' });

  const sel = h('select', { class: 'input inline-select estimate-select' });
  for (const o of ESTIMATE_OPTIONS) sel.append(h('option', { value: String(o.value) }, o.label));
  // 手动填了非预设值时，用它显示实际值
  const custom = h('option', { value: 'custom', hidden: 'hidden' });
  sel.append(custom);

  const num = h('input', {
    type: 'number',
    class: 'input estimate-hours',
    step: '0.5',
    min: '0',
    placeholder: '手填',
    title: '手动输入预计用时（小时）',
    'aria-label': '预计用时（小时）'
  });
  const unit = h('span', { class: 'small muted estimate-unit' }, 'h');

  function syncSelect(minutes) {
    const preset = ESTIMATE_OPTIONS.find((o) => o.value === minutes);
    if (preset) {
      custom.setAttribute('hidden', 'hidden');
      sel.value = String(preset.value);
      return;
    }
    if (!minutes) {
      custom.setAttribute('hidden', 'hidden');
      sel.value = '0';
      return;
    }
    custom.textContent = estimateLabel(minutes);
    custom.removeAttribute('hidden');
    sel.value = 'custom';
  }

  function syncInput(minutes) {
    num.value = minutes ? String(estimateHours(minutes)) : '';
  }

  const initial = normalizeEstimate(value);
  syncSelect(initial);
  syncInput(initial);

  sel.onchange = async () => {
    if (sel.value === 'custom') return; // 自定义值由输入框负责
    const minutes = normalizeEstimate(sel.value);
    syncInput(minutes);
    await onSave(minutes);
  };

  num.addEventListener('change', async () => {
    const raw = String(num.value).trim();
    const minutes = raw === '' ? null : normalizeEstimate(hoursToMinutes(Number(raw)));
    syncInput(minutes);
    syncSelect(minutes);
    await onSave(minutes);
  });

  wrap.append(sel, num, unit);
  return wrap;
}
