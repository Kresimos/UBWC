
/* ===========================================================================
   A port of the app's own helpers. starRow is lifted from web/js/ui/bits.js
   and itemTile from web/js/ui/itemTile.js, so what is drawn below is what the
   implementation will draw. New behaviour is marked NEW.
   ========================================================================= */

const STAR_D = 'M12 3.39L17.3 19.68L3.43 9.61L20.57 9.61L6.7 19.68Z';
const PITCH = 24, ROW_W = 120, INK_L = 2.43, INK_W = 19.14;
const starsRow = (colour) => `<svg viewBox="0 0 ${ROW_W} 24.35" fill="${colour}" stroke="${colour}"
  stroke-width="2.05" stroke-linejoin="round" aria-hidden="true">${
  Array.from({ length: 5 }, (_, i) =>
    `<path transform="translate(${i * PITCH} 0)" d="${STAR_D}"/>`).join('')}</svg>`;

function starRow(stars) {
  const value = Math.max(0, Math.min(5, Number(stars) || 0));
  const whole = Math.floor(value);
  const cut = whole * PITCH + INK_L + (value - whole) * INK_W;
  const pct = Math.max(0, Math.min(100, (cut / ROW_W) * 100)).toFixed(2);
  return `<span class="starrow">${starsRow('var(--star-off)')}<span class="fill" style="--cut:${pct}%">${starsRow('var(--star)')}</span></span>`;
}

const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();
const num = (v, dp = 1) => Number(v).toFixed(dp).replace(/\.0$/, '');

/* NEW — the stack of who asked for a piece.
   The leftmost disc sits on top and each one behind it is a step fainter, so
   the stack reads as a pile with a front to it. Depth and opacity are written
   per disc here rather than in CSS because both depend on how many are shown,
   and that is the --voter-cap knob. */
function whostack(voters) {
  if (!voters || !voters.length) return '';
  const css = getComputedStyle(document.documentElement);
  const cap = Number(css.getPropertyValue('--voter-cap').trim()) || 3;
  const fade = parseFloat(css.getPropertyValue('--voter-fade')) || 0.3;
  const shown = voters.slice(0, cap);
  const total = shown.length;
  const step = (i) => (total > 1 ? 1 - (1 - fade) * (i / (total - 1)) : 1);
  const discs = shown.map((v, i) =>
    `<span class="av" style="opacity:${step(i).toFixed(3)};z-index:${20 - i}">${initial(v)}</span>`).join('');
  /* No counter. Three discs fading back already says "several people asked",
     and the exact number is not a decision anybody makes from a row. Where it
     genuinely matters — the approve deck — it is spelled out in words. */
  const who = voters.join(', ');
  return `<span class="whostack" role="button" tabindex="0" title="Requested by ${who}" aria-label="Requested by ${who}">${discs}</span>`;
}

/**
 * itemTile — the shipped function, plus six options.
 *   voters   array of display names, or null
 *   checked  ticked on a packing/unpacking checklist
 *   checkable  shows the checklist control unticked
 *   place    {site, spot} shown instead of the rating
 *   out      away with another trip
 *   dotFault fault as a bubble on the thumb rather than a chip in the row
 */
function itemTile(opts) {
  const {
    grid, pickAttr = 'item', id, art, size, name, type, rating, fault, saved,
    faultNoun = 'piece', picked = false, selecting = false,
    voters = null, checked = false, checkable = false, place = null,
    out = null, dotFault = false,
  } = opts;

  const checkmode = checked || checkable;
  const savedMark = saved ? `<span class="savedmark" aria-hidden="true">${icon('heart')}</span>` : '';
  const ratingMark = saved
    ? `<span class="rt-heart" role="img" aria-label="Saved">${icon('heart')}</span>`
    : (rating ? `<span class="rt-star">${icon('star')}</span>` : '');
  const faultChip = fault
    ? `<button class="flagchip ${fault.severity === 'out_of_action' ? 'oos' : ''} ${grid ? '' : 'mini'}"
        data-flag="${id}" aria-label="What is wrong with this ${faultNoun}">
        ${icon('warning')}${fault.severity === 'out_of_action' ? 'Out' : 'Fault'}</button>`
    : '';
  const outChip = out
    ? `<span class="flagchip out ${grid ? '' : 'mini'}" aria-label="Away with ${out}">${icon('flag')}Out</span>`
    : '';
  const figure = size.value != null ? `${size.value}<small>${size.unit}</small>` : (size.label || '—');
  const figureList = size.value != null ? `${size.value}<u>${size.unit}</u>` : (size.label || '—');

  if (grid) {
    /* NEW — checklist mode moves the marks: the tick takes the top-right the
       fault chip normally holds, and the fault joins the heart top-left. */
    const corner = checkmode
      ? `<span class="cluster">${savedMark}${faultChip}${outChip}</span>`
      : `${savedMark}<span class="chipstack">${faultChip}${outChip}</span>`;
    const tick = checked ? `<span class="tickdisc" aria-hidden="true">${icon('tick')}</span>` : '';
    const foot = place
      ? `<span class="rating place">${icon('pin')}${[place.site, place.spot].filter(Boolean).join(' · ')}</span>`
      : (rating
        ? `<span class="rating">${starRow(rating.stars)}<span class="n">${num(rating.stars)}</span></span>`
        : `<span class="rating muted">Not yet rated</span>`);
    return `
      <div class="card ${picked || checked ? 'picked' : ''}" role="button" tabindex="0" data-${pickAttr}="${id}">
        <span class="shot">${art}${corner}${tick}${whostack(voters)}</span>
        <span class="meta">
          <span class="size">${figure}</span>
          <span class="nm">${name}</span>
          ${foot}
        </span>
      </div>`;
  }

  /* The bubble overhangs the thumb's corner and .thumb crops its shot, so the
     two are siblings inside .lead rather than parent and child — otherwise the
     bubble is clipped away by the crop. */
  const thumb = `<span class="lead"><span class="thumb">${art}</span>${dotFault && fault
    ? `<span class="faultdot ${fault.severity === 'out_of_action' ? 'oos' : ''}" aria-label="Has a fault">${icon('warning')}</span>`
    : ''}</span>`;
  const box = `<span class="selbox">${icon('tick')}</span>`;
  /* A checkable row shows the circle AND the picture: a trailer is packed by
     looking at kit. `selecting` is the Catalogue's own mode and still swaps. */
  const lead = checkmode ? `${box}${thumb}` : (selecting ? box : thumb);
  const facts = place
    ? `<span class="rt">${icon('pin')}${place.site}</span>`
    : `<span class="rt">${ratingMark}${rating ? num(rating.stars) : 'Not yet rated'}</span>`;
  /* The chip only survives in the row when the bubble has not taken it. */
  const rowChip = dotFault ? '' : faultChip;
  return `
    <div class="card ${picked || checked ? 'picked' : ''}" role="button" tabindex="0" data-${pickAttr}="${id}">
      ${lead}
      <span class="lm">
        <span class="t">${name}</span>
        <span class="s">${type}${type ? ' · ' : ''}${facts}</span>
      </span>
      ${whostack(voters)}
      <span class="lr">${rowChip}${outChip}<span class="sz">${figureList}</span></span>
    </div>`;
}

