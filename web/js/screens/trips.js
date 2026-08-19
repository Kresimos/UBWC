/**
 * Trips — what the club is taking, what it voted for, and what came back.
 *
 * Three audiences, one tab. Anybody, signed in or not, can see which trips are
 * running and what is on them, because what the trailer is taking is the whole
 * club's business. A signed-in member can vote on the boards, sails, wings and
 * foils a trip should take while it is still being decided. The kit sec packs
 * it and checks it back in.
 *
 * A trip is decided in two acts, and `trips.status` is which act it is in:
 *
 *   'voting'  the trip exists, named and dated, with no kit. Every packable
 *             piece the club owns is on the ballot at nought votes, and voting
 *             for one IS suggesting it, so there is no separate suggestion to
 *             make and no zero-vote suggestion to tidy away. Nothing is
 *             reserved: a vote is a wish, and the kit stays rig-able.
 *   'open'    the kit sec has packed it. That save is what closes voting —
 *             packing IS the decision, so there is no separate button to
 *             forget — and the tally stays on the page beside what actually
 *             went, which is the record worth keeping.
 *
 * The kit the trip is *for* is chosen; the rest is worked out. The kit sec
 * picks boards, sails, wings and foils and the app derives a mast, extension
 * and boom for every sail and a fin and base for every board, using the rig
 * wizard's own rules (`packList` in rig/engine.js), so a mast still has to
 * reach its sail's luff and a fin still has to match its board's box.
 *
 * Nothing here moves kit. An item's location is where it is stored and still
 * says so all the way through a trip, so unpacking is putting things back
 * where the app already says they live. Being away is membership of an *open*
 * trip: that is what hides a piece from the rig picker, and it is why a trip
 * still being voted on hides nothing.
 */
import { html, mount, onClick, ago } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { store } from '../store.js';
import { kitTile, wireWhoPill } from '../ui/bits.js';
import { needCommittee, openIdentity } from '../ui/chrome.js';
import { confirmSheet, formSheet, toast } from '../ui/overlay.js';
import { go, back, refresh } from '../router.js';
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
 * The packing screens are committee's, and a hash can be typed, so they ask
 * for themselves rather than trusting the tab that got you here. Reading a
 * trip and voting on one are deliberately not behind this.
 */
async function guard() {
  if (store.committee) return true;
  await needCommittee('Packing a trip is a committee job.');
  go('/trips', { replace: true });
  return false;
}

const votes = (n) => `${n} ${n === 1 ? 'vote' : 'votes'}`;

/**
 * Most wanted first, and stable underneath: within one tally the kit list's
 * own order is kept, so cards do not shuffle under a thumb as votes land.
 */
function byVotes(pieces, tally) {
  return pieces
    .map((piece, index) => ({ piece, index, n: tally[piece.id] || 0 }))
    .sort((a, b) => b.n - a.n || a.index - b.index)
    .map((entry) => entry.piece);
}

/* ---------------------------------------------------------------- the list */

