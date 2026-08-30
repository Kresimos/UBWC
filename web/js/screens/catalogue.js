/**
 * Catalogue — browse the kit like a windsurf shop.
 *
 * The tile is deliberately quiet: a product shot, the size, the name and the
 * derived star score. Everything else a member might want lives one tap away
 * on the item page, so a screenful of kit stays scannable. It's the same
 * tile Build picks from (js/ui/itemTile.js) — a scuffed board should read
 * the same wherever a member is choosing from a shelf of them.
 *
 * Out-of-action kit is not hidden here — this is the inventory, and knowing a
 * board is broken is the point — but it sorts to the bottom and carries a red
 * flag. Hiding is the rig picker's job, not the catalogue's.
 */
import { html, mount, num, numFixed, onClick, on } from '../dom.js';
import { icon, artFor } from '../icons.js';
import { api } from '../api.js';
import { store, siteLabel, subscribe } from '../store.js';
import { worstFault, fullName, sitePill, wireWhoPill } from '../ui/bits.js';
import { itemTile, faultPopup } from '../ui/itemTile.js';
import { pickSite, needCommittee, openIdentity } from '../ui/chrome.js';
import { chooser, formSheet, toast } from '../ui/overlay.js';
import { go } from '../router.js';

const VIEW_KEY = 'ubwc.view';

const state = {
  type: 'all',
  // 'all' | 'faulty' | 'clean'. Deliberately not persisted like `view` is: a
  // sticky "no faults" filter would silently hide broken kit next session.
  fault: 'all',
  q: '',
  view: localStorage.getItem(VIEW_KEY) || 'grid',
  selecting: false,
  selected: new Set(),
};