/* ===========================================================================
   The club's kit, near enough. Real shapes, real sizes, invented names.
   ========================================================================= */

const MINOR = { title: 'Batten tension slipping', severity: 'usable' };
const MAJOR = { title: 'Foot strap insert stripped', severity: 'out_of_action' };

const KIT = {
  b86:  { id: 1,  kind: 'board', name: 'Fanatic Freewave', size: { value: 86, unit: 'L' },  type: 'Freewave', rating: { stars: 4.2 }, site: 'Boathouse', spot: 'Rack A' },
  b111: { id: 2,  kind: 'board', name: 'Starboard Freesex', size: { value: 111, unit: 'L' }, type: 'Freeride', rating: { stars: 3.6 }, site: 'Boathouse', spot: 'Rack A' },
  b124: { id: 3,  kind: 'board', name: 'JP Magic Ride', size: { value: 124, unit: 'L' }, type: 'Freeride', rating: { stars: 4.5 }, site: 'Boathouse', spot: 'Rack B', saved: true },
  b96:  { id: 4,  kind: 'board', name: 'Tabou Rocket', size: { value: 96, unit: 'L' }, type: 'Freeride', rating: null, site: 'Cheddar', spot: 'Container' },
  s78:  { id: 10, kind: 'sail', name: 'Bic Techno', size: { value: 7.8, unit: 'm²' }, type: 'Freeride', rating: { stars: 3.9 }, site: 'Boathouse', spot: 'Sail bin' },
  s65:  { id: 11, kind: 'sail', name: 'Neil Pryde V8', size: { value: 6.5, unit: 'm²' }, type: 'Cambered', rating: { stars: 4.7 }, site: 'Boathouse', spot: 'Sail bin', saved: true },
  s58:  { id: 12, kind: 'sail', name: 'Gaastra Matrix', size: { value: 5.8, unit: 'm²' }, type: 'Freeride', rating: { stars: 3.1 }, fault: MINOR, site: 'Boathouse', spot: 'Sail bin' },
  s47:  { id: 13, kind: 'sail', name: 'Severne Blade', size: { value: 4.7, unit: 'm²' }, type: 'Wave', rating: { stars: 4.4 }, site: 'Cheddar', spot: 'Container' },
  s52:  { id: 14, kind: 'sail', name: 'Ezzy Elite', size: { value: 5.2, unit: 'm²' }, type: 'Wave', rating: null, fault: MAJOR, site: 'Boathouse', spot: 'Sail bin' },
  m460: { id: 20, kind: 'mast', name: 'Neil Pryde X6', size: { value: 460, unit: 'cm' }, type: 'RDM', rating: { stars: 4.0 }, site: 'Boathouse', spot: 'Mast tube' },
  m430: { id: 21, kind: 'mast', name: 'Severne Enigma', size: { value: 430, unit: 'cm' }, type: 'SDM', rating: { stars: 3.8 }, site: 'Boathouse', spot: 'Mast tube' },
  e30:  { id: 30, kind: 'ext', name: 'Chinook RDM', size: { value: 30, unit: 'cm' }, type: 'RDM · 0–30', rating: { stars: 3.4 }, site: 'Boathouse', spot: 'Shelf 2' },
  bm19: { id: 40, kind: 'boom', name: 'Neil Pryde X9', size: { label: '140–190' }, type: 'Alloy', rating: { stars: 4.1 }, site: 'Boathouse', spot: 'Boom rack' },
  f34:  { id: 50, kind: 'fin', name: 'MFC Freeride', size: { value: 34, unit: 'cm' }, type: 'Powerbox', rating: { stars: 3.7 }, site: 'Boathouse', spot: 'Fin box' },
  uj1:  { id: 60, kind: 'uj', name: 'Chinook base', size: { label: 'Std' }, type: 'Universal', rating: null, site: 'Boathouse', spot: 'Shelf 1' },
  wet:  { id: 70, kind: 'misc', name: "O'Neill Psycho 5/4", size: { label: 'L' }, type: 'Wetsuit', rating: { stars: 4.3 }, site: 'Boathouse', spot: 'Dry room' },
};

/* Turn a kit row into tile options, then let the caller layer trip state on. */
function tile(key, grid, extra = {}) {
  const k = KIT[key];
  return itemTile(Object.assign({
    grid, id: k.id, art: artFor(k.kind), size: k.size, name: k.name,
    type: k.type, rating: k.rating, fault: k.fault || null, saved: !!k.saved,
    faultNoun: k.kind,
  }, extra));
}
const place = (key) => ({ site: KIT[key].site, spot: KIT[key].spot });

/* ===========================================================================
   Device chrome, copied from web/index.html.
   ========================================================================= */

const TABS = [
  ['Catalogue', 'gridIcon'], ['Rig', 'sailNav'], ['Log', 'doc'],
  ['Trips', 'flag'], ['Add', 'plusCircle'],
];

function tabbar(active) {
  return `<nav class="tabbar" aria-label="Sections">${TABS.map(([label, ic]) =>
    `<button class="tab ${label === active ? 'on' : ''}">${icon(ic)}${label}</button>`).join('')}</nav>`;
}

function phone(screen, inner, activeTab) {
  return `
    <div class="phone">
      <div class="screen">
        <div class="notch" aria-hidden="true"></div>
        <div class="statusbar" aria-hidden="true">
          <span>9:41</span>
          <span class="dots">
            <svg class="sig" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="1"/><rect x="4.5" y="5" width="3" height="6" rx="1"/><rect x="9" y="2.5" width="3" height="8.5" rx="1"/><rect x="13.5" y="0" width="3" height="11" rx="1"/></svg>
            <svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor"><path d="M8.5 2.4c2.2 0 4.2.8 5.7 2.2l1.3-1.4A10 10 0 0 0 8.5.5 10 10 0 0 0 1 3.2l1.3 1.4A8 8 0 0 1 8.5 2.4Zm0 3.6c1.2 0 2.3.45 3.1 1.2l1.3-1.4a7 7 0 0 0-8.8 0l1.3 1.4A4.6 4.6 0 0 1 8.5 6Zm0 3.4L10.4 8a2.7 2.7 0 0 0-3.8 0Z"/></svg>
            <span class="batt"></span>
          </span>
        </div>
        <div class="app" data-screen="${screen}">${inner}</div>
        ${tabbar(activeTab)}
        <div class="home-ind" aria-hidden="true"></div>
      </div>
    </div>`;
}

/* ===========================================================================
   Screen furniture shared by the trip pages.
   ========================================================================= */

const bar = (title, right = '', back = true) => `
  <div class="appbar">
    <div class="row">
      ${back ? `<button class="backbtn" aria-label="Back">${icon('back')}</button>` : ''}
      <span class="ttl${back ? ' sm' : ''}">${title}</span>
      ${right}
    </div>
  </div>`;

