/**
 * Log — the club feed, and your own rig above it.
 *
 * Sessions are a club-visible feed: everyone sees everyone's. The personal
 * thing at the top is whichever of two states your setup is in, never both:
 *
 *  - **out now**, a rig you have not de-rigged. The Log tab is where a member
 *    looks to see what the club is doing, so it is also where "and what am I
 *    on" belongs;
 *  - **the nudge**, a setup you de-rigged but have not written up. It persists
 *    until logged (there is no dismiss), because a save is always a deliberate
 *    act and the nudge is what turns a finished sail into one.
 */
import { html, mount, num, numFixed, ago, clockTime, spanned, stampDate, onClick, initial } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { store, setSetup } from '../store.js';
import { starIcons, wireWhoPill } from '../ui/bits.js';
import { refreshSetup, needUser, openIdentity } from '../ui/chrome.js';
import { confirmSheet, toast } from '../ui/overlay.js';
import { go } from '../router.js';
import { building } from '../rig/session.js';

const state = { scope: 'club' };
let feedCache = [];

export async function render(root) {
  const setup = store.user ? (store.setup || (await refreshSetup())) : null;
  const unlogged = setup && setup.status === 'derigged' ? setup : null;
  const live = setup && setup.status === 'active' ? setup : null;

  mount(root, shell(unlogged, live));
  const feedNode = root.querySelector('[data-feed]');

  async function loadFeed() {
    mount(feedNode, html`<div class="spinner"></div>`);
    try {
      const data = await api.sessions(state.scope);
      feedCache = data.sessions;
      if (!data.sessions.length) {
        mount(feedNode, emptyFeed());
      } else {
        mount(feedNode, byDay(data.sessions).map(([label, group]) => html`
          <section class="day">
            <div class="dayhead"><h3>${label}</h3><span class="ln"></span><span class="n">${group.length}</span></div>
            ${group.map(sessionCard)}
          </section>`));
      }
    } catch (error) {
      toast(error.message, true);
    }
  }

  const unwire = wireWhoPill(root, openIdentity);

  onClick(root, 'data-scope', async (value) => {
    if (value === 'mine' && !(await needUser('Your own sessions are tied to your account.'))) return;
    state.scope = value;
    root.querySelectorAll('[data-scope]').forEach((button) =>
      button.classList.toggle('on', button.getAttribute('data-scope') === value));
    loadFeed();
  });

  onClick(root, 'data-log', () => go('/compose'));
  onClick(root, 'data-yourrig', () => go('/setup'));
  onClick(root, 'data-kititem', (value) => { if (value) go(`/item/${value}`); });

  // The stat strip is the toggle: tapping it opens the full spec list (every
  // piece on the session, not just the sail and board it headlines) below it.
  onClick(root, 'data-expand', (_, node) => node.closest('.sess').classList.toggle('open'));

  // "Repeat last time" reuses that session's kit as a fresh active setup, then
  // drops you on the setup screen — the same place a wizard build lands.
  onClick(root, 'data-repeat', async (value) => {
    if (!(await needUser('A repeated setup is saved to your account.'))) return;
    const session = feedCache.find((s) => String(s.id) === value);
    if (!session) return;
    const pieces = session.pieces
      .filter((piece) => piece.item_id)
      .map((piece) => ({ role: piece.role, item_id: piece.item_id, custom: null, settings: {} }));
    if (!pieces.length) {
      toast('That session has no reusable kit recorded.', true);
      return;
    }
    if (store.setup && store.setup.status === 'active') {
      const yes = await confirmSheet({
        title: 'You are already out on a rig',
        sub: 'Repeating this replaces your current setup.',
        confirmLabel: 'Replace it',
      });
      if (!yes) return;
    }
    try {
      const saved = await api.saveSetup(session.site, pieces);
      setSetup(saved.setup);
      // Your rig rebuilds its working state from the setup it finds, so the
      // stale half-built one from last time has to go first.
      building.clear();
      go('/setup');
      toast('Same kit as last time. Here is where each piece lives.');
    } catch (error) {
      toast(error.message, true);
    }
  });

  await loadFeed();
  return unwire;
}

