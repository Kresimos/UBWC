/**
 * Catalogue — browse the kit like a windsurf shop.
 *
 * The tile is deliberately quiet: a product shot, the size, the name and the
 * derived star score. Everything else a member might want lives one tap away
 * on the item page, so a screenful of kit stays scannable. It's the same
 * tile Build picks from (js/ui/itemTile.js) — a scuffed board should read
 * the same wherever a member is choosing from a shelf of them.
 *
 * The chrome above the grid is three things now: the type rail (a quick
 * one-tap switch, Build's chip size), a control row of [filter | sort] · count ·
 * grid/list, and one filter panel that slides up over the screen behind both
 * of those icons. The panel owns everything narrowing does — subtype, box,
 * diameter, cams, fault severity and the sort — and the whole site's kit is
 * loaded once so every toggle in it filters in the browser with no round-trip.
 *
 * Out-of-action kit is in the inventory the same as anything else, but the
 * fault filter opens on "no faults + minor faults", so a red-flagged board is
 * hidden until a member ticks "Major faults". When it is shown it still sorts
 * to the very bottom, whatever the chosen sort. Selecting kit to pack a trip
 * is a long-press on a tile; the picks survive every filter change after that,
 * counted even when a filter has scrolled them out of view.
 */
import { html, mount, toHtml, onClick, on, stampDate } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { store, siteLabel, setTrip, subscribe } from '../store.js';
import { fullName, wireWhoPill } from '../ui/bits.js';
import { cardTile, faultPopup } from '../ui/itemTile.js';
import { pickSite, needCommittee, openIdentity } from '../ui/chrome.js';
import { chooser, formSheet, toast } from '../ui/overlay.js';
import { haptic, PICK } from '../ui/haptics.js';
import { go } from '../router.js';

const VIEW_KEY = 'ubwc.view';
const SORT_KEY = 'ubwc.catsort';
const DIR_KEY = 'ubwc.catdir';
const SELECT_HINT_KEY = 'ubwc.usedselect';

// The fault buckets the panel opens on: a clean piece and an amber-flagged
// one, but not a red "out of action" one. Deliberately not persisted — a
// member should never come back next session to silently hidden broken kit.
const DEFAULT_FAULTS = ['none', 'minor'];

const SORTS = [
  { key: 'added', label: 'Newest' },
  { key: 'rating', label: 'Rating' },
  { key: 'size', label: 'Size' },
  { key: 'name', label: 'Name' },
  { key: 'condition', label: 'Condition' },
  { key: 'location', label: 'Location' },
];

// The subtypes a member reaches for first, in that order; anything else the
// club actually owns is appended after (mirrors js/rig/engine.js).
const SUBTYPE_ORDER = {
  board: ['Freewave', 'Freeride', 'Freestyle', 'Slalom', 'Wave', 'Formula', 'Foil'],
  sail: ['Freewave', 'Freeride', 'Wave', 'Freestyle', 'Slalom', 'Race'],
  fin: ['Wave', 'Freeride', 'Freestyle', 'Slalom', 'Weed'],
};

const CONDITION_RANK = { 'new': 4, 'very good': 3, good: 2, fair: 1, poor: 0 };

// Which extra sections a type shows in the panel. Only ever drawn for options
// that match something in stock, so the panel never offers a dead filter.
const CONTEXT = {
  board: ['sub', 'box'],
  sail: ['sub', 'cams', 'diam'],
  wing: ['sub'],
  mast: ['diam', 'length'],
  ext: ['diam'],
  boom: [],
  fin: ['sub', 'box'],
  foil: ['sub', 'box'],
  misc: ['sub'],
};

// The panel filters, the sort and the view. Filters live at module scope, so
// leaving the Catalogue and coming back keeps them; a full reload (a new day)
// clears them. Sort, direction and view outlast a reload in localStorage.
const state = {
  view: localStorage.getItem(VIEW_KEY) || 'grid',
  sort: localStorage.getItem(SORT_KEY) || 'added',
  dir: localStorage.getItem(DIR_KEY) || 'desc',
  q: '',
  type: 'all',
  subs: new Set(),
  boxes: new Set(),
  diams: new Set(),
  cams: new Set(),
  lens: new Set(),
  faults: new Set(DEFAULT_FAULTS),
  // Which trip the list is narrowed to (or null) is app-wide state now, held in
  // store.trip and driven by the location chip — see store.js and chrome.js.
  panel: null, // null | 'filter' | 'sort'
  selecting: false,
  selected: new Set(),
};

function clearContextFilters() {
  state.subs.clear();
  state.boxes.clear();
  state.diams.clear();
  state.cams.clear();
  state.lens.clear();
}