const whopill = `<span style="margin-left:auto"><button class="whobtn dot"><span class="av">J</span></button></span>`;

const chiprail = (chips, on) => `
  <div class="chips">${chips.map((c) =>
    `<button class="chip ${c === on ? 'on' : ''}">${c}</button>`).join('')}</div>`;

const fsbtn = `
  <div class="viewtoggle fsbtn">
    <button aria-label="Filter">${icon('filter')}</button>
    <button aria-label="Sort">${icon('sortArrows')}</button>
  </div>`;

const viewtoggle = (view) => `
  <div class="viewtoggle">
    <button class="${view === 'grid' ? 'on' : ''}" aria-label="Grid view">${icon('gridIcon')}</button>
    <button class="${view === 'list' ? 'on' : ''}" aria-label="List view">${icon('listIcon')}</button>
  </div>`;

/* The hero carries where and when, not the trip's name — the app bar already
   holds that, and printing it twice on one screen said nothing the second time.
   .hpar is the photo layer the parallax drags; .wash and .htxt ride the band. */
const hero = (place, when) => `
  <div class="triphero">
    <span class="hpar" aria-hidden="true"></span>
    <div class="wash"></div>
    <div class="htxt"><b>${place}</b><span>${when}</span></div>
  </div>`;

const mrow = (ic, text) => `<div class="mrow">${icon(ic)}<span>${text}</span></div>`;

/**
 * The list's heading, carrying all three things on one ruled row: how much
 * there is, what this list is, and how to look at it. The rule above it is the
 * seam — everything above is the same at every stage, everything below is the
 * part that changes.
 */
const listhead = (title, count, view) => `
  <div class="listhead">
    <span class="count">${count}</span>
    <b class="ttx">${title}</b>
    <span class="tail">${viewtoggle(view)}</span>
  </div>`;

/** The picker sheet's plainer bar: it has no title to sit either side of. */
const kitbar = (count, view) => `
  <div class="kitbar"><span class="count">${count}</span>${viewtoggle(view)}</div>`;

const progline = (done, total) => `
  <div class="progline">
    <span><b>${done}</b> of ${total}</span>
    <span class="bar"><i style="width:${Math.round((done / total) * 100)}%"></i></span>
  </div>`;

/**
 * The forecast, read the way every windsurfer already reads one.
 *
 * Windguru's colour ramp is doing the work here, not a palette of ours: pale
 * blue through cyan, green, yellow and orange into red is a scale this club can
 * already read at a glance, and inventing a prettier one would only mean
 * everybody has to learn it. And Windguru's layout too: not bars but a grid of
 * coloured cells, one column per hour through the sailing day, gust stacked
 * above mean, each cell coloured by its own speed and carrying its number. The
 * columns touch, so the day reads as one continuous strip the way a Windguru
 * row does.
 */
const windColour = (kn) =>
  kn <= 5 ? '#D6EEF9' : kn <= 8 ? '#A8DFF0' : kn <= 11 ? '#7BD0E4'
  : kn <= 14 ? '#86D98F' : kn <= 17 ? '#C6E063' : kn <= 20 ? '#EFD84F'
  : kn <= 24 ? '#F2A93F' : kn <= 28 ? '#E76A42' : kn <= 33 ? '#D93E38' : '#B93A8A';

function windChart() {
  /* Hourly through the sailing day: [hour, mean, gust] in knots. */
  const slots = [
    ['06', 8, 12], ['07', 9, 13], ['08', 11, 16], ['09', 13, 18],
    ['10', 15, 21], ['11', 17, 23], ['12', 19, 26], ['13', 21, 28],
    ['14', 22, 29], ['15', 20, 27], ['16', 18, 24], ['17', 15, 20],
    ['18', 12, 16],
  ];
  const W = 322, n = slots.length;
  const p = W / n;              /* column pitch; the cells are square */
  const g = 1;                  /* the hairline that keeps cells countable while touching */
  const labelH = 15, H = 2 * p + labelH;
  /* Dark ink on the pale end of the ramp, white once the cell goes deep red. */
  const ink = (kn) => (kn >= 29 ? '#fff' : 'var(--app-ink)');
  const cell = (x, y, kn) => `
      <rect x="${(x + g).toFixed(1)}" y="${(y + g).toFixed(1)}"
            width="${(p - g).toFixed(1)}" height="${(p - g).toFixed(1)}"
            fill="${windColour(kn)}"/>
      <text x="${(x + p / 2).toFixed(1)}" y="${(y + p / 2 + 3.4).toFixed(1)}"
            text-anchor="middle" font-size="10" font-weight="700"
            fill="${ink(kn)}">${kn}</text>`;
  const cols = slots.map(([hour, mean, gust], i) => {
    const x = i * p;
    return `${cell(x, 0, gust)}${cell(x, p, mean)}
      <text x="${(x + p / 2).toFixed(1)}" y="${(H - 4).toFixed(1)}"
            text-anchor="middle" font-size="9" fill="var(--app-faint)">${hour}</text>`;
  }).join('');
  return `
    <div class="wind">
      <div class="wtop"><b>Saturday, SW</b><span>gust / mean, knots</span></div>
      <svg viewBox="0 0 ${W} ${H.toFixed(1)}" role="img"
           aria-label="Wind forecast for Saturday: 8 to 22 knots mean through the day, gusting 29 around 2pm">
        ${cols}
      </svg>
    </div>`;
}

/**
 * The trip summary. This is the half of the page that does NOT change: it rides
 * every stage from requesting through to done, and only the kit underneath it
 * turns into a ballot, a checklist or a manifest.
 */
const summary = () => `
  ${hero('Cheddar Reservoir', 'Saturday 14 March')}
  <div class="tripmeta">
    ${mrow('clock', 'Leaves <b>08:30</b> from the boathouse')}
    ${mrow('pin', '<b>Cheddar Reservoir</b> · 50 min in the minibus')}
    <div class="info">Minibus leaves at half eight sharp from the boathouse. Bring a
      packed lunch and a pound coin for the lockers.</div>
  </div>
  ${windChart()}`;

/* Unpacking is effectively done: the description and the forecast have nothing
   left to say, so they collapse and only where/when stays above the checklist. */
const summaryLite = () => `
  ${hero('Cheddar Reservoir', 'Saturday 14 March')}
  <div class="tripmeta">
    ${mrow('tick', 'Back at the boathouse · checking kit in')}
  </div>`;

/* ===========================================================================
   THE SCREENS
   ========================================================================= */

const SCREENS = [];
const add = (o) => SCREENS.push(o);

/* ---------------------------------------------------------------- 1. index */
const trow = (name, sub) => `
  <button class="trow">
    <span class="tsq">${icon('flag')}</span>
    <span class="tm"><b>${name}</b><span>${sub}</span></span>
    ${icon('chevronRight')}
  </button>`;