export async function render(root) {
  state.selecting = false;
  state.selected.clear();

  mount(root, shell());
  const listNode = root.querySelector('[data-list]');
  const searchInput = root.querySelector('[data-search]');

  let items = [];
  let loading = false;

  async function load() {
    loading = true;
    paint();
    try {
      const data = await api.items({ type: state.type, site: store.site, q: state.q });
      items = data.items;
    } catch (error) {
      toast(error.message, true);
      items = [];
    }
    loading = false;
    paint();
  }

  function paint() {
    // Fault filtering happens here, not on the server: every card already
    // carries its open faults and the catalogue loads everything, so this is
    // an array predicate over data in memory. Open faults only — a cleared
    // fault should not mark a piece as faulty.
    const shown = state.fault === 'all' ? items
      : items.filter((i) => (i.faults.length > 0) === (state.fault === 'faulty'));

    root.querySelector('[data-sitelabel]').textContent = siteLabel();
    root.querySelectorAll('[data-chip]').forEach((chip) => {
      chip.classList.toggle('on', chip.getAttribute('data-chip') === state.type);
    });
    root.querySelectorAll('[data-view]').forEach((button) => {
      button.classList.toggle('on', button.getAttribute('data-view') === state.view);
    });
    root.querySelectorAll('[data-fault]').forEach((button) => {
      button.classList.toggle('on', button.getAttribute('data-fault') === state.fault);
    });
    root.querySelector('[data-count]').innerHTML = countLabel(shown.length, loading);
    root.querySelector('[data-select]').textContent = state.selecting ? 'Done' : 'Select';
    root.querySelector('.searchbar').classList.toggle('filled', Boolean(state.q));

    if (loading) {
      mount(listNode, html`<div class="spinner"></div>`);
    } else if (!shown.length) {
      mount(listNode, emptyState());
    } else {
      const grid = state.view === 'grid';
      mount(listNode, html`
        <div class="${grid ? 'itemgrid' : 'itemlist'}">${shown.map((item) => tile(item, grid))}</div>`);
    }
    paintMoveBar();
  }

  function paintMoveBar() {
    const slot = root.querySelector('[data-movebar]');
    if (!state.selecting) {
      slot.innerHTML = '';
      return;
    }
    const count = state.selected.size;
    mount(slot, html`
      <div class="actionbar">
        <button class="bigbtn ${count ? '' : 'mute'}" data-move>
          ${icon('move')}${count ? `Move ${count} ${count === 1 ? 'piece' : 'pieces'}` : 'Select kit to move'}
        </button>
        <span class="helper">Packing a trip is moving kit to that location. Returning is moving it back.</span>
      </div>`);
    slot.querySelector('[data-move]').addEventListener('click', moveSelected);
  }

  async function moveSelected() {
    if (!state.selected.size) return;
    if (!(await needCommittee('Moving kit is a committee action.'))) return;

    const target = await chooser({
      title: `Move ${state.selected.size} ${state.selected.size === 1 ? 'piece' : 'pieces'}`,
      sub: 'Moving overwrites where the kit lives. A trip is just a location kit was moved to.',
      rows: [
        ...store.sites.map((site) => ({ value: site.name, label: site.name, sub: `${site.n_items} pieces now` })),
        { value: '__new', label: 'A new location', sub: 'Add it to the club list' },
      ],
    });
    if (!target) return;

    let site = target;
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
      const result = await api.moveItems([...state.selected], site, spot);
      store.sites = result.sites;
      toast(`Moved ${result.moved} ${result.moved === 1 ? 'piece' : 'pieces'} to ${site}.`);
      state.selected.clear();
      state.selecting = false;
      await load();
    } catch (error) {
      toast(error.message, true);
    }
  }

  // ---------------------------------------------------------------- events
  root.querySelector('[data-pick-site]').addEventListener('click', async () => {
    if (await pickSite()) load();
  });

  let typingTimer = null;
  searchInput.addEventListener('input', () => {
    state.q = searchInput.value;
    root.querySelector('.searchbar').classList.toggle('filled', Boolean(state.q));
    clearTimeout(typingTimer);
    typingTimer = setTimeout(load, 180);
  });
  root.querySelector('[data-clear]').addEventListener('click', () => {
    searchInput.value = '';
    state.q = '';
    load();
  });

  onClick(root, 'data-chip', (value) => {
    state.type = value;
    load();
  });
  onClick(root, 'data-view', (value) => {
    state.view = value;
    localStorage.setItem(VIEW_KEY, value);
    paint();
  });
  // Pressing the active one again returns to all. paint() only, never load():
  // nothing needs refetching.
  onClick(root, 'data-fault', (value) => {
    state.fault = state.fault === value ? 'all' : value;
    paint();
  });
  root.querySelector('[data-select]').addEventListener('click', () => {
    state.selecting = !state.selecting;
    state.selected.clear();
    paint();
  });
  /**
   * The fault flag is readable where it is flagged, the same as Build's: a
   * member weighing up two boards should not have to leave the list to find
   * out what "Fault" means.
   */
  // `data-flag`, not `data-fault`: the subbar's fault filter already owns that
  // name on this same root, and a delegated handler cannot tell a chip on a
  // tile from a button in the subbar once they share an attribute.
  onClick(root, 'data-flag', (value, _node, event) => {
    // Both handlers are delegated from the same root, so stopPropagation is
    // not enough - see onFlag below for why a fault tap must not also open
    // the item it is a fault on.
    event.stopImmediatePropagation();
    const item = items.find((i) => i.id === Number(value));
    faultPopup(item ? item.faults : []);
  });

  // The fault chip lives inside the tile, so anything aimed at it is a
  // question about the item rather than a tap on the item itself.
  const onFlag = (event) => Boolean(event.target.closest('[data-flag]'));

  function openItem(id) {
    if (state.selecting) {
      if (state.selected.has(id)) state.selected.delete(id);
      else state.selected.add(id);
      paint();
      return;
    }
    go(`/item/${id}`);
  }
  onClick(root, 'data-item', (value, _node, event) => {
    if (!onFlag(event)) openItem(Number(value));
  });
  on(root, 'keydown', '[data-item]', (event, node) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (onFlag(event)) return;
    event.preventDefault();
    openItem(Number(node.getAttribute('data-item')));
  });

  const unsubscribe = subscribe(() => {
    const label = root.querySelector('[data-sitelabel]');
    if (label) label.textContent = siteLabel();
  });
  // The app opens here, so this is where signing in has to be reachable.
  const unwire = wireWhoPill(root, openIdentity, { compact: true });

  await load();
  return () => { unsubscribe(); unwire(); clearTimeout(typingTimer); };
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

    <div class="chips">
      <button class="chip on" data-chip="all">All</button>
      ${store.types.map((type) => html`
        <button class="chip" data-chip="${type.key}">${type.label}s</button>`)}
    </div>

    <div class="subbar">
      <span class="count" data-count></span>
      <button class="selbtn" data-select>Select</button>
      <div class="viewtoggle">
        <button data-fault="faulty" aria-label="Show only kit with a fault">${icon('warning')}</button>
        <button data-fault="clean" aria-label="Hide kit with a fault">${icon('tick')}</button>
      </div>
      <div class="viewtoggle">
        <button data-view="grid" aria-label="Grid view">${icon('gridIcon')}</button>
        <button data-view="list" aria-label="List view">${icon('listIcon')}</button>
      </div>
    </div>

    <div class="body" data-list></div>
    <div data-movebar></div>`;
}

function countLabel(count, loading) {
  if (loading) return '';
  const type = store.types.find((t) => t.key === state.type);
  const noun = type ? `${type.label.toLowerCase()}${count === 1 ? '' : 's'}` : `${count === 1 ? 'piece' : 'pieces'}`;
  return `<b>${count}</b> ${noun}`;
}

function emptyState() {
  return html`
    <div class="emptystate">
      ${icon('box')}
      <b>Nothing here</b>
      <span>${state.fault === 'faulty'
        ? `Nothing here has an open fault.`
        : state.fault === 'clean'
        ? `Everything here has an open fault.`
        : state.q
        ? `No kit matches "${state.q}" at ${siteLabel().toLowerCase()}.`
        : `No kit of this type is recorded at ${siteLabel().toLowerCase()}.`}</span>
    </div>`;
}

function tile(item, grid) {
  return itemTile({
    grid,
    pickAttr: 'item',
    id: item.id,
    art: item.image_path
      ? html`<img src="${item.image_path}" alt="">`
      : artFor(item.rig_kind || item.component_type),
    size: item.size_value != null
      ? { value: item.component_type === 'sail' ? numFixed(item.size_value) : num(item.size_value),
          unit: item.size_unit }
      : { label: item.size_label },
    name: fullName(item),
    type: item.type,
    rating: item.rating.n ? { stars: item.rating.stars, n: item.rating.n } : null,
    fault: worstFault(item.faults),
    saved: item.favourite,
    faultNoun: item.type,
    picked: state.selected.has(item.id),
    selecting: state.selecting,
  });
}
