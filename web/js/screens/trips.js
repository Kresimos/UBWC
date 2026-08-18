/**
 * Trips — pack the trailer, and check it back in.
 *
 * Three screens, one job. The kit sec chooses the kit a trip is *for* — the
 * boards, sails, wings and foils — and the app works out what those need: a
 * mast, an extension and a boom for every sail, a fin and a base for every
 * board. That reasoning is the rig wizard's own (`packList` in rig/engine.js),
 * run over a whole trailer instead of one rig, so a mast still has to reach
 * its sail's luff and a fin still has to match its board's box.
 *
 * The list it produces is the same list the trip is checked back against, which
 * is the point: what went out is what should come home.
 *
 * Nothing here moves kit. An item's location is where it is stored, and it
 * still says so all the way through a trip, so unpacking is putting things
 * back where the app already says they live rather than a second bulk move
 * with a spot to re-set afterwards. Being away is membership of an open trip:
 * that is what hides a piece from the rig picker, and what puts an "away"
 * flag on it in the catalogue.
 */
import { html, mount, onClick, ago } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { store } from '../store.js';
import { kitTile, wireWhoPill } from '../ui/bits.js';
import { needCommittee, openIdentity } from '../ui/chrome.js';
import { confirmSheet, formSheet, toast } from '../ui/overlay.js';
import { go, back } from '../router.js';
import { packList } from '../rig/engine.js';

/** What can be chosen outright, in the order the trailer is thought about. */
const PICKABLE = [
  { kind: 'board', label: 'Boards', plural: 'boards' },
  { kind: 'sail', label: 'Sails', plural: 'sails' },
  { kind: 'wing', label: 'Wings', plural: 'wings' },
  { kind: 'foil', label: 'Foils', plural: 'foils' },
];

const ROLE_ORDER = ['sail', 'mast', 'ext', 'boom', 'board', 'fin', 'uj', 'wing', 'foil'];

/**
 * The tab only exists for committee, but a hash can be typed, so the screens
 * ask as well rather than trusting the bar that got you here.
 */
async function guard() {
  if (store.committee) return true;
  await needCommittee('Packing a trip is a committee job.');
  go('/catalogue', { replace: true });
  return false;
}

/* ---------------------------------------------------------------- the list */

export async function renderList(root) {
  if (!(await guard())) return undefined;
  const { trips } = await api.trips();
  const open = trips.filter((trip) => trip.status === 'open');
  const past = trips.filter((trip) => trip.status !== 'open');

  mount(root, html`
    <div class="appbar">
      <div class="row">
        <span class="ttl">Trips</span>
        <span data-who></span>
      </div>
    </div>
    <div class="body pad rowlist">
      <button class="bigbtn" data-new>${icon('plusCircle')}Pack a new trip</button>
      ${open.length ? html`
        <div class="sectlabel">Out now</div>
        <div class="rows">${open.map(tripRow)}</div>` : ''}
      ${past.length ? html`
        <div class="sectlabel">Been and gone</div>
        <div class="rows">${past.map(tripRow)}</div>` : ''}
      ${trips.length ? '' : html`
        <div class="emptystate">
          ${icon('move')}
          <b>No trips yet</b>
          <span>Pick the boards and sails you want to take and the app works out
                the masts, booms, extensions and fins that go with them.</span>
        </div>`}
    </div>`);

  onClick(root, 'data-new', () => go('/trips/new'));
  onClick(root, 'data-trip', (value) => go(`/trips/${value}`));
  return wireWhoPill(root, openIdentity);
}

function tripRow(trip) {
  const outstanding = trip.n_items - trip.n_returned;
  const when = [trip.starts_on, trip.ends_on].filter(Boolean).join(' to ');
  return html`
    <button class="lrow" data-trip="${trip.id}">
      <span class="thumb">${icon('move')}</span>
      <span class="lm">
        <span class="t">${trip.name}</span>
        <span class="s">${[trip.destination, when || ago(trip.created_at),
                           `${trip.n_items} ${trip.n_items === 1 ? 'piece' : 'pieces'}`]
                          .filter(Boolean).join(' · ')}</span>
      </span>
      <span class="lr">
        <span class="rt">${trip.status === 'open'
          ? (outstanding ? `${outstanding} still out` : 'all back')
          : `${trip.n_returned} of ${trip.n_items} back`}</span>
      </span>
    </button>`;
}

