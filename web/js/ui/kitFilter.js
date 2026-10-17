/**
 * The Catalogue's filter and sort, as one module the trip page and the kit
 * picker share with it.
 *
 * The Catalogue grew this as closures inside its own render(); the trip's kit
 * list and the picker sheet both wanted the same narrowing, and the picker had
 * already started copying it. So the rules live here, and nothing in this file
 * knows which screen is asking:
 *
 *  - **state** is a plain object each screen owns (`createFilterState`), so
 *    filtering the Catalogue never hides a thing on a packing list;
 *  - **matching and ordering** are pure functions over that state and a card;
 *  - **the panel** is drawn by `panelSections` and answered by `applyPanelClick`
 *    + `syncPanel`, the same markup and attributes the Catalogue's sheet has
 *    always used.
 *
 * It never touches localStorage, the app-wide trip or the DOM outside the
 * panel body it is handed: persistence and the sheet itself stay with the caller.
 */
import { html, stampDate } from '../dom.js';
import { store } from '../store.js';
import { fullName } from './bits.js';

// The fault buckets the Catalogue opens on: a clean piece and an amber-flagged
// one, but not a red "out of action" one. Deliberately not persisted - a member
// should never come back next session to silently hidden broken kit.
export const DEFAULT_FAULTS = ['none', 'minor'];
export const ALL_FAULTS = ['none', 'minor', 'major'];

export const SORTS = [
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
  boom: ['diam'],
  fin: ['sub', 'box'],
  foil: ['sub', 'box'],
  misc: ['sub'],
};

const FAULT_OPTIONS = [
  { key: 'none', label: 'No faults', tone: '' },
  { key: 'minor', label: 'Minor faults', tone: 'amber' },
  { key: 'major', label: 'Major faults', tone: 'red' },
];

/* ================================================================== state */

/**
 * @param {object} [start]
 * @param {string} [start.type]
 * @param {string} [start.sort]
 * @param {'asc'|'desc'} [start.dir]
 * @param {string[]} [start.faults] - the fault buckets that are showing.
 */
export function createFilterState({
  type = 'all', sort = 'added', dir = 'desc', faults = DEFAULT_FAULTS,
} = {}) {
  return {
    q: '',
    type,
    sort,
    dir,
    subs: new Set(),
    boxes: new Set(),
    diams: new Set(),
    cams: new Set(),
    lens: new Set(),
    faults: new Set(faults),
  };
}

export function clearContextFilters(state) {
  state.subs.clear();
  state.boxes.clear();
  state.diams.clear();
  state.cams.clear();
  state.lens.clear();
}

/** Back to what `createFilterState` was given, search and all. */
export function resetFilterState(state, start = {}) {
  const fresh = createFilterState(start);
  state.q = '';
  state.type = fresh.type;
  state.sort = fresh.sort;
  state.dir = fresh.dir;
  state.faults = fresh.faults;
  clearContextFilters(state);
}

/* ================================================================ filtering */

export function bucketOf(item) {
  if (!item.faults.length) return 'none';
  return item.faults.some((f) => f.severity === 'out_of_action') ? 'major' : 'minor';
}

