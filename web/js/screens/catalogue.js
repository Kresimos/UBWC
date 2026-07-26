/**
 * Catalogue — browse the kit like a windsurf shop.
 *
 * The tile is deliberately quiet: a product shot, the size, the name, the
 * condition and the derived star score. Everything else a member might want
 * lives one tap away on the item page, so a screenful of kit stays scannable.
 *
 * Out-of-action kit is not hidden here — this is the inventory, and knowing a
 * board is broken is the point — but it sorts to the bottom and carries a red
 * flag. Hiding is the rig picker's job, not the catalogue's.
 */
import { html, mount, num, onClick } from '../dom.js';
import { icon, artFor } from '../icons.js';
import { api } from '../api.js';
import { store, siteLabel, subscribe, isCommittee } from '../store.js';
import { conditionClass, worstFault, sitePill } from '../ui/bits.js';
import { pickSite, needCommittee } from '../ui/chrome.js';
import { chooser, formSheet, toast } from '../ui/overlay.js';
import { go } from '../router.js';

const VIEW_KEY = 'ubwc.view';

const state = {
  type: 'all',
  q: '',
  view: localStorage.getItem(VIEW_KEY) || 'grid',
  selecting: false,
  selected: new Set(),
  archived: false,
};

export async function render(root) {
  state.selecting = false;
  state.selected.clear();
  state.archived = false;

  mount(root, shell());
  const listNode = root.querySelector('[data-list]');
  const searchInput = root.querySelector('[data-search]');

  let items = [];
  let loading = false;

  async function load() {
    loading = true;
    paint();
    try {
      const data = await api.items({
        type: state.type, site: store.site, q: state.q,
        archived: state.archived || undefined,
      });
      items = data.items;
    } catch (error) {
      toast(error.message, true);
      items = [];
    }
    loading = false;
    paint();
  }

  function paint() {
    root.querySelector('[data-sitelabel]').textContent = siteLabel();
    root.querySelectorAll('[data-chip]').forEach((chip) => {
      chip.classList.toggle('on', chip.getAttribute('data-chip') === state.type);
    });
    root.querySelectorAll('[data-view]').forEach((button) => {
      button.classList.toggle('on', button.getAttribute('data-view') === state.view);
    });
    root.querySelector('[data-count]').innerHTML = countLabel(items.length, loading);
    root.querySelector('[data-select]').textContent = state.selecting ? 'Done' : 'Select';
    const archBtn = root.querySelector('[data-archived-toggle]');
    if (archBtn) archBtn.classList.toggle('on', state.archived);
    root.querySelector('.searchbar').classList.toggle('filled', Boolean(state.q));

    if (loading) {
      mount(listNode, html`<div class="spinner"></div>`);
    } else if (!items.length) {
      mount(listNode, emptyState());
    } else if (state.view === 'grid') {
      mount(listNode, html`<div class="grid">${items.map(tile)}</div>`);
    } else {
      mount(listNode, html`<div class="rows">${items.map(row)}</div>`);
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
  const archivedToggle = root.querySelector('[data-archived-toggle]');
  if (archivedToggle) archivedToggle.addEventListener('click', () => {
    state.archived = !state.archived;
    state.selecting = false;
    state.selected.clear();
    load();
  });
  onClick(root, 'data-view', (value) => {
    state.view = value;
    localStorage.setItem(VIEW_KEY, value);
    paint();
  });
  root.querySelector('[data-select]').addEventListener('click', () => {
    state.selecting = !state.selecting;
    state.selected.clear();
    paint();
  });
  onClick(root, 'data-item', (value) => {
    const id = Number(value);
    if (state.selecting) {
      if (state.selected.has(id)) state.selected.delete(id);
      else state.selected.add(id);
      paint();
      return;
    }
    go(`/item/${id}`);
  });

  const unsubscribe = subscribe(() => {
    const label = root.querySelector('[data-sitelabel]');
    if (label) label.textContent = siteLabel();
  });

  await load();
  return () => { unsubscribe(); clearTimeout(typingTimer); };
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
        <button class="sitebtn" data-pick-site style="margin-left:auto">
          ${icon('pin')}<span class="nm" data-sitelabel>${siteLabel()}</span>
          <span class="caret">${icon('chevronDown')}</span>
        </button>
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
      ${isCommittee() ? html`<button class="chip" data-archived-toggle>Archived</button>` : ''}
      <button class="selbtn" data-select>Select</button>
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
  if (state.archived) {
    return html`
      <div class="emptystate">
        ${icon('box')}
        <b>Nothing archived</b>
        <span>Broken or retired kit shows up here once a committee member archives it from its item page.</span>
      </div>`;
  }
  return html`
    <div class="emptystate">
      ${icon('box')}
      <b>Nothing here</b>
      <span>${state.q
        ? `No kit matches "${state.q}" at ${siteLabel().toLowerCase()}.`
        : `No kit of this type is recorded at ${siteLabel().toLowerCase()}.`}</span>
    </div>`;
}

function tile(item) {
  const fault = worstFault(item.faults);
  const picked = state.selected.has(item.id);
  return html`
    <button class="card ${picked ? 'picked' : ''}" data-item="${item.id}">
      <span class="shot">
        ${item.image_path
          ? html`<img src="${item.image_path}" alt="">`
          : artFor(item.rig_kind || item.component_type)}
        ${item.rating.n
          ? html`<span class="ratechip">${icon('star')}${num(item.rating.stars)}
              <span class="n">· ${item.rating.n}</span></span>`
          : ''}
        ${fault
          ? html`<span class="flagchip ${fault.severity === 'out_of_action' ? 'oos' : ''}">
              ${icon('warning')}${fault.severity === 'out_of_action' ? 'Out' : 'Fault'}</span>`
          : ''}
      </span>
      <span class="meta">
        <span class="size">${item.size_value != null ? num(item.size_value) : item.size_label || '—'}
          ${item.size_unit ? html`<small>${item.size_unit}</small>` : ''}</span>
        <span class="nm">${item.manufacturer} · ${item.model}</span>
        <span class="cond ${conditionClass(item.condition)}">${item.condition || 'Condition unknown'}</span>
        ${store.site === 'all' && item.site ? html`<span class="spot">${item.site}</span>` : ''}
      </span>
    </button>`;
}

function row(item) {
  const fault = worstFault(item.faults);
  const picked = state.selected.has(item.id);
  return html`
    <button class="lrow ${picked ? 'picked' : ''}" data-item="${item.id}">
      ${state.selecting
        ? html`<span class="selbox">${icon('tick')}</span>`
        : html`<span class="thumb">${item.image_path
            ? html`<img src="${item.image_path}" alt="">`
            : artFor(item.rig_kind || item.component_type)}</span>`}
      <span class="lm">
        <span class="t">${item.manufacturer} ${item.model}</span>
        <span class="s">${[item.type, item.spot || item.site,
          fault ? (fault.severity === 'out_of_action' ? 'out of action' : 'has a fault') : null]
          .filter(Boolean).join(' · ')}</span>
      </span>
      <span class="lr">
        <span class="sz">${item.size_value != null ? num(item.size_value) : item.size_label || ''}
          ${item.size_unit ? html`<u>${item.size_unit}</u>` : ''}</span>
        <span class="rt">${item.rating.n
          ? html`${icon('star')}${num(item.rating.stars)} · ${item.rating.n}`
          : 'Not yet rated'}</span>
      </span>
    </button>`;
}
