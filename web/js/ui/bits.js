/**
 * The small pieces that appear on more than one screen.
 *
 * The rating is the one worth reading twice: members vote with a single thumb
 * because picking a number is more thought than the rating deserves, and the
 * app *displays* the tally as stars so the catalogue reads like a shop. The
 * vote count travels with the stars on the item page and Your rig — it is the
 * pinch of salt, which is why there is no minimum-votes threshold — while the
 * catalogue and the build picker show the star number alone. Zero votes says
 * "Not yet rated" rather than showing a blank nought.
 */
import { html, mount, raw, num, initial } from '../dom.js';
import { icons, icon } from '../icons.js';
import { store, subscribe } from '../store.js';

/* One star's box is 24 wide and the ink sits 2.43 in from each edge, so laying
   the boxes edge to edge already leaves an even gap and the row needs no
   letter-spacing. Five of them make a 120-wide viewBox. */
const STAR_D = 'M12 3.39L17.3 19.68L3.43 9.61L20.57 9.61L6.7 19.68Z';
const PITCH = 24, ROW_W = 120, INK_L = 2.43, INK_W = 19.14;

const starsRow = (colour) => `<svg viewBox="0 0 ${ROW_W} 24.35" fill="${colour}" stroke="${colour}"
  stroke-width="2.05" stroke-linejoin="round" aria-hidden="true">${
  Array.from({ length: 5 }, (_, i) =>
    `<path transform="translate(${i * PITCH} 0)" d="${STAR_D}"/>`).join('')}</svg>`;

/**
 * Stars as a coloured row masked over a grey one, so 3.7 really is 3.7 stars.
 * The cut is measured in the row's own units - three whole boxes, then 70% of
 * the fourth star's *ink* - rather than as a percentage of the whole element,
 * which is what used to let the trailing gap eat into the fraction.
 */
export function starRow(stars) {
  const value = Math.max(0, Math.min(5, Number(stars) || 0));
  const whole = Math.floor(value);
  const cut = whole * PITCH + INK_L + (value - whole) * INK_W;
  const pct = Math.max(0, Math.min(100, (cut / ROW_W) * 100)).toFixed(2);
  return html`<span class="starrow"
    >${raw(starsRow('var(--star-off)'))}<span class="fill" style="--cut:${pct}%"
    >${raw(starsRow('var(--star)'))}</span></span>`;
}

/** Five separate glyphs, for the places the sketches drew them individually. */
export function starIcons(stars, total = 5) {
  const filled = Math.round(stars || 0);
  return raw(Array.from({ length: total }, (_, i) =>
    icons.star.replace('<svg', `<svg class="${i < filled ? '' : 'off'}"`)).join(''));
}

/**
 * The rating as one line: the stars, the average, then the vote count. Never
 * stars without their count, and "Not yet rated" rather than a blank nought.
 *
 * The average and the count are wrapped together rather than sitting beside the
 * stars as two more flex items. They are different sizes, and as separate items
 * each would be centred on its own line box, which left their baselines a
 * fraction apart; inside one wrapper they are ordinary inline siblings sharing
 * a line box, so they share a baseline.
 */
export function ratingLine(rating) {
  if (!rating || !rating.n) return html`<span class="rcount">Not yet rated</span>`;
  return html`${starRow(rating.stars)}<span class="rtext"><span class="ravg">${num(rating.stars)}</span
    ><span class="rcount">${rating.n} ${rating.n === 1 ? 'vote' : 'votes'}</span></span>`;
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

export function whoPill({ compact = false } = {}) {
  const name = store.user && (store.user.display_name || store.user.username);
  // The Catalogue's bar already carries the club mark and the site, so there it
  // is the avatar alone. Everywhere else the pill says the name outright.
  if (compact) {
    return html`<button class="whobtn dot ${store.user ? '' : 'out'}" data-identity
                        aria-label="${store.user ? `Signed in as ${name}` : 'Sign in'}">
      <span class="av">${store.user ? avatar(name) : '?'}</span>
    </button>`;
  }
  if (!store.user) {
    return html`<button class="whobtn out" data-identity><span class="av">?</span>Sign in</button>`;
  }
  return html`<button class="whobtn" data-identity>
    <span class="av">${avatar(name)}</span>
    ${name}
    ${store.committee ? html`<span class="key">${icon('key')}</span>` : ''}
  </button>`;
}

/**
 * Keep a screen's identity pill honest. Signing in happens *inside* a screen
 * that is already drawn, so the pill has to repaint on its own or it goes on
 * saying "Sign in" to somebody who just did. Returns the unsubscribe for the
 * screen to hand back to the router.
 */
export function wireWhoPill(root, onOpen, options) {
  const slot = root.querySelector('[data-who]');
  if (!slot) return () => {};
  const paint = () => {
    mount(slot, whoPill(options));
    slot.querySelector('[data-identity]').addEventListener('click', onOpen);
  };
  paint();
  return subscribe(paint);
}