function shell(unlogged, live) {
  return html`
    <div class="appbar">
      <div class="row">
        <span class="ttl">Logbook</span>
        <span data-who></span>
      </div>
      <div class="seg">
        <button class="on" data-scope="club">Club feed</button>
        <button data-scope="mine">Mine</button>
      </div>
    </div>
    <div class="body pad">
      ${live ? outNow(live) : ''}
      ${unlogged ? nudge(unlogged) : ''}
      <div data-feed></div>
    </div>`;
}

/**
 * The rig you are on right now. Same card as the nudge below, because it is the
 * same fact one step earlier: this is the session, before it has ended.
 */
function outNow(setup) {
  return html`
    <div class="nudge live">
      <div class="nt">
        <span class="dotpulse"></span><b>Out now</b>
      </div>
      <span class="kit">${rigWords(setup) || 'Your rig'}</span>
      <div class="row2"><button class="go" data-yourrig>Your rig</button></div>
    </div>`;
}

/** "5.8 Gaastra rig, Fanatic Freewave" from whatever the setup actually has. */
function rigWords(setup) {
  const sail = setup.pieces.find((p) => p.role === 'sail');
  const board = setup.pieces.find((p) => p.role === 'board');
  const bits = [];
  if (sail && sail.item) bits.push(`${numFixed(sail.item.size_value)} ${(sail.item.model || '').split(' ')[0]} rig`);
  if (board && board.item) bits.push(board.item.model);
  return bits.join(', ');
}

function nudge(setup) {
  return html`
    <div class="nudge">
      <div class="nt"><span class="dotpulse"></span><b>Out earlier, not logged</b></div>
      <span class="kit">${rigWords(setup) || 'Your last rig'}</span>
      <span class="sub">You sailed this at ${setup.site || store.site}. Keep it as a session?</span>
      <div class="row2"><button class="go" data-log>Log this session</button></div>
    </div>`;
}

function emptyFeed() {
  return html`
    <div class="emptystate">
      ${icon('doc')}
      <b>${state.scope === 'mine' ? 'You have not logged a session yet' : 'No sessions yet'}</b>
      <span>A session is kit + wind + a note, saved when you choose to. De-rig a rig and the prompt appears here.</span>
    </div>`;
}

/**
 * Sessions arrive newest-first, so grouping is one pass: start a new day every
 * time the calendar date changes. The day heading carries the date, which frees
 * each card's own line to say the time it happened rather than repeating
 * "2 hours ago" down the whole feed.
 */
function byDay(sessions) {
  const groups = [];
  let key = null;
  for (const session of sessions) {
    const when = stampDate(session.ended_at || session.created_at);
    const at = when ? when.toDateString() : '';
    if (at !== key || !groups.length) {
      groups.push([dayLabel(when, session), []]);
      key = at;
    }
    groups[groups.length - 1][1].push(session);
  }
  return groups;
}

