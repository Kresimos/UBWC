/**
 * The item tile — one shot, one line of facts, used by the Catalogue, the
 * Build picker and the trip packer alike, so a scuffed board reads the same
 * wherever a member is choosing from a shelf of them. Grid and list ended up
 * different enough (size moves off the name line into its own column, the
 * rating condenses to one star) that this is one function branching on `grid`
 * rather than one shape reflowed by CSS alone. The two marks a piece can carry,
 * a red heart for kit the member has saved and a fault flag, are drawn
 * differently in each: the grid floats them over the shot, while the list folds
 * the heart into the rating line and sets the flag inline before the size, so
 * the size sits at the same height on every row rather than shuffling up when a
 * flag appears. The flag is a button in both, since a member choosing between
 * two sails needs to read what is actually wrong without leaving the list.
 *
 * Condition and location are deliberately absent from the tile itself.
 * Condition doubled up with the star rating — one committee-reported, one
 * member-reviewed, both saying roughly "is this fine" — and location never
 * earned its place on a tile a member is choosing kit from, not filing it away
 * in. The trip packer, where "which rack do I grab this off" genuinely matters,
 * passes its own `sub` line rather than making every screen carry one.
 *
 * The trip packer's extras — `tick` (a coming/back checkbox on the shot),
 * `away` (a quiet flag for kit already on another trip), `chip` (a corner
 * label, the ballot's vote tally) and `info` (a second, smaller tap target
 * into the item page, since the card is one big button) — are all grid-only
 * and all opt-in, so the Catalogue and Build draw exactly the tile they did
 * before.
 */
import { html, num, numFixed } from '../dom.js';
import { icon, artFor } from '../icons.js';
import { starRow, fullName, worstFault } from './bits.js';
import { lightbox } from './overlay.js';

/**
 * Map a server item card (server.item_card) to the tile's own options. The
 * Catalogue, Build and the trip packer all hold the same shape of row, so the
 * translation lives here once rather than in each screen.
 */
export function cardTileOpts(item) {
  return {
    id: item.id,
    art: item.image_path
      ? html`<img src="${item.image_path}" alt="">`
      : artFor(item.rig_kind || item.component_type),
    size: item.size_value != null
      ? {
          value: item.component_type === 'sail' ? numFixed(item.size_value) : num(item.size_value),
          unit: item.size_unit,
        }
      : { label: item.size_label },
    name: fullName(item),
    type: item.type,
    rating: item.rating && item.rating.n
      ? { stars: item.rating.stars, n: item.rating.n }
      : null,
    fault: worstFault(item.faults),
    saved: Boolean(item.favourite),
    faultNoun: item.type,
  };
}

/**
 * @param {object} opts
 * @param {boolean} opts.grid - grid tile vs list row.
 * @param {string} opts.pickAttr - the data attribute name the screen wires up
 *   its own click handler on ('item' for the Catalogue, 'pick' for Build,
 *   'pick'/'vote'/'tick' for the trip packer).
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
 * @param {boolean} [opts.picked] - multi-select / chosen state.
 * @param {boolean} [opts.selecting] - swaps the shot for a select box in list
 *   view (Catalogue only).
 * @param {boolean} [opts.tick] - grid only: a checkbox on the shot, filled when
 *   `picked`. The trip packer's "this one is coming" / "this one is back".
 * @param {string} [opts.away] - grid only: the name of another trip this piece
 *   is already packed for, shown as a quiet flag.
 * @param {*} [opts.chip] - grid only: a corner label bottom-left (vote tally).
 * @param {boolean} [opts.info] - grid only: wrap the card and add a small
 *   info button into the item page alongside it.
 * @param {*} [opts.sub] - grid only: an extra line under the name (where the
 *   kit is stored, on the trip packer).
 */
export function itemTile(opts) {
  const {
    grid, pickAttr, id, art, size, name, type, rating, fault, saved,
    faultNoun, picked = false, selecting = false,
    tick = false, away = null, chip = null, info = false, sub = null,
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
    const awayChip = away
      ? html`<span class="flagchip away">${icon('move')}Away</span>`
      : '';
    const tickMark = tick
      ? html`<span class="tickmark" aria-hidden="true">${icon('tick')}</span>`
      : '';
    const cornerChip = chip
      ? html`<span class="cornerchip">${chip}</span>`
      : '';
    const card = html`
      <div class="card ${picked ? 'picked' : ''} ${tick ? 'ticking' : ''}"
           role="button" tabindex="0" data-${pickAttr}="${id}">
        <span class="shot">${art}${savedMark}${faultChip}${awayChip}${tickMark}${cornerChip}</span>
        <span class="meta">
          <span class="size">${figure}</span>
          <span class="nm">${name}</span>
          ${rating
            ? html`<span class="rating">${starRow(rating.stars)}<span class="n">${num(rating.stars)}</span></span>`
            : html`<span class="rating muted">Not yet rated</span>`}
          ${sub ? html`<span class="sub">${sub}</span>` : ''}
        </span>
      </div>`;
    if (!info) return card;
    return html`
      <span class="cardwrap">
        ${card}
        <button class="infobtn" data-info="${id}" aria-label="About this kit">${icon('info')}</button>
      </span>`;
  }

  return html`
    <div class="card ${picked ? 'picked' : ''}" role="button" tabindex="0" data-${pickAttr}="${id}">
      ${selecting
        ? html`<span class="selbox">${icon('tick')}</span>`
        : html`<span class="thumb">${art}</span>`}
      <span class="lm">
        <span class="t">${name}</span>
        <span class="s">${type}${type ? ' · ' : ''}<span class="rt">${ratingMark}${rating
          ? html`${num(rating.stars)}`
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