/* -------------------------------------------------------------- the picker */

export async function renderNew(root, params) {
  if (!(await guard())) return undefined;

  const editing = params.trip ? (await api.trip(params.trip)).trip : null;
  // Two views of the same kit: `kit` is what the pack maths reasons about,
  // `cards` is what it is drawn as (the catalogue's tiles, photos and all).
  const { kit, cards } = await api.tripKit();
  // A trip being edited is not a clash with itself: its own kit is free to
  // stay on it, so the "already packed for" flag is dropped for those pieces.
  if (editing) {
    const mine = new Set(editing.items.map((row) => row.item.id));
    kit.forEach((piece) => { if (mine.has(piece.id)) delete piece.away; });
    mine.forEach((id) => { if (cards[id]) cards[id].away = null; });
  }

  const state = {
    kind: 'board',
    chosen: new Set(editing
      ? editing.items.filter((row) => row.source === 'chosen').map((row) => row.item.id)
      : []),
  };

  mount(root, html`
    <div class="appbar">
      <div class="row">
        <button class="backbtn" data-back aria-label="Back">${icon('back')}</button>
        <span class="ttl">${editing ? editing.name : 'Pack a trip'}</span>
      </div>
      <div class="chiprail" data-kinds>
        ${PICKABLE.map((entry) => html`
          <button class="chip ${entry.kind === 'board' ? 'on' : ''}"
                  data-kind="${entry.kind}">${entry.label}</button>`)}
      </div>
    </div>
    <div class="body kitgrid" data-list></div>
    <div data-bar></div>`);

  const listNode = root.querySelector('[data-list]');

  function paint() {
    root.querySelectorAll('[data-kind]').forEach((chip) => {
      chip.classList.toggle('on', chip.getAttribute('data-kind') === state.kind);
    });
    const pieces = kit.filter((piece) => piece.kind === state.kind);
    mount(listNode, pieces.length
      ? html`<div class="grid">${pieces.map(pickTile)}</div>`
      : html`<div class="emptystate">${icon('box')}<b>None recorded</b>
               <span>The club has no ${PICKABLE.find((e) => e.kind === state.kind).plural
                     } in the app yet.</span></div>`);

    const count = state.chosen.size;
    mount(root.querySelector('[data-bar]'), html`
      <div class="actionbar">
        <button class="bigbtn ${count ? '' : 'mute'}" data-pack>
          ${icon('tick')}${count
            ? `Work out the kit for ${count} ${count === 1 ? 'piece' : 'pieces'}`
            : 'Choose what you are taking'}
        </button>
        <span class="helper">The masts, booms, extensions, fins and bases these
          need are worked out for you. Nothing moves: kit keeps saying where it
          is stored the whole trip.</span>
      </div>`);
  }

  /** The catalogue's own tile, with the tick that says it is coming. */
  function pickTile(piece) {
    return kitTile(cards[piece.id], {
      attr: 'data-pick',
      tick: true,
      picked: state.chosen.has(piece.id),
      sub: html`<span class="spot">${[piece.site, piece.spot]
        .filter(Boolean).join(' · ')}</span>`,
    });
  }

  onClick(root, 'data-back', () => back('/trips'));
  onClick(root, 'data-kind', (value) => { state.kind = value; paint(); });
  onClick(root, 'data-pick', (value) => {
    const id = Number(value);
    const piece = kit.find((entry) => entry.id === id);
    // Spoken for by another trip: say so rather than letting it be chosen and
    // refused at save, which would lose the rest of the selection.
    if (piece && piece.away) {
      toast(`That one is already packed for ${piece.away}.`, true);
      return;
    }
    if (state.chosen.has(id)) state.chosen.delete(id);
    else state.chosen.add(id);
    paint();
  });
  onClick(root, 'data-pack', () => pack());

  async function pack() {
    if (!state.chosen.size) return;
    const chosen = kit.filter((piece) => state.chosen.has(piece.id));
    const byKind = (kind) => chosen.filter((piece) => piece.kind === kind);
    // Kit spoken for by another open trip is out of the pool: one board cannot
    // be in two trailers on the same weekend.
    const pool = kit.filter((piece) => !piece.away);
    const { assigned, short } = packList(pool, {
      sails: byKind('sail'), boards: byKind('board'),
      wings: byKind('wing'), foils: byKind('foil'),
    });

    const items = [
      ...chosen.map((piece) => ({ item_id: piece.id, role: piece.kind, source: 'chosen' })),
      ...assigned.map((entry) => ({ item_id: entry.piece.id, role: entry.role,
                                    source: 'derived' })),
    ];

    try {
      let trip = editing;
      if (editing) {
        trip = (await api.setTripItems(editing.id, items)).trip;
      } else {
        const values = await formSheet({
          title: 'Name the trip',
          sub: 'What the club calls it. This is how you will find the list again '
             + 'when the trailer comes back.',
          fields: [
            { name: 'name', label: 'Trip name', required: true, placeholder: 'Nottingham, March' },
            { name: 'destination', label: 'Where (optional)', placeholder: 'Hoveringham' },
            { name: 'starts_on', label: 'Leaves (optional)', type: 'date' },
            { name: 'ends_on', label: 'Back (optional)', type: 'date' },
          ],
          submitLabel: 'Pack it',
          onSubmit: (values2) => api.createTrip({ ...values2, items }),
        });
        if (!values) return;
        trip = values.trip;
      }
      go(`/trips/${trip.id}`, { replace: true });
      toast(shortfallLine(short, items.length));
    } catch (error) {
      toast(error.message, true);
    }
  }

  paint();
  return undefined;
}

