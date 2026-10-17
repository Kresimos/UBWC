/**
 * One trip, through all five of its stages.
 *
 * The half of this screen above the rule does not change. Where the trip is
 * going, when it leaves, what members should know and what the wind is doing
 * ride every stage from the first request to the day it comes home - because
 * the wind on the day is exactly what you are still thinking about while you
 * load the trailer. What changes is the list underneath: a wishlist, then a
 * checklist, then a manifest.
 *
 * Coming home is not a stage. It is one button on the app bar: the kit sec
 * ends the trip, confirms, and every piece goes back to being available at the
 * rack it never left. A second checklist to work through earned nothing, since
 * the app moved none of it in the first place.
 *
 * Three things the tile does here that it does nowhere else, all of them
 * options on js/ui/itemTile.js rather than a second tile:
 *
 *  - **voter tags**, the little stack of discs saying who asked for a piece.
 *    They stay on the kit for the whole trip, because on the water "who wanted
 *    the 124?" is a real question. The app answers it and then stays out of the
 *    argument;
 *  - **the tick**, while packing. In grid it takes the top-right corner the
 *    fault chip normally holds, so the fault slides left to sit beside the
 *    heart; in list the circle joins the thumbnail rather than replacing it,
 *    because a trailer is packed by looking at kit;
 *  - **the rack in place of the stars**, on that same stage. Where a piece
 *    lives is the useful fact while you are fetching it; its score is not.
 *    Same slot, same size, so nothing moves when the stage turns over.
 *
 * Reading a trip is open to everyone. Ticking kit and moving a trip on a stage
 * is committee - packing the trailer is the kit sec's job - with the one
 * exception of a request, which is any member's to make.
 */
import { html, toHtml, mount, onClick, on, el, stampDate } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { store, spotNote } from '../store.js';
import { fullName } from '../ui/bits.js';
import { cardTile, faultPopup, whoPopup } from '../ui/itemTile.js';
import { kitPicker } from '../ui/kitpicker.js';
import {
  ALL_FAULTS, SORTS, createFilterState, resetFilterState, matches, order,
  activeCount, panelSections, applyPanelClick, syncPanel,
} from '../ui/kitFilter.js';
import { dragToDismiss } from '../ui/sheetDrag.js';
import { needUser, needCommittee } from '../ui/chrome.js';
import { confirmSheet, lightbox, toast } from '../ui/overlay.js';
import { packBoardKit, shortName } from '../rig/engine.js';
import {
  buildModel, chooseTrailer, unriggableGroups, checkGroup, packingList,
} from '../rig/pack.js';
import { go, back, refresh } from '../router.js';
import { dates } from './trips.js';

const VIEW_KEY = 'ubwc.view';

// The photo layer moves this fraction as fast as the band it sits in. Small on
// purpose: a parallax you notice is a parallax that is too strong.
const PARALLAX_RATE = 0.32;

const LONG_PRESS_MS = 420;

// The stages where a trip can still be ended: its kit is out of the racks and
// there is something to hand back. A trip only being asked about holds nothing.
const LIVE = ['packing', 'active'];

const STAGE = {
  requesting: { title: 'Packing list' },
  packing: { title: 'Packing list' },
  active: { title: 'Trip kit' },
  done: { title: 'What went' },
  cancelled: { title: 'What was picked' },
};

// The kit list's filters. The same rules and panel as the Catalogue (ui/kitFilter.js)
// but a state of their own, so narrowing the shelf never hides a thing on a
// packing list. A trip opens showing everything - faults included, because a
// red-flagged piece that is already on the trailer is not one to hide - in the
// packing order. They outlast a visit to an item page, and reset on another trip.
const TRIP_START = { sort: 'packing', dir: 'asc', faults: ALL_FAULTS };
const TRIP_SORTS = [{ key: 'packing', label: 'Packing order' }, ...SORTS];
let tripFilter = createFilterState(TRIP_START);
let tripFilterId = null;

/* ========================================================== the trip page */