function dayLabel(when, session) {
  if (!when) return ago(session.created_at) || 'Earlier';
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(when).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const shape = days < 7 ? { weekday: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' };
  return when.toLocaleDateString('en-GB', shape);
}

function sessionCard(session) {
  const sail = session.pieces.find((p) => p.role === 'sail');
  const board = session.pieces.find((p) => p.role === 'board');
  const stamp = session.ended_at || session.created_at;
  return html`
    <article class="sess">
      <div class="who">
        <span class="av">${initial(session.user_name)}</span>
        <span class="wn">
          <span class="nm">${session.user_name}</span>
          <span class="meta">${[clockTime(stamp) || ago(stamp), session.site].filter(Boolean).join(' · ')}</span>
        </span>
        ${session.stars ? html`
          <span class="stars">${starIcons(session.stars)}</span>` : ''}
      </div>
      ${session.note ? html`<div class="note"><p>${session.note}</p></div>` : ''}
      <div class="strip" data-expand role="button">
        ${windTile(session)}
        ${kitTile(sail, 'm²')}
        ${kitTile(board, 'L')}
      </div>
      ${duration(session)}
      <div class="specs">
        ${session.pieces.map(specRow)}
        <button class="repeat" data-repeat="${session.id}">${icon('refresh')}Repeat this kit</button>
      </div>
    </article>`;
}

/**
 * Time on the water is its own quiet line below the strip — optional, and
 * often absent, so the line disappears rather than leaving a gap behind. A
 * duration is only worth printing once it is long enough to have been a sail
 * rather than a mis-tap, hence the ten-minute floor.
 */
const SHORTEST_SAIL_MS = 10 * 60 * 1000;

function duration(session) {
  const started = stampDate(session.started_at);
  const ended = stampDate(session.ended_at);
  if (started && ended && ended - started >= SHORTEST_SAIL_MS) {
    return html`<div class="cond"><span class="c">${icon('clock')}<b>${spanned(session.started_at, session.ended_at)}</b> on the water</span></div>`;
  }
  return '';
}

function windTile(session) {
  if (session.wind_kn == null) {
    return html`<div class="tile empty"><span class="val">&mdash;</span><span class="lbl">No wind</span></div>`;
  }
  const gust = session.wind_gust_kn;
  return html`
    <div class="tile">
      <span class="val">${num(session.wind_kn, 0)}${gust != null ? html`<span class="sep">/</span>${num(gust, 0)}` : ''}<span class="unit">kn</span></span>
      <span class="lbl">${session.wind_dir ? `${session.wind_dir} wind` : 'Wind'}</span>
    </div>`;
}

// Drop a trailing number from a model when it is just the size again, so a
// "Start 185" board beside its 185 L value reads "Starboard Start", not twice.
function kitParts(piece) {
  const size = piece.size_m2 ?? piece.size_l ?? null;
  let model = piece.model || '';
  const tail = model.match(/^(.*[^\s-])[\s-]+(\d+(?:\.\d+)?)$/);
  if (tail && size != null && Math.abs(Number(size) - Number(tail[2])) < 0.51) model = tail[1];
  return { brand: piece.manufacturer || '', model: model || piece.label || 'Kit' };
}

function kitName(piece) {
  const { brand, model } = kitParts(piece);
  return `${brand} ${model}`.trim();
}

// Sail and board tiles share one shape: a value with its unit riding beside
// it, and the model underneath. No icon — the value+label pair already says
// what the tile is, so a glyph above them would only repeat it. Neither tile
// links out on its own any more — the whole strip is one tap target that
// opens the spec list below, where every piece (these two included) is its
// own row with its own link to the catalogue.
//
// Brand and model sit in their own spans, each unbreakable, so a label that
// needs two lines wraps cleanly between them rather than mid-word wherever
// the text happens to run out of room.
function kitTile(piece, unit) {
  if (!piece) return html`<div class="tile empty"><span class="val">&mdash;</span><span class="lbl">Not logged</span></div>`;
  const kind = piece.component_type || piece.role;
  const size = piece.size_m2 ?? piece.size_l ?? null;
  const val = size != null ? (kind === 'sail' ? numFixed(size) : num(size)) : '';
  const { brand, model } = kitParts(piece);
  return html`
    <div class="tile">
      <span class="val">${val}<span class="unit">${unit}</span></span>
      <span class="lbl">${brand ? html`<span class="brand">${brand}</span>` : ''}<span class="model">${model}</span></span>
    </div>`;
}

// A piece's headline number, whichever field it actually lives on — a sail's
// area, a board's volume, or a length for anything rigid (mast, extension,
// boom, fin).
function pieceSize(piece) {
  if (piece.size_m2 != null) return `${numFixed(piece.size_m2)} m²`;
  if (piece.size_l != null) return `${num(piece.size_l, 0)} L`;
  if (piece.length_cm != null) return `${num(piece.length_cm, 0)} cm`;
  if (piece.fin_length_cm != null) return `${num(piece.fin_length_cm, 0)} cm`;
  return '';
}

// One row per piece on the session — sail and board included, plus whatever
// else was rigged (mast, extension, boom, fin, harness...). Each is its own
// link to the catalogue, and carries the thumb this member left on it, if any.
function specRow(piece) {
  const size = pieceSize(piece);
  return html`
    <button class="specrow" data-kititem="${piece.item_id || ''}">
      <span class="sn">
        <span class="sr">${store.roleLabels[piece.role] || piece.role || 'Kit'}</span>
        <span class="sm">${kitName(piece)}</span>
      </span>
      ${size ? html`<span class="ssz">${size}</span>` : ''}
      ${piece.vote === 1 ? html`<span class="svote up">${icon('thumbUp')}</span>` : ''}
      ${piece.vote === -1 ? html`<span class="svote down">${icon('thumbDown')}</span>` : ''}
    </button>`;
}