/**
 * What the kit sec needs to hear the moment the list exists: how much there is,
 * and what the club could not cover. Running out is the answer to a real
 * question ("can we take four rigs?"), so it is said plainly rather than left
 * as a gap in a list.
 */
function shortfallLine(short, total) {
  if (!short.length) return `${total} pieces on the list.`;
  const nouns = [...new Set(short.map((entry) => entry.noun))];
  return `${total} pieces on the list, but ${short.length} short: `
       + `no ${nouns.join(' or ')} free.`;
}

/* ---------------------------------------------------------- the trip itself */

export async function renderTrip(root, params) {
  if (!(await guard())) return undefined;
  let trip = (await api.trip(params.id)).trip;

  mount(root, html`
    <div class="appbar">
      <div class="row">
        <button class="backbtn" data-back aria-label="Back">${icon('back')}</button>
        <span class="ttl" data-name>${trip.name}</span>
        <button class="editbtn" data-edit>${icon('edit')}Kit</button>
      </div>
    </div>
    <div class="body pad kitgrid" data-body></div>
    <div data-bar></div>`);

  function paint() {
    const outstanding = trip.items.filter((row) => !row.returned);
    mount(root.querySelector('[data-body]'), html`
      <div class="subline">${[trip.destination,
                              [trip.starts_on, trip.ends_on].filter(Boolean).join(' to '),
                              trip.status === 'open' ? 'out now' : trip.status]
                             .filter(Boolean).join(' · ')}</div>
      <div class="prog">
        <b>${trip.n_returned}</b> of <b>${trip.n_items}</b> back
        ${outstanding.length && trip.status !== 'open'
          ? html` · <span class="warn">${outstanding.length} never came home</span>` : ''}
      </div>
      ${gapNote(trip)}
      ${groups(trip).map(([role, rows]) => html`
        <div class="sectlabel">${store.roleLabels[role] || role}${rows.length > 1 ? 's' : ''}</div>
        <div class="grid">${rows.map(itemTile)}</div>`)}
      ${trip.items.length ? '' : html`
        <div class="emptystate">${icon('box')}<b>Nothing packed</b>
          <span>Tap Kit to choose what this trip is taking.</span></div>`}`);

    mount(root.querySelector('[data-bar]'), trip.status === 'open' && trip.items.length
      ? html`
        <div class="actionbar">
          <button class="bigbtn" data-allback>${icon('tick')}Check it all back in</button>
          <span class="helper">${outstanding.length
            ? `Ticks the ${outstanding.length} still out and closes the trip. `
            : 'Closes the trip. '}Tap a single piece instead if something is missing.</span>
        </div>`
      : '');
  }

  /**
   * A packed piece as the same tile the catalogue draws, ticked when it is
   * back. The line underneath is where it belongs rather than where it is,
   * because checking a trip in is the moment somebody is holding it looking
   * for the rack.
   */
  function itemTile(row) {
    return kitTile(row.item, {
      attr: 'data-tick',
      tick: trip.status === 'open',
      picked: row.returned,
      sub: html`<span class="spot">${[row.item.site, row.item.spot]
        .filter(Boolean).join(' · ')}</span>`,
    });
  }

  onClick(root, 'data-back', () => back('/trips'));
  onClick(root, 'data-edit', () => go(`/trips/new?trip=${trip.id}`));

  onClick(root, 'data-tick', async (value) => {
    if (trip.status !== 'open') return;
    const row = trip.items.find((entry) => String(entry.item.id) === value);
    if (!row) return;
    try {
      trip = (await api.tripReturned(trip.id, row.item.id, !row.returned)).trip;
      paint();
    } catch (error) {
      toast(error.message, true);
    }
  });

  onClick(root, 'data-allback', async () => {
    const outstanding = trip.items.filter((row) => !row.returned).length;
    const yes = await confirmSheet({
      title: 'Everything back?',
      sub: outstanding
        ? `This ticks the ${outstanding} still out and closes the trip. Only do it `
          + 'once the trailer is empty and the kit is on its racks.'
        : 'This closes the trip.',
      confirmLabel: 'All back',
    });
    if (!yes) return;
    try {
      trip = (await api.closeTrip(trip.id, { all: true })).trip;
      paint();
      toast('Trip closed. The kit is available again.');
    } catch (error) {
      toast(error.message, true);
    }
  });

  paint();
  return undefined;
}

