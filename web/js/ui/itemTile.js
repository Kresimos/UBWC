/**
 * The item tile — one shot, one line of facts, used by the Catalogue and the
 * Build picker alike, so a scuffed board reads the same wherever a member is
 * choosing from a shelf of them. Grid and list ended up different enough
 * (size moves off the name line into its own column, the rating condenses to
 * one star) that this is one function branching on `grid` rather than one
 * shape reflowed by CSS alone. The two marks a piece can carry, a red heart
 * for kit the member has saved and a fault flag, are drawn differently in each:
 * the grid floats them over the shot, while the list folds the heart into the
 * rating line and sets the flag inline before the size, so the size sits at the
 * same height on every row rather than shuffling up when a flag appears. The
 * flag is a button in both, since a member choosing between two sails needs to
 * read what is actually wrong without leaving the list.
 *
 * Condition and location are deliberately absent. Condition doubled up with
 * the star rating — one committee-reported, one member-reviewed, both saying
 * roughly "is this fine" — and location never earned its place on a tile a
 * member is choosing kit from, not filing it away in.
 */
import { html, num } from '../dom.js';
import { icon } from '../icons.js';
import { starRow } from './bits.js';
import { lightbox } from './overlay.js';

/**
 * @param {object} opts
 * @param {boolean} opts.grid - grid tile vs list row.
 * @param {string} opts.pickAttr - the data attribute name the screen wires up
 *   its own click handler on ('item' for the Catalogue, 'pick' for Build).
 * @param {number} opts.id
 * @param {*} opts.art - pre-rendered shot content (an `<img>` or `artFor(...)`).
 * @param {{value: string, unit: string}|{label: string}} opts.size
 * @param {string} opts.name - already "{manufacturer} {model}", no divider.
 * @param {string} opts.type - the list row's secondary line: a riding
 *   discipline, a diameter class, whatever actually varies for this kind.
 * @param {{stars: number, n: number}|null} opts.rating
 * @param {{title: string, severity: string}|null} opts.fault
 * @param {boolean} opts.saved
 * @param {string} opts.faultNoun - "sail", "board"... for the fault button's
 *   aria-label.
 * @param {boolean} [opts.picked] - multi-select state (Catalogue only).
 * @param {boolean} [opts.selecting] - swaps the shot for a select box in list
 *   view (Catalogue only).
 */
export function itemTile(opts) {
  const {
    grid, pickAttr, id, art, size, name, type, rating, fault, saved,
    faultNoun, picked = false, selecting = false,
  } = opts;

  const savedMark = saved
    ? html`<span class="savedmark" aria-hidden="true">${icon('heart')}</span>`
    : '';
  // List view spends its one glyph on whichever fact is rarer: a heart if the
  // member saved this piece, the star otherwise. A saved piece is already one
  // they rate, so the star it displaces says less than the heart does, and the
  // right-hand column stays free for the size to sit at a fixed height.
  const ratingMark = saved
    ? html`<span class="rt-heart" role="img" aria-label="Saved">${icon('heart')}</span>`
    : (rating ? html`<span class="rt-star">${icon('star')}</span>` : '');
  const faultChip = fault
    ? html`<button class="flagchip ${fault.severity === 'out_of_action' ? 'oos' : ''} ${grid ? '' : 'mini'}"
            data-flag="${id}" aria-label="What is wrong with this ${faultNoun}">
            ${icon('warning')}${fault.severity === 'out_of_action' ? 'Out' : 'Fault'}</button>`
    : '';
  const figure = size.value != null
    ? html`${size.value}<small>${size.unit}</small>`
    : (size.label || '—');
  const figureList = size.value != null
    ? html`${size.value}<u>${size.unit}</u>`
    : (size.label || '—');

  if (grid) {
    return html`
      <div class="card ${picked ? 'picked' : ''}" role="button" tabindex="0" data-${pickAttr}="${id}">
        <span class="shot">${art}${savedMark}${faultChip}</span>
        <span class="meta">
          <span class="size">${figure}</span>
          <span class="nm">${name}</span>
          ${rating
            ? html`<span class="rating">${starRow(rating.stars)}<span class="n">${num(rating.stars)} · ${rating.n}</span></span>`
            : html`<span class="rating muted">Not yet rated</span>`}
        </span>
      </div>`;
  }

  return html`
    <div class="card ${picked ? 'picked' : ''}" role="button" tabindex="0" data-${pickAttr}="${id}">
      ${selecting
        ? html`<span class="selbox">${icon('tick')}</span>`
        : html`<span class="thumb">${art}</span>`}
      <span class="lm">
        <span class="t">${name}</span>
        <span class="s">${type}${type ? ' · ' : ''}<span class="rt">${ratingMark}${rating
          ? html`${num(rating.stars)} · ${rating.n}`
          : 'Not yet rated'}</span></span>
      </span>
      <span class="lr">${faultChip}<span class="sz">${figureList}</span></span>
    </div>`;
}

/**
 * What a tapped fault chip opens: read here rather than costing a trip to
 * the item page and losing your place in the list. `faults` is every open
 * fault on the piece, each `{title, description, severity}`.
 */
export function faultPopup(faults) {
  if (!faults || !faults.length) return;
  lightbox({
    glyph: 'warning',
    title: faults.length === 1 ? faults[0].title : `${faults.length} reported faults`,
    sub: faults.map((fault) => {
      const body = fault.description || 'No description was recorded with this one.';
      const label = faults.length > 1 ? `${fault.title} — ` : '';
      return `${label}${body}${fault.severity === 'out_of_action' ? ' (out of action)' : ''}`;
    }).join('\n\n'),
  });
}
