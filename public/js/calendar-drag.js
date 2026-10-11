import { h } from './ui.js';
import { calendarRangeAfterPatch } from './calendar.js';

let cancelActive = null;
const saving = new Set();
const dayDifference = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const inside = (parent, node) => {
  for (; node; node = node.parentNode) if (node === parent) return true;
  return false;
};
const calendarOf = node => {
  for (; node; node = node.parentNode) if (node.classList?.contains('cal')) return node;
  return null;
};

export function cancelCalendarDrag() { cancelActive?.(); }

// 连续像素预览，日期只在松手时保存；旧浏览器保留鼠标事件回退。
export function attachCalendarDrag(handle, opts) {
  handle.addEventListener('click', event => event.stopPropagation());
  const pointer = typeof globalThis.PointerEvent === 'function';
  handle.addEventListener(pointer ? 'pointerdown' : 'mousedown', event => {
    if ((event.button !== undefined && event.button !== 0) || event.isPrimary === false) return;
    const key = opts.entry.base || `${opts.entry.kind}:${opts.entry.id}`;
    if (saving.has(key)) return;
    const doc = document;
    const rect = opts.row.getBoundingClientRect?.();
    const width = rect?.width || opts.row.offsetWidth;
    if (!(width > 0) || !opts.dates.length) return;
    event.preventDefault(); event.stopPropagation();
    cancelActive?.();
    const colW = width / opts.dates.length;
    const x = event.clientX || 0, y = event.clientY || 0;
    const calendar = calendarOf(opts.row);
    const rows = [...doc.querySelectorAll('.cal-row')].filter(row => inside(calendar, row));
    const cells = rows.flatMap(row => [...row.children].filter(cell => cell.dataset.date));
    const moveEvent = pointer ? 'pointermove' : 'mousemove';
    const upEvent = pointer ? 'pointerup' : 'mouseup';
    let moved = false, ended = false, frame = null, latest = event;
    let delta = 0, valid = true, hint = null;
    const highlighted = new Set();
    const accepts = ev => !pointer || ev.pointerId === event.pointerId;
    const clearHighlight = () => {
      for (const cell of highlighted) cell.classList.remove('cal-drop-target');
      highlighted.clear();
    };
    const preview = () => {
      frame = null;
      const pointerDx = (latest.clientX ?? x) - x, pointerDy = (latest.clientY ?? y) - y;
      if (!moved && Math.hypot(pointerDx, pointerDy) < 4) return;
      moved = true;
      // 手动滚动页面时，预览仍跟随指针，而不是随原来的周行偏移。
      const currentRect = opts.row.getBoundingClientRect?.();
      const dx = pointerDx - ((currentRect?.left ?? 0) - (rect?.left ?? 0));
      const dy = pointerDy - ((currentRect?.top ?? 0) - (rect?.top ?? 0));
      let visual = opts.clamp(dx / colW);
      delta = opts.clamp(Math.round(dx / colW)); valid = true;
      let offsetY = 0;
      // 移动和拉伸都可跨周行，拉伸按真实端点计算，另一端保持不变。
      if (opts.crossRows && Number.isFinite(latest.clientY) && Number.isFinite(rect?.left)) {
        const target = rows.find(row => {
          const r = row.getBoundingClientRect?.();
          return r && latest.clientX >= r.left && latest.clientX < r.left + r.width
            && latest.clientY >= r.top && latest.clientY < r.top + r.height;
        });
        valid = !!target;
        if (target) {
          const r = target.getBoundingClientRect();
          const targetColW = r.width / opts.dates.length;
          const grabCol = Math.floor((x - rect.left) / colW);
          const grabOffset = x - rect.left - grabCol * colW;
          const col = Math.max(0, Math.min(opts.dates.length - 1,
            Math.round((latest.clientX - r.left - grabOffset) / targetColW)));
          if (opts.resize) {
            const edgeDate = opts.resize === 'start' ? opts.entry.spanFrom : opts.entry.spanTo;
            const targetCol = Math.max(0, Math.min(opts.dates.length - 1, Math.floor((latest.clientX - r.left) / targetColW)));
            delta = opts.clamp(dayDifference(edgeDate, target.children[targetCol].dataset.date));
          } else {
            delta = dayDifference(opts.dates[Math.max(0, Math.min(opts.dates.length - 1, grabCol))], target.children[col].dataset.date);
          }
          visual = dx / colW; offsetY = dy;
        }
      }
      opts.row.classList.add('dragging'); doc.body.classList.add('calendar-drag-active');
      const patch = opts.patchOf(delta);
      const { from, to } = calendarRangeAfterPatch(opts.entry, patch);
      opts.onPreview?.(visual, colW, { dx: visual * colW, dy: offsetY, delta, from, to, valid });
      clearHighlight();
      if (valid) for (const cell of cells) {
        if (cell.dataset.date >= from && cell.dataset.date <= to) {
          cell.classList.add('cal-drop-target'); highlighted.add(cell);
        }
      }
      if (!hint) {
        hint = h('div', { class: 'cal-drag-hint', role: 'status', 'aria-live': 'polite' }); doc.body.append(hint);
      }
      const label = valid ? `${from}${to && to !== from ? ` → ${to}` : ''} · 松手保存，Esc 取消` : '移回日历内安排，Esc 取消';
      if (hint.textContent !== label) hint.textContent = label;
      // 保持提示位于视口内，避免遮住落点。
      const viewW = globalThis.innerWidth || 1200, viewH = globalThis.innerHeight || 800;
      hint.style.left = `${Math.max(8, Math.min(latest.clientX + 14, viewW - 300))}px`;
      hint.style.top = `${Math.max(8, Math.min((latest.clientY ?? y) + 22, viewH - 48))}px`;
    };
    const flush = () => {
      if (frame !== null) globalThis.cancelAnimationFrame?.(frame);
      preview();
    };
    const onMove = ev => {
      if (!accepts(ev) || ended) return;
      latest = ev;
      if (typeof globalThis.requestAnimationFrame !== 'function') preview();
      else if (frame === null) frame = globalThis.requestAnimationFrame(preview);
    };
    const clean = () => {
      ended = true;
      if (frame !== null) globalThis.cancelAnimationFrame?.(frame);
      frame = null;
      doc.removeEventListener(moveEvent, onMove); doc.removeEventListener(upEvent, onUp);
      doc.removeEventListener('pointercancel', onCancel); doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('visibilitychange', onHidden); handle.removeEventListener?.('lostpointercapture', onCancel);
      globalThis.window?.removeEventListener?.('blur', onCancel);
      clearHighlight(); hint?.remove();
      opts.row.classList.remove('dragging'); doc.body.classList.remove('calendar-drag-active');
      opts.onEnd?.();
      cancelActive = null;
      if (pointer) try { handle.releasePointerCapture?.(event.pointerId); } catch { /* 控件可能已被重绘 */ }
    };
    const onCancel = ev => {
      if (ev?.pointerId !== undefined && !accepts(ev)) return;
      if (!ended) {
        if (moved || Math.hypot((latest.clientX ?? x) - x, (latest.clientY ?? y) - y) >= 4) opts.suppressClick?.();
        clean();
      }
    };
    const onKey = ev => { if (ev.key === 'Escape') { ev.preventDefault(); onCancel(); } };
    const onHidden = () => { if (doc.hidden) onCancel(); };
    const onUp = async ev => {
      if (!accepts(ev) || ended) return;
      if (Number.isFinite(ev.clientX)) latest = ev;
      flush();
      const patch = moved && valid ? opts.patchOf(delta) : null;
      if (moved) opts.suppressClick?.();
      clean();
      if (!patch) return;
      saving.add(key);
      try { await opts.savePatch(opts.entry, patch); }
      catch (error) { opts.onError?.(error); }
      finally { saving.delete(key); }
    };
    cancelActive = onCancel;
    doc.addEventListener(moveEvent, onMove); doc.addEventListener(upEvent, onUp);
    doc.addEventListener('pointercancel', onCancel); doc.addEventListener('keydown', onKey);
    doc.addEventListener('visibilitychange', onHidden); handle.addEventListener('lostpointercapture', onCancel);
    globalThis.window?.addEventListener?.('blur', onCancel);
    if (pointer) try { handle.setPointerCapture?.(event.pointerId); } catch { /* 鼠标事件回退仍可使用 */ }
  });
}