export async function render(root, params) {
  const id = Number(params.id);
  const state = { view: localStorage.getItem(VIEW_KEY) || 'grid', notesOpen: false };
  let trip = null;
  let forecast = null;
  let catalogue = null;        // /api/items cards: every site's kit, for the picker
  let cataloguePending = null; // the in-flight fetch, so two taps don't run it twice
  let picker = null;
  let filterNode = null; // the filter sheet while it is up
  let unwireParallax = () => {};
  let press = null;
  let suppressClick = false;
  let disposed = false;

  trip = (await api.trip(id)).trip;
  if (tripFilterId !== id) {
    tripFilter = createFilterState(TRIP_START);
    tripFilterId = id;
  }

  // Packing is the one stage that is a checklist. Coming home is a single act
  // on the app bar, not a second list to work through.
  const checklist = () => trip.status === 'packing';
  const ticking = () => checklist() && store.committee;

  // ------------------------------------------------------------- painting
  /**
   * A full repaint rebuilds the whole screen, scroller and all, so by default
   * it lands you back at the top - right for a stage change, wrong for the
   * small stuff (toggling the notes, closing the picker). `keepScroll` reads
   * the scroll offset off the old body and puts it back on the new one, in the
   * same synchronous beat so nothing is painted in between.
   */
  function paint({ keepScroll = false } = {}) {
    if (disposed) return;
    const y = keepScroll ? (root.querySelector('[data-scroll]')?.scrollTop || 0) : 0;
    unwireParallax();
    mount(root, screen());
    unwireParallax = wireParallax(root);
    wire();
    if (y) {
      const scroller = root.querySelector('[data-scroll]');
      if (scroller) scroller.scrollTop = y;
    }
  }

  /** Only the part below the rule, so a repaint cannot close the open sheet. */
  function paintKit() {
    if (disposed) return;
    mount(root.querySelector('[data-kit]'), kitSection());
    paintCount();
    paintFind();
  }

  function paintCount() {
    const node = root.querySelector('[data-count]');
    if (node) mount(node, countLabel());
  }

  /**
   * The pack bar arrives with the last tick and leaves if one is undone. It
   * lives at the screen root, outside the scrolling body, so ticking a box
   * adds or removes just this one node rather than repainting the whole
   * screen to find out whether it belongs there.
   */
  function syncBar() {
    if (disposed) return;
    const showing = root.querySelector('.packbar');
    const want = store.committee && trip.status === 'packing'
      && trip.n_items && trip.n_packed === trip.n_items;
    if (want && !showing) {
      root.insertAdjacentHTML('beforeend', toHtml(packBar()));
      root.querySelector('.packbar')?.classList.add('rise');
    } else if (!want && showing) {
      showing.remove();
    }
  }

  async function reload({ whole = true } = {}) {
    trip = (await api.trip(id)).trip;
    if (whole) paint();
    else paintKit();
  }

  // ---------------------------------------------------------------- markup
  function screen() {
    const stage = STAGE[trip.status] || STAGE.active;
    return html`
      <div class="appbar">
        <div class="row">
          <button class="backbtn" data-back aria-label="Back">${icon('back')}</button>
          <span class="ttl sm">${trip.name}</span>
          ${store.committee && LIVE.includes(trip.status) ? html`
            <button class="backbtn" data-end aria-label="End this trip">
              ${icon('tick')}</button>` : ''}
          ${store.committee ? html`
            <button class="backbtn" data-edit aria-label="Edit this trip">
              ${icon('edit')}</button>` : ''}
        </div>
      </div>
      <div class="body" data-scroll>
        ${summary()}
        <div class="listhead">
          <span class="count" data-count>${countLabel()}</span>
          <b class="ttx">${stage.title}</b>
          <span class="tail">
            <div class="viewtoggle">
              <button class="${state.view === 'grid' ? 'on' : ''}" data-view="grid"
                      aria-label="Grid view">${icon('gridIcon')}</button>
              <button class="${state.view === 'list' ? 'on' : ''}" data-view="list"
                      aria-label="List view">${icon('listIcon')}</button>
            </div>
          </span>
        </div>
        <div data-find>${findBar()}</div>
        <div data-kit>${kitSection()}</div>
        ${addButton()}
        ${skipButton()}
        ${finaliseButton()}
      </div>
      ${packBar()}`;
  }

  /**
   * The summary. Unpacking collapses it: the trip is home, so the blurb and the
   * forecast have nothing left to say and only where and when stays above the
   * checklist. A finished trip keeps its where and when for the same reason,
   * and loses the forecast because what the wind was going to do stopped being
   * useful the moment it did it.
   */
  function summary() {
    const home = trip.status === 'done' || trip.status === 'cancelled';
    const rows = home ? homeRows() : awayRows();
    return html`
      ${hero(trip)}
      ${rows ? html`<div class="tripmeta">${rows}</div>` : ''}
      ${!home && forecast && forecast.length ? windChart(forecast) : ''}`;
  }

  /** Null when a trip has told us nothing yet, so the block collapses. */
  function awayRows() {
    if (!trip.starts_on && !trip.destination && !trip.notes) return null;
    return html`
      ${trip.starts_on ? mrow('clock', html`Leaves <b>${longDate(trip.starts_on)}</b>`) : ''}
      ${trip.destination ? mrow('pin', html`<b>${trip.destination}</b>`) : ''}
      ${trip.notes ? html`
        <div class="info ${state.notesOpen ? 'open' : ''}" data-notes>${trip.notes}</div>
        <button class="more" data-morenotes>${state.notesOpen ? 'Less' : 'More'}</button>` : ''}`;
  }

  function homeRows() {
    if (trip.status === 'cancelled') return mrow('close', 'Called off. Never packed.');
    return html`
      ${trip.destination ? mrow('pin', html`<b>${trip.destination}</b>`) : ''}
      ${mrow('tick', html`Back at the boathouse${trip.n_items
        ? html`, all <b>${trip.n_items}</b> ${trip.n_items === 1 ? 'piece' : 'pieces'}`
        : ''}`)}`;
  }

  function countLabel() {
    if (trip.status === 'requesting') {
      const n = trip.pending.length + trip.items.length;
      return html`<b>${n}</b> requested`;
    }
    if (trip.status === 'packing') {
      return html`<b>${trip.n_packed}</b> of ${trip.n_items} packed`;
    }
    return html`<b>${trip.n_items}</b> ${trip.n_items === 1 ? 'piece' : 'pieces'}`;
  }

  /**
   * The list below the rule.
   *
   * While a trip is still being asked about the kit is not grouped: it is a
   * wishlist, and what matters is who wants what, not which shelf it came off.
   * From packing onward it is sorted by type, because that is the order a
   * trailer is loaded and a rack is walked - but it stays one flat list, no
   * headers: the checklist reads as a single run of ticks, not a set of them.
   */
  function kitSection() {
    const grid = state.view === 'grid';
    if (!listRows().length) return emptyKit();
    const rows = visibleRows();
    if (!rows.length) return noMatch();
    return html`
      <div class="${grid ? 'itemgrid' : 'itemlist'}">${rows.map((row) => tile(row, grid))}</div>`;
  }

  /** Everything on the list at this stage, before any filter. */
  function listRows() {
    return trip.status === 'requesting' ? [...trip.pending, ...trip.items] : [...trip.items];
  }

  /**
   * What the filters leave, in the chosen order. "Packing order" is the order
   * the list has always had: as asked for while requesting (a wishlist is about
   * who wants what, not which shelf), then by type, size and name from packing
   * on. Any other sort is the Catalogue's, applied to the piece inside the row.
   */
  function visibleRows() {
    const kept = listRows().filter((row) => matches(tripFilter, row.item));
    return order(tripFilter, kept, {
      get: (row) => row.item,
      custom: { packing: trip.status === 'requesting' ? () => 0 : packingOrder() },
    });
  }

  function tile(row, grid) {
    const item = row.item;
    const check = checklist() && !!trip.items.includes(row);
    return cardTile(item, grid, {
      voters: row.who && row.who.length ? row.who : null,
      out: item.away && item.away !== trip.name ? item.away : null,
      // In list view the voter stack takes the right-hand column, so the fault
      // gives up its inline chip and becomes a bubble on the thumb. It does so
      // on every trip list rather than only the crowded ones, or a row would
      // read differently depending on who happened to ask for it.
      dotFault: !grid,
      ...(check ? { checked: row.packed, checkable: !row.packed } : {}),
      ...(checklist() ? { place: { site: item.site, spot: item.spot } } : {}),
    });
  }

  function emptyKit() {
    return html`
      <div class="emptystate">
        ${icon('box')}
        <b>Nothing on the list yet</b>
        <span>${trip.status === 'requesting'
          ? 'Ask for the kit you want and it turns up here, with your name on it.'
          : 'No kit was picked for this trip.'}</span>
      </div>`;
  }

  /** The list has kit, but the filters have hidden all of it. */
  function noMatch() {
    return html`
      <div class="emptystate">
        ${icon('box')}
        <b>Nothing matches</b>
        <span>No kit on this trip fits those filters.</span>
        <button class="askbtn ghost" data-kitreset>Clear filters</button>
      </div>`;
  }

  // ----------------------------------------------------- search and filter
  const badge = () => activeCount(tripFilter, { faults: ALL_FAULTS });
  const narrowing = () => Boolean(tripFilter.q.trim()) || badge() > 0;

  function noteText() {
    return html`Showing <b>${visibleRows().length}</b> of ${listRows().length}`;
  }

  /**
   * Search and the filter button, under the title. Only once there is kit to
   * look through: an empty wishlist has nothing to narrow.
   */
  function findBar() {
    if (!listRows().length) return '';
    return html`
      <div class="kitfind">
        <label class="searchbar ${tripFilter.q ? 'filled' : ''}">
          ${icon('search')}
          <input type="search" data-kitsearch value="${tripFilter.q}"
                 placeholder="Search this trip's kit…" aria-label="Search this trip's kit">
          <button class="clearbtn" data-kitclear aria-label="Clear search">${icon('close')}</button>
        </label>
        <div class="viewtoggle fsbtn">
          <button data-kitfilter aria-label="Filter and sort kit">${icon('filter')}</button>
          <span class="fsdot" data-fsdot ${badge() ? '' : 'hidden'}>${badge()}</span>
        </div>
      </div>
      <div class="kitnote" data-kitnote ${narrowing() ? '' : 'hidden'}>${noteText()}</div>`;
  }

  /**
   * Brings the bar, its badge and "Showing N of M" in step with the filters
   * without rebuilding the search box mid-keystroke. The bar itself only
   * arrives or leaves when the list gains its first piece or loses its last.
   */
  function paintFind() {
    const wrap = root.querySelector('[data-find]');
    if (!wrap) return;
    const has = listRows().length > 0;
    if (has !== Boolean(wrap.querySelector('.kitfind'))) {
      mount(wrap, findBar());
    } else if (has) {
      const dot = wrap.querySelector('[data-fsdot]');
      dot.hidden = badge() === 0;
      dot.textContent = badge();
      const note = wrap.querySelector('[data-kitnote]');
      note.hidden = !narrowing();
      if (narrowing()) mount(note, noteText());
    }
    const count = root.querySelector('[data-sheetcount]');
    if (count) mount(count, html`<b>${visibleRows().length}</b> shown`);
  }

  function setQuery(value) {
    tripFilter.q = value;
    root.querySelectorAll('[data-kitsearch], [data-sheetsearch]').forEach((input) => {
      if (input.value !== value) input.value = value;
    });
    root.querySelectorAll('.kitfind .searchbar').forEach((box) => {
      box.classList.toggle('filled', Boolean(value));
    });
    paintKit();
  }

  function resetFilters() {
    resetFilterState(tripFilter, TRIP_START);
    setQuery('');
  }

  /**
   * The Catalogue's filter sheet, over the trip. Offers only what is on this
   * trip - a type, a diameter, a box nobody packed would be a dead button - and
   * adds "Packing order" to the sorts. Drawn into this screen's root like the
   * kit picker, so like the picker it keeps every click to itself.
   */
  function openFilter() {
    if (filterNode && root.contains(filterNode)) return;
    const pool = listRows().map((row) => row.item);
    const present = new Set(pool.map((item) => item.component_type));
    const options = {
      types: store.types.filter((type) => present.has(type.key)),
      sorts: TRIP_SORTS,
    };

    const node = el(html`
      <div class="filterpanel" data-tripfilter>
        <div class="fp-scrim" data-close></div>
        <div class="fp-sheet" role="dialog" aria-label="Filter and sort">
          <div class="fp-top" data-grab>
            <div class="fp-grab" aria-hidden="true"></div>
            <div class="fp-head">
              <label class="searchbar">
                ${icon('search')}
                <input type="search" data-sheetsearch placeholder="Search this trip's kit…"
                       aria-label="Search this trip's kit">
              </label>
            </div>
          </div>
          <div class="fp-body" data-body></div>
          <div class="fp-foot">
            <button class="fp-reset" data-reset>Reset</button>
            <span class="fp-count" data-sheetcount></span>
            <button class="fp-done" data-close>Done</button>
          </div>
        </div>
      </div>`);
    filterNode = node;
    root.append(node);

    const sheet = node.querySelector('.fp-sheet');
    const body = node.querySelector('[data-body]');
    const search = node.querySelector('[data-sheetsearch]');
    const paintBody = () => mount(body, panelSections(tripFilter, pool, options));
    paintBody();
    search.value = tripFilter.q;
    paintFind();

    let closing = false;
    function close() {
      if (closing) return;
      closing = true;
      node.classList.remove('open');
      sheet.style.transition = 'transform .2s cubic-bezier(.4, 0, 1, 1)';
      sheet.style.transform = 'translateY(101%)';
      let settled = false;
      const finish = (event) => {
        if (settled || (event && event.target !== sheet)) return;
        settled = true;
        sheet.removeEventListener('transitionend', finish);
        node.remove();
        if (filterNode === node) filterNode = null;
      };
      sheet.addEventListener('transitionend', finish);
      setTimeout(finish, 300);
    }

    node.addEventListener('click', (event) => {
      // The sheet is drawn inside the screen that runs its own delegated
      // handlers on this root; whatever is tapped in it is the sheet's alone.
      event.stopPropagation();
      if (event.target.closest('[data-close]')) { close(); return; }
      if (event.target.closest('[data-reset]')) {
        resetFilters();
        paintBody();
        return;
      }
      const kind = applyPanelClick(tripFilter, event.target);
      if (!kind) return;
      if (kind === 'type') paintBody();
      else syncPanel(body, tripFilter);
      paintKit();
    });
    search.addEventListener('input', () => setQuery(search.value));
    dragToDismiss({ grab: node.querySelector('[data-grab]'), sheet, search, onClose: close });

    void sheet.offsetHeight; // commit the closed transform before animating open
    requestAnimationFrame(() => node.classList.add('open'));
  }

  /** "Request kit" while asking, "Add kit" once the kit sec owns the list. */
  function addButton() {
    if (trip.status === 'requesting') {
      // For the kit sec the primary action here is "Finalise kit" below, so
      // their "Request kit" steps back to a ghost; a plain member keeps it solid.
      const cls = store.committee ? 'askbtn ghost' : 'askbtn';
      return html`<button class="${cls}" data-pick>${icon('plusCircle')}Request kit</button>`;
    }
    if (store.committee && LIVE.includes(trip.status)) {
      return html`<button class="askbtn ghost" data-pick>${icon('plusCircle')}Add kit</button>`;
    }
    return '';
  }

  /**
   * The way out of the checklist without working through it. Packing a trailer
   * off a phone is optional - sometimes the kit is already on and nobody ticked
   * a thing - so the kit sec can call the trip packed at any point. It sits
   * under "Add kit" as the quieter of the two, since ticking is still the
   * normal way through.
   */
  function skipButton() {
    if (!store.committee || trip.status !== 'packing') return '';
    return html`<button class="askbtn ghost" data-skip>
      ${icon('arrowRight')}Skip packing</button>`;
  }

  /**
   * The kit sec's way into the deck, once members have asked for things. It
   * rides at the foot of the scroll under "Request kit" rather than on a fixed
   * bar: on this stage it is one more thing the kit sec can do, not the thing
   * the screen is for. Anyone else asking for kit never sees it.
   */
  function finaliseButton() {
    if (!store.committee || trip.status !== 'requesting') return '';
    const waiting = trip.pending.length;
    return html`
      <button class="askbtn" data-confirm>
        ${icon('tick')}${waiting ? `Finalise kit (${waiting})` : 'Finalise kit'}</button>`;
  }

  /**
   * The bar at the foot, which is only ever there when there is genuinely
   * something to press. While kit is still unticked the checklist is the whole
   * screen; the bar arrives with the last tick.
   */
  function packBar() {
    if (!store.committee) return '';
    if (trip.status === 'packing' && trip.n_items && trip.n_packed === trip.n_items) {
      return html`
        <div class="packbar">
          <button class="askbtn" data-stage="active">${icon('tick')}Complete packing</button>
        </div>`;
    }
    // An active trip has no bar. Ending it is the one thing left to do and it
    // lives on the app bar, out of the way of a list people are reading.
    return '';
  }

  // ---------------------------------------------------------------- events
  function wire() {
    root.querySelector('[data-back]').addEventListener('click', () => back('/trips'));
    root.querySelector('[data-edit]')?.addEventListener('click', () => go(`/trip/${id}/edit`));
    root.querySelector('[data-end]')?.addEventListener('click', endTrip);
    root.querySelector('[data-morenotes]')?.addEventListener('click', () => {
      state.notesOpen = !state.notesOpen;
      paint({ keepScroll: true });
    });

    // The toggle sits above the list but outside [data-kit], so flip the
    // buttons by hand and repaint only the list. A full repaint here threw the
    // scroll position away every time somebody switched grid and list.
    onClick(root, 'data-view', (value) => {
      state.view = value;
      localStorage.setItem(VIEW_KEY, value);
      root.querySelectorAll('[data-view]').forEach((button) => {
        button.classList.toggle('on', button.getAttribute('data-view') === value);
      });
      paintKit();
    });

    onClick(root, 'data-pick', openPicker);
    onClick(root, 'data-kitfilter', openFilter);
    onClick(root, 'data-kitclear', () => setQuery(''));
    onClick(root, 'data-kitreset', resetFilters);
    on(root, 'input', '[data-kitsearch]', (_event, node) => setQuery(node.value));
    onClick(root, 'data-confirm', () => go(`/trip/${id}/confirm`));
    onClick(root, 'data-stage', (value) => moveStage(value));
    onClick(root, 'data-skip', skipPacking);

    // The stack of discs opens into who, in words. It sits inside the tile, so
    // this has to run before the tile's own tap and stop it.
    onClick(root, 'data-whostack', (value, _node, event) => {
      event.stopImmediatePropagation();
      whoPopup(value.split('|').filter(Boolean));
    });
    // The rack on a packing tile opens what the club wrote about that spot.
    // It sits inside the tile, so like the fault chip it has to run first and
    // stop the tile's own tap.
    onClick(root, 'data-spot', (value, node, event) => {
      if (event.target.closest('[data-kitpicker]')) return;
      event.stopImmediatePropagation();
      const site = node.getAttribute('data-site');
      lightbox({
        title: [value, site].filter(Boolean).join(' · ') || 'Location',
        sub: spotNote(site, value)
          || 'No description recorded for this spot yet. A committee member can add one when moving kit.',
      });
    });
    onClick(root, 'data-flag', (value, _node, event) => {
      if (event.target.closest('[data-kitpicker]')) return;
      event.stopImmediatePropagation();
      const row = allRows().find((r) => r.item.id === Number(value));
      faultPopup(row ? row.item.faults : []);
    });

    // A long press takes a piece back off the list, or withdraws your own
    // request - the press-and-hold the Catalogue already uses to pick kit.
    // The picker sheet is drawn into this same root, so its tiles bubble up
    // through these handlers. Every one of them leaves the sheet alone.
    const inPicker = (event) => Boolean(event.target.closest('[data-kitpicker]'));

    // The tile's own controls - the fault chip, the disc stack, the rack - are
    // buttons inside the tile, and a press held on one of them is not a press
    // on the piece.
    const onControl = (event) => Boolean(event.target.closest(
      '[data-flag], [data-whostack], [data-spot]'));

    on(root, 'pointerdown', '[data-item]', (event, node) => {
      suppressClick = false;
      if (press || inPicker(event) || onControl(event)) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const itemId = Number(node.getAttribute('data-item'));
      press = { x: event.clientX, y: event.clientY };
      press.timer = setTimeout(() => {
        press = null;
        suppressClick = true;
        removeOrWithdraw(itemId);
      }, LONG_PRESS_MS);
    });
    on(root, 'pointermove', '[data-item]', (event) => {
      if (!press) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) {
        clearTimeout(press.timer);
        press = null;
      }
    });
    const endPress = () => {
      if (!press) return;
      clearTimeout(press.timer);
      press = null;
    };
    on(root, 'pointerup', '[data-item]', endPress);
    on(root, 'pointercancel', '[data-item]', endPress);

    onClick(root, 'data-item', (value, node, event) => {
      if (suppressClick) { suppressClick = false; return; }
      if (inPicker(event)) return;
      if (event.target.closest('[data-flag]') || event.target.closest('[data-whostack]')
        || event.target.closest('[data-spot]')) return;
      const itemId = Number(value);
      // On a checklist the tap IS the tick, for whoever is holding the
      // clipboard. Everybody else still gets the item page from it.
      if (ticking()) toggleTick(itemId, node);
      else go(`/item/${itemId}`);
    });
  }

  const allRows = () => [...trip.items, ...trip.pending];

  // ------------------------------------------------------------- the doing
  /**
   * The picker's inventory: every site's kit, because a trailer is loaded from
   * wherever kit lives. Fetched once and kept. It is warmed in the background
   * after the first paint (see below), so by the time anyone taps "Request kit"
   * the sheet has something to open onto rather than a spinner and a wait.
   */
  function loadCatalogue() {
    if (catalogue) return Promise.resolve();
    if (!cataloguePending) {
      cataloguePending = api.items({}).then((data) => { catalogue = data.items; });
    }
    return cataloguePending;
  }

  async function openPicker() {
    if (picker) return;
    const asking = trip.status === 'requesting';
    const reason = asking
      ? 'Asking for kit puts your name on it, so the kit sec knows who wants what.'
      : 'Adding kit to a trip is a committee action.';
    const ok = asking ? await needUser(reason) : await needCommittee(reason);
    if (!ok) return;

    try {
      await loadCatalogue();
    } catch (error) {
      cataloguePending = null;   // let the next tap try again
      toast(error.message, true);
      return;
    }
    picker = kitPicker({
      root,
      items: catalogue,
      chosen: () => new Set(asking
        ? trip.my_requests
        : trip.items.map((row) => row.item.id)),
      onPick: (item) => (asking ? toggleRequest(item) : toggleOnTrip(item)),
      // The kit sec is loading a trailer and wants the sheet to stay up; a
      // member asking for kit is usually naming one favourite sail, so that
      // sheet closes on the tap.
      multi: !asking,
      // Picks already repaint the list as they happen (toggle* -> reload ->
      // paintKit), so closing only needs to refresh that section, not rebuild
      // the whole screen - a full paint here landed a heavy synchronous chunk
      // in the frames right after the sheet finished sliding out.
      onClose: () => { picker = null; paintKit(); },
    });
  }

  async function toggleRequest(item) {
    const on = !trip.my_requests.includes(item.id);
    try {
      await api.tripRequest(id, item.id, on);
      await reload({ whole: false });
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function toggleOnTrip(item) {
    const on = !trip.items.some((row) => row.item.id === item.id);
    try {
      if (on) await api.addTripItems(id, [{ item_id: item.id, role: item.rig_kind || null, source: 'chosen' }]);
      else await api.removeTripItem(id, item.id);
      await reload({ whole: false });
    } catch (error) {
      toast(error.message, true);
    }
  }

  /**
   * Tick or untick one piece.
   *
   * The tick follows the finger, not the lake's signal: the row fills the
   * instant it is tapped, the count and the pack bar catch up locally, and the
   * request goes off behind that. Waiting on the round trip before anything
   * moved is what made a checklist feel broken; a full-screen repaint on top of
   * it threw the whole list away and rebuilt it from a string, so even the
   * reply landed with a lurch. If the request fails the tick is rolled back and
   * the reason is said out loud.
   */
  async function toggleTick(itemId, node) {
    const row = trip.items.find((r) => r.item.id === itemId);
    if (!row) return;
    const next = !row.packed;

    row.packed = next;
    trip.n_packed = trip.items.filter((r) => r.packed).length;
    applyTick(node, next);
    paintCount();
    syncBar();

    try {
      await api.tripPacked(id, itemId, next);
    } catch (error) {
      row.packed = !next;
      trip.n_packed = trip.items.filter((r) => r.packed).length;
      // The failure path is rare and off the hot loop, so it can afford to
      // repaint the list outright rather than trust a node the optimistic
      // pass may have left behind.
      paintKit();
      syncBar();
      toast(error.message, true);
    }
  }

  /**
   * The tick, drawn onto one card in place so the fill can animate and nothing
   * else on the screen moves. List view rides the `.picked` class the CSS
   * already keys the box fill off; grid view carries an extra disc in the
   * corner, added or removed here.
   */
  function applyTick(card, packed) {
    if (!card) return;
    card.classList.toggle('picked', packed);
    let mark = card.querySelector('.tickdisc') || card.querySelector('.selbox');
    if (state.view === 'grid') {
      const disc = card.querySelector('.tickdisc');
      if (packed && !disc) {
        card.querySelector('.shot')?.insertAdjacentHTML('beforeend',
          toHtml(html`<span class="tickdisc" aria-hidden="true">${icon('tick')}</span>`));
        mark = card.querySelector('.tickdisc');
      } else if (!packed && disc) {
        disc.remove();
        mark = null;
      }
    }
    if (packed && mark) {
      mark.classList.add('pop');
      mark.addEventListener('animationend', () => mark.classList.remove('pop'), { once: true });
    }
  }

  async function removeOrWithdraw(itemId) {
    const row = allRows().find((r) => r.item.id === itemId);
    if (!row) return;
    const name = fullName(row.item);
    const mine = trip.my_requests.includes(itemId);
    const onTrip = trip.items.some((r) => r.item.id === itemId);
    const pending = trip.pending.some((r) => r.item.id === itemId);

    if (store.committee && onTrip) {
      const sure = await confirmSheet({
        title: `Take ${name} off this trip?`,
        sub: 'It goes back to being available to rig. Nothing moves - it never left its rack.',
        confirmLabel: 'Take it off',
      });
      if (!sure) return;
      try {
        await api.removeTripItem(id, itemId);
        await reload();
      } catch (error) { toast(error.message, true); }
      return;
    }
    // The kit sec clearing a piece off the wishlist before the Confirm screen.
    // Every request for it goes at once, and it is not kept: the list is read
    // once and acted on.
    if (store.committee && pending && trip.status === 'requesting') {
      const sure = await confirmSheet({
        title: `Drop ${name} from the list?`,
        sub: 'It comes off for everyone who asked. Nobody is taking it on this trip.',
        confirmLabel: 'Drop it',
      });
      if (!sure) return;
      try {
        await api.dropRequest(id, itemId);
        await reload();
      } catch (error) { toast(error.message, true); }
      return;
    }
    if (mine && trip.status === 'requesting') {
      const sure = await confirmSheet({
        title: `Withdraw your request for ${name}?`,
        sub: 'It stays on the list if somebody else asked for it too.',
        confirmLabel: 'Withdraw',
      });
      if (!sure) return;
      try {
        await api.tripRequest(id, itemId, false);
        await reload();
      } catch (error) { toast(error.message, true); }
    }
  }

  async function moveStage(status) {
    if (!(await needCommittee('Moving a trip on is a committee action.'))) return;
    try {
      trip = (await api.setTripStage(id, status)).trip;
      paint();
      toast('Packed. Have a good one.');
    } catch (error) {
      toast(error.message, true);
    }
  }

  /**
   * Calling the trip packed with the checklist part-done. The list is left
   * exactly as it is - unticked pieces stay unticked - because the record of
   * what went is the list itself, not the ticks.
   */
  async function skipPacking() {
    if (!(await needCommittee('Moving a trip on is a committee action.'))) return;
    const left = (trip.n_items || 0) - (trip.n_packed || 0);
    const sure = await confirmSheet({
      title: 'Call this trip packed?',
      sub: left
        ? `${left} ${left === 1 ? 'piece is' : 'pieces are'} still unticked. They stay `
          + 'on the trip either way - the trip just goes active now.'
        : 'The trip goes active now.',
      confirmLabel: 'Skip packing',
    });
    if (!sure) return;
    await moveStage('active');
  }

  /**
   * Ending a trip, which is the whole of coming home.
   *
   * There is no unpacking checklist to work through first. Every piece on the
   * list goes straight back to being available, at the rack it never left, and
   * the trip becomes the record of what went. The confirmation says the number
   * out loud because it is the one thing worth being sure about.
   */
  async function endTrip() {
    if (!(await needCommittee('Ending a trip is a committee action.'))) return;
    const sure = await confirmSheet({
      title: 'End this trip?',
      sub: `All ${trip.n_items} ${trip.n_items === 1 ? 'piece' : 'pieces'} go back to `
        + 'being available to rig, at the rack each one never left. The trip is kept '
        + 'as the record of what went.',
      confirmLabel: 'End the trip',
    });
    if (!sure) return;
    try {
      trip = (await api.closeTrip(id, { all: true })).trip;
      paint();
      toast('Trip ended. Everything is back on the shelf.');
    } catch (error) {
      toast(error.message, true);
    }
  }

  // ------------------------------------------------------------- first paint
  paint();

  // Warm the picker's inventory now if this stage has a way into it, so the
  // first "Request kit" / "Add kit" tap opens straight onto a full sheet.
  if (trip.status === 'requesting' || (store.committee && LIVE.includes(trip.status))) {
    loadCatalogue().catch(() => { cataloguePending = null; });
  }

  // The forecast is fetched after the page is up, not before it: it is a nice
  // thing to know and a slow thing to fetch, and a trip is still a trip when
  // Open-Meteo is unreachable at the lake.
  if (trip.status !== 'done' && trip.status !== 'cancelled' && trip.starts_on) {
    api.tripForecast(id).then((data) => {
      if (disposed || !data.forecast || !data.forecast.length) return;
      forecast = data.forecast;
      paint();
    }).catch(() => { /* no forecast is not an error */ });
  }

  return () => {
    disposed = true;
    if (press) clearTimeout(press.timer);
    unwireParallax();
    if (picker) picker.close();
  };
}


/* ========================================================= confirm the kit */

/**
 * The step between the wishlist and the wizard.
 *
 * Members have asked for kit; this is where the kit sec settles which sails and
 * boards actually go, topping up from the whole club inventory. A dense list,
 * not a card-at-a-time deck: the decision is "what is the fleet", taken in one
 * look. Nothing is kept as a record - a piece left off is simply not on the
 * trip, and a request the kit sec did not want was dropped on the list before
 * they got here.
 *
 * Everything else asked for rides straight through. Requested rig kit (a mast, a
 * base someone named) is pinned onto the trailer the wizard builds; requested
 * odds and ends (a wetsuit, a repair kit) go straight onto the packing list.
 */
export async function renderConfirm(root, params) {
  const id = Number(params.id);
  if (!(await needCommittee('Settling the kit list is a committee action.'))) {
    go(`/trip/${id}`, { replace: true });
    return undefined;
  }
  const trip = (await api.trip(id)).trip;
  const { kit } = await api.tripKit();
  const byId = new Map(kit.map((piece) => [piece.id, piece]));

  // The wishlist: what members asked for, plus anything already on the list.
  const wishlist = [...trip.pending, ...trip.items];

  const DERIVE_FROM = ['sail', 'board', 'wing', 'foil'];
  const kindsAsked = new Set(wishlist
    .map((row) => byId.get(row.item.id))
    .filter(Boolean)
    .map((piece) => piece.kind));

  // Sails and boards always; wings or foils only when one was asked for.
  const sections = DERIVE_FROM.filter((kind) =>
    kind === 'sail' || kind === 'board' || kindsAsked.has(kind));
  const LABEL = { sail: 'Sails', board: 'Boards', wing: 'Wings', foil: 'Foils' };
  const UNIT = { sail: 'm²', wing: 'm²', board: 'L', foil: '' };

  const pieces = {};
  sections.forEach((kind) => {
    pieces[kind] = kit
      .filter((piece) => piece.kind === kind)
      .sort((a, b) => (a.m2 ?? a.vol ?? 0) - (b.m2 ?? b.vol ?? 0)
        || shortName(a).localeCompare(shortName(b)));
  });

  // Pre-ticked: everything on the wishlist. Kept in `ticked`, keyed by piece id.
  const ticked = {};
  wishlist.forEach((row) => { ticked[row.item.id] = true; });

  const sizeOf = (piece) => {
    if (piece.m2 != null) return piece.m2.toFixed(1);
    return piece.vol != null ? String(piece.vol) : '';
  };

  mount(root, html`
    <div class="appbar">
      <div class="row">
        <button class="backbtn" data-back aria-label="Back">${icon('back')}</button>
        <span class="ttl sm">Confirm the kit</span>
      </div>
    </div>
    <div class="body">
      <div class="cf">
        <div class="cf-sum">
          ${sections.map((kind) => html`
            <button class="cf-tile" data-jump="${kind}">
              <span class="k">${LABEL[kind]} packed</span>
              <b data-count="${kind}">0</b>
            </button>`)}
        </div>
        ${sections.map((kind) => html`
          <div class="cf-sect" data-sect="${kind}">
            <div class="grouplab">${LABEL[kind]}</div>
            <div class="cf-list">
              ${pieces[kind].map((piece) => html`
                <button class="cf-row ${ticked[piece.id] ? 'sel' : ''} ${piece.away ? 'away' : ''}"
                        data-row="${piece.id}" ${piece.away ? 'disabled' : ''}>
                  <span class="sz">${sizeOf(piece)}${UNIT[kind]
                    ? html`<i>${UNIT[kind]}</i>` : ''}</span>
                  <span class="nm">${shortName(piece)}${piece.cams
                    ? html`<span class="cam">◆</span>` : ''}</span>
                  ${piece.away ? html`<span class="out">Out</span>` : ''}
                </button>`)}
            </div>
          </div>`)}
      </div>
    </div>
    <div class="packbar">
      <button class="askbtn" data-continue>Continue${icon('arrowRight')}</button>
    </div>`);

  function repaintCounts() {
    sections.forEach((kind) => {
      const n = pieces[kind].filter((piece) => ticked[piece.id]).length;
      const node = root.querySelector(`[data-count="${kind}"]`);
      if (node) node.textContent = String(n);
    });
  }
  repaintCounts();

  // A stop in a flow steps *out* of it: pop the entry we came in on rather than
  // pushing the trip on top, or the trip's own back arrow lands right back here
  // and the two screens bounce off each other forever. The fallback is only for
  // someone who opened this screen cold.
  onClick(root, 'data-back', () => back(`/trip/${id}`));
  on(root, 'click', '.cf-tile', (_event, node) => {
    const kind = node.getAttribute('data-jump');
    const sect = root.querySelector(`.cf-sect[data-sect="${kind}"]`);
    if (sect) sect.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  on(root, 'click', '.cf-row', (_event, node) => {
    const pieceId = Number(node.getAttribute('data-row'));
    ticked[pieceId] = !ticked[pieceId];
    node.classList.toggle('sel', ticked[pieceId]);
    repaintCounts();
  });

  onClick(root, 'data-continue', async () => {
    const keep = new Set();
    // The sails and boards the kit sec settled on.
    sections.forEach((kind) => pieces[kind].forEach((piece) => {
      if (ticked[piece.id]) keep.add(piece.id);
    }));
    // Everything else asked for rides straight through, untouched.
    wishlist.forEach((row) => {
      const piece = byId.get(row.item.id);
      if (!piece || !DERIVE_FROM.includes(piece.kind)) keep.add(row.item.id);
    });
    const items = [...keep].map((itemId) => {
      const piece = byId.get(itemId);
      return { item_id: itemId, role: piece ? piece.kind : null, source: 'chosen' };
    });
    try {
      await api.finaliseTripKit(id, items);
      go(`/trip/${id}/wizard`);
    } catch (error) {
      toast(error.message, true);
    }
  });

  return undefined;
}

/* ============================================================ the wizard */

/**
 * Working it out.
 *
 * The kit sec has settled the sails and boards; this screen works out the
 * masts, extensions and booms that go with them and re-runs the whole trailer
 * search on every touch. So it is built around that search moving: the headline
 * numbers count to their new value, the hero tint crossfades green to amber the
 * moment the club's kit cannot stand up the number asked for, and the size
 * mixes reshuffle between the two bands.
 *
 * The search is the rig assistant's own (web/js/rig/pack.js), fed the club
 * inventory from /api/trips/kit. Requested rig kit is pinned onto the trailer;
 * the fins and bases are a straight count (web/js/rig/engine.js packBoardKit),
 * since the board side of a trip has no combinatorics in it. There is one set
 * of rig rules in this app and neither of those is a second one.
 */
export async function renderWizard(root, params) {
  const id = Number(params.id);
  if (!(await needCommittee('Packing the trailer is a committee action.'))) {
    go(`/trip/${id}`, { replace: true });
    return undefined;
  }
  const trip = (await api.trip(id)).trip;
  const { kit } = await api.tripKit();
  const byId = new Map(kit.map((piece) => [piece.id, piece]));
  // The trip is still taking requests, so nothing is away for it yet; the
  // solver works the whole inventory bar anything a live trip has out.
  const free = kit.filter((piece) => !piece.away);

  const chosenPieces = trip.items
    .map((row) => byId.get(row.item.id))
    .filter(Boolean);
  const chosen = {
    sails: chosenPieces.filter((p) => p.kind === 'sail').sort((a, b) => a.m2 - b.m2),
    boards: chosenPieces.filter((p) => p.kind === 'board'),
    wings: chosenPieces.filter((p) => p.kind === 'wing'),
    foils: chosenPieces.filter((p) => p.kind === 'foil'),
    // Odds and ends (harnesses, wetsuits, spares) ride the packing list
    // untouched by the solver. Everything the wizard reasons about has a
    // rig_kind; anything without one is a misc piece, counted straight off the
    // trip's own rows since it never reaches the rig kit list.
    misc: trip.items.filter((row) => !row.item.rig_kind),
  };
  const RIG_KINDS = ['mast', 'ext', 'boom', 'fin', 'uj'];
  const pins = chosenPieces
    .filter((p) => RIG_KINDS.includes(p.kind))
    .map((p) => p.id);

  if (!chosen.sails.length && !chosen.boards.length) {
    mount(root, html`
      <div class="appbar"><div class="row">
        <button class="backbtn" data-back aria-label="Back">${icon('back')}</button>
        <span class="ttl sm">Working it out</span>
      </div></div>
      <div class="body"><div class="emptystate">
        ${icon('box')}
        <b>Nothing to work out yet</b>
        <span>Confirm the sails and boards first and the app fills in the rest.</span>
      </div></div>`);
    onClick(root, 'data-back', () => back(`/trip/${id}/confirm`));
    return undefined;
  }

  // ---------------------------------------------------------------- knobs
  const rootCss = getComputedStyle(document.documentElement);
  const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nums = (prop) => rootCss.getPropertyValue(prop).trim().split(/\s+/)
    .map(Number).filter((n) => !Number.isNaN(n));
  const ms = (prop, dflt) => {
    const v = rootCss.getPropertyValue(prop).trim();
    if (v.endsWith('ms')) return parseFloat(v);
    if (v.endsWith('s')) return parseFloat(v) * 1000;
    return dflt;
  };
  const asWeights = (a) => ({ spare: a[0], short: a[1], match: a[2], sessions: a[3], light: a[4] });
  const PRESETS = {
    light: asWeights(nums('--wz-preset-light')),
    standard: asWeights(nums('--wz-preset-standard')),
    generous: asWeights(nums('--wz-preset-generous')),
  };
  const DEBOUNCE = Number(rootCss.getPropertyValue('--wz-recompute-debounce')) || 90;
  // Stepping the rigs target is a run of quick taps, and a big trip takes
  // seconds per solve, so wait for the taps to stop before working it out.
  const STEP_DEBOUNCE = 600;
  const ROLL_MS = ms('--wz-roll-ms', 440);
  const FILL_HINT = {
    light: 'The smallest trailer that still keeps the promise. Nothing spare.',
    standard: 'A backup for the sizes most people sail.',
    generous: 'Every backup that fits, for the sizes people swap between.',
  };

  // ---------------------------------------------------------------- state
  // The sail set never changes here, so the model is built once; only the
  // trailer args move. Everything the interactive layer touches - `pick`,
  // `mustRig`, the tester rows - keys on a sail's row index (its position in
  // `chosen.sails`, which is `model.rows`), never its m² size, so two sails of
  // the same size stay separate picks.
  const model = buildModel(chosen.sails, free, pins);

  const state = {
    sails: chosen.sails.map((_, i) => i),
    // Half the sails on the water at once is a fair start; the kit sec steps it
    // from there.
    minRigs: Math.max(1, Math.round(chosen.sails.length / 2)),
    preset: 'standard',
    mustRig: [],
  };
  let pick = [];
  let last = { counts: null, result: null, board: { assigned: [], short: [] } };
  const shown = {};
  let disposed = false;
  let solveTimer = null;

  // -------------------------------------------------------------- helpers
  // The paint code builds a few nodes by innerHTML rather than through `html`,
  // so an icon has to come out as its markup string here, not a raw() wrapper.
  const ic = (n) => toHtml(icon(n));
  const m2s = (v) => v.toFixed(1);
  const cam = (i) => (chosen.sails[i] && chosen.sails[i].cams
    ? '<span class="cam">◆</span>' : '');
  const sortIdxs = (list) => list.slice().sort((a, b) => a - b);
  // A group is a list of row indices; `chosen.sails` is sorted by m², so
  // sorting the indices sorts the labels by size too.
  const comboLabel = (list) => sortIdxs(list)
    .map((i) => m2s(chosen.sails[i].m2) + cam(i)).join(' + ');
  const keyOf = (list) => sortIdxs(list).join(',');
  const sameGroup = (a, b) => keyOf(a) === keyOf(b);

  function idxsFor(list) {
    return sortIdxs(list).filter((i) => i >= 0 && i < chosen.sails.length);
  }

  // "one more 430 RDM mast" / "an SDM extension" / "a 150-200 boom"
  function friendly(c) {
    if (!c) return null;
    const p = c.rep;
    if (c.kind === 'mast') return `${p.len} ${p.diam} mast`;
    if (c.kind === 'ext') return `${p.diam ? `${p.diam} ` : ''}extension`;
    return `${p.min}-${p.max} boom`;
  }

  // ---------------------------------------------------------------- solve
  function solve() {
    const live = state.sails;
    state.mustRig = state.mustRig
      .map((g) => g.filter((i) => live.indexOf(i) !== -1))
      .filter((g) => g.length >= 2);
    pick = pick.filter((i) => live.indexOf(i) !== -1);

    const result = chooseTrailer(model, {
      minRigs: Math.min(state.minRigs, live.length),
      weights: PRESETS[state.preset],
      mustRig: state.mustRig.map((g) => g.slice()),
    });

    const usedIds = new Set([
      ...pins,
      ...packingList(model, result.counts).map((p) => p.id),
    ]);
    const board = packBoardKit(free, chosen.boards, state.preset, usedIds);

    last = { counts: result.counts, result, board };
    return result;
  }

  // ------------------------------------------------------------- skeleton
  mount(root, html`
    <div class="appbar"><div class="row">
      <button class="backbtn" data-back aria-label="Back">${icon('back')}</button>
      <span class="ttl sm">Working it out</span>
      <button class="wz-skip" data-skip>Skip</button>
    </div></div>
    <div class="body"><div data-wzbody></div></div>
    <div class="packbar">
      <button class="askbtn" data-start>${icon('tick')}Start packing</button>
    </div>`);
  const mountEl = root.querySelector('[data-wzbody]');
  const $ = (sel) => mountEl.querySelector(sel);

  function paintShell() {
    mountEl.innerHTML = toHtml(html`
      <div class="wz" data-wz>
        <div class="wz-strip" data-dim>
          <div class="wz-stat"><span class="k">Pieces</span><b data-fig="pieces">0</b></div>
          <div class="wz-stat"><span class="k">Spares</span><b data-fig="spares">0</b></div>
          <div class="wz-stat"><span class="k">Brand match</span>
            <b><span data-fig="match">0</span><i>%</i></b></div>
        </div>
        <div class="wz-hero" data-hero>
          <div class="wz-heronum">
            <button class="wz-step" data-nudge="-1" aria-label="Fewer rigs">−</button>
            <span class="fig" data-fig="rigs">0</span>
            <button class="wz-step" data-nudge="1" aria-label="More rigs">+</button>
          </div>
          <span class="wz-herocap">rigs at once</span>
        </div>
        <div class="wz-fill">
          <div class="grouplab">How full to pack</div>
          <div class="wz-seg" data-seg>
            <button data-preset="light">Light</button>
            <button data-preset="standard">Standard</button>
            <button data-preset="generous">Generous</button>
          </div>
          <p class="wz-fillhint" data-fillhint></p>
        </div>
        <table class="wz-kit" data-kittable hidden></table>
        <div class="wz-combos" data-dim>
          <div class="wz-dead" data-dead hidden></div>
          <div class="wz-bands">
            <div class="wz-band req" data-band="req" hidden>
              <div class="grouplab">Requested</div><ul class="wz-rows" data-rows="req"></ul></div>
            <div class="wz-band bad" data-band="bad" hidden>
              <div class="grouplab">Currently incompatible</div>
              <ul class="wz-rows" data-rows="bad"></ul></div>
          </div>
          <div class="wz-test">
            <div class="grouplab">Test a combination</div>
            <p class="wz-lead">Tick sails to see whether they can all be rigged at the same time.</p>
            <div class="wz-srows" data-sizes></div>
            <div class="wz-verdict" data-verdict hidden></div>
          </div>
        </div>
      </div>`);
  }

  // ------------------------------------------------------------- the roll
  const rollGen = {};
  function roll(name, to, fmt = String) {
    const el = $(`[data-fig="${name}"]`);
    if (!el || !Number.isFinite(to)) return;
    const gen = (rollGen[name] || 0) + 1;
    rollGen[name] = gen;
    const from = (name in shown) ? shown[name] : to;
    shown[name] = to;
    if (REDUCE || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const frame = (now) => {
      if (rollGen[name] !== gen || disposed) return;
      const k = Math.max(0, Math.min(1, (now - t0) / ROLL_MS));
      if (k < 1) {
        const e = 1 - (1 - k) ** 3;
        el.textContent = fmt(Math.round(from + (to - from) * e));
        requestAnimationFrame(frame);
      } else {
        el.textContent = fmt(to);
      }
    };
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------- the controls
  function wireControls() {
    const target = Math.min(state.minRigs, state.sails.length);
    $('[data-seg]').querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.preset === state.preset);
    });
    mountEl.querySelector('[data-nudge="-1"]').disabled = target <= 1;
    mountEl.querySelector('[data-nudge="1"]').disabled = target >= state.sails.length;
    $('[data-fillhint]').textContent = FILL_HINT[state.preset];
  }

  // Every line of the packing list as a count: the rig slots from the trailer
  // solve, the board slots from packBoardKit, everything else straight off what
  // was confirmed. A board slot the pack came up short on is flagged red; the
  // rig promise being unmet is what the hero tint already says.
  function kitRows() {
    if (!last.counts) return [];
    const rig = { mast: 0, ext: 0, boom: 0 };
    model.classes.forEach((c, i) => { rig[c.kind] += last.counts[i]; });
    const b = last.board;
    const nBoard = (role) => b.assigned.filter((e) => e.role === role).length;
    const shortOf = (role) => b.short.some((e) => e.role === role);

    const rows = [
      ['Sails', chosen.sails.length, false],
      ['Masts', rig.mast, false],
      ['Extensions', rig.ext, false],
      ['Booms', rig.boom, false],
    ];
    if (chosen.wings.length) rows.push(['Wings', chosen.wings.length, false]);
    if (chosen.boards.length) {
      rows.push(['Boards', chosen.boards.length, false]);
      // A wingfoil board takes no base, and a foil-ready or wingfoil board
      // takes a foil instead of a fin (packBoardKit), so each row only
      // appears when this trip's boards actually asked for it.
      if (nBoard('uj') || shortOf('uj')) rows.push(['Bases', nBoard('uj'), shortOf('uj')]);
      if (nBoard('fin') || shortOf('fin')) rows.push(['Fins', nBoard('fin'), shortOf('fin')]);
    }
    // Foils requested outright and foils packBoardKit derived for a board
    // are the same line in the packing list.
    const foilCount = chosen.foils.length + nBoard('foil');
    if (foilCount || shortOf('foil')) rows.push(['Foils', foilCount, shortOf('foil')]);
    if (chosen.misc.length) rows.push(['Misc', chosen.misc.length, false]);

    return rows;
  }

  // The strip's "Pieces": the whole packing list, every row of the table added
  // up, not just the three rig slots.
  const totalPieces = (rows) => rows.reduce((sum, [, n]) => sum + n, 0);

  function kitTable(rows) {
    return rows.map(([label, n, short]) =>
      `<tr${short ? ' class="short"' : ''}><th>${label}</th><td>${n}</td></tr>`).join('');
  }

  // ---------------------------------------------------------------- paint
  function paint(result) {
    wireControls();

    const target = Math.min(state.minRigs, state.sails.length);
    const kept = result.rigs >= target;
    const rows = kitRows();

    roll('pieces', totalPieces(rows));
    roll('spares', result.slack.mast + result.slack.ext + result.slack.boom);
    roll('match', Math.round(result.match * 100));
    roll('rigs', target);

    // The hero tint is the only readout of whether the target was met.
    $('[data-hero]').classList.toggle('short', !kept);

    const kt = $('[data-kittable]');
    kt.innerHTML = kitTable(rows);
    kt.hidden = !rows.length;

    const reqGroups = state.mustRig.slice();
    // A sail nothing in the club rigs already has its own red note; leaving it
    // in the incompatible band too would just repeat that against every size.
    // `unriggableGroups` returns groups of row indices, the same shape the rest
    // of this screen works in.
    const deadSet = new Set(result.impossible);
    const badGroups = unriggableGroups(model, last.counts, { maxSize: target, limit: 8 })
      .filter((g) => !g.some((i) => deadSet.has(i)))
      .filter((g) => !reqGroups.some((r) => sameGroup(r, g)));

    const dead = $('[data-dead]');
    if (result.impossible.length) {
      const ds = result.impossible.map((i) => m2s(chosen.sails[i].m2));
      dead.innerHTML = `${ic('warning')}<span>The <b>${ds.join(', ')}</b>m² `
        + `${ds.length === 1 ? 'sail rigs' : 'sails rig'} with nothing the club owns. `
        + `Take ${ds.length === 1 ? 'it' : 'them'} and borrow on the day, or leave `
        + `${ds.length === 1 ? 'it' : 'them'} behind.</span>`;
      dead.hidden = false;
    } else {
      dead.hidden = true;
    }

    syncRows($('[data-rows="req"]'), reqGroups.map((g, i) => {
      const cg = checkGroup(model, last.counts, idxsFor(g));
      const st = cg.riggable ? ''
        : `<span class="st warn">${ic('warning')}${cg.need
          ? `needs a ${friendly(cg.need)}` : 'short more than one piece'}</span>`;
      return {
        key: keyOf(g),
        html: `<span class="combo">${comboLabel(g)}</span>${st}`
          + `<button class="x" data-unmust="${i}" aria-label="Stop packing for this">`
          + `${ic('close')}</button>`,
      };
    }));

    syncRows($('[data-rows="bad"]'), badGroups.map((g) => ({
      key: keyOf(g),
      html: `<span class="combo">${comboLabel(g)}</span>`
        + `<button class="wz-pack" data-pack="${keyOf(g)}">Pack</button>`,
    })));

    renderSizes();
    paintTester();
  }

  // ------------------------------------------------ the tester (no solve)
  let sizesKey = '';
  function renderSizes() {
    const key = chosen.sails.map((s) => s.id).join(',');
    if (key === sizesKey) return;
    sizesKey = key;
    $('[data-sizes]').innerHTML = chosen.sails.map((s, i) => {
      const on = pick.indexOf(i) !== -1;
      const name = shortName(s);
      return `<button class="wz-srow${on ? ' sel' : ''}" data-size="${i}">`
        + `<span class="box">${ic('tick')}</span>`
        + `<span class="sz">${m2s(s.m2)}</span>`
        + `<span class="nm">${name}${cam(i)}</span>`
        + '</button>';
    }).join('');
  }

  function paintTester() {
    const verdict = pick.length >= 2
      ? checkGroup(model, last.counts, idxsFor(pick)) : null;
    const missing = new Set();
    if (verdict && !verdict.riggable) {
      verdict.missing.forEach((i) => missing.add(i));
    }

    mountEl.querySelectorAll('[data-size]').forEach((b) => {
      const idx = Number(b.getAttribute('data-size'));
      const on = pick.indexOf(idx) !== -1;
      b.classList.toggle('sel', on);
      b.classList.toggle('ok', on && !!verdict && (verdict.riggable || !missing.has(idx)));
      b.classList.toggle('warn', on && !!verdict && !verdict.riggable && missing.has(idx));
    });

    const box = $('[data-verdict]');
    if (!verdict) { box.hidden = true; box.innerHTML = ''; return; }

    const labels = comboLabel(pick);
    if (verdict.riggable) {
      const rig = verdict.sheet.map((r) => `${r.mast.len} ${r.mast.diam}`).join(' · ');
      box.className = 'wz-verdict ok';
      box.innerHTML = `<div class="vh">${ic('tick')}`
        + `<span>${labels} all stand up at once.</span></div>`
        + `<div class="vkit">${rig}</div>`;
    } else {
      // Two missing sails of one size read as "5.0m² (×2)", not "5.0, 5.0".
      const tally = {};
      verdict.missing.forEach((i) => {
        const k = m2s(chosen.sails[i].m2);
        tally[k] = (tally[k] || 0) + 1;
      });
      const miss = Object.entries(tally)
        .map(([k, n]) => (n > 1 ? `${k}m² (×${n})` : `${k}m²`)).join(', ');
      const fix = verdict.need
        ? `: one more <b>${friendly(verdict.need)}</b> would fit `
          + `${verdict.missing.length === 1 ? 'it' : 'them'}.`
        : ': more than one piece short.';
      box.className = 'wz-verdict bad';
      box.innerHTML = `<div class="vh">${ic('warning')}`
        + `<span>${verdict.sheet.length} of ${idxsFor(pick).length} stand up. `
        + `${miss} left without a rig${fix}</span></div>`
        + `<button class="vpack" data-pack="${keyOf(pick)}">Repack so this mix works</button>`;
    }
    box.hidden = false;
  }

  // --------------------------------------------------- row transitions
  function liveCount(ul) {
    let n = 0;
    Array.prototype.forEach.call(ul.children, (li) => {
      if (!li.classList.contains('leave')) n += 1;
    });
    return n;
  }

  function syncRows(ul, items) {
    const band = ul.closest('[data-band]');
    const have = {};
    Array.prototype.forEach.call(ul.children, (li) => {
      if (!li.classList.contains('leave')) have[li.dataset.key] = li;
    });
    const want = {};
    items.forEach((it) => { want[it.key] = it; });

    Object.keys(have).forEach((k) => {
      if (want[k]) return;
      const li = have[k];
      if (REDUCE) { li.remove(); return; }
      li.classList.add('leave');
      const done = () => {
        if (li.parentNode) li.remove();
        if (band && !liveCount(ul)) band.hidden = true;
      };
      li.addEventListener('transitionend', (e) => {
        if (e.propertyName === 'max-height') done();
      });
      setTimeout(done, 520);
    });

    items.forEach((it) => {
      const li = have[it.key];
      if (li) { li.innerHTML = it.html; return; }
      const node = document.createElement('li');
      node.className = REDUCE ? 'wz-crow' : 'wz-crow enter';
      node.dataset.key = it.key;
      node.innerHTML = it.html;
      ul.appendChild(node);
      if (!REDUCE) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => node.classList.remove('enter'));
        });
      }
    });

    items.forEach((it) => {
      const li = ul.querySelector(`li[data-key="${it.key}"]`);
      if (li) ul.appendChild(li);
    });

    if (band && (items.length || liveCount(ul))) band.hidden = false;
    else if (band && !liveCount(ul)) band.hidden = true;
  }

  // --------------------------------------------------------- the run loop
  function schedule(delay = DEBOUNCE) {
    wireControls();
    const wz = $('[data-wz]');
    wz.classList.add('recomputing');
    if (solveTimer) clearTimeout(solveTimer);
    solveTimer = setTimeout(() => {
      if (disposed) return;
      let result;
      try {
        result = solve();
      } catch (error) {
        wz.classList.remove('recomputing');
        toast('Could not work the trailer out just now.', true);
        return;
      }
      requestAnimationFrame(() => {
        if (disposed) return;
        wz.classList.remove('recomputing');
        paint(result);
      });
    }, REDUCE ? 0 : delay);
  }

  // --------------------------------------------------------------- events
  onClick(root, 'data-back', () => back(`/trip/${id}`));

  onClick(root, 'data-nudge', (value) => {
    const d = Number(value);
    const lim = state.sails.length;
    const next = Math.max(1, Math.min(lim, Math.min(state.minRigs, lim) + d));
    if (next === Math.min(state.minRigs, lim)) return;
    state.minRigs = next;
    pick = [];
    // Show the new number at once; the trailer catches up when the taps stop.
    const fig = $('[data-fig="rigs"]');
    if (fig) fig.textContent = String(next);
    shown.rigs = next;
    rollGen.rigs = (rollGen.rigs || 0) + 1;
    schedule(STEP_DEBOUNCE);
  });

  onClick(root, 'data-preset', (value) => {
    if (value === state.preset) return;
    state.preset = value;
    schedule();
  });

  onClick(root, 'data-size', (value) => {
    const idx = Number(value);
    const at = pick.indexOf(idx);
    if (at === -1) pick.push(idx); else pick.splice(at, 1);
    paintTester();
  });

  onClick(root, 'data-pack', (value) => {
    const g = value.split(',').map(Number).filter((x) => !Number.isNaN(x));
    if (g.length >= 2 && !state.mustRig.some((r) => sameGroup(r, g))) {
      state.mustRig.push(g.slice().sort((a, b) => a - b));
    }
    pick = [];
    schedule();
  });

  onClick(root, 'data-unmust', (value) => {
    state.mustRig.splice(Number(value), 1);
    schedule();
  });

  // Save the packing list and move the trip to packing. `derived` is the rig
  // and board kit the solver worked out; skipping the wizard passes none.
  async function startPacking(derived = []) {
    const items = [
      ...trip.items.map((row) => ({
        item_id: row.item.id, role: row.role || null, source: 'chosen',
      })),
      ...derived,
    ];
    try {
      await api.setTripItems(id, items);
      await api.setTripStage(id, 'packing');
      go(`/trip/${id}`, { replace: true });
      refresh();
    } catch (error) {
      toast(error.message, true);
    }
  }

  onClick(root, 'data-start', () => {
    if (!last.result) return;
    const rig = packingList(model, last.counts)
      .map((piece) => ({ item_id: piece.id, role: piece.kind, source: 'derived' }));
    const boardKit = last.board.assigned
      .map((entry) => ({ item_id: entry.piece.id, role: entry.role, source: 'derived' }));
    startPacking([...rig, ...boardKit]);
  });

  // Skip the solver entirely: the packing list is just the confirmed sails and
  // boards, and the kit sec adds the masts, extensions, booms and fins to it by
  // hand once the trip is packing.
  onClick(root, 'data-skip', async () => {
    const sure = await confirmSheet({
      title: 'Skip working it out?',
      sub: 'The packing list will be just the sails and boards you confirmed. '
        + 'You add the masts, extensions, booms and fins to it yourself.',
      confirmLabel: 'Skip',
    });
    if (!sure) return;
    startPacking();
  });

  // ----------------------------------------------------------------- boot
  // The first solve runs on the page's only thread, so hand the browser a
  // frame to draw the screen (and make Skip and Back tappable) before it
  // starts. A big trip could otherwise show a spinner and nothing else.
  mountEl.innerHTML = toHtml(html`
    <div class="emptystate"><b>Working it out</b>
      <span>Finding the masts, extensions and booms for ${chosen.sails.length}
        ${chosen.sails.length === 1 ? 'sail' : 'sails'}.</span></div>`);
  solveTimer = setTimeout(() => {
    solveTimer = null;
    if (disposed) return;
    try {
      paintShell();
      paint(solve());
    } catch (error) {
      mountEl.innerHTML = toHtml(html`
        <div class="emptystate">${icon('warning')}
          <b>Could not work the trailer out</b>
          <span>${error.message || 'The kit list may be incomplete.'}</span></div>`);
    }
  }, 30);

  return () => {
    disposed = true;
    if (solveTimer) clearTimeout(solveTimer);
  };
}

