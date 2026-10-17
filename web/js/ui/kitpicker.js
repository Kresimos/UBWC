/**
 * The kit picker: the sheet behind "Request kit" on a trip and "Add kit" on the
 * new-trip form.
 *
 * It is the Catalogue's filter panel doing a second job rather than a new
 * control that resembles one - same slide-up sheet, same search row, same drag
 * to dismiss, same type rail, same tiles. Three settings are made for you: the
 * location opens on everything, because a trailer is loaded from wherever kit
 * lives; the sort opens on size, because that is how anybody thinks about a
 * board; and the type rail opens on sails, which is what nearly every pick
 * starts from. The rest of the Catalogue's narrowing - subtype, box, diameter,
 * cams, length, faults and the sort - sits behind a Filters button on the count
 * row, the very same rules (ui/kitFilter.js). Faults offers only "no faults"
 * and "minor": out-of-action kit cannot go on a trailer, so it is never
 * listed, not even greyed. The rows are always the list, never the grid - a picker is read
 * top to bottom looking for one size, and a name-per-line beats a wall of
 * cards for that, so the view toggle the Catalogue carries is not offered.
 *
 * Tapping a piece asks for it, and the piece says so by changing. Tap it again
 * to take it back. Kit already away with another trip is shown, greyed with the
 * "Out" chip, because seeing that the good 5.0 is down for another weekend is
 * the point - but it cannot be picked, and the server refuses it too.
 *
 * `multi` is what separates the two ways in. Adding kit to a trip is loading a
 * trailer, so the sheet stays up and takes pick after pick until Done; asking
 * for kit is usually one member naming their favourite sail, so that sheet
 * closes on the tap and has no footer at all.
 */
import { html, el, mount } from '../dom.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { cardTile } from './itemTile.js';
import { toast } from './overlay.js';
import { fullName } from './bits.js';
import {
  createFilterState, matches, order, activeCount, panelSections,
  applyPanelClick, syncPanel, clearContextFilters,
} from './kitFilter.js';

// Out-of-action kit is never on offer, so the bucket is simply not a choice.
const PICK_FAULTS = ['none', 'minor'];

/**
 * @param {object} options
 * @param {HTMLElement} options.root - the screen root the sheet is drawn into.
 * @param {object[]} options.items - /api/items cards, every site, unfiltered.
 * @param {() => Set<number>} options.chosen - what is already on the list, read
 *   fresh on every repaint so a pick can be reflected without re-opening.
 * @param {(item: object) => Promise<void>} options.onPick - tapped a piece.
 * @param {boolean} [options.multi] - stay open and keep taking picks until Done.
 * @param {() => void} [options.onClose]
 */