add({
  title: 'Trips', tab: 'Trips', screen: 'trip',
  desc: 'What is planned, what is being loaded, what is out, and what has been. A finished trip is kept, not deleted: it is the record of what was packed.',
  inner: `
    ${bar('Trips', whopill, false)}
    <div class="body">
      <div style="padding:2px 0 4px"><button class="askbtn">${icon('plusCircle')}Start a new trip</button></div>
      <div class="grouplab stage">Planning</div>
      ${trow('Cheddar, Saturday', 'Cheddar Reservoir · 14 Mar')}
      <div class="grouplab stage">Packing</div>
      ${trow('Weymouth weekender', 'Portland Harbour · 28–30 Mar')}
      <div class="grouplab stage">Out now</div>
      ${trow('Nottingham, March', 'Holme Pierrepont · 21–23 Mar')}
      <div class="grouplab stage">Been and gone</div>
      ${trow('Poole, February', 'Poole Harbour · 8–9 Feb')}
      ${trow('Rutland trip', 'Rutland Water · 18 Jan')}
      ${trow('Tenby, December', 'Called off · never packed')}
    </div>`,
  notes: [
    ['The group heading is the stage.', 'A trip in the Packing group is being packed; there is no chip to read as well. The one thing a grouped list cannot say, it now says by having its own group.'],
    ['These headings breathe; the ones inside a trip do not.', 'They separate whole groups of unrelated trips, so they get <code>--stage-gap</code>. A Boards heading inside one trip’s kit gets <code>--group-gap</code>, which is nearly nothing.'],
  ],
});

/* ------------------------------------------------------- 2 & 3. requesting */
add({
  title: 'Requesting · grid', tab: 'Trips', screen: 'trip',
  desc: 'The trip as a member meets it: where, when, what it is doing, then what has been asked for. Anyone can ask for a specific piece, newest request first.',
  inner: `
    ${bar('Cheddar, Saturday', '', true)}
    <div class="body">
      ${summary()}
      ${listhead('Packing list', '<b>6</b> requested · closes Thursday', 'grid')}
      <div class="itemgrid">
        ${tile('b124', true, { voters: ['Jo Marsh', 'Ben Whitlock', 'Priya Raman', 'Tom Ash', 'Cal Devine'] })}
        ${tile('s65', true, { voters: ['Ben Whitlock'] })}
        ${tile('wet', true, { voters: ['Sana Iqbal', 'Tom Ash', 'Cal Devine', 'Jo Marsh'] })}
        ${tile('s58', true, { voters: ['Priya Raman', 'Jo Marsh'] })}
      </div>
      <button class="askbtn">${icon('plusCircle')}Request kit</button>
    </div>`,
  notes: [
    ['Windguru’s colours, not ours.', 'Pale blue through cyan, green, yellow and orange into red is a scale every windsurfer already reads. And Windguru’s layout: a grid of coloured cells, one column per hour, gust stacked above mean, each cell carrying its own number. The columns touch, so the day reads as one strip.'],
    ['Request kit sits under the list.', 'The list is what a member came to read; the button to add to it waits at the foot of the grid rather than between the heading and the kit.'],
    ['Count left, name centre, view right.', 'One ruled row does all three, and the rule is the seam: above it the trip, below it the part that changes with the stage.'],
    ['Stars stay while requesting.', 'This is when a member is choosing, so the rating is the useful fact. It gives up its slot only once packing starts.'],
  ],
});

add({
  title: 'Requesting · list', tab: 'Trips', screen: 'trip',
  desc: 'The same screen in list view. This is where the voter tags had to earn their place: the fault gives up its chip and becomes a bubble on the thumb.',
  inner: `
    ${bar('Cheddar, Saturday', '', true)}
    <div class="body">
      ${summary()}
      ${listhead('Packing list', '<b>6</b> requested · closes Thursday', 'list')}
      <div class="itemlist">
        ${tile('b124', false, { voters: ['Jo Marsh', 'Ben Whitlock', 'Priya Raman', 'Tom Ash', 'Cal Devine'], dotFault: true })}
        ${tile('s65', false, { voters: ['Ben Whitlock'], dotFault: true })}
        ${tile('wet', false, { voters: ['Sana Iqbal', 'Tom Ash', 'Cal Devine', 'Jo Marsh'], dotFault: true })}
        ${tile('s58', false, { voters: ['Priya Raman', 'Jo Marsh'], dotFault: true })}
        ${tile('s52', false, { voters: ['Cal Devine'], dotFault: true })}
      </div>
      <button class="askbtn">${icon('plusCircle')}Request kit</button>
    </div>`,
  notes: [
    ['No counter on the pile.', 'Three discs fading back says “several people asked”, which is the whole message. The exact number is not a decision anybody makes, and a +N was the one thing in the stack that had to stay legible.'],
    ['The stacks line up.', 'The size column is given a fixed width, so a pile sits at the same place on every row whether the size under it reads 124L or 5.8m².'],
    ['Pale ground, deep glyph.', 'The bubble uses the same amber and red pairing as the fault chip, so the two read as one warning at two sizes rather than two different marks.'],
  ],
});

/* ------------------------------------------------------- 4. the kit picker */
add({
  title: 'Request kit', tab: 'Trips', screen: 'trip',
  desc: 'The same sheet behind “Request kit” and the “Add kit” button on the new-trip form. The one screen that keeps a type rail, because here you are searching rather than reading.',
  inner: `
    ${bar('Cheddar, Saturday', '', true)}
    <div class="body">
      ${summary()}
      ${listhead('Packing list', '<b>6</b> requested · closes Thursday', 'grid')}
    </div>
    <div class="filterpanel open">
      <div class="fp-scrim"></div>
      <div class="fp-sheet">
        <div class="fp-top">
          <div class="fp-grab"></div>
          <div class="fp-head">
            <label class="searchbar">${icon('search')}<input type="search" placeholder="Search kit…" aria-label="Search kit"></label>
          </div>
        </div>
        <div class="fp-body">
          ${chiprail(['All', 'Boards', 'Sails', 'Masts', 'Booms', 'Misc'], 'Boards')}
          <div class="kitbar" style="padding-left:0;padding-right:0">
            <span class="count"><b>11</b> boards</span>
            ${viewtoggle('grid')}
          </div>
          <div class="itemgrid" style="padding-left:0;padding-right:0">
            ${tile('b86', true, {})}
            ${tile('b111', true, { out: 'Weymouth weekender' })}
            ${tile('b124', true, {})}
            ${tile('b96', true, {})}
          </div>
        </div>
      </div>
    </div>`,
  notes: [
    ['The type rail lives here and nowhere else.', 'Every other screen either groups its kit under Boards and Sails headings or lists it newest-first, and a rail that filters by the thing the list already says is furniture. Searching is the one job it does that nothing else does.'],
    ['Two settings are made for you.', 'Location opens on <b>all</b>, because a trip takes kit from wherever it lives, and sort opens on <b>size</b>, because that is how anybody thinks about a board.'],
    ['No footer.', 'Tapping a piece asks for it and the piece says so by changing. Pull the sheet down to close it.'],
  ],
});

