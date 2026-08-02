/**
 * Log — the club feed, and the un-logged nudge.
 *
 * Sessions are a club-visible feed: everyone sees everyone's. The one personal
 * thing at the top is the nudge — a setup you de-rigged but have not written
 * up. It persists until logged (there is no dismiss), because a save is always
 * a deliberate act and the nudge is what turns a finished sail into one.
 */
import { html, mount, num, ago, clockTime, spanned, stampDate, onClick, initial } from '../dom.js';
import { icon, artFor } from '../icons.js';
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

  mount(root, shell(unlogged));
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
  onClick(root, 'data-kititem', (value) => { if (value) go(`/item/${value}`); });

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

function shell(unlogged) {
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
      ${unlogged ? nudge(unlogged) : ''}
      <div data-feed></div>
    </div>`;
}

function nudge(setup) {
  const sail = setup.pieces.find((p) => p.role === 'sail');
  const board = setup.pieces.find((p) => p.role === 'board');
  const bits = [];
  if (sail && sail.item) bits.push(`${num(sail.item.size_value)} ${(sail.item.model || '').split(' ')[0]} rig`);
  if (board && board.item) bits.push(board.item.model);
  return html`
    <div class="nudge">
      <div class="nt"><span class="dotpulse"></span><b>Out earlier, not logged</b></div>
      <span class="kit">${bits.join(', ') || 'Your last rig'}</span>
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
  const up = session.pieces.filter((p) => p.vote === 1).length;
  const down = session.pieces.filter((p) => p.vote === -1).length;
  const heads = session.pieces.filter(headliner);
  const rest = session.pieces.filter((piece) => !headliner(piece));
  const stamp = session.ended_at || session.created_at;
  return html`
    <article class="sess">
      <div class="who">
        <span class="av">${initial(session.user_name)}</span>
        <span class="wn">
          <span class="nm">${session.user_name}</span>
          <span class="meta">${[clockTime(stamp) || ago(stamp), session.site].filter(Boolean).join(' · ')}</span>
        </span>
        ${session.stars ? html`<span class="stars">${starIcons(session.stars)}</span>` : ''}
      </div>
      ${heads.length || rest.length ? html`
        <div class="rig">
          ${heads.map(kitRow)}
          ${rest.length ? html`<span class="also">plus ${rest.map(restLabel).join(' · ')}</span>` : ''}
        </div>` : ''}
      ${conditions(session)}
      ${session.note ? html`<p class="cmt">${session.note}</p>` : ''}
      <div class="foot">
        <button class="repeat" data-repeat="${session.id}">${icon('refresh')}Repeat this kit</button>
        ${up || down ? html`
          <span class="votes" title="How the kit rated on this session">
            ${up ? html`<span class="v up">${icon('thumbUp')}${up}</span>` : ''}
            ${down ? html`<span class="v down">${icon('thumbDown')}${down}</span>` : ''}
          </span>` : ''}
      </div>
    </article>`;
}

/**
 * Wind and time on the water share one quiet line. Both are optional and often
 * absent, so the line disappears rather than leaving a gap behind. A duration
 * is only worth printing once it is long enough to have been a sail rather
 * than a mis-tap, hence the ten-minute floor.
 */
const SHORTEST_SAIL_MS = 10 * 60 * 1000;

function conditions(session) {
  const bits = [];
  if (session.wind_kn != null) {
    const extra = [session.wind_dir, session.wind_gust_kn != null ? `gusts ${num(session.wind_gust_kn, 0)}` : null]
      .filter(Boolean).join(' · ');
    bits.push(html`<span class="c">${icon('wind')}<b>${num(session.wind_kn, 0)} kn</b>${extra ? ` ${extra}` : ''}</span>`);
  }
  const started = stampDate(session.started_at);
  const ended = stampDate(session.ended_at);
  if (started && ended && ended - started >= SHORTEST_SAIL_MS) {
    bits.push(html`<span class="c">${icon('clock')}<b>${spanned(session.started_at, session.ended_at)}</b> on the water</span>`);
  }
  return bits.length ? html`<div class="cond">${bits}</div>` : '';
}

// The feed leads on the two pieces that name a session: the sail (or wing) and
// the board. The rest of the rig is still on the session, named on one quiet
// line under them rather than given a row of its own.
const headliner = (piece) => piece.role === 'sail' || piece.role === 'board' || !piece.role;

const restLabel = (piece) =>
  (store.roleLabels[piece.role] || piece.role || 'kit').toLowerCase();

function kitRow(piece) {
  const kind = piece.component_type || piece.role;
  const size = piece.size_m2 ?? piece.size_l ?? null;
  // Drop a trailing number from the model when it is just the size again, so a
  // "Start 185" board beside its 185 L headline reads "Starboard Start", not twice.
  let model = piece.model || '';
  const tail = model.match(/^(.*[^\s-])[\s-]+(\d+(?:\.\d+)?)$/);
  if (tail && size != null && Math.abs(Number(size) - Number(tail[2])) < 0.51) model = tail[1];
  const name = model ? `${piece.manufacturer || ''} ${model}`.trim() : (piece.label || 'Kit');
  return html`
    <button class="krow" data-kititem="${piece.item_id || ''}">
      ${artFor(kind)}
      <b class="sz">${size != null ? num(size) : ''}</b>
      <span class="knm">${name}</span>
    </button>`;
}
