/**
 * The item tile - one shot, one line of facts, used by the Catalogue, the
 * Build picker and the Trips tab alike, so a scuffed board reads the same
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
 * Condition and location are deliberately absent. Condition doubled up with
 * the star rating - one committee-reported, one member-reviewed, both saying
 * roughly "is this fine" - and location never earned its place on a tile a
 * member is choosing kit from, not filing it away in.
 *
 * A trip is the one thing that changes any of that, and it does so through the
 * six options at the foot of the parameter list. Every one is off by default,
 * so a tile drawn without them is the tile that shipped:
 *
 *   voters    the stack of discs saying who asked for this piece;
 *   checked   ticked onto the trailer on a packing checklist;
 *   checkable the same checklist, not yet ticked;
 *   place     where it lives, in the slot the rating usually holds - while
 *             packing, the rack is the useful fact and the star score is not;
 *   out       away with somebody else's trip;
 *   dotFault  the fault as a bubble on the thumb, because the row's right-hand
 *             column has been given to the voter stack.
 */
import { html, num, numFixed, initial } from '../dom.js';
import { icon, artFor } from '../icons.js';
import { starRow, fullName, worstFault } from './bits.js';
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
 * @param {string[]|null} [opts.voters] - display names of who asked for this.
 * @param {boolean} [opts.checked] - ticked onto the trailer.
 * @param {boolean} [opts.checkable] - on a trip checklist, not yet ticked.
 * @param {{site: string, spot: string}|null} [opts.place] - shown instead of
 *   the rating while a trip is being packed.
 * @param {string|null} [opts.out] - name of the trip this piece is away with.
 * @param {boolean} [opts.dotFault] - fault as a bubble on the thumb (list only).
 */
export function itemTile(opts) {
  const {
    grid, pickAttr, id, art, size, name, type, rating, fault, saved,
    faultNoun, picked = false, selecting = false,
    voters = null, checked = false, checkable = false, place = null,
    out = null, dotFault = false,
  } = opts;

  const checkmode = checked || checkable;
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
  // Not a button: there is nothing to read that the trip page does not say
  // better, and a second target on a tile that already has one is a mis-tap.
  const outChip = out
    ? html`<span class="flagchip out ${grid ? '' : 'mini'}"
            aria-label="Away with ${out}">${icon('flag')}Out</span>`
    : '';
  const figure = size.value != null
    ? html`${size.value}<small>${size.unit}</small>`
    : (size.label || '—');
  const figureList = size.value != null
    ? html`${size.value}<u>${size.unit}</u>`
    : (size.label || '—');

  if (grid) {
    // Checklist mode moves the marks: the tick takes the top-right the fault
    // chip normally holds, and the fault slides left to join the heart.
    const corner = checkmode
      ? html`<span class="cluster">${savedMark}${faultChip}${outChip}</span>`
      : html`${savedMark}<span class="chipstack">${faultChip}${outChip}</span>`;
    const tick = checked
      ? html`<span class="tickdisc" aria-hidden="true">${icon('tick')}</span>`
      : '';
    // The rack is a button here, the same one the item page and Your rig
    // already carry: while you are packing, "where is Rack B" is the question
    // the tile has just raised, and the answer is a spot description somebody
    // has already written. In list view the row has no width for the spot, so
    // it shows the site alone and stays plain text.
    const foot = place
      ? html`<button class="rating place" data-spot="${place.spot || ''}"
              data-site="${place.site || ''}">${icon('pin')}${[place.site, place.spot].filter(Boolean).join(' · ')}</button>`
      : (rating
        ? html`<span class="rating">${starRow(rating.stars)}<span class="n">${num(rating.stars)}</span></span>`
        : html`<span class="rating muted">Not yet rated</span>`);
    return html`
      <div class="card ${picked || checked ? 'picked' : ''}" role="button" tabindex="0" data-${pickAttr}="${id}">
        <span class="shot">${art}${corner}${tick}${whoStack(voters)}</span>
        <span class="meta">
          <span class="size">${figure}</span>
          <span class="nm">${name}</span>
          ${foot}
        </span>
      </div>`;
  }

  // The bubble overhangs the thumb's corner and .thumb crops its shot, so the
  // two are siblings inside .lead rather than parent and child - otherwise the
  // crop clips the bubble away.
  const thumb = html`<span class="lead"><span class="thumb">${art}</span>${dotFault && fault
    ? html`<span class="faultdot ${fault.severity === 'out_of_action' ? 'oos' : ''}"
            role="img" aria-label="Has a fault">${icon('warning')}</span>`
    : ''}</span>`;
  const box = html`<span class="selbox">${icon('tick')}</span>`;
  // A checkable row shows the circle AND the picture: a trailer is packed by
  // looking at kit. `selecting` is the Catalogue's own mode and still swaps.
  const lead = checkmode ? html`${box}${thumb}` : (selecting ? box : thumb);
  // The rack name is the one thing on this line with no upper bound on its
  // length, so it gets a box of its own to be ellipsised in. text-overflow has
  // no effect on a flex item's own text, only on a block box's inline content.
  const facts = place
    ? html`<span class="rt">${icon('pin')}<span class="pl">${place.site}</span></span>`
    : html`<span class="rt">${ratingMark}${rating ? num(rating.stars) : 'Not yet rated'}</span>`;
  // The chip only survives in the row when the bubble has not taken it.
  const rowChip = dotFault ? '' : faultChip;
  return html`
    <div class="card ${picked || checked ? 'picked' : ''}" role="button" tabindex="0" data-${pickAttr}="${id}">
      ${lead}
      <span class="lm">
        <span class="t">${name}</span>
        <span class="s">${type}${type ? ' · ' : ''}${facts}</span>
      </span>
      ${whoStack(voters)}
      <span class="lr">${rowChip}${outChip}<span class="sz">${figureList}</span></span>
    </div>`;
}