/* -------------------------------------------------------- 5. approve deck */
add({
  title: 'Approve or decline', tab: 'Trips', screen: 'trip',
  desc: 'The first half of the move out of requesting. One request at a time, swipe right to take it, left to leave it.',
  inner: `
    ${bar('Requests', '', true)}
    <div class="body">
      <div class="progline" style="padding-top:12px"><span><b>4</b> of 9 seen</span><span class="bar"><i style="width:44%"></i></span></div>
      <div class="deck">
        <div class="dcard b3"></div>
        <div class="dcard b2"></div>
        <div class="dcard front">
          <div class="stamp no">NOT THIS TIME</div>
          <div class="dshot">${artFor('board')}</div>
          <div class="dname">JP Magic Ride 124L</div>
          <div class="dmeta">
            <span class="drate">${starRow(4.5)}<span class="n">4.5</span></span>
            <span class="dplace">${icon('pin')}Boathouse · Rack B</span>
          </div>
          <div class="dwho">${whostack(['Jo Marsh', 'Ben Whitlock', 'Priya Raman', 'Tom Ash', 'Cal Devine'])}<span>asked for by 5 members</span></div>
        </div>
      </div>
      <div class="swipehint"><span class="no">&larr; Not this time</span><span class="yes">Take it &rarr;</span></div>
    </div>`,
  notes: [
    ['A decline is kept, and surfaces later.', 'Not here and not on the packing list, but on the <b>active</b> trip (frame 09) — that is the screen somebody is on when they are looking for the board and need to find out the answer was no.'],
    ['Here the count is spelled out.', 'The pile has no number on it, so the card underneath says “asked for by 5 members” in words. On a row there is no room for that and no need.'],
    ['The card carries the deciding facts.', 'Rating and where the piece lives, the two things the packing list also shows, so the kit sec can weigh a request without leaving the deck to look the piece up.'],
  ],
});

/* ------------------------------------------------------------- 6. wizard */
add({
  title: 'The packing wizard', tab: 'Trips', screen: 'trip',
  desc: 'The second half. With the chosen kit settled, the app works out the masts, extensions, booms, fins and bases those pieces need, through the rig wizard’s own rules.',
  inner: `
    ${bar('Working it out', '', true)}
    <div class="body">
      <div class="rigcount"><b>4</b><span>complete rigs can stand up at once</span></div>
      <div class="derived">
        <div class="drow"><span>Sails chosen</span><b>5</b></div>
        <div class="drow"><span>Masts that reach their luff</span><b>5</b></div>
        <div class="drow"><span>Extensions matching mast diameter</span><b>5</b></div>
        <div class="drow short"><span>Booms in range</span><b>4 &mdash; one short</b></div>
      </div>
      <div class="derived">
        <div class="drow"><span>Boards chosen</span><b>3</b></div>
        <div class="drow"><span>Fins matching board box</span><b>3</b></div>
        <div class="drow"><span>Bases</span><b>3</b></div>
      </div>
      <div style="padding:2px var(--gutter) 0"><div style="padding:11px 13px;border-radius:11px;background:var(--warn-tint);color:var(--warn-ink);font-size:12.5px;line-height:1.5">Nothing free fits the Ezzy 5.2’s boom length. Take it anyway, borrow one, or drop the sail.</div></div>
    </div>
    <div class="packbar">
      <button class="askbtn">${icon('tick')}Start packing</button>
    </div>`,
  notes: [['The maths is deferred, the shape is not.', 'The headline number is the question people actually ask: how many rigs can we put up at once. Filling it in properly is the next piece of work.']],
});

/* --------------------------------------------------- 7 & 8. packing lists */
add({
  title: 'Packing · grid', tab: 'Trips', screen: 'trip',
  desc: 'Same trip, same summary; only the kit has become a checklist. Grouped by type so it walks the trailer.',
  inner: `
    ${bar('Cheddar, Saturday', '', true)}
    <div class="body">
      ${summary()}
      ${listhead('Packing list', '<b>4</b> of 11 packed', 'grid')}
      <div class="grouplab">Boards</div>
      <div class="itemgrid">
        ${tile('b124', true, { checked: true, fault: MINOR, place: place('b124'), voters: ['Jo Marsh', 'Ben Whitlock', 'Priya Raman', 'Tom Ash', 'Cal Devine'] })}
        ${tile('b86', true, { checkable: true, place: place('b86') })}
      </div>
    </div>`,
  notes: [
    ['No button until the list is clear.', 'While kit is still unticked there is nothing to press — the checklist is the whole screen. The pack bar appears with the last tick, carrying <b>Complete packing</b> (frame 08).'],
    ['The trip does not disappear when the job starts.', 'Same hero, same details, same forecast — because the wind on the day is exactly what you are still thinking about while you load. Only the list below the rule has changed.'],
    ['Two corners, and they never collide.', 'The tick disc takes the top-right that the fault chip normally holds, so the fault slides left to sit <b>beside</b> the heart. The first tile shows all three at once: saved, faulted and ticked.'],
    ['The star row becomes the rack.', 'While packing, where a piece lives is the only useful fact. Same slot, same size, so nothing shifts when the trip changes stage.'],
  ],
});

add({
  title: 'Packing · list', tab: 'Trips', screen: 'trip',
  desc: 'The view a trailer actually gets packed from: type, then size, then name, so you work along the rack rather than hunting. Shown at the moment the last piece is ticked; frame 11 has the empty circles.',
  inner: `
    ${bar('Cheddar, Saturday', '', true)}
    <div class="body">
      ${summary()}
      ${listhead('Packing list', '<b>11</b> of 11 packed', 'list')}
      <div class="grouplab">Boards</div>
      <div class="itemlist">
        ${tile('b86', false, { checked: true, place: place('b86'), dotFault: true })}
        ${tile('b124', false, { checked: true, fault: MINOR, place: place('b124'), dotFault: true, voters: ['Jo Marsh', 'Ben Whitlock', 'Priya Raman', 'Tom Ash', 'Cal Devine'] })}
      </div>
      <div class="grouplab">Sails</div>
      <div class="itemlist">
        ${tile('s47', false, { checked: true, place: place('s47'), dotFault: true })}
        ${tile('s58', false, { checked: true, place: place('s58'), dotFault: true, voters: ['Priya Raman', 'Jo Marsh'] })}
      </div>
    </div>
    <div class="packbar">
      <button class="askbtn">${icon('tick')}Complete packing</button>
    </div>`,
  notes: [
    ['The circle joins the thumbnail, it does not replace it.', 'A trailer is packed by looking at kit, so the picture stays and the pair is tightened by 4px to buy the width back. The circle is the catalogue’s own select box.'],
    ['Type headings sit tight.', 'Nearly no gap above them: they divide one trip’s kit into sections, and air there would read as a break between unrelated things. That is <code>--group-gap</code>, and it is a different number from the trips index.'],
    ['A ticked row runs to the glass.', 'The tint carries out past the list’s gutter to the screen edge, painted rather than laid out, so no thumb moves and the grid still lines up.'],
  ],
});