/** The packed list, grouped into the order a trailer is loaded and unloaded. */
function groups(trip) {
  return ROLE_ORDER
    .map((role) => [role, trip.items.filter((row) => row.role === role)])
    .filter(([, rows]) => rows.length)
    .concat(trip.items.some((row) => !ROLE_ORDER.includes(row.role))
      ? [['misc', trip.items.filter((row) => !ROLE_ORDER.includes(row.role))]]
      : []);
}

/**
 * Counted, not re-solved: the list itself says whether every sail got a mast.
 * Worth saying on the trip page as well as at packing time, because a trip is
 * often packed days before it leaves and this is the thing somebody can still
 * do something about — borrow one, or take one sail fewer.
 */
function gapNote(trip) {
  const count = (role) => trip.items.filter((row) => row.role === role).length;
  const gaps = [];
  [['mast', 'sail'], ['ext', 'sail'], ['boom', 'sail'],
   ['fin', 'board'], ['uj', 'board']].forEach(([role, per]) => {
    const missing = count(per) - count(role);
    if (missing > 0) {
      gaps.push(`${missing} ${(store.roleLabels[role] || role).toLowerCase()}${
        missing === 1 ? '' : 's'} short`);
    }
  });
  if (!gaps.length) return '';
  return html`
    <div class="warnrow">
      ${icon('warning')}
      <span>${gaps.join(', ')}. Every sail needs its own mast, extension and
             boom, and every board a fin and a base, so that they can all be
             rigged at once.</span>
    </div>`;
}