/** True when `item` passes every filter in `state`. */
export function matches(state, item) {
  if (state.type !== 'all' && item.component_type !== state.type) return false;
  if (!state.faults.has(bucketOf(item))) return false;
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

export function sizeNumber(item) {
  if (item.size_value == null) return Infinity;
  const parsed = parseFloat(String(item.size_value));
  return Number.isNaN(parsed) ? Infinity : parsed;
}

function addedAt(item) {
  const when = stampDate(item.created_at);
  return when ? when.getTime() : 0;
}

/**
 * Where a piece sits on the rating sort. A fault outranks a missing rating as a
 * reason to sit low: nobody has looked at an unrated piece, but a flagged one
 * has been looked at and found wrong. So anything carrying an open fault sorts
 * below every unrated piece, which in turn sorts below one star.
 */
function ratingRank(item) {
  if (bucketOf(item) !== 'none') return -2;
  if (!item.rating || !item.rating.n) return -1;
  return item.rating.stars || 0;
}

/** Ascending comparison of two cards on `sort`. */
export function compare(sort, a, b) {
  switch (sort) {
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
    default: // 'added' - imported kit shares a stamp, so id breaks the tie
      return (addedAt(a) - addedAt(b)) || (a.id - b.id);
  }
}

/**
 * Sorts `rows` in place by the state's sort and direction and hands them back.
 *
 * @param {object} state
 * @param {any[]} rows
 * @param {object} [options]
 * @param {(row: any) => object} [options.get] - the card inside a row, for lists
 *   whose rows wrap one (a trip's rows carry theirs in `.item`).
 * @param {boolean} [options.sinkMajor] - a red-flagged piece always sinks to the
 *   bottom, whatever the sort; the sort then orders within each group.
 * @param {Record<string, (a: any, b: any) => number>} [options.custom] - sorts
 *   of the screen's own, keyed like SORTS and given whole rows.
 */
export function order(state, rows, { get = (row) => row, sinkMajor = false, custom = {} } = {}) {
  rows.sort((a, b) => {
    if (sinkMajor) {
      const majorA = bucketOf(get(a)) === 'major';
      const majorB = bucketOf(get(b)) === 'major';
      if (majorA !== majorB) return majorA ? 1 : -1;
    }
    const d = custom[state.sort]
      ? custom[state.sort](a, b)
      : compare(state.sort, get(a), get(b));
    return state.dir === 'desc' ? -d : d;
  });
  return rows;
}

/**
 * How many filters are narrowing the list - the number on the badge. The search
 * is not counted (it has a box of its own), and nor is sort.
 *
 * @param {object} [options]
 * @param {boolean} [options.countType] - false where the type has a rail of its
 *   own and is not a "filter" in the badge's sense.
 * @param {string[]} [options.faults] - the buckets that count as untouched.
 */
export function activeCount(state, { countType = true, faults = DEFAULT_FAULTS } = {}) {
  let n = 0;
  if (countType && state.type !== 'all') n += 1;
  n += state.subs.size + state.boxes.size + state.diams.size
     + state.cams.size + state.lens.size;
  const untouched = state.faults.size === faults.length
    && faults.every((k) => state.faults.has(k));
  if (!untouched) n += 1;
  return n;
}

/* =================================================================== panel */

function poolOf(pool, type) {
  return type === 'all' ? pool : pool.filter((i) => i.component_type === type);
}

function distinct(pool, type, field) {
  const seen = [];
  poolOf(pool, type).forEach((item) => {
    const value = item[field];
    if (value != null && value !== '' && !seen.includes(value)) seen.push(value);
  });
  return seen;
}

function orderedSubtypes(pool, type) {
  const found = distinct(pool, type, 'raw_type');
  const known = SUBTYPE_ORDER[type] || [];
  return [...known.filter((t) => found.includes(t)),
          ...found.filter((t) => !known.includes(t))];
}

function optButton(state, setName, value, label, tone = '') {
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

function contextSections(state, pool) {
  const type = state.type;
  const wanted = CONTEXT[type] || [];
  const out = [];

  if (wanted.includes('sub')) {
    const subs = orderedSubtypes(pool, type);
    out.push(fpSection(type === 'misc' ? 'Category' : 'Subtype',
      subs.map((s) => optButton(state, 'subs', s, s))));
  }
  if (wanted.includes('cams')) {
    const sails = poolOf(pool, 'sail');
    const opts = [];
    if (sails.some((i) => i.cams)) opts.push(optButton(state, 'cams', 'Cammed', 'Cammed'));
    if (sails.some((i) => !i.cams)) opts.push(optButton(state, 'cams', 'Camless', 'Camless'));
    out.push(fpSection('Cams', opts));
  }
  if (wanted.includes('diam')) {
    const diams = distinct(pool, type, 'diameter');
    out.push(fpSection('Diameter', diams.map((d) => optButton(state, 'diams', d, d))));
  }
  if (wanted.includes('box')) {
    const boxes = distinct(pool, type, 'box_type');
    out.push(fpSection('Box type', boxes.map((b) => optButton(state, 'boxes', b, b))));
  }
  if (wanted.includes('length')) {
    const lengths = distinct(pool, type, 'size_value')
      .map(Number).filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    out.push(fpSection('Length',
      lengths.map((n) => optButton(state, 'lens', String(n), `${n} cm`))));
  }
  return out;
}

/**
 * The body of the filter sheet: type, whatever that type narrows by, faults,
 * sort and order. Mount it into the sheet's `.fp-body`.
 *
 * @param {object} state
 * @param {object[]} pool - the cards the options are drawn from, so the panel
 *   only offers values somebody holds (a trip offers what is on the trip).
 * @param {object} [options]
 * @param {boolean} [options.showType] - false where a chip rail already is the type.
 * @param {{key: string, label: string}[]} [options.types] - the types offered.
 * @param {string[]} [options.faultBuckets] - which fault buckets can be ticked.
 * @param {{key: string, label: string}[]} [options.sorts]
 */
export function panelSections(state, pool, {
  showType = true, types = store.types, faultBuckets = ALL_FAULTS, sorts = SORTS,
} = {}) {
  return html`
    ${showType ? html`
      <div class="fpsect">
        <div class="fplab">Type</div>
        <div class="fpopts">
          <button class="fpopt ${state.type === 'all' ? 'on' : ''}" data-fptype="all">All</button>
          ${types.map((type) => html`
            <button class="fpopt ${state.type === type.key ? 'on' : ''}"
              data-fptype="${type.key}">${type.label}s</button>`)}
        </div>
      </div>` : ''}
    ${contextSections(state, pool)}
    <div class="fpsect">
      <div class="fplab">Faults</div>
      <div class="fpopts">
        ${FAULT_OPTIONS.filter((f) => faultBuckets.includes(f.key)).map((f) => html`
          <button class="fpopt ${f.tone} ${state.faults.has(f.key) ? 'on' : ''}"
            data-fpfault="${f.key}">${f.label}</button>`)}
      </div>
    </div>
    <div class="fpsect" data-sortsect>
      <div class="fplab">Sort by</div>
      <div class="fpopts">
        ${sorts.map((s) => html`
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
 * Applies a click inside the panel to `state`.
 *
 * Returns what kind of option it was, or null when the click was not on one (or
 * changed nothing). A `'type'` change alters which sections the panel has, so
 * the caller must re-mount the body; every other kind only flips highlights,
 * which `syncPanel` does without rebuilding.
 *
 * @returns {null|'type'|'set'|'fault'|'sort'|'dir'}
 */
export function applyPanelClick(state, target) {
  const type = target.closest('[data-fptype]');
  if (type) {
    const value = type.getAttribute('data-fptype');
    state.type = state.type === value ? 'all' : value;
    clearContextFilters(state);
    return 'type';
  }
  const set = target.closest('[data-fpset]');
  if (set) {
    const bucket = state[set.getAttribute('data-fpset')];
    const value = set.getAttribute('data-fpval');
    if (bucket.has(value)) bucket.delete(value);
    else bucket.add(value);
    return 'set';
  }
  const fault = target.closest('[data-fpfault]');
  if (fault) {
    const value = fault.getAttribute('data-fpfault');
    if (state.faults.has(value)) {
      if (state.faults.size === 1) return null; // one bucket must always be on
      state.faults.delete(value);
    } else {
      state.faults.add(value);
    }
    return 'fault';
  }
  const sort = target.closest('[data-fpsort]');
  if (sort) {
    state.sort = sort.getAttribute('data-fpsort');
    return 'sort';
  }
  const dir = target.closest('[data-fpdir]');
  if (dir) {
    state.dir = dir.getAttribute('data-fpdir');
    return 'dir';
  }
  return null;
}

/** Re-lights every option in a mounted panel body from `state`, in place. */
export function syncPanel(body, state) {
  const light = (selector, attribute, isOn) => {
    body.querySelectorAll(selector).forEach((node) => {
      node.classList.toggle('on', isOn(node.getAttribute(attribute), node));
    });
  };
  light('[data-fptype]', 'data-fptype', (value) => state.type === value);
  light('[data-fpset]', 'data-fpset', (name, node) =>
    state[name].has(node.getAttribute('data-fpval')));
  light('[data-fpfault]', 'data-fpfault', (value) => state.faults.has(value));
  light('[data-fpsort]', 'data-fpsort', (value) => state.sort === value);
  light('[data-fpdir]', 'data-fpdir', (value) => state.dir === value);
}