/* -------------------------------------------------------------- 9. active */
add({
  title: 'Active', tab: 'Trips', screen: 'trip',
  desc: 'Packed and gone. Same summary as every other stage; the list below the rule has stopped being a checklist and become the manifest.',
  inner: `
    ${bar('Cheddar, Saturday', '', true)}
    <div class="body">
      ${summary()}
      ${listhead('Trip kit', '<b>11</b> pieces', 'list')}
      <div class="grouplab">Boards</div>
      <div class="itemlist">
        ${tile('b86', false, { dotFault: true })}
        ${tile('b124', false, { voters: ['Jo Marsh', 'Ben Whitlock', 'Priya Raman', 'Tom Ash', 'Cal Devine'], dotFault: true })}
      </div>
      <div class="grouplab">Sails</div>
      <div class="itemlist">
        ${tile('s65', false, { voters: ['Ben Whitlock'], dotFault: true })}
      </div>
    </div>
    <div class="packbar">
      <button class="askbtn ghost">${icon('refresh')}Unpack kit</button>
    </div>`,
  notes: [
    ['The stars come back.', 'Nobody is packing now, so the rating is the useful fact again and the rack is not.'],
    ['The tags stay, and stay tappable.', 'On the water, “who asked for the 124?” is a real question. The app answers it and then stays out of the argument.'],
    ['The summary stays whole here, and collapses at unpacking.', 'While a trip is out the wind on the day is still the thing people check, so the forecast stays. Once it is back (frame 11) the description and forecast drop away and only where and when remain.', 'ask'],
  ],
});

add({
  title: 'Active · declined kit', tab: 'Trips', screen: 'trip',
  desc: 'The foot of the previous screen, scrolled. Not a separate page — but it is the one thing on the trip that would otherwise never be seen, so it gets its own frame here.',
  inner: `
    ${bar('Cheddar, Saturday', '', true)}
    <div class="body">
      <div class="grouplab">Sails</div>
      <div class="itemlist">
        ${tile('s58', false, { voters: ['Priya Raman', 'Jo Marsh'], dotFault: true })}
        ${tile('s65', false, { voters: ['Ben Whitlock'], dotFault: true })}
      </div>
      <div class="grouplab">Masts</div>
      <div class="itemlist">
        ${tile('m460', false, { dotFault: true })}
      </div>
      <div class="declined">
        <div class="grouplab">Declined kit</div>
        <div class="dnote">Asked for, but not on this trip.</div>
        <div class="itemlist">
          ${tile('b111', false, { voters: ['Tom Ash', 'Sana Iqbal'], dotFault: true })}
          ${tile('s47', false, { voters: ['Cal Devine'], dotFault: true })}
        </div>
      </div>
    </div>
    <div class="packbar">
      <button class="askbtn ghost">${icon('refresh')}Unpack kit</button>
    </div>`,
  notes: [
    ['Declines belong here, and only here.', 'This is the screen somebody is on when they are stood at the trailer looking for the 111. Greyed out, in their own section, right at the bottom: the answer, where the question gets asked.'],
    ['Greyed and desaturated, not hidden.', 'A declined piece keeps its discs, so you can also see who else wanted it and go and ask them.'],
  ],
});

/* ---------------------------------------------------------- 10. unpacking */
add({
  title: 'Unpacking', tab: 'Trips', screen: 'trip',
  desc: 'The same checklist, run backwards. A tick means it is back on its rack, which is where the app has said it lives the whole time.',
  inner: `
    ${bar('Cheddar, Saturday', '', true)}
    <div class="body">
      ${summaryLite()}
      ${listhead('Checking back in', '<b>9</b> of 11 back', 'list')}
      <div class="grouplab">Boards</div>
      <div class="itemlist">
        ${tile('b86', false, { checked: true, place: place('b86'), dotFault: true })}
        ${tile('b124', false, { checked: true, place: place('b124'), dotFault: true, voters: ['Jo Marsh', 'Ben Whitlock', 'Priya Raman'] })}
      </div>
      <div class="grouplab">Sails</div>
      <div class="itemlist">
        ${tile('s58', false, { checkable: true, place: place('s58'), dotFault: true, voters: ['Priya Raman', 'Jo Marsh'] })}
      </div>
    </div>`,
  notes: [
    ['The summary has collapsed.', 'The trip is home, so the blurb and the forecast are gone — where and when is all that is left above the list.'],
    ['No button while kit is still out.', 'Same rule as packing: the bar appears with the last tick, to close the trip and hand everything back to the rig assistant.'],
    ['The unticked row, for comparison.', 'The Gaastra is still in the trailer: empty circle, no tint, thumbnail and fault bubble exactly as on every other row.'],
  ],
});

/* ----------------------------------------------------------- 11. add trip */
add({
  title: 'New trip', tab: 'Trips', screen: 'form',
  desc: 'The add-kit form, reused. Same app bar, same field groups, same fixed save bar, so it needs no learning.',
  inner: `
    ${bar('New trip', '', true)}
    <div class="body pad">
      <div class="form">
        <button class="photo" type="button">
          <span class="cam">${icon('camera')}</span>
          <span class="t">Add photo</span>
          <span class="h">A shot of the spot, so the trip is recognisable in the list. Optional.</span>
        </button>
        <div class="grp">
          <span class="lab"><span class="req"></span>Trip name</span>
          <div class="inp"><input type="text" value="Cheddar, Saturday"></div>
        </div>
        <div class="grp">
          <span class="lab">Where</span>
          <div class="inp"><input type="text" value="Cheddar Reservoir"></div>
        </div>
        <div class="two">
          <div class="grp">
            <span class="lab">Leaves</span>
            <div class="inp"><input type="text" value="14 Mar"></div>
          </div>
          <div class="grp">
            <span class="lab">Back</span>
            <div class="inp"><input type="text" value="14 Mar"></div>
          </div>
        </div>
        <div class="grp">
          <span class="lab">Let members request kit first</span>
          <button class="inp sel"><span class="v">Yes, until I pick the kit</span>${icon('chevronDown')}</button>
        </div>
        <div class="grp">
          <span class="lab">Anything members should know</span>
          <div class="inp"><textarea>Minibus leaves at half eight sharp. Bring a packed lunch.</textarea></div>
        </div>
        <div class="grp">
          <span class="lab">Kit</span>
          <button class="askbtn">${icon('plusCircle')}Add kit</button>
          <div class="itemlist">
            ${tile('b124', false, { dotFault: true })}
            ${tile('s65', false, { dotFault: true })}
          </div>
        </div>
      </div>
    </div>
    <div class="actionbar">
      <button class="bigbtn">Start the trip${icon('tick')}</button>
    </div>`,
  notes: [
    ['Kit goes last.', 'The description and the request-first switch sit above it: they are decisions made once when the trip is set up, while the kit list is filled in over the days after and grows longest.'],
    ['“Add kit” opens frame 04.', 'One picker, two entrances: the kit sec uses it here, a member uses it from the trip page.'],
    ['Long-press to remove.', 'Taking a piece off this list, or withdrawing your own request, is the press-and-hold the catalogue already uses.'],
  ],
});