export async function renderList(root) {
  const { trips } = await api.trips();
  const voting = trips.filter((trip) => trip.status === 'voting');
  const open = trips.filter((trip) => trip.status === 'open');
  const past = trips.filter((trip) => !['voting', 'open'].includes(trip.status));

  mount(root, html`
    <div class="appbar">
      <div class="row">
        <span class="ttl">Trips</span>
        <span data-who></span>
      </div>
    </div>
    <div class="body pad rowlist">
      ${store.committee
        ? html`<button class="bigbtn" data-new>${icon('plusCircle')}Start a new trip</button>`
        : ''}
      ${voting.length ? html`
        <div class="sectlabel">Voting open</div>
        <div class="rows">${voting.map(tripRow)}</div>` : ''}
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
          <span>${store.committee
            ? `Start a trip and let the club vote on the boards and sails it should
               take, or pack it yourself. Either way the app works out the masts,
               booms, extensions and fins that go with them.`
            : `When the club plans a trip away it shows up here, and you can vote
               on the kit it takes.`}</span>
        </div>`}
    </div>`);

  onClick(root, 'data-new', newTrip);
  onClick(root, 'data-trip', (value) => go(`/trips/${value}`));
  return wireWhoPill(root, openIdentity);
}

function tripRow(trip) {
  const outstanding = trip.n_items - trip.n_returned;
  const when = [trip.starts_on, trip.ends_on].filter(Boolean).join(' to ');
  const voting = trip.status === 'voting';
  return html`
    <button class="lrow" data-trip="${trip.id}">
      <span class="thumb">${icon('move')}</span>
      <span class="lm">
        <span class="t">${trip.name}</span>
        <span class="s">${[trip.destination, when || ago(trip.created_at),
                           voting
                             ? 'kit not picked yet'
                             : `${trip.n_items} ${trip.n_items === 1 ? 'piece' : 'pieces'}`]
                          .filter(Boolean).join(' · ')}</span>
      </span>
      <span class="lr">
        <span class="rt">${voting
          ? votes(trip.n_votes)
          : trip.status === 'open'
            ? (outstanding ? `${outstanding} still out` : 'all back')
            : `${trip.n_returned} of ${trip.n_items} back`}</span>
      </span>
    </button>`;
}

/**
 * A trip is named before it is packed, so one that is still being voted on is
 * a real thing with a date on it. The tick is the whole difference between the
 * two ways a trip starts: leave it and you go straight to the picker, take it
 * and the club gets a say first.
 */
async function newTrip() {
  const result = await formSheet({
    title: 'Start a trip',
    sub: 'What the club calls it. This is how you will find the list again when '
       + 'the trailer comes back.',
    fields: [
      { name: 'name', label: 'Trip name', required: true, placeholder: 'Nottingham, March' },
      { name: 'destination', label: 'Where (optional)', placeholder: 'Hoveringham' },
      { name: 'starts_on', label: 'Leaves (optional)', type: 'date' },
      { name: 'ends_on', label: 'Back (optional)', type: 'date' },
      { name: 'voting', label: 'Let members vote first', type: 'checkbox',
        hint: 'Members vote on the boards and sails it should take. Voting closes '
            + 'the moment you pick the kit. Nothing is held back while it runs, so '
            + 'voted-for kit can still be rigged this week.' },
    ],
    submitLabel: 'Start it',
    onSubmit: (values) => api.createTrip({ ...values, items: [] }),
  });
  if (!result) return;
  // Voting first means the trip page is now the ballot; otherwise straight on to
  // the picker, which is the same screen that edits a packed trip's kit.
  const trip = result.trip;
  go(trip.status === 'voting' ? `/trips/${trip.id}` : `/trips/new?trip=${trip.id}`);
}

/* -------------------------------------------------------------- the picker */

export async function renderNew(root, params) {
  if (!(await guard())) return undefined;
  if (!params.trip) {
    // The picker always edits a trip that already exists: a trip is named
    // first, so there is nothing to pack kit onto without one.
    go('/trips', { replace: true });
    return undefined;
  }

  const editing = (await api.trip(params.trip)).trip;
  // Two views of the same kit: `kit` is what the pack maths reasons about,
  // `cards` is what it is drawn as (the catalogue's tiles, photos and all).
  const { kit, cards } = await api.tripKit();
  // A trip being edited is not a clash with itself: its own kit is free to
  // stay on it, so the "already packed for" flag is dropped for those pieces.
  const mine = new Set(editing.items.map((row) => row.item.id));
  kit.forEach((piece) => { if (mine.has(piece.id)) delete piece.away; });
  mine.forEach((id) => { if (cards[id]) cards[id].away = null; });

  // What the club asked for, if it was asked. Saving this screen is what closes
  // that vote, so this is the last time the tally is anything but a record.
  const tally = editing.votes || {};
  const wasVoting = editing.status === 'voting';
  const state = {
    kind: 'board',
    chosen: new Set(editing.items.filter((row) => row.source === 'chosen')
                                 .map((row) => row.item.id)),
  };

  mount(root, html`
    <div class="appbar">
      <div class="row">
        <button class="backbtn" data-back aria-label="Back">${icon('back')}</button>
        <span class="ttl">${editing.name}</span>
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
    const pieces = byVotes(kit.filter((piece) => piece.kind === state.kind), tally);
    mount(listNode, pieces.length
      ? html`<div class="grid">${pieces.map(pickTile)}</div>`
      : html`<div class="emptystate">${icon('box')}<b>None recorded</b>
               <span>The club has no ${PICKABLE.find((e) => e.kind === state.kind).plural
                     } in the app yet.</span></div>`);

    const count = state.chosen.size;
    const voted = Object.keys(tally).length;
    mount(root.querySelector('[data-bar]'), html`
      <div class="actionbar">
        <button class="bigbtn ${count ? '' : 'mute'}" data-pack>
          ${icon('tick')}${count
            ? `Work out the kit for ${count} ${count === 1 ? 'piece' : 'pieces'}`
            : 'Choose what you are taking'}
        </button>
        <span class="helper">${wasVoting && voted
          ? `The club voted for ${voted} ${voted === 1 ? 'piece' : 'pieces'}, most
             wanted first. Take what you like and fill in the rest — saving the
             kit closes the vote. `
          : ''}The masts, booms, extensions, fins and bases these need are worked
          out for you. Nothing moves: kit keeps saying where it is stored the
          whole trip.</span>
      </div>`);
  }

  /** The catalogue's own tile, with the tick that says it is coming. */
  function pickTile(piece) {
    return kitTile(cards[piece.id], {
      attr: 'data-pick',
      tick: true,
      info: true,
      picked: state.chosen.has(piece.id),
      chip: tally[piece.id] ? votes(tally[piece.id]) : null,
      sub: html`<span class="spot">${[piece.site, piece.spot]
        .filter(Boolean).join(' · ')}</span>`,
    });
  }

  onClick(root, 'data-back', () => back('/trips'));
  onClick(root, 'data-kind', (value) => { state.kind = value; paint(); });
  onClick(root, 'data-info', (value) => go(`/item/${value}`));
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
      await api.setTripItems(editing.id, items);
      go(`/trips/${editing.id}`, { replace: true });
      toast(wasVoting
        ? `${shortfallLine(short, items.length)} Voting is closed.`
        : shortfallLine(short, items.length));
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
  const trip = (await api.trip(params.id)).trip;
  return trip.status === 'voting'
    ? renderBallot(root, trip)
    : renderPacked(root, trip);
}