export function kitPicker({ root, items, chosen, onPick, multi = false, onClose }) {
  const state = createFilterState({
    type: 'sail', sort: 'size', dir: 'asc', faults: PICK_FAULTS,
  });
  let panelOpen = false;

  const node = el(html`
    <div class="filterpanel" data-kitpicker>
      <div class="fp-scrim" data-close></div>
      <div class="fp-sheet" role="dialog" aria-label="Pick kit">
        <div class="fp-top" data-grab>
          <div class="fp-grab" aria-hidden="true"></div>
          <div class="fp-head">
            <label class="searchbar">
              ${icon('search')}
              <input type="search" data-search placeholder="Search kit…" aria-label="Search kit">
            </label>
          </div>
        </div>
        <div class="fp-body">
          <div class="chips" data-chips></div>
          <div class="kitbar">
            <span class="count" data-count></span>
            <button class="pickfilterbtn" data-filtertoggle aria-expanded="false">
              ${icon('filter')}Filters<span class="fsdot" data-fsdot hidden>0</span>
            </button>
          </div>
          <div class="pickpanel" data-pickpanel hidden></div>
          <div data-list></div>
        </div>
        ${multi ? html`
          <div class="fp-foot">
            <button class="fp-done" data-close data-picked></button>
          </div>` : ''}
      </div>
    </div>`);
  root.append(node);

  const sheet = node.querySelector('.fp-sheet');
  const search = node.querySelector('[data-search]');
  const listNode = node.querySelector('[data-list]');
  const panelNode = node.querySelector('[data-pickpanel]');

  // Name breaks a tie on any sort, as it always has on size: the sort below is
  // stable, so ordering by name first leaves equal sizes in name order.
  const byName = (a, b) => fullName(a).localeCompare(fullName(b));

  function shown() {
    // The fault filter can never include "major" here, so out-of-action kit
    // never passes `matches` - unlike the Catalogue this list does not offer it
    // even greyed out.
    const rows = items.filter((item) => matches(state, item)).sort(byName);
    return order(state, rows);
  }

  function countLabel(count) {
    if (state.type === 'all') return html`<b>${count}</b> ${count === 1 ? 'piece' : 'pieces'}`;
    const type = store.types.find((t) => t.key === state.type);
    const noun = `${(type ? type.label : 'piece').toLowerCase()}${count === 1 ? '' : 's'}`;
    return html`<b>${count}</b> ${noun}`;
  }

  // `skipList` paints everything except the tile grid - the chrome, the chips,
  // the count. It is used for the very first paint, while the sheet is still
  // sliding up: building a few hundred tiles is the one expensive thing this
  // function does, and doing it mid-animation is what dropped frames. The grid
  // is filled in a second paint once the sheet has stopped moving.
  function paint({ skipList = false } = {}) {
    const on = chosen();
    mount(node.querySelector('[data-chips]'), html`
      <button class="chip ${state.type === 'all' ? 'on' : ''}" data-chip="all">All</button>
      ${store.types.map((type) => html`
        <button class="chip ${state.type === type.key ? 'on' : ''}"
                data-chip="${type.key}">${type.label}s</button>`)}`);
    const rows = shown();
    mount(node.querySelector('[data-count]'), countLabel(rows.length));
    const dot = node.querySelector('[data-fsdot]');
    const active = activeCount(state, { countType: false, faults: PICK_FAULTS });
    dot.hidden = active === 0;
    dot.textContent = active;
    paintPicked(on);
    if (skipList) return;
    mount(listNode, rows.length
      ? html`<div class="itemlist">${rows.map((item) =>
          cardTile(item, false, { picked: on.has(item.id), out: item.away || null }))}</div>`
      : html`<div class="emptystate">${icon('box')}<b>Nothing here</b>
             <span>No kit matches that.</span></div>`);
  }

  // The footer's running tally, in multi only. The count lives inside the Done
  // button rather than beside it: two things in the bar meant the eye had to
  // pair a number on the left with the way out on the right, and the number is
  // only ever about that button. One wide target, one label. It is repainted on
  // its own rather than through `paint`, which would rebuild a few hundred rows
  // to change a number.
  function paintPicked(on = chosen()) {
    const foot = node.querySelector('[data-picked]');
    if (!foot) return;
    mount(foot, on.size
      ? html`Done <span class="n">${on.size} ${on.size === 1 ? 'piece' : 'pieces'}</span>`
      : html`Done`);
  }

  function paintPanel() {
    mount(panelNode, panelSections(state, items, {
      showType: false, faultBuckets: PICK_FAULTS,
    }));
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    panelNode.hidden = !panelOpen;
    node.querySelector('[data-filtertoggle]').setAttribute('aria-expanded', String(panelOpen));
    if (panelOpen) paintPanel();
  }

  // ------------------------------------------------------------- events
  node.addEventListener('click', async (event) => {
    // The sheet is mounted inside a screen that runs its own delegated click
    // handlers on this same root - the trip's grid/list toggle, its tile taps,
    // the form's "remove this piece" confirm. Every click inside the sheet is
    // the sheet's alone, so stop it here before it bubbles out and fires one of
    // those too. (The grid/list toggle in particular was repainting the whole
    // screen and taking the open sheet down with it.)
    event.stopPropagation();

    if (event.target.closest('[data-close]')) { close(); return; }

    if (event.target.closest('[data-filtertoggle]')) { togglePanel(); return; }
    if (event.target.closest('[data-pickpanel]')) {
      const kind = applyPanelClick(state, event.target);
      if (!kind) return;
      if (kind === 'type') paintPanel();
      else syncPanel(panelNode, state);
      paint();
      return;
    }

    const chip = event.target.closest('[data-chip]');
    if (chip) {
      state.type = chip.getAttribute('data-chip');
      // What a type narrows by is that type's own, so a new type starts clean.
      clearContextFilters(state);
      if (panelOpen) paintPanel();
      paint();
      return;
    }

    const card = event.target.closest('[data-item]');
    if (!card) return;
    const id = Number(card.getAttribute('data-item'));
    const item = items.find((row) => row.id === id);
    if (!item) return;
    if (item.away && !chosen().has(id)) {
      toast(`${fullName(item)} is already packed for ${item.away}.`, true);
      return;
    }
    await onPick(item);
    if (!multi) {
      // One tap picks the piece and the sheet is done: for a request the picker
      // is a way in, not a place to linger, so it closes itself and drops you
      // back on the list with the piece now on it.
      close();
      return;
    }
    // Loading a trailer, so the sheet stays. The row is re-read from `chosen`
    // rather than flipped blind, because a pick the server refused never
    // landed; only the tapped row and the tally are touched, so a whole trip's
    // worth of kit can go on without rebuilding the list once.
    const on = chosen();
    card.classList.toggle('picked', on.has(id));
    paintPicked(on);
  });

  search.addEventListener('input', () => { state.q = search.value; paint(); });

  // Drag anywhere on the sheet's top section downward to dismiss it, exactly as
  // the Catalogue's panel does. The pointer is captured on touchdown so the
  // browser cannot reclaim the gesture mid-pull; a press that never really
  // moves is treated as a tap on the search field, which the capture ate.
  const grab = node.querySelector('[data-grab]');
  let drag = null;
  grab.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    drag = { id: event.pointerId, y: event.clientY, dy: 0, moved: false,
             onInput: Boolean(event.target.closest('[data-search]')) };
    try { grab.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    sheet.classList.add('lift');
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
  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const was = drag;
    drag = null;
    if (was.dy > 88) { close(); return; }
    sheet.style.transition = 'transform .18s ease';
    sheet.style.transform = 'translateY(0)';
    if (!was.moved && was.onInput) search.focus();
    // Drop the compositor layer once the sheet has settled back - keeping it
    // parked there costs texture memory the drag no longer needs.
    setTimeout(() => { if (!closing) sheet.classList.remove('lift'); }, 220);
  };
  grab.addEventListener('pointerup', endDrag);
  grab.addEventListener('pointercancel', endDrag);

  let closing = false;
  function close() {
    if (closing) return;
    closing = true;
    node.classList.remove('open');
    sheet.classList.add('lift');
    sheet.style.transition = 'transform .2s cubic-bezier(.3,0,.8,.15)';
    sheet.style.transform = 'translateY(100%)';
    // The host's onClose repaints the screen this sheet is drawn into, which
    // wipes the sheet mid-slide if it fires now. Hold it until the sheet has
    // actually left, so the close animates instead of just vanishing.
    let settled = false;
    const finish = (event) => {
      if (settled || (event && event.target !== sheet)) return;
      settled = true;
      sheet.removeEventListener('transitionend', finish);
      node.remove();
      if (onClose) onClose();
    };
    sheet.addEventListener('transitionend', finish);
    setTimeout(finish, 260);
  }

  // Slide up an almost-empty sheet - just its chrome - then fill the grid once
  // it has stopped moving. The Catalogue's panel gets away with painting its
  // whole body before the slide because that body is a dozen filter chips; this
  // one is the entire inventory, and building it mid-slide dropped every frame
  // however the commit was staged. `.lift` promotes the sheet to its own
  // compositor layer for the length of the animation and is dropped the moment
  // it lands. Off-screen tiles cost nothing either way (content-visibility).
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  paint({ skipList: !still });
  void sheet.offsetHeight;
  if (!still) sheet.classList.add('lift');
  requestAnimationFrame(() => { node.classList.add('open'); });
  let opened = still;
  const fill = (event) => {
    if (opened || (event && (event.target !== sheet || event.propertyName !== 'transform'))) return;
    opened = true;
    sheet.removeEventListener('transitionend', fill);
    // Dragged or tapped shut before it even opened: leave the close animation
    // (and its layer) alone, there is nothing to fill.
    if (closing) return;
    sheet.classList.remove('lift');
    paint();
  };
  if (!still) {
    sheet.addEventListener('transitionend', fill);
    setTimeout(fill, 360);
  }

  return { close, paint };
}