/* ------------------------------------------- 12 & 13. catalogue and rig */
add({
  title: 'Catalogue · out', tab: 'Catalogue', screen: 'catalogue',
  desc: 'The one change kit away with a trip forces on the rest of the app: a grey chip that says so, stacking under a fault when a piece has both.',
  inner: `
    ${bar('Catalogue', whopill, false)}
    ${chiprail(['All', 'Boards', 'Sails', 'Masts', 'Booms', 'Misc'], 'All')}
    <div class="subbar">
      ${fsbtn}
      <span class="count"><b>24</b> pieces</span>
      ${viewtoggle('grid')}
    </div>
    <div class="body">
      <div class="itemgrid">
        ${tile('b111', true, { out: 'Weymouth weekender' })}
        ${tile('s58', true, { out: 'Weymouth weekender' })}
        ${tile('b86', true, {})}
        ${tile('s65', true, {})}
      </div>
    </div>`,
  notes: [
    ['The chip has no tap.', 'There is nothing to read that the trip page does not say better, and a second button on a tile that already has one is a mis-tap waiting to happen.'],
    ['The catalogue keeps its type rail.', 'Here it is the only way to narrow a list of everything the club owns — the same reason the kit picker keeps one.'],
  ],
});

add({
  title: 'Status, not Faults', tab: 'Catalogue', screen: 'catalogue',
  desc: 'The filter section grows a fourth thing to be, so it stops being called Faults. Trips also join the location list.',
  inner: `
    ${bar('Catalogue', whopill, false)}
    <div class="body"><div class="itemgrid">${tile('b86', true, {})}${tile('s65', true, {})}</div></div>
    <div class="filterpanel open">
      <div class="fp-scrim"></div>
      <div class="fp-sheet">
        <div class="fp-top">
          <div class="fp-grab"></div>
          <div class="fp-head"><label class="searchbar">${icon('search')}<input type="search" placeholder="Search kit…" aria-label="Search kit"></label></div>
        </div>
        <div class="fp-body">
          <div class="fpsect">
            <div class="fplab">Status</div>
            <div class="fpopts">
              <button class="fpopt on">No faults</button>
              <button class="fpopt amber on">Minor faults</button>
              <button class="fpopt red">Major faults</button>
              <button class="fpopt">On trip</button>
            </div>
          </div>
          <div class="fpsect">
            <div class="fplab">Location</div>
            <div class="fpopts">
              <button class="fpopt on">All</button>
              <button class="fpopt">Boathouse</button>
              <button class="fpopt">Cheddar</button>
              <button class="fpopt">${icon('flag')}Weymouth weekender</button>
              <button class="fpopt">${icon('flag')}Cheddar, Saturday</button>
            </div>
          </div>
          <div class="fpsect">
            <div class="fplab">Sort by</div>
            <div class="fpopts">
              <button class="fpopt">Newest</button><button class="fpopt on">Size</button>
              <button class="fpopt">Rating</button><button class="fpopt">Name</button>
            </div>
          </div>
        </div>
        <div class="fp-foot">
          <button class="fp-reset">Reset</button>
          <span class="fp-count"><b>24</b> shown</span>
          <button class="fp-done">Done</button>
        </div>
      </div>
    </div>`,
  notes: [
    ['A trip is a location you can filter to, and never one kit moves to.', 'Picking a trip lists what it took, without the grey chips: inside its own trip, nothing is away.'],
    ['The rig assistant just loses them.', 'Kit that is out is hidden from suggestions outright, exactly as out-of-action kit already is. If two trips somehow claim one piece, both show it and neither can rig it.'],
    ['This panel keeps its footer.', 'Unlike the kit picker in frame 04: here Reset genuinely undoes a set of filters you cannot otherwise see the extent of.'],
  ],
});

/* --------------------------------------------------------- 14. past trip */
add({
  title: 'Done', tab: 'Trips', screen: 'trip',
  desc: 'The reason finished trips are kept: what went, and what did not come home.',
  inner: `
    ${bar('Poole, February', '', true)}
    <div class="body">
      ${hero('Poole Harbour', '8–9 February')}
      <div class="tripmeta">
        ${mrow('tick', '<b>18 of 19</b> came back')}
        ${mrow('warning', 'Ezzy Elite 5.2 never returned — reported as a fault')}
      </div>
      ${listhead('What went', '<b>19</b> pieces', 'list')}
      <div class="grouplab">Boards</div>
      <div class="itemlist">
        ${tile('b86', false, { dotFault: true })}
        ${tile('b111', false, { voters: ['Tom Ash', 'Sana Iqbal'], dotFault: true })}
      </div>
      <div class="grouplab">Sails</div>
      <div class="itemlist">
        ${tile('s58', false, { voters: ['Priya Raman'], dotFault: true })}
        ${tile('s52', false, { dotFault: true })}
      </div>
    </div>`,
  notes: [
    ['The forecast goes, the summary stays.', 'A finished trip keeps its where and when; what the wind was going to do stopped being useful the moment it did it.'],
    ['No declines here.', 'A finished trip is a record of what went. What was asked for and refused mattered while the trip was running, on frame 09, and stops mattering once it is back.'],
  ],
});

/* ===========================================================================
   Paint the wall.
   ========================================================================= */

const rack = document.getElementById('rack');
rack.innerHTML = SCREENS.map((s, i) => `
  <div class="slot">
    <div class="cap">
      <b><span class="num">${String(i + 1).padStart(2, '0')}</span>${s.title}</b>
      <span>${s.desc}</span>
    </div>
    ${phone(s.screen, s.inner, s.tab)}
    ${(s.notes || []).map(([h, body, kind]) =>
      `<div class="note ${kind || ''}"><b>${h}</b> ${body}</div>`).join('')}
  </div>`).join('');

/* The hero parallax. The band scrolls with the page; the photo layer inside it
   is dragged back at a fraction of that, written as a translate on .hpar from
   how far the band has travelled up its own scroll box (.body). Each frame's
   .body is its own scroller, so every hero is wired separately. */
function wireParallax() {
  const RATE = 0.32; /* image moves this fraction as fast as the band */
  document.querySelectorAll('.phone .body').forEach((scroller) => {
    const hpar = scroller.querySelector('.triphero .hpar');
    if (!hpar) return;
    const band = hpar.parentElement;
    const paint = () => {
      /* offset of the band's top below the scroller's top: 0 when flush,
         negative once it has scrolled up out of view. */
      const top = band.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      hpar.style.setProperty('--hpar', `${(-top * RATE).toFixed(1)}px`);
    };
    scroller.addEventListener('scroll', paint, { passive: true });
    paint();
  });
}
wireParallax();

/* The voter tags are the one thing on the page that has to actually work: the
   whole point of the stack is that it opens into the full list. */