/* -------------------------------------------------------------- the ballot */

/**
 * A trip still being decided.
 *
 * The whole packable inventory *is* the ballot — there is nothing to suggest
 * first, because voting for a piece nobody has voted for yet is the suggestion
 * — laid out with the picker's own chips and tiles, so the members' screen and
 * the kit sec's are recognisably the same act.
 *
 * Signed out, the kit list is not fetchable (it needs an account), so the page
 * falls back to what the server already sent with the trip: every piece
 * somebody has voted for, with its tally. That is the honest read-only view of
 * a vote in progress anyway.
 */
async function renderBallot(root, trip) {
  const signedIn = Boolean(store.user);
  let tally = trip.votes || {};
  let mine = new Set(trip.my_votes || []);

  const { kit, cards } = signedIn
    ? await api.tripKit()
    : {
      kit: (trip.voted || []).map((row) => ({
        id: row.item.id, kind: row.item.rig_kind || row.item.component_type,
      })),
      cards: Object.fromEntries((trip.voted || []).map((row) => [row.item.id, row.item])),
    };

  const state = { kind: 'board' };

  mount(root, html`
    <div class="appbar">
      <div class="row">
        <button class="backbtn" data-back aria-label="Back">${icon('back')}</button>
        <span class="ttl">${trip.name}</span>
        ${store.committee
          ? html`<button class="editbtn" data-pack>${icon('tick')}Pick kit</button>`
          : ''}
      </div>
      ${signedIn ? html`
        <div class="chiprail" data-kinds>
          ${PICKABLE.map((entry) => html`
            <button class="chip ${entry.kind === 'board' ? 'on' : ''}"
                    data-kind="${entry.kind}">${entry.label}</button>`)}
        </div>` : ''}
    </div>
    <div class="body pad kitgrid" data-body></div>
    <div data-bar></div>`);

  function paint() {
    root.querySelectorAll('[data-kind]').forEach((chip) => {
      chip.classList.toggle('on', chip.getAttribute('data-kind') === state.kind);
    });
    // Signed out there are no chips to filter by, so the short voted-for list
    // is shown whole rather than sliced to a kind nobody chose.
    const pieces = byVotes(
      kit.filter((piece) => !signedIn || piece.kind === state.kind), tally);
    mount(root.querySelector('[data-body]'), html`
      <div class="subline">${[trip.destination,
                              [trip.starts_on, trip.ends_on].filter(Boolean).join(' to '),
                              'kit not picked yet'].filter(Boolean).join(' · ')}</div>
      ${pieces.length
        ? html`<div class="grid">${pieces.map(voteTile)}</div>`
        : html`<div class="emptystate">${icon('box')}
            <b>${signedIn ? 'None recorded' : 'Nothing voted for yet'}</b>
            <span>${signedIn
              ? `The club has no ${PICKABLE.find((e) => e.kind === state.kind).plural
                 } in the app yet.`
              : 'Nobody has voted on this trip yet.'}</span></div>`}`);

    const total = Object.values(tally).reduce((sum, n) => sum + n, 0);
    mount(root.querySelector('[data-bar]'), html`
      <div class="actionbar">
        ${signedIn ? '' : html`<button class="bigbtn" data-signin>Sign in to vote</button>`}
        <span class="helper">${votes(total)} so far${mine.size
          ? `, ${mine.size} of them yours` : ''}. ${signedIn
            ? `Tap a piece to say it should come, tap it again to take your vote
               back. Nothing is held for the trip while the vote runs, so
               anything here can still be rigged this week. The kit sec picks
               from the tally, and that closes the vote.`
            : 'Sign in to add your own.'}</span>
        ${store.committee
          ? html`<button class="bigbtn ghost" data-cancel>Call this trip off</button>`
          : ''}
      </div>`);
  }

  function voteTile(piece) {
    return kitTile(cards[piece.id], {
      attr: 'data-vote',
      tick: signedIn,
      info: true,
      picked: mine.has(piece.id),
      chip: tally[piece.id] ? votes(tally[piece.id]) : null,
    });
  }

  onClick(root, 'data-back', () => back('/trips'));
  onClick(root, 'data-kind', (value) => { state.kind = value; paint(); });
  onClick(root, 'data-info', (value) => go(`/item/${value}`));
  // Signing in from here has to redraw the page: the ballot a member can vote
  // on is a different screen from the one they were just reading.
  onClick(root, 'data-signin', async () => {
    await openIdentity();
    if (store.user) refresh();
  });
  onClick(root, 'data-pack', () => go(`/trips/new?trip=${trip.id}`));

  onClick(root, 'data-cancel', () => callOff(trip.id));

  onClick(root, 'data-vote', async (value) => {
    if (!signedIn) {
      toast('Sign in to vote on the kit.', true);
      return;
    }
    const id = Number(value);
    try {
      // The server answers with the whole tally, so two members voting at once
      // cannot leave one of them looking at a count that never catches up.
      const result = await api.tripVote(trip.id, id, !mine.has(id));
      tally = result.counts;
      mine = new Set(result.mine);
      paint();
    } catch (error) {
      toast(error.message, true);
    }
  });

  paint();
  return undefined;
}