/* ============================================================== the parts */

function hero(trip) {
  const photo = trip.image_path;
  return html`
    <div class="triphero ${photo ? '' : 'blank'}">
      <span class="hpar" aria-hidden="true"
        style="${photo ? `background-image:url('${trip.image_path}')` : ''}"></span>
      ${photo ? html`<div class="wash"></div>`
        : html`<span class="blankmark" aria-hidden="true">${icon('flag')}</span>`}
      <div class="htxt">
        <b>${trip.destination || trip.name}</b>
        <span>${dates(trip) || 'No dates yet'}</span>
      </div>
    </div>`;
}

function mrow(glyph, text) {
  return html`<div class="mrow">${icon(glyph)}<span>${text}</span></div>`;
}

/** "Saturday 14 March", which is how anybody says when a trip leaves. */
function longDate(stamp) {
  const when = stampDate(stamp);
  if (!when) return '';
  return when.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * The parallax on the photo band.
 *
 * The band scrolls with the page like any other row; the photo layer inside it
 * is dragged back at a fraction of that, written as a translate from how far
 * the band has travelled up its own scroll box. The layer is oversized well
 * past the band on every side (see screens.css) so the lag never uncovers an
 * edge, and it simply holds still if this never runs.
 */
function wireParallax(root) {
  const scroller = root.querySelector('[data-scroll]');
  const layer = root.querySelector('.triphero .hpar');
  if (!scroller || !layer) return () => {};
  const band = layer.parentElement;
  const paint = () => {
    const top = band.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    layer.style.setProperty('--hpar', `${(-top * PARALLAX_RATE).toFixed(1)}px`);
  };
  scroller.addEventListener('scroll', paint, { passive: true });
  paint();
  return () => scroller.removeEventListener('scroll', paint);
}

/**
 * The forecast, read the way every windsurfer already reads one.
 *
 * Windguru's colour ramp is doing the work here, not a palette of ours: pale
 * blue through cyan, green, yellow and orange into red is a scale this club can
 * already read at a glance, and inventing a prettier one would only mean
 * everybody has to learn it. And Windguru's layout too: not bars but a grid of
 * coloured cells, one column per hour through the sailing day, gust stacked
 * above mean, each cell coloured by its own speed and carrying its number. The
 * columns touch, so the day reads as one continuous strip.
 *
 * A trip runs one to seven days, so the strip is drawn once per day, stacked,
 * each with the weekday where a single-day chart would name the wind
 * direction. Direction is left off here: over a week it is the run of speed
 * that decides which day you sail, and the arrow is noise.
 */
const WIND_COLOUR = (kn) =>
  (kn <= 5 ? '#D6EEF9' : kn <= 8 ? '#A8DFF0' : kn <= 11 ? '#7BD0E4'
   : kn <= 14 ? '#86D98F' : kn <= 17 ? '#C6E063' : kn <= 20 ? '#EFD84F'
   : kn <= 24 ? '#F2A93F' : kn <= 28 ? '#E76A42' : kn <= 33 ? '#D93E38' : '#B93A8A');

const ORDINAL = (n) => {
  const tens = n % 100;
  return n + (['th', 'st', 'nd', 'rd'][(tens - 20) % 10] || ['th', 'st', 'nd', 'rd'][tens] || 'th');
};

/**
 * A forecast day's heading. The day itself and the two either side are named
 * the way you would say them - "Today", "Tomorrow", "Yesterday". The rest of
 * the week is its weekday ("the wind's better Thursday"). Past a week the
 * weekday alone stops being enough ("which Thursday?"), so it becomes a date:
 * "18th December". Anything Open-Meteo could not reach never gets a column.
 */
function forecastDayName(dateStr) {
  // The server sends a plain YYYY-MM-DD. Parse it by hand into a local-midnight
  // date: Safari rejects the string stampDate() builds from a date with no time.
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!parts) return dateStr;
  const when = new Date(+parts[1], +parts[2] - 1, +parts[3]);
  const today = new Date();
  const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((when - midnight(today)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days >= 2 && days <= 6) {
    return when.toLocaleDateString('en-GB', { weekday: 'long' });
  }
  return `${ORDINAL(when.getDate())} ${when.toLocaleDateString('en-GB', { month: 'long' })}`;
}

/** One day's strip: gust row over mean row, one column an hour. */
function windDay(day) {
  const rows = day.rows;
  const W = 322;
  const pitch = W / rows.length;      // the cells are square, so this is also
  const hair = 1;                     // their height; the hairline keeps them
  const labelH = 15;                  // countable while they touch
  const H = 2 * pitch + labelH;
  // Dark ink on the pale end of the ramp, white once the cell goes deep red.
  const ink = (kn) => (kn >= 29 ? '#fff' : 'var(--app-ink)');
  const cell = (x, y, kn) => html`
    <rect x="${(x + hair).toFixed(1)}" y="${(y + hair).toFixed(1)}"
          width="${(pitch - hair).toFixed(1)}" height="${(pitch - hair).toFixed(1)}"
          fill="${WIND_COLOUR(kn)}"/>
    <text x="${(x + pitch / 2).toFixed(1)}" y="${(y + pitch / 2 + 3.4).toFixed(1)}"
          text-anchor="middle" font-size="10" font-weight="700"
          fill="${ink(kn)}">${kn}</text>`;
  const peak = Math.max(...rows.map((r) => r.kn));
  const low = Math.min(...rows.map((r) => r.kn));
  const name = forecastDayName(day.date);
  return html`
    <div class="wday">
      <b>${name}</b>
      <svg viewBox="0 0 ${W} ${H.toFixed(1)}" role="img"
           aria-label="${name}: ${low} to ${peak} knots mean through the day">
        ${rows.map((rowData, i) => {
          const x = i * pitch;
          return html`
            ${cell(x, 0, rowData.gust_kn == null ? rowData.kn : rowData.gust_kn)}
            ${cell(x, pitch, rowData.kn)}
            <text x="${(x + pitch / 2).toFixed(1)}" y="${(H - 4).toFixed(1)}"
                  text-anchor="middle" font-size="9"
                  fill="var(--app-faint)">${rowData.hour}</text>`;
        })}
      </svg>
    </div>`;
}

function windChart(days) {
  return html`
    <div class="wind">
      <div class="wtop">
        <b>Forecast</b>
        <span>gust / mean, knots</span>
      </div>
      ${days.map(windDay)}
    </div>`;
}

/**
 * The packing list's sort, as a comparator over trip rows: by type in the
 * order a trailer is loaded, then within a type by size then name so you work
 * along the rack rather than hunting. One flat list, no headers - the checklist is a single run of ticks.
 */
function packingOrder() {
  const types = store.types.map((type) => type.key);
  const sizeOf = (row) => {
    const parsed = parseFloat(String(row.item.size_value));
    return Number.isNaN(parsed) ? Infinity : parsed;
  };
  return (a, b) =>
    types.indexOf(a.item.component_type) - types.indexOf(b.item.component_type)
    || sizeOf(a) - sizeOf(b)
    || fullName(a.item).localeCompare(fullName(b.item));
}
