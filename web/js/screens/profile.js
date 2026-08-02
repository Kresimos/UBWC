/**
 * Your sailing: what the app has learned about how this member sails.
 *
 * Deliberately not a second logbook: the Log tab already shows a member their
 * own sessions and rigs under "Mine", and repeating them here would just be two
 * places to look. What is here is the *shape* of that history, which nothing
 * else in the app can show:
 *
 *  - the **sizes against the wind** they were rigged in, one dot per session,
 *    with the curve the rig assistant fitted through them. That curve is the
 *    number the Build wheel opens on (suggest.py), so this screen is where a
 *    member can see why it suggests what it suggests, and see it move as they
 *    log more sailing;
 *  - the **kit they keep going back to**, with what they last thought of it;
 *  - the kit they have **saved**, which is what the rig assistant flags.
 *
 * The chart is drawn as plain SVG against the app's own tokens rather than a
 * charting library: it is one small scatter and one curve, and a build step for
 * that would cost more than it is worth.
 */
import { html, mount, num, ago, onClick } from '../dom.js';
import { icon, artFor } from '../icons.js';
import { api } from '../api.js';
import { store, siteLabel } from '../store.js';
import { starRow } from '../ui/bits.js';
import { openIdentity, pickSite } from '../ui/chrome.js';
import { lightbox } from '../ui/overlay.js';
import { go, back } from '../router.js';

/** The plot box, in the SVG's own units. */
const W = 320;
const H = 190;
const PAD = { top: 12, right: 12, bottom: 34, left: 32 };

export async function render(root) {
  const data = await api.profile(store.site);
  mount(root, screen(data));

  root.querySelector('[data-back]').addEventListener('click', () => back('/catalogue'));
  root.querySelector('[data-account]').addEventListener('click', openIdentity);
  root.querySelector('[data-pick-site]').addEventListener('click', async () => {
    if (await pickSite({ allowAll: true })) go('/me', { replace: true });
  });

  onClick(root, 'data-item', (id) => go(`/item/${id}`));

  // A dot is a session, and on a phone the only way to ask "which one?" is to
  // touch it. The same answer a hover tooltip would give on a desktop.
  onClick(root, 'data-point', (index) => {
    const point = data.curve.points[Number(index)];
    if (!point) return;
    lightbox({
      glyph: 'wind',
      title: `${num(point.sail)} m² in ${num(point.wind)} kn`,
      sub: [
        point.site || 'Site not recorded',
        point.board ? `${num(point.board)} L board` : null,
        point.stars ? `${point.stars} of 5 for the session` : null,
        point.vote === 1 ? 'You rated the sail up'
          : point.vote === -1 ? 'You rated the sail down' : null,
        ago(point.at),
      ].filter(Boolean).join(' · '),
    });
  });

  return undefined;
}

function screen(data) {
  const { stats, curve, kit, favourites } = data;
  const name = data.user.display_name || data.user.username;

  return html`
    <div class="appbar">
      <div class="row">
        <button class="backbtn" data-back aria-label="Back">${icon('back')}</button>
        <span class="ttl">Your sailing</span>
        <button class="site" data-pick-site>${icon('pin')}<span>${siteLabel()}</span></button>
      </div>
    </div>

    <div class="body">
      <button class="whocard" data-account>
        <span class="av">${(name[0] || '?').toUpperCase()}</span>
        <span class="whomid">
          <b>${name}</b>
          <span>${data.user.is_admin ? 'Committee' : 'Member'} · ${data.user.username}</span>
        </span>
        ${icon('chevronRight')}
      </button>

      <div class="statgrid">
        ${stat(stats.n_sessions, stats.n_sessions === 1 ? 'session' : 'sessions')}
        ${stat(stats.avg_wind == null ? '—' : Math.round(stats.avg_wind), 'kn average')}
        ${stat(stats.n_ratings, stats.n_ratings === 1 ? 'rating' : 'ratings')}
        ${stat(stats.n_favourites, 'saved')}
      </div>

      <div class="sect">
        <h3>Sail size against wind</h3>
        ${curve.points.length
          ? html`
            ${chart(curve)}
            <p class="calc">${caption(curve)}</p>`
          : html`
            <div class="emptystate">
              ${icon('chart')}
              <b>Nothing plotted yet</b>
              <span>Log a session with a sail and a wind reading and it appears here. Until then the
                rig assistant opens on the club's usual sizes.</span>
            </div>`}
      </div>

      <div class="sect">
        <h3>Kit you keep going back to</h3>
        ${kit.length
          ? html`<div class="usetable">${kit.map(kitRow)}</div>`
          : html`<p class="calc" style="margin:0">Nothing yet. The kit on your logged sessions
              collects here, with what you last thought of it.</p>`}
      </div>

      <div class="sect">
        <h3>Saved kit</h3>
        ${favourites.length
          ? html`<div class="usetable">${favourites.map(favRow)}</div>`
          : html`<p class="calc" style="margin:0">Nothing saved. The bookmark on an item page keeps
              it here, and flags it in the rig assistant while you are choosing.</p>`}
      </div>
    </div>`;
}

const stat = (value, label) => html`
  <div class="statcell"><b>${value}</b><span>${label}</span></div>`;