/**
 * The tile drawn straight from an /api/items card.
 *
 * Every screen that shows the club's kit is handed the same shape by the
 * server, and every one of them was unpacking it the same way. It lives here
 * so a board looks identical in the Catalogue, in a trip's packing list and in
 * the picker sheet, and so a change to how a size or a fault reads is made once.
 * `extra` is whatever that screen is layering on: selection, ticks, voters.
 */
export function cardTile(item, grid, extra = {}) {
  return itemTile({
    grid,
    pickAttr: 'item',
    id: item.id,
    art: item.image_path
      ? html`<img src="${item.image_path}" alt="">`
      : artFor(item.rig_kind || item.component_type),
    size: item.size_value != null
      ? { value: item.component_type === 'sail' ? numFixed(item.size_value) : num(item.size_value),
          unit: item.size_unit }
      : { label: item.size_label },
    name: fullName(item),
    type: item.type,
    rating: item.rating && item.rating.n
      ? { stars: item.rating.stars, n: item.rating.n }
      : null,
    fault: worstFault(item.faults),
    saved: item.favourite,
    faultNoun: item.type,
    ...extra,
  });
}

/**
 * The stack of who asked for a piece.
 *
 * The leftmost disc sits on top and each one behind it is a step fainter, so
 * the stack reads as a pile with a front to it rather than a row that happens
 * to overlap. Depth and opacity are written per disc here rather than in CSS
 * because both depend on how many are shown, and that is a tunable
 * (--voter-cap in tokens.css).
 *
 * There is deliberately no +N counter. Three discs fading back already says
 * "several people asked", and the exact number is not a decision anybody makes
 * from a row - where it genuinely matters, on the approve deck and in the
 * pop-up this opens, it is spelled out in words.
 */
export function whoStack(voters) {
  if (!voters || !voters.length) return '';
  const css = getComputedStyle(document.documentElement);
  const cap = Number(css.getPropertyValue('--voter-cap').trim()) || 3;
  const fade = parseFloat(css.getPropertyValue('--voter-fade')) || 0.3;
  const shown = voters.slice(0, cap);
  const total = shown.length;
  const step = (i) => (total > 1 ? 1 - (1 - fade) * (i / (total - 1)) : 1);
  const discs = shown.map((who, i) => html`<span class="av"
    style="opacity:${step(i).toFixed(3)};z-index:${20 - i}">${initial(who)}</span>`);
  const label = `Asked for by ${voters.join(', ')}`;
  return html`<span class="whostack" role="button" tabindex="0"
    data-whostack="${voters.join('|')}" title="${label}" aria-label="${label}">${discs}</span>`;
}

/** What a tapped stack opens: the names in full, and the count as a word. */
export function whoPopup(names) {
  if (!names || !names.length) return;
  lightbox({
    glyph: 'flag',
    // The count goes in the title because the stack itself carries no number:
    // three discs fading back says "several", and this is where "several" is
    // spelled out. The names follow, in the order they asked.
    title: `${names.length} ${names.length === 1 ? 'member' : 'members'} asked for this`,
    sub: names.join('\n'),
  });
}

/**
 * What a tapped fault chip opens: read here rather than costing a trip to
 * the item page and losing your place in the list. `faults` is every open
 * fault on the piece, each `{title, description, severity}`.
 */
export function faultPopup(faults) {
  if (!faults || !faults.length) return;
  // A red chip opens a red pop-up. The piece is bucketed by its worst fault
  // everywhere else in the app, so the pop-up is coloured by it too rather
  // than always arriving amber and making a major fault read as a minor one.
  const major = faults.some((fault) => fault.severity === 'out_of_action');
  lightbox({
    glyph: 'warning',
    tone: major ? 'crit' : '',
    title: faults.length === 1 ? faults[0].title : `${faults.length} reported faults`,
    sub: faults.map((fault) => {
      const body = fault.description || 'No description was recorded with this one.';
      const label = faults.length > 1 ? `${fault.title}: ` : '';
      return `${label}${body}${fault.severity === 'out_of_action' ? ' (out of action)' : ''}`;
    }).join('\n\n'),
  });
}