export async function render(root) {
  state.panel = null;
  state.selecting = false;
  state.selected.clear();

  let disposed = false;

  mount(root, shell());
  const scroller = root.querySelector('[data-scroll]');
  const listNode = root.querySelector('[data-list]');
  const mainSearch = root.querySelector('.appbar .searchbar input');
  const chrome = root.querySelector('[data-catchrome]');
  const panelRoot = root.querySelector('[data-panelroot]');
  const panelBody = root.querySelector('[data-panelbody]');
  const panelSearch = root.querySelector('[data-panelsearch]');

  let items = [];
  let trips = [];
  let loading = false;
  let press = null;
  let suppressClick = false;

  // ---------------------------------------------------------- the chrome
  /**
   * The type rail and the control row are a sticky layer pinned to the top of
   * the grid, not part of its flow — so tucking them slides them under the app
   * bar without moving a single tile or touching the scroll position. They go
   * on a downward scroll and come back on any upward one. The slide is timed
   * to the scroll speed (a slow drift eases away, a flick snaps) and lags the
   * finger a touch, which is what makes it read as its own piece.
   */
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let chromeH = 0;
  let chromeTucked = false;
  let lastY = 0;
  let lastT = 0;
  let vel = 0; // px per ms, smoothed
  let travel = 0; // px moved in the current direction, since the last flip

  requestAnimationFrame(() => { chromeH = chrome.offsetHeight || 90; });

  function tuckDuration(v) {
    if (reduceMotion) return 0;
    // Unhurried by default, quicker if a member flings the list. `v` is px/ms,
    // smoothed. It only ever slides — no fade.
    return Math.round(Math.min(720, Math.max(240, 200 / Math.max(v, 0.05) + 260)));
  }

  function applyChrome(duration) {
    const tuck = chromeTucked && !state.selecting && !state.panel;
    chrome.style.transition = reduceMotion ? 'none' : `transform ${duration}ms ease-in-out`;
    chrome.classList.toggle('tucked', tuck);
  }

  function onScroll() {
    const y = scroller.scrollTop;
    const now = performance.now();
    const dt = now - lastT;
    const dy = y - lastY;
    if (dt > 0) vel = vel * 0.5 + (Math.abs(dy) / dt) * 0.5;
    lastT = now;
    lastY = y;
    if (dy === 0) return;

    // Travel accrues while the finger keeps going one way and resets when it
    // turns, so a slow continuous drag still adds up to a flip while a pixel
    // of jitter cancels itself out.
    travel = (dy > 0) === (travel > 0) ? travel + dy : dy;

    if (y < 24) {
      if (chromeTucked) { chromeTucked = false; travel = 0; applyChrome(tuckDuration(vel)); }
      return;
    }
    if (travel > 28 && !chromeTucked && y > chromeH) {
      chromeTucked = true;
      travel = 0;
      applyChrome(tuckDuration(vel));
    } else if (travel < -16 && chromeTucked) {
      chromeTucked = false;
      travel = 0;
      applyChrome(tuckDuration(vel));
    }
  }
  scroller.addEventListener('scroll', onScroll, { passive: true });

  // ---------------------------------------------------------------- data
  async function load() {
    loading = true;
    paint();
    try {
      // A trip's kit is spread across every store it was fetched from, so
      // narrowing to one asks for the lot and filters in the browser.
      const data = await api.items(store.trip ? {} : { site: store.site });
      items = data.items;
    } catch (error) {
      toast(error.message, true);
      items = [];
    }
    loading = false;
    paint();
  }

  /**
   * The trips a piece of kit can be away with. Only the two middle stages: a
   * trip still taking requests holds nothing back, and a finished one has
   * handed everything in.
   */
  async function loadTrips() {
    try {
      const data = await api.trips();
      trips = data.trips.filter((trip) =>
        ['packing', 'active'].includes(trip.status));
      // Keep the app-wide toggle list current off the same fetch.
      store.trips = trips.map((trip) => ({
        id: trip.id, name: trip.name, destination: trip.destination,
        lat: trip.lat, lon: trip.lon, status: trip.status, n_items: trip.n_items,
      }));
      if (store.trip && !trips.some((t) => t.id === store.trip.id)) {
        setTrip(null); // the selected trip ended while the catalogue was open
      }
    } catch {
      trips = store.trips; // the boot-time snapshot is enough to draw the panel
    }
  }

  // ------------------------------------------------------------- filtering
  function bucketOf(item) {
    if (!item.faults.length) return 'none';
    return item.faults.some((f) => f.severity === 'out_of_action') ? 'major' : 'minor';
  }

  function matches(item) {
    if (state.type !== 'all' && item.component_type !== state.type) return false;
    if (!state.faults.has(bucketOf(item))) return false;
    // Narrowed to one trip, the list IS that trip's kit and nothing else.
    if (store.trip && item.away !== store.trip.name) return false;
    if (state.subs.size && !state.subs.has(item.raw_type)) return false;
    if (state.boxes.size && !state.boxes.has(item.box_type)) return false;
    if (state.diams.size && !state.diams.has(item.diameter)) return false;
    if (state.cams.size && !state.cams.has(item.cams ? 'Cammed' : 'Camless')) return false;
    if (state.lens.size && !state.lens.has(String(item.size_value))) return false;
    const needle = state.q.trim().toLowerCase();
    if (needle) {
      const hay = [item.manufacturer, item.model, item.raw_type, item.diameter,
                   item.site, item.spot, item.size_label].join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  }

  function sizeNumber(item) {
    if (item.size_value == null) return Infinity;
    const parsed = parseFloat(String(item.size_value));
    return Number.isNaN(parsed) ? Infinity : parsed;
  }

  function addedAt(item) {
    const when = stampDate(item.created_at);
    return when ? when.getTime() : 0;
  }

  /**
   * Where a piece sits on the rating sort. A fault outranks a missing rating
   * as a reason to sit low: nobody has looked at an unrated piece, but a
   * flagged one has been looked at and found wrong. So anything carrying an
   * open fault sorts below every unrated piece, which in turn sorts below one
   * star. (A red flag is sunk to the very bottom separately, in `shown`.)
   */
  function ratingRank(item) {
    if (bucketOf(item) !== 'none') return -2;
    if (!item.rating || !item.rating.n) return -1;
    return item.rating.stars || 0;
  }

  function compare(a, b) {
    switch (state.sort) {
      case 'rating':
        return ratingRank(a) - ratingRank(b);
      case 'size':
        return sizeNumber(a) - sizeNumber(b);
      case 'name':
        return fullName(a).localeCompare(fullName(b));
      case 'condition':
        return (CONDITION_RANK[String(a.condition || '').toLowerCase()] ?? -1)
             - (CONDITION_RANK[String(b.condition || '').toLowerCase()] ?? -1);
      case 'location':
        return String(a.site || '').localeCompare(String(b.site || ''));
      default: // 'added' — imported kit shares a stamp, so id breaks the tie
        return (addedAt(a) - addedAt(b)) || (a.id - b.id);
    }
  }

  function shown() {
    const rows = items.filter(matches);
    rows.sort((a, b) => {
      // A red-flagged piece always sinks to the bottom of the list, whatever
      // the sort — then the sort orders within each group.
      const majorA = bucketOf(a) === 'major';
      const majorB = bucketOf(b) === 'major';
      if (majorA !== majorB) return majorA ? 1 : -1;
      const d = compare(a, b);
      return state.dir === 'desc' ? -d : d;
    });
    return rows;
  }

  function activeFilterCount() {
    let n = 0;
    if (state.type !== 'all') n += 1;
    if (store.trip) n += 1;
    n += state.subs.size + state.boxes.size + state.diams.size
       + state.cams.size + state.lens.size;
    const faultsDefault = state.faults.size === DEFAULT_FAULTS.length
      && DEFAULT_FAULTS.every((k) => state.faults.has(k));
    if (!faultsDefault) n += 1;
    return n;
  }

  // ------------------------------------------------------------- painting
  function paint() {
    if (disposed) return;
    const rows = shown();

    root.querySelector('[data-sitelabel]').textContent = siteLabel();
    root.querySelectorAll('[data-chip]').forEach((chip) => {
      chip.classList.toggle('on', chip.getAttribute('data-chip') === state.type);
    });
    root.querySelectorAll('[data-view]').forEach((button) => {
      button.classList.toggle('on', button.getAttribute('data-view') === state.view);
    });
    root.querySelectorAll('[data-panel]').forEach((button) => {
      button.classList.toggle('on', button.getAttribute('data-panel') === state.panel);
    });

    const dot = root.querySelector('[data-fsdot]');
    const active = activeFilterCount();
    dot.hidden = active === 0;
    dot.textContent = active;

    paintCount(rows.length);

    const hint = root.querySelector('[data-selecthint]');
    hint.hidden = state.selecting || Boolean(localStorage.getItem(SELECT_HINT_KEY));

    // A fresh grid (a filter changed, a search) scrolls back to the top, so the
    // chrome belongs open again.
    chromeTucked = chromeTucked && scroller.scrollTop > 24;
    lastY = scroller.scrollTop;
    travel = 0;
    applyChrome(300);

    if (state.panel) {
      mount(root.querySelector('[data-panelcount]'), html`<b>${rows.length}</b> shown`);
    }

    if (loading) {
      mount(listNode, html`<div class="spinner"></div>`);
    } else if (!rows.length) {
      mount(listNode, emptyState());
    } else {
      const grid = state.view === 'grid';
      mount(listNode, html`
        <div class="${grid ? 'itemgrid' : 'itemlist'}">${rows.map((item) => tile(item, grid))}</div>`);
    }
    syncMoveBar();
  }

  /**
   * The selected-count reading in the middle of the control row. Pulled out of
   * paint() so a tap in select mode can refresh it on its own, without the
   * whole grid re-rendering underneath the tick that just animated.
   */
  function paintCount(count) {
    const node = root.querySelector('[data-count]');
    node.classList.toggle('sel', state.selecting);
    mount(node, countLabel(count == null ? shown().length : count, loading));
  }

  function countLabel(count, isLoading) {
    if (isLoading) return '';
    if (state.selecting) {
      return html`<b>${state.selected.size}</b> selected`;
    }
    if (state.type === 'all') {
      return html`<b>${count}</b> ${count === 1 ? 'piece' : 'pieces'}`;
    }
    const type = store.types.find((t) => t.key === state.type);
    let noun = `${(type ? type.label : 'piece').toLowerCase()}${count === 1 ? '' : 's'}`;
    if (state.subs.size === 1) noun = `${[...state.subs][0].toLowerCase()} ${noun}`;
    return html`<b>${count}</b> ${noun}`;
  }

  function moveBtnLabel() {
    const n = state.selected.size;
    return n ? `Move ${n} ${n === 1 ? 'piece' : 'pieces'}` : 'Tap kit to select';
  }

  /**
   * The move bar rides in a slot outside the scrolling body, so it can slide in
   * and out on its own without the grid reflowing. It is idempotent like the
   * trip screen's pack bar: the first time selecting turns on it mounts and
   * rises, every repaint after that only re-labels the button, and turning
   * selecting off sinks it and clears the slot a beat later.
   */
  function syncMoveBar() {
    const slot = root.querySelector('[data-movebar]');
    const bar = slot.firstElementChild;

    if (state.selecting && !bar) {
      mount(slot, html`
        <div class="actionbar">
          <div class="selrow">
            <button class="bigbtn ${state.selected.size ? '' : 'mute'}" data-move>${moveBtnLabel()}</button>
            <button class="donebtn" data-doneselect>Done</button>
          </div>
        </div>`);
      if (!reduceMotion) slot.firstElementChild.classList.add('rise');
      slot.querySelector('[data-move]').addEventListener('click', moveSelected);
      slot.querySelector('[data-doneselect]').addEventListener('click', exitSelect);
      return;
    }

    if (state.selecting && bar) {
      bar.classList.remove('sink'); // a fast off→on caught it mid-exit
      const btn = bar.querySelector('[data-move]');
      btn.classList.toggle('mute', !state.selected.size);
      btn.textContent = moveBtnLabel();
      return;
    }

    if (bar) {
      if (reduceMotion) { slot.innerHTML = ''; return; }
      bar.classList.remove('rise');
      bar.classList.add('sink');
      setTimeout(() => { if (!disposed && !state.selecting) slot.innerHTML = ''; }, 220);
    }
  }

  // ----------------------------------------------------------- the panel
  function renderPanelBody() {
    mount(panelBody, panelSections());
  }

  function poolOf(type) {
    return type === 'all' ? items : items.filter((i) => i.component_type === type);
  }

  function distinct(type, field) {
    const seen = [];
    poolOf(type).forEach((item) => {
      const value = item[field];
      if (value != null && value !== '' && !seen.includes(value)) seen.push(value);
    });
    return seen;
  }

  function orderedSubtypes(type) {
    const found = distinct(type, 'raw_type');
    const order = SUBTYPE_ORDER[type] || [];
    return [...order.filter((t) => found.includes(t)),
            ...found.filter((t) => !order.includes(t))];
  }

  function optButton(setName, value, label, tone = '') {
    const on = state[setName].has(value) ? 'on' : '';
    return html`<button class="fpopt ${tone} ${on}"
      data-fpset="${setName}" data-fpval="${value}">${label}</button>`;
  }

  function fpSection(label, options) {
    if (!options || !options.length) return '';
    return html`
      <div class="fpsect">
        <div class="fplab">${label}</div>
        <div class="fpopts">${options}</div>
      </div>`;
  }

  function contextSections() {
    const type = state.type;
    const wanted = CONTEXT[type] || [];
    const out = [];

    if (wanted.includes('sub')) {
      const subs = orderedSubtypes(type);
      out.push(fpSection(type === 'misc' ? 'Category' : 'Subtype',
        subs.map((s) => optButton('subs', s, s))));
    }
    if (wanted.includes('cams')) {
      const pool = poolOf('sail');
      const opts = [];
      if (pool.some((i) => i.cams)) opts.push(optButton('cams', 'Cammed', 'Cammed'));
      if (pool.some((i) => !i.cams)) opts.push(optButton('cams', 'Camless', 'Camless'));
      out.push(fpSection('Cams', opts));
    }
    if (wanted.includes('diam')) {
      const diams = distinct(type, 'diameter');
      out.push(fpSection('Diameter', diams.map((d) => optButton('diams', d, d))));
    }
    if (wanted.includes('box')) {
      const boxes = distinct(type, 'box_type');
      out.push(fpSection('Box type', boxes.map((b) => optButton('boxes', b, b))));
    }
    if (wanted.includes('length')) {
      const lengths = distinct(type, 'size_value')
        .map(Number).filter((n) => !Number.isNaN(n))
        .sort((a, b) => a - b);
      out.push(fpSection('Length',
        lengths.map((n) => optButton('lens', String(n), `${n} cm`))));
    }
    return out;
  }

  function panelSections() {
    return html`
      <div class="fpsect">
        <div class="fplab">Type</div>
        <div class="fpopts">
          <button class="fpopt ${state.type === 'all' ? 'on' : ''}" data-fptype="all">All</button>
          ${store.types.map((type) => html`
            <button class="fpopt ${state.type === type.key ? 'on' : ''}"
              data-fptype="${type.key}">${type.label}s</button>`)}
        </div>
      </div>
      ${contextSections()}
      <div class="fpsect">
        <div class="fplab">Faults</div>
        <div class="fpopts">
          <button class="fpopt ${state.faults.has('none') ? 'on' : ''}" data-fpfault="none">No faults</button>
          <button class="fpopt amber ${state.faults.has('minor') ? 'on' : ''}" data-fpfault="minor">Minor faults</button>
          <button class="fpopt red ${state.faults.has('major') ? 'on' : ''}" data-fpfault="major">Major faults</button>
        </div>
      </div>
      <div class="fpsect" data-sortsect>
        <div class="fplab">Sort by</div>
        <div class="fpopts">
          ${SORTS.map((s) => html`
            <button class="fpopt ${state.sort === s.key ? 'on' : ''}" data-fpsort="${s.key}">${s.label}</button>`)}
        </div>
      </div>
      <div class="fpsect">
        <div class="fplab">Sort order</div>
        <div class="fpopts">
          <button class="fpopt wide ${state.dir === 'asc' ? 'on' : ''}" data-fpdir="asc">Ascending</button>
          <button class="fpopt wide ${state.dir === 'desc' ? 'on' : ''}" data-fpdir="desc">Descending</button>
        </div>
      </div>`;
  }

  /**
   * Opening and closing the panel must not touch the grid — it hasn't changed,
   * and re-rendering it here is what used to jump the page as the sheet slid.
   * So these use `refreshCounts()` (labels only), never `paint()`.
   */
  function refreshCounts() {
    const rows = shown();
    root.querySelectorAll('[data-panel]').forEach((button) => {
      button.classList.toggle('on', button.getAttribute('data-panel') === state.panel);
    });
    const dot = root.querySelector('[data-fsdot]');
    const active = activeFilterCount();
    dot.hidden = active === 0;
    dot.textContent = active;
    mount(root.querySelector('[data-count]'), countLabel(rows.length, loading));
    if (state.panel) {
      mount(root.querySelector('[data-panelcount]'), html`<b>${rows.length}</b> shown`);
    }
  }

  // Both icons do exactly the same thing — open the one panel at its top. (An
  // earlier version scrolled to the Sort section for the sort icon; the
  // scrollIntoView nudged the whole screen and made the app bar flicker.)
  function openPanel() {
    state.panel = true;
    renderPanelBody();
    panelSearch.value = state.q;
    panelSheet.style.transition = '';
    panelSheet.style.transform = '';
    panelRoot.hidden = false;
    void panelSheet.offsetHeight; // commit the closed transform before animating open
    requestAnimationFrame(() => panelRoot.classList.add('open'));
    applyChrome(0); // chrome straight to its panel-open state, out of sight behind the sheet
    refreshCounts();
  }

  function closePanel() {
    if (!state.panel) return;
    state.panel = null;
    panelRoot.classList.remove('open');
    // Drive the sheet down explicitly from wherever a drag left it, on an
    // accelerating curve so it clears the screen cleanly instead of dawdling
    // the last few pixels over the tab bar.
    panelSheet.style.transition = 'transform .2s cubic-bezier(.4, 0, 1, 1)';
    requestAnimationFrame(() => { panelSheet.style.transform = 'translateY(101%)'; });
    let settled = false;
    const finish = (event) => {
      if (settled || (event && (event.target !== panelSheet || event.propertyName !== 'transform'))) return;
      settled = true;
      panelRoot.hidden = true;
      panelSheet.style.transition = '';
      panelSheet.style.transform = '';
      panelSheet.removeEventListener('transitionend', finish);
    };
    panelSheet.addEventListener('transitionend', finish);
    setTimeout(finish, 300);
    applyChrome(0);
    refreshCounts();
  }

  function resetFilters() {
    const wasTrip = Boolean(store.trip);
    state.type = 'all';
    clearContextFilters();
    state.faults = new Set(DEFAULT_FAULTS);
    state.sort = 'added';
    state.dir = 'desc';
    state.q = '';
    localStorage.setItem(SORT_KEY, 'added');
    localStorage.setItem(DIR_KEY, 'desc');
    mainSearch.value = '';
    panelSearch.value = '';
    root.querySelector('.appbar .searchbar').classList.remove('filled');
    renderPanelBody();
    // Coming out of a trip is a different set of rows, so the subscribe handler
    // takes the reload; otherwise a repaint is enough.
    if (wasTrip) setTrip(null);
    else paint();
  }

  // ------------------------------------------------------------ selecting
  function enterSelect(id) {
    state.selecting = true;
    state.selected.add(id);
    localStorage.setItem(SELECT_HINT_KEY, '1');
    haptic(PICK);
    paint();
  }

  function exitSelect() {
    state.selecting = false;
    state.selected.clear();
    paint();
  }

  function openItem(id, card) {
    if (state.selecting) {
      const on = !state.selected.has(id);
      if (on) state.selected.add(id);
      else state.selected.delete(id);
      applyTick(card, on);
      paintCount();
      syncMoveBar();
      haptic(PICK);
      return;
    }
    go(`/item/${id}`);
  }

  /**
   * Tick or untick one card in place, so the fill animates and nothing else on
   * the screen moves. Ported from the trip checklist: list view rides the
   * `.picked` class the CSS keys the box fill off; grid view carries a tick
   * disc in the corner, added or removed here. The `.pop` is held back under
   * reduced motion.
   */
  function applyTick(card, on) {
    if (!card) return;
    card.classList.toggle('picked', on);
    let mark = card.querySelector('.tickdisc') || card.querySelector('.selbox');
    if (state.view === 'grid') {
      const disc = card.querySelector('.tickdisc');
      if (on && !disc) {
        card.querySelector('.shot')?.insertAdjacentHTML('beforeend',
          toHtml(html`<span class="tickdisc" aria-hidden="true">${icon('tick')}</span>`));
        mark = card.querySelector('.tickdisc');
      } else if (!on && disc) {
        disc.remove();
        mark = null;
      }
    }
    if (on && mark && !reduceMotion) {
      mark.classList.add('pop');
      mark.addEventListener('animationend', () => mark.classList.remove('pop'), { once: true });
    }
  }

  async function moveSelected() {
    if (!state.selected.size) return;
    if (!(await needCommittee('Moving kit is a committee action.'))) return;

    const ids = [...state.selected];
    const n = ids.length;
    const piece = (k) => `${k} ${k === 1 ? 'piece' : 'pieces'}`;

    // Every trip that has not finished is a place kit can be going. A request
    // reserves nothing, but "add it to a trip" is still the honest way to say a
    // board is spoken for by the Cheddar Saturday crowd.
    let dests = [];
    try {
      dests = (await api.trips()).trips
        .filter((t) => !['done', 'cancelled'].includes(t.status));
    } catch {
      dests = trips; // the packing/active snapshot is enough to draw the list
    }
    const tripSub = (t) => (t.status === 'active' ? 'Out on the water now'
      : t.status === 'packing' ? 'Packing now' : 'Taking requests');

    const target = await chooser({
      title: `Move ${piece(n)}`,
      sub: 'A site overwrites where the kit lives. Adding it to a trip just '
         + 'marks it going: the kit stays on its rack.',
      rows: [
        ...store.sites.map((site) => ({
          value: `site:${site.name}`, label: site.name,
          sub: `${site.n_items} pieces now`, avatar: icon('pin'),
        })),
        { value: '__new', label: 'A new location', sub: 'Add it to the club list', avatar: icon('plus') },
        ...dests.map((t) => ({
          value: `trip:${t.id}`, label: t.name, sub: tripSub(t), avatar: icon('flag'),
        })),
        { value: 'newtrip', label: 'Add to a new trip', sub: 'Start one with this kit on it', avatar: icon('plus') },
      ],
    });
    if (!target) return;

    if (target === 'newtrip') {
      go(`/newtrip?kit=${ids.join(',')}`);
      return;
    }

    if (target.startsWith('trip:')) {
      const tripId = Number(target.slice(5));
      const byId = new Map(items.map((i) => [i.id, i]));
      try {
        await api.addTripItems(tripId, ids.map((iid) => ({
          item_id: iid,
          role: (byId.get(iid) || {}).rig_kind || null,
          source: 'chosen',
        })));
        const t = dests.find((x) => x.id === tripId);
        toast(`Added ${piece(n)} to ${t ? t.name : 'the trip'}.`);
        state.selected.clear();
        state.selecting = false;
        await Promise.all([load(), loadTrips()]);
      } catch (error) {
        toast(error.message, true);
      }
      return;
    }

    let site = target === '__new' ? '' : target.slice(5);
    let spot = '';
    if (target === '__new') {
      const values = await formSheet({
        title: 'New location',
        sub: 'Committee keeps this list, so the catalogue filter stays clean.',
        fields: [
          { name: 'site', label: 'Site name', required: true, placeholder: 'Nottingham' },
          { name: 'spot', label: 'Spot within it (optional)', placeholder: 'van' },
        ],
        submitLabel: 'Move here',
      });
      if (!values) return;
      site = values.site;
      spot = values.spot;
    } else {
      const values = await formSheet({
        title: `Move to ${site}`,
        sub: 'A spot is optional. After a trip, kit often needs its fine spot re-setting.',
        fields: [{ name: 'spot', label: 'Spot within the site', placeholder: 'wooden rack' }],
        submitLabel: 'Move',
      });
      if (!values) return;
      spot = values.spot;
    }

    try {
      const result = await api.moveItems(ids, site, spot);
      store.sites = result.sites;
      toast(`Moved ${piece(result.moved)} to ${site}.`);
      state.selected.clear();
      state.selecting = false;
      await load();
    } catch (error) {
      toast(error.message, true);
    }
  }

  // ---------------------------------------------------------------- events
  // The pill just sets the app-wide location; the subscribe handler below is
  // what notices the change and reloads, so a pick from here and a pick from
  // anywhere else behave the same.
  root.querySelector('[data-pick-site]').addEventListener('click', () => pickSite());

  const syncSearch = (value) => {
    state.q = value;
    mainSearch.value = value;
    panelSearch.value = value;
    root.querySelector('.appbar .searchbar').classList.toggle('filled', Boolean(value));
    paint();
  };
  mainSearch.addEventListener('input', () => syncSearch(mainSearch.value));
  panelSearch.addEventListener('input', () => syncSearch(panelSearch.value));
  root.querySelector('[data-clear]').addEventListener('click', () => syncSearch(''));

  onClick(root, 'data-chip', (value) => {
    state.type = value;
    clearContextFilters();
    if (state.panel) renderPanelBody();
    paint();
  });

  onClick(root, 'data-view', (value) => {
    state.view = value;
    localStorage.setItem(VIEW_KEY, value);
    paint();
  });

  // Filter and Sort are one panel; once it is open it covers them both, so the
  // same tap is a request to close.
  onClick(root, 'data-panel', () => {
    if (state.panel) closePanel();
    else openPanel();
  });
  onClick(root, 'data-panelclose', () => closePanel());
  root.querySelector('[data-paneldone]').addEventListener('click', closePanel);
  root.querySelector('[data-panelreset]').addEventListener('click', resetFilters);

  // Drag anywhere on the panel's top section — the handle or the search row —
  // downward to dismiss it. The pointer is captured on touchdown so the browser
  // can't reclaim the gesture mid-pull; a press that never really moves is
  // treated as a tap and (since the capture ate the native focus) the search
  // field is focused by hand.
  const panelSheet = root.querySelector('[data-panelsheet]');
  const grabZone = root.querySelector('[data-panelgrab]');
  let sheetDrag = null;
  grabZone.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    sheetDrag = {
      id: event.pointerId,
      y: event.clientY,
      dy: 0,
      moved: false,
      onInput: Boolean(event.target.closest('[data-panelsearch]')),
    };
    try { grabZone.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    panelSheet.style.transition = 'none';
  });
  grabZone.addEventListener('pointermove', (event) => {
    if (!sheetDrag || event.pointerId !== sheetDrag.id) return;
    const dy = Math.max(0, event.clientY - sheetDrag.y);
    if (dy > 3) sheetDrag.moved = true;
    sheetDrag.dy = dy;
    panelSheet.style.transform = `translateY(${dy}px)`;
    if (event.cancelable) event.preventDefault();
  }, { passive: false });
  const endSheetDrag = (event) => {
    if (!sheetDrag || event.pointerId !== sheetDrag.id) return;
    const drag = sheetDrag;
    sheetDrag = null;
    if (drag.dy > 88) {
      closePanel();
      return;
    }
    // Not far enough: ride the sheet back up, then either honour the tap on the
    // search field or leave it be.
    panelSheet.style.transition = 'transform .18s ease';
    panelSheet.style.transform = 'translateY(0)';
    if (!drag.moved && drag.onInput) panelSearch.focus();
  };
  grabZone.addEventListener('pointerup', endSheetDrag);
  grabZone.addEventListener('pointercancel', endSheetDrag);

  onClick(root, 'data-fptype', (value) => {
    state.type = state.type === value ? 'all' : value;
    clearContextFilters();
    renderPanelBody();
    paint();
  });
  onClick(root, 'data-fpset', (setName, node) => {
    const value = node.getAttribute('data-fpval');
    const set = state[setName];
    if (set.has(value)) set.delete(value);
    else set.add(value);
    node.classList.toggle('on');
    paint();
  });
  onClick(root, 'data-fpfault', (value, node) => {
    if (state.faults.has(value)) {
      if (state.faults.size === 1) return; // one bucket must always be on
      state.faults.delete(value);
      node.classList.remove('on');
    } else {
      state.faults.add(value);
      node.classList.add('on');
    }
    paint();
  });
  onClick(root, 'data-fpsort', (value) => {
    state.sort = value;
    localStorage.setItem(SORT_KEY, value);
    panelBody.querySelectorAll('[data-fpsort]').forEach((button) => {
      button.classList.toggle('on', button.getAttribute('data-fpsort') === value);
    });
    paint();
  });
  onClick(root, 'data-fpdir', (value) => {
    state.dir = value;
    localStorage.setItem(DIR_KEY, value);
    panelBody.querySelectorAll('[data-fpdir]').forEach((button) => {
      button.classList.toggle('on', button.getAttribute('data-fpdir') === value);
    });
    paint();
  });

  // Long-press a tile to start selecting kit for a trip. A press that turns
  // into a scroll, or lifts early, is just a tap and opens the item.
  on(root, 'pointerdown', '[data-item]', (event, node) => {
    suppressClick = false;
    if (state.selecting || press) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const id = Number(node.getAttribute('data-item'));
    press = { x: event.clientX, y: event.clientY };
    press.timer = setTimeout(() => {
      press = null;
      suppressClick = true;
      enterSelect(id);
    }, 420);
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

  /**
   * The fault flag is readable where it is flagged, the same as Build's: a
   * member weighing up two boards should not have to leave the list to find
   * out what "Fault" means.
   */
  onClick(root, 'data-flag', (value, _node, event) => {
    event.stopImmediatePropagation();
    const item = items.find((i) => i.id === Number(value));
    faultPopup(item ? item.faults : []);
  });

  // The fault chip lives inside the tile, so anything aimed at it is a
  // question about the item rather than a tap on the item itself.
  const onFlag = (event) => Boolean(event.target.closest('[data-flag]'));

  onClick(root, 'data-item', (value, node, event) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (!onFlag(event)) openItem(Number(value), node);
  });
  on(root, 'keydown', '[data-item]', (event, node) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (onFlag(event)) return;
    event.preventDefault();
    openItem(Number(node.getAttribute('data-item')), node);
  });

  // The location (a site or a trip) is app-wide, so a change to it — from this
  // screen's pill, its filter panel, or anywhere else — lands here. The label
  // always follows; a real change of place also reloads the grid and re-renders
  // the panel body so its "on" states are right.
  let locKey = store.trip ? `t${store.trip.id}` : store.site;
  const unsubscribe = subscribe(() => {
    const label = root.querySelector('[data-sitelabel]');
    if (label) label.textContent = siteLabel();
    const next = store.trip ? `t${store.trip.id}` : store.site;
    if (next === locKey) return;
    locKey = next;
    if (state.panel) renderPanelBody();
    load();
  });
  // The app opens here, so this is where signing in has to be reachable.
  const unwire = wireWhoPill(root, openIdentity, { compact: true });

  await Promise.all([load(), loadTrips()]);
  return () => {
    disposed = true;
    if (press) clearTimeout(press.timer);
    scroller.removeEventListener('scroll', onScroll);
    unsubscribe();
    unwire();
  };
}