function kitRow(row) {
  return html`
    <button class="userow" data-item="${row.id}">
      <span class="uthumb">${artFor(row.component_type)}</span>
      <span class="umid">
        <b>${row.manufacturer} ${row.model}</b>
        <span>${row.times} ${row.times === 1 ? 'session' : 'sessions'} · last ${ago(row.last_used)}</span>
      </span>
      ${row.favourite ? html`<span class="savedmark">${icon('bookmarkOn')}</span>` : ''}
      <span class="uvote ${row.my_vote === 1 ? 'up' : row.my_vote === -1 ? 'down' : 'none'}">
        ${row.my_vote === 1 ? icon('thumbUp') : row.my_vote === -1 ? icon('thumbDown') : ''}
      </span>
    </button>`;
}

function favRow(card) {
  return html`
    <button class="userow" data-item="${card.id}">
      <span class="uthumb">${artFor(card.rig_kind || card.component_type)}</span>
      <span class="umid">
        <b>${card.manufacturer} ${card.model}</b>
        <span>${card.size_label || ''}${card.site ? ` · ${card.site}` : ''}</span>
      </span>
      ${card.rating.n ? html`<span class="urate">${starRow(card.rating.stars)}</span>` : ''}
    </button>`;
}

/**
 * The scatter and the fitted curve.
 *
 * One series (this member's sessions), so there is no colour coding to decode:
 * every dot is teal, and what they thought of the sail is carried by the mark
 * itself (filled for a thumbs up, hollow for a thumbs down, small and grey when
 * they did not say), which the key underneath names in words.
 */
function chart(curve) {
  const points = curve.points;
  const xs = points.map((p) => p.wind);
  const ys = points.map((p) => p.sail);

  // The domain always contains the sailable range, then widens to fit anything
  // outside it, so two sessions in a flat calm do not zoom the chart into them.
  const x0 = Math.max(0, Math.min(8, ...xs) - 2);
  const x1 = Math.max(28, ...xs) + 2;
  const y0 = Math.max(0, Math.min(4, ...ys) - 1);
  const y1 = Math.max(7, ...ys) + 1;

  const px = (wind) => PAD.left + ((wind - x0) / (x1 - x0)) * (W - PAD.left - PAD.right);
  const py = (sail) => H - PAD.bottom - ((sail - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom);

  const xticks = ticks(x0, x1, 4);
  const yticks = ticks(y0, y1, 4);

  // The curve is sail = K / wind: the member's own power constant, which is the
  // whole model behind the suggestion. Sampled rather than solved because it
  // has to be clipped to the box at both ends.
  const path = [];
  for (let i = 0; i <= 60; i += 1) {
    const wind = x0 + ((x1 - x0) * i) / 60;
    const sail = curve.k / Math.max(wind, 0.5);
    if (sail > y1 || sail < y0) continue;
    path.push(`${path.length ? 'L' : 'M'}${px(wind).toFixed(1)} ${py(sail).toFixed(1)}`);
  }

  return html`
    <svg class="fitchart" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="Your sail size against the wind for each logged session, with the fitted curve the rig assistant uses.">
      ${yticks.map((value) => html`
        <line class="grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${py(value)}" y2="${py(value)}"></line>
        <text class="tick" x="${PAD.left - 6}" y="${py(value) + 3}" text-anchor="end">${num(value)}</text>`)}
      ${xticks.map((value) => html`
        <text class="tick" x="${px(value)}" y="${H - 21}" text-anchor="middle">${Math.round(value)}</text>`)}
      <line class="axis" x1="${PAD.left}" x2="${W - PAD.right}" y1="${H - PAD.bottom}" y2="${H - PAD.bottom}"></line>

      <path class="fit" d="${path.join(' ')}"></path>

      ${points.map((point, index) => html`
        <circle class="pt ${point.vote === 1 ? 'up' : point.vote === -1 ? 'down' : 'none'}"
                cx="${px(point.wind)}" cy="${py(point.sail)}"
                r="${point.vote ? 4.5 : 3.5}" data-point="${index}" tabindex="0" role="button">
          <title>${num(point.sail)} m² in ${num(point.wind)} kn</title>
        </circle>`)}

      <text class="axlabel" x="${W / 2}" y="${H - 3}" text-anchor="middle">wind (kn)</text>
      <text class="axlabel" x="8" y="${PAD.top + 2}">m²</text>
    </svg>

    <div class="fitkey">
      <span><i class="dot up"></i>rated up</span>
      <span><i class="dot down"></i>rated down</span>
      <span><i class="dot none"></i>no verdict</span>
      <span><i class="line"></i>your fitted size</span>
    </div>`;
}

/** Nice round tick values across a domain. */
function ticks(low, high, count) {
  const raw = (high - low) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) || raw;
  const out = [];
  for (let value = Math.ceil(low / step) * step; value <= high; value += step) {
    out.push(Math.round(value * 100) / 100);
  }
  return out;
}

function caption(curve) {
  const suggestion = curve.suggestion.sail;
  const own = suggestion.n
    ? `Fitted to ${suggestion.n} ${suggestion.n === 1 ? 'session' : 'sessions'}`
    : 'The club average, until you log a sail with a wind reading';
  const club = curve.k > curve.club_k ? 'more sail than the club average'
    : curve.k < curve.club_k ? 'less sail than the club average'
      : 'the club average';
  // The server's own sentence is kept whole: it is already written for a member,
  // and it says which of the two things (their history, today's wind) it used.
  return `${own}: you rig about ${num(Math.round(curve.k / 18 * 10) / 10)} m² in 18 kn, ${club}. `
    + `Build opens on ${num(suggestion.value)} m² right now. ${suggestion.why}`;
}
