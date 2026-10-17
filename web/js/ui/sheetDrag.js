/**
 * Drag a bottom sheet's top section downward to dismiss it - the gesture the
 * Catalogue's filter panel and the kit picker have always had, for a sheet that
 * is new enough not to have grown its own copy yet.
 *
 * The pointer is captured on touchdown so the browser cannot reclaim the
 * gesture mid-pull; a press that never really moves is treated as a tap on the
 * search field, which the capture ate, so focus is given back by hand.
 *
 * @param {object} options
 * @param {HTMLElement} options.grab - the zone the drag starts on (handle + search row).
 * @param {HTMLElement} options.sheet - the element that moves.
 * @param {HTMLInputElement} [options.search] - focused on a tap that lands on it.
 * @param {() => void} options.onClose - called once the pull passes the threshold.
 */
export function dragToDismiss({ grab, sheet, search, onClose }) {
  let drag = null;

  grab.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    drag = {
      id: event.pointerId,
      y: event.clientY,
      dy: 0,
      moved: false,
      onInput: Boolean(search && event.target.closest('input')),
    };
    try { grab.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    sheet.style.transition = 'none';
  });

  grab.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dy = Math.max(0, event.clientY - drag.y);
    if (dy > 3) drag.moved = true;
    drag.dy = dy;
    sheet.style.transform = `translateY(${dy}px)`;
    if (event.cancelable) event.preventDefault();
  }, { passive: false });

  const end = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const was = drag;
    drag = null;
    if (was.dy > 88) { onClose(); return; }
    // Not far enough: ride the sheet back up, then honour a tap on the search.
    sheet.style.transition = 'transform .18s ease';
    sheet.style.transform = 'translateY(0)';
    if (!was.moved && was.onInput) search.focus();
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
}