// ------------------------------------------------------------------ markup
function shell() {
  return html`
    <div class="appbar">
      <div class="row">
        <span class="brand">
          <img class="mark" src="/assets/logo.png" alt="">
          <span class="wm"><b>UBWC Kit</b><span>Inventory</span></span>
        </span>
        <button class="sitebtn" data-pick-site>
          ${icon('pin')}<span class="nm" data-sitelabel>${siteLabel()}</span>
          <span class="caret">${icon('chevronDown')}</span>
        </button>
        <span data-who></span>
      </div>
      <label class="searchbar">
        ${icon('search')}
        <input type="search" data-search placeholder="Search kit…" aria-label="Search kit">
        <button class="clearbtn" data-clear aria-label="Clear search">${icon('close')}</button>
      </label>
    </div>

    <div class="selecthint" data-selecthint hidden>
      Hold a piece to pick several, to move them somewhere else.
    </div>

    <div class="body" data-scroll>
      <div class="catchrome" data-catchrome>
        <div class="chips">
          <button class="chip on" data-chip="all">All</button>
          ${store.types.map((type) => html`
            <button class="chip" data-chip="${type.key}">${type.label}s</button>`)}
        </div>

        <div class="subbar">
          <div class="viewtoggle fsbtn">
            <button data-panel="filter" aria-label="Filter kit">${icon('filter')}</button>
            <button data-panel="sort" aria-label="Sort kit">${icon('sortArrows')}</button>
            <span class="fsdot" data-fsdot hidden>0</span>
          </div>
          <span class="count" data-count></span>
          <div class="viewtoggle">
            <button data-view="grid" aria-label="Grid view">${icon('gridIcon')}</button>
            <button data-view="list" aria-label="List view">${icon('listIcon')}</button>
          </div>
        </div>
      </div>

      <div data-list></div>
    </div>
    <div data-movebar></div>

    <div class="filterpanel" data-panelroot hidden>
      <div class="fp-scrim" data-panelclose></div>
      <div class="fp-sheet" data-panelsheet role="dialog" aria-label="Filter and sort">
        <div class="fp-top" data-panelgrab>
          <div class="fp-grab" aria-hidden="true"></div>
          <div class="fp-head">
            <label class="searchbar">
              ${icon('search')}
              <input type="search" data-panelsearch placeholder="Search kit…" aria-label="Search kit">
            </label>
          </div>
        </div>
        <div class="fp-body" data-panelbody></div>
        <div class="fp-foot">
          <button class="fp-reset" data-panelreset>Reset</button>
          <span class="fp-count" data-panelcount></span>
          <button class="fp-done" data-paneldone>Done</button>
        </div>
      </div>
    </div>`;
}

function emptyState() {
  const onlyClean = state.faults.size === 1 && state.faults.has('none');
  return html`
    <div class="emptystate">
      ${icon('box')}
      <b>Nothing here</b>
      <span>${state.q
        ? `No kit matches "${state.q}" with these filters.`
        : onlyClean
        ? `Everything of this kind has a fault. Tick a fault filter to see it.`
        : `No kit matches these filters at ${siteLabel().toLowerCase()}.`}</span>
    </div>`;
}

/**
 * The tile is the shared one (js/ui/itemTile.js). Out of select mode it is the
 * plain catalogue tile plus the grey "Out" chip for kit away with a trip. In
 * select mode it borrows the trip checklist's dressing: a tick (a disc in grid,
 * a filling box in list) and, in list, the fault as a bubble on the thumb so
 * the tick has the corner. The stars stay where the catalogue keeps them —
 * `place` is a trip idea and is never passed here.
 */
function tile(item, grid) {
  const picked = state.selected.has(item.id);
  return cardTile(item, grid, {
    // Inside a trip's own kit the chip says nothing: everything there is out.
    out: store.trip ? null : (item.away || null),
    ...(state.selecting
      ? { checked: picked, checkable: !picked, dotFault: !grid }
      : {}),
  });
}