document.addEventListener('click', (event) => {
  const stack = event.target.closest('.whostack');
  if (!stack) return;
  event.stopPropagation();
  const who = (stack.getAttribute('title') || '').replace(/^Requested by /, '');
  const names = who.split(', ').filter(Boolean);
  const box = document.getElementById('whopop');
  box.querySelector('.wp-list').innerHTML = names.map((n) =>
    `<div class="wp-row"><span class="av">${initial(n)}</span>${n}</div>`).join('');
  box.querySelector('.wp-count').textContent =
    `${names.length} ${names.length === 1 ? 'member asked' : 'members asked'} for this`;
  box.hidden = false;
});
document.addEventListener('click', (event) => {
  const box = document.getElementById('whopop');
  if (!box.hidden && !event.target.closest('.wp-card') && !event.target.closest('.whostack')) box.hidden = true;
});

/* ===========================================================================
   The tuner. Every knob writes a CSS custom property on :root, which is where
   src/design.css declares it, so a drag retunes all fourteen frames at once.
   ========================================================================= */

const KNOBS = [
  ['Voter tags', [
    ['--voter-size', 'Disc size, grid', 14, 30, 1, 'px'],
    ['--voter-size-list', 'Disc size, list', 12, 28, 1, 'px'],
    ['--voter-overlap', 'Overlap', 0, 16, 1, 'px'],
    ['--voter-cap', 'Discs before +N', 1, 6, 1, ''],
    ['--voter-ring', 'Separating ring', 0, 4, .5, 'px'],
    ['--voter-font', 'Initial size', 7, 13, .5, 'px'],
    ['--voter-fade', 'Fade on the last disc', 0, 1, .05, ''],
  ]],
  ['Check disc', [
    ['--tick-size', 'Diameter', 16, 34, 1, 'px'],
    ['--tick-inset', 'Corner inset', 0, 16, 1, 'px'],
  ]],
  ['Fault bubble', [
    ['--faultdot-size', 'Diameter', 12, 26, 1, 'px'],
    ['--faultdot-inset', 'Corner offset', -8, 6, 1, 'px'],
  ]],
  ['Cluster', [
    ['--cluster-gap', 'Heart to fault gap', 0, 12, 1, 'px'],
  ]],
  ['List rhythm', [
    ['--group-gap', 'Above a type heading', 0, 22, 1, 'px'],
    ['--stage-gap', 'Above a stage heading', 0, 34, 1, 'px'],
    ['--size-col-w', 'Size column width', 40, 90, 1, 'px'],
  ]],
];

const root = document.documentElement;
const readVar = (name) => getComputedStyle(root).getPropertyValue(name).trim();
const DEFAULTS = {};
KNOBS.forEach(([, list]) => list.forEach(([name]) => { DEFAULTS[name] = readVar(name); }));

const body = document.getElementById('tunerbody');
body.innerHTML = KNOBS.map(([group, list]) => `
  <div class="grp">${group}</div>
  ${list.map(([name, label, min, max, step, unit]) => {
    const value = parseFloat(DEFAULTS[name]) || 0;
    return `<div class="knob">
      <label for="k${name}">${label}</label>
      <output id="o${name}">${value}${unit}</output>
      <input id="k${name}" type="range" min="${min}" max="${max}" step="${step}"
             value="${value}" data-var="${name}" data-unit="${unit}">
    </div>`;
  }).join('')}`).join('') + `
  <div class="tunerfoot">
    <button id="tReset">Reset</button>
    <button id="tCopy" class="pri">Copy CSS</button>
  </div>
  <div class="tunerout" id="tOut"></div>`;

function apply(input) {
  const name = input.getAttribute('data-var');
  const unit = input.getAttribute('data-unit');
  root.style.setProperty(name, input.value + unit);
  document.getElementById('o' + name).textContent = input.value + unit;
  /* Depth and opacity are written per disc by JS, not by CSS, so anything that
     changes how many discs there are or how far they fade rebuilds them. */
  if (name === '--voter-cap' || name === '--voter-fade') repaintStacks();
}

/* Rebuilding every stack in place keeps the frames from being thrown away. */
function repaintStacks() {
  document.querySelectorAll('.whostack').forEach((stack) => {
    const who = (stack.getAttribute('title') || '').replace(/^Requested by /, '');
    const names = who.split(', ').filter(Boolean);
    stack.outerHTML = whostack(names);
  });
}

body.addEventListener('input', (event) => {
  if (event.target.matches('input[type=range]')) apply(event.target);
});

document.getElementById('tReset').addEventListener('click', () => {
  body.querySelectorAll('input[type=range]').forEach((input) => {
    input.value = parseFloat(DEFAULTS[input.getAttribute('data-var')]) || 0;
    apply(input);
  });
  document.getElementById('tOut').style.display = 'none';
});

document.getElementById('tCopy').addEventListener('click', () => {
  const lines = [];
  KNOBS.forEach(([group, list]) => {
    lines.push('  /* ' + group + ' */');
    list.forEach(([name, , , , , unit]) => {
      const input = document.getElementById('k' + name);
      lines.push('  ' + name + ': ' + input.value + unit + ';');
    });
  });
  const css = ':root {\n' + lines.join('\n') + '\n}';
  const out = document.getElementById('tOut');
  out.textContent = css;
  out.style.display = 'block';
  if (navigator.clipboard) navigator.clipboard.writeText(css).catch(() => {});
  const btn = document.getElementById('tCopy');
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = 'Copy CSS'; }, 1400);
});
</script>

<div id="whopop" class="whopop" hidden>
  <div class="wp-card">
    <div class="wp-count"></div>
    <div class="wp-list"></div>
    <button class="wp-close" onclick="document.getElementById('whopop').hidden = true">Close</button>
  </div>
</div>

<style>
/* the voter-tag popup, drawn on the wall rather than inside a handset because
   it belongs to whichever frame you tapped */
.whopop { position: fixed; inset: 0; z-index: 120; display: flex; align-items: center; justify-content: center; background: rgba(8, 24, 26, .42); }
.whopop[hidden] { display: none; }
.wp-card {
  background: var(--cv-panel); color: var(--cv-ink); border-radius: 16px; padding: 20px 22px;
  width: 290px; box-shadow: 0 24px 60px -20px rgba(6, 26, 30, .6);
  font-family: "Public Sans", -apple-system, sans-serif;
}
.wp-count { font-size: 12px; font-weight: 600; color: var(--cv-faint); margin-bottom: 12px; }
.wp-row { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 500; padding: 6px 0; }
.wp-row .av {
  width: 28px; height: 28px; border-radius: 50%; background: #10788A; color: #fff;
  font-size: 12px; font-weight: 750; display: flex; align-items: center; justify-content: center; flex: none;
}
.wp-close {
  margin-top: 14px; width: 100%; height: 36px; border-radius: 9px; border: 1px solid var(--cv-rule);
  background: var(--cv-bg); color: var(--cv-ink); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
}
</style>
