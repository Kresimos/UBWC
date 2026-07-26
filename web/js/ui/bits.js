/**
 * The small pieces that appear on more than one screen.
 *
 * The rating is the one worth reading twice: members vote with a single thumb
 * because picking a number is more thought than the rating deserves, and the
 * app *displays* the tally as stars so the catalogue reads like a shop. The
 * vote count travels with the stars everywhere — it is the pinch of salt, which
 * is why there is no minimum-votes threshold — and zero votes says "Not yet
 * rated" rather than showing a blank nought.
 */
import { html, raw, num, initial } from '../dom.js';
import { icons, icon } from '../icons.js';
import { store } from '../store.js';

export const STAR_FULL = '★★★★★';

/** Stars as one clipped overlay, so 3.7 is genuinely 3.7 stars wide. */
export function starRow(stars) {
  const width = stars ? (stars / 5) * 100 : 0;
  return html`<span class="starrow"><span class="base">${STAR_FULL}</span><span
    class="fill" style="width:${width.toFixed(1)}%">${STAR_FULL}</span></span>`;
}

/** Five separate glyphs, for the places the sketches drew them individually. */
export function starIcons(stars, total = 5) {
  const filled = Math.round(stars || 0);
  return raw(Array.from({ length: total }, (_, i) =>
    icons.star.replace('<svg', `<svg class="${i < filled ? '' : 'off'}"`)).join(''));
}

/** "4.2 · 5 votes", or "Not yet rated". Never stars without their count. */
export function ratingLine(rating) {
  if (!rating || !rating.n) return html`<span class="rc">Not yet rated</span>`;
  return html`${starRow(rating.stars)}<span class="rn">${num(rating.stars)}</span
    ><span class="rc">${rating.n} ${rating.n === 1 ? 'vote' : 'votes'}</span>`;
}

export function conditionClass(condition) {
  const value = String(condition || '').toLowerCase();
  if (value === 'fair') return 'fair';
  if (value === 'poor') return 'poor';
  return 'good';
}

/**
 * The model with the size taken back out of it: "Severne Gator 6.5" reads as
 * "Severne Gator" beside a 6.5 m² headline. Only a trailing number that IS
 * this item's size is dropped, so a Bic Techno 293 (a 160 L board named for
 * its length) keeps the name it is known by.
 */
export function shortName(item, size) {
  const model = String(item.model || '');
  const tail = model.match(/^(.*[^\s-])[\s-]+(\d+(?:\.\d+)?)$/);
  let trimmed = model;
  if (tail && size != null && Math.abs(Number(size) - Number(tail[2])) < 0.051) {
    trimmed = tail[1];
  }
  return `${item.manufacturer || ''} ${trimmed}`.trim();
}

export function fullName(item) {
  return `${item.manufacturer || ''} ${item.model || ''}`.trim() || `Item #${item.id}`;
}

/** The worst open fault on a piece, which is what a badge should show. */
export function worstFault(faults) {
  if (!faults || !faults.length) return null;
  return faults.find((f) => f.severity === 'out_of_action') || faults[0];
}

export function avatar(name) {
  return initial(name);
}

/** The site pill in an app bar. Tapping it is how a member says where they are. */
export function sitePill(label) {
  return html`<button class="site" data-pick-site>${icon('pin')}${label}</button>`;
}

export function whoPill() {
  if (!store.user) {
    return html`<button class="whobtn out" data-identity><span class="av">?</span>Sign in</button>`;
  }
  return html`<button class="whobtn" data-identity>
    <span class="av">${avatar(store.user.display_name || store.user.username)}</span>
    ${store.user.display_name || store.user.username}
    ${store.committee ? html`<span class="key">${icon('key')}</span>` : ''}
  </button>`;
}
