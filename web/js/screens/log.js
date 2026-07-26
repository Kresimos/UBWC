/**
 * Log — the club feed, and the un-logged nudge.
 *
 * Sessions are a club-visible feed: everyone sees everyone's. The one personal
 * thing at the top is the nudge — a setup you de-rigged but have not written
 * up. It persists until logged (there is no dismiss), because a save is always
 * a deliberate act and the nudge is what turns a finished sail into one.
 */
import { html, mount, num, ago, onClick, initial } from '../dom.js';
import { icon, artFor } from '../icons.js';
import { api } from '../api.js';
import { store, setSetup } from '../store.js';
import { starIcons } from '../ui/bits.js';
import { refreshSetup, needUser } from '../ui/chrome.js';
import { confirmSheet, toast } from '../ui/overlay.js';
import { go } from '../router.js';

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
        mount(feedNode, html`
          <div class="feedhead"><h3>${state.scope === 'mine' ? 'Your sessions' : 'Recent sessions'}</h3><span class="ln"></span></div>
          ${data.sessions.map(sessionCard)}`);
      }
    } catch (error) {
      toast(error.message, true);
    }
  }

  onClick(root, 'data-scope', async (value) => {
    if (value === 'mine' && !(await needUser('Your own sessions are tied to your name.'))) return;
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
      go('/setup');
      toast('Same kit as last time. Here is where each piece lives.');
    } catch (error) {
      toast(error.message, true);
    }
  });

  await loadFeed();
}

function shell(unlogged) {
  return html`
    <div class="appbar">
      <div class="row"><span class="ttl">Logbook</span></div>
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

function sessionCard(session) {
  const rated = session.pieces.filter((p) => p.vote === 1 || p.vote === -1).length;
  return html`
    <div class="sess">
      <div class="who">
        <span class="av">${initial(session.user_name)}</span>
        <span class="wn">
          <span class="nm">${session.user_name}</span>
          <span class="meta">${[ago(session.ended_at || session.created_at), session.site].filter(Boolean).join(' · ')}</span>
        </span>
        ${session.stars ? html`<span class="stars">${starIcons(session.stars)}</span>` : ''}
      </div>
      ${session.pieces.length ? html`<div class="kit">${session.pieces.filter(headliner).map(kitChip)}</div>` : ''}
      ${session.wind_kn != null ? html`
        <span class="wind">${icon('wind')}<b>${num(session.wind_kn, 0)} kn</b>${
          [session.wind_dir, session.wind_gust_kn != null ? `gusts ${num(session.wind_gust_kn, 0)}` : null]
            .filter(Boolean).join(' · ')}</span>` : ''}
      ${session.note ? html`<p class="cmt">${session.note}</p>` : ''}
      <div class="foot">
        <button class="repeat" data-repeat="${session.id}">${icon('refresh')}Repeat this kit</button>
        ${rated ? html`<span class="peritem">rated ${rated} ${rated === 1 ? 'piece' : 'pieces'}</span>` : ''}
      </div>
    </div>`;
}

// The feed shows the two pieces that name a session: the sail (or wing) and the
// board. The rest of the rig is on the session, just not in the headline.
const headliner = (piece) => piece.role === 'sail' || piece.role === 'board' || !piece.role;

function kitChip(piece) {
  const kind = piece.component_type || piece.role;
  const size = piece.size_m2 ?? piece.size_l ?? null;
  // Drop a trailing number from the model when it is just the size again, so a
  // "Start 185" board beside its 185 L headline reads "Starboard Start", not twice.
  let model = piece.model || '';
  const tail = model.match(/^(.*[^\s-])[\s-]+(\d+(?:\.\d+)?)$/);
  if (tail && size != null && Math.abs(Number(size) - Number(tail[2])) < 0.51) model = tail[1];
  const name = model ? `${piece.manufacturer || ''} ${model}`.trim() : (piece.label || 'Kit');
  return html`
    <button class="kchip" data-kititem="${piece.item_id || ''}">
      ${artFor(kind)}${size != null ? html`<b>${num(size)}</b> ` : ''}${name}
    </button>`;
}