/**
 * A trip that was floated and did not happen: the one being voted on that the
 * club decided against, and the one named but never packed. Cancelled rather
 * than deleted, so the fact it was discussed — and what the club wanted to take
 * — is kept. Nothing was ever held back for it, so there is nothing to release.
 */
async function callOff(tripId) {
  const yes = await confirmSheet({
    title: 'Call it off?',
    sub: 'The trip closes without being packed. Any votes are kept, and no kit '
       + 'was ever held back for it.',
    confirmLabel: 'Call it off',
  });
  if (!yes) return;
  try {
    await api.closeTrip(tripId, { status: 'cancelled' });
    go('/trips', { replace: true });
    toast('Trip called off.');
  } catch (error) {
    toast(error.message, true);
  }
}

/* ---------------------------------------------------------- the packed trip */

async function renderPacked(root, packed) {
  let trip = packed;
  /** Ticking kit back in is the kit sec's, and only while the trip is running. */
  const mayEdit = () => store.committee && trip.status === 'open';

  mount(root, html`
    <div class="appbar">
      <div class="row">
        <button class="backbtn" data-back aria-label="Back">${icon('back')}</button>
        <span class="ttl" data-name>${trip.name}</span>
        ${store.committee
          ? html`<button class="editbtn" data-edit>${icon('edit')}Kit</button>`
          : ''}
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
          <span>${store.committee
            ? 'Tap Kit to choose what this trip is taking.'
            : 'The kit sec has not picked this trip’s kit yet.'}</span></div>`}`);

    // An open trip with nothing on it is one the kit sec named and walked away
    // from, so the only thing to offer there is calling it off — otherwise it
    // sits in "Out now" forever saying nothing went anywhere.
    mount(root.querySelector('[data-bar]'), !mayEdit() ? '' : trip.items.length
      ? html`
        <div class="actionbar">
          <button class="bigbtn" data-allback>${icon('tick')}Check it all back in</button>
          <span class="helper">${outstanding.length
            ? `Ticks the ${outstanding.length} still out and closes the trip. `
            : 'Closes the trip. '}Tap a single piece instead if something is missing.</span>
        </div>`
      : html`
        <div class="actionbar">
          <button class="bigbtn" data-edit>${icon('plusCircle')}Pick this trip's kit</button>
          <button class="bigbtn ghost" data-cancel>Call this trip off</button>
        </div>`);
  }

  /**
   * A packed piece as the same tile the catalogue draws, ticked when it is
   * back. The line underneath is where it belongs rather than where it is,
   * because checking a trip in is the moment somebody is holding it looking
   * for the rack. Anything the club voted for keeps its tally alongside: what
   * was asked for, beside what actually went. For everybody who is not
   * checking the trailer in, the tile is a way into the item page instead.
   */
  function itemTile(row) {
    const n = (trip.votes || {})[row.item.id];
    return kitTile(row.item, {
      attr: mayEdit() ? 'data-tick' : 'data-info',
      tick: mayEdit(),
      picked: row.returned,
      chip: n ? votes(n) : null,
      sub: html`<span class="spot">${[row.item.site, row.item.spot]
        .filter(Boolean).join(' · ')}</span>`,
    });
  }

  onClick(root, 'data-back', () => back('/trips'));
  onClick(root, 'data-edit', () => go(`/trips/new?trip=${trip.id}`));
  onClick(root, 'data-info', (value) => go(`/item/${value}`));
  onClick(root, 'data-cancel', () => callOff(trip.id));

  onClick(root, 'data-tick', async (value) => {
    if (!mayEdit()) return;
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
