/**
 * Every glyph in the app.
 *
 * misc/spec.md bans emoji outright, including the thumbs of the kit rating, so
 * this file is the whole icon vocabulary — one drawn SVG each, taken from the
 * sketches. Colour comes from `currentColor` and size from CSS, so an icon
 * always matches the text it sits beside.
 */
import { raw } from './dom.js';

const stroke = (d, width = 2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const icons = {
  // navigation
  back: stroke('<path d="m15 6-6 6 6 6"/>', 2.2),
  chevronRight: stroke('<path d="m9 6 6 6-6 6"/>', 2.4),
  chevronDown: stroke('<path d="m6 9 6 6 6-6"/>', 2.4),
  chevronUp: stroke('<path d="m6 15 6-6 6 6"/>', 2.4),
  arrowRight: stroke('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>', 2.2),
  close: stroke('<path d="M6 6l12 12M18 6 6 18"/>', 2.2),
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  tick: stroke('<path d="m5 12 5 5L20 6"/>', 3),
  plus: stroke('<path d="M12 5v14M5 12h14"/>', 2.2),
  pin: stroke('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/>', 2.2),
  edit: stroke('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  camera: stroke('<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.2"/>'),
  image: stroke('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5L5 20"/>'),
  info: stroke('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>'),
  warning: stroke('<path d="M12 3 2 20h20Z"/><path d="M12 10v4"/><path d="M12 17h.01"/>', 2.2),
  clock: stroke('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 2.2),
  refresh: stroke('<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>'),
  wind: stroke('<path d="M3 8h10a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h9a2.4 2.4 0 1 1-2 3.7"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5Z"/></svg>',
  key: stroke('<circle cx="8" cy="14" r="4"/><path d="m11 11 8-8"/><path d="m17 5 2 2"/><path d="m14 8 2 2"/>'),
  logout: stroke('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
  listIcon: stroke('<path d="M4 6h16M4 12h16M4 18h16"/>', 2.4),
  filter: stroke('<path d="M3 5h18l-7 8v5l-4 2v-9Z"/>', 2),
  sortArrows: stroke('<path d="M8 4v16M8 4 5 7m3-3 3 3M16 20V4m0 16-3-3m3 3 3-3"/>', 2),
  gridIcon: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>',
  // The star is a pentagram: ONE path through the five points in the order
  // 1,3,5,2,4, stroked with a round join and filled. That is how the Unicode
  // star is built, and it is why this reads rounder than a ten-vertex star
  // would - the stroke blunts the five points and fattens the arms in the same
  // move. Stroke width is 0.2276x the pentagram's radius, the ratio measured
  // off the system star itself: it puts the inner/outer radius at 0.469, where
  // a bare pentagram sits at 0.382. Ink spans y 3.01-21.34, exactly the heart's
  // box, so the two are the same height and align top and bottom.
  star: '<svg viewBox="0 0 24 24.35" fill="currentColor" stroke="currentColor" stroke-width="2.05" stroke-linejoin="round"><path d="M12 3.39L17.3 19.68L3.43 9.61L20.57 9.61L6.7 19.68Z"/></svg>',
  thumbUp: stroke('<path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"/><path d="M7 11l4.2-8a2 2 0 0 1 1.8 3v3h5.4a2 2 0 0 1 2 2.5l-1.5 6A2 2 0 0 1 17 20H7"/>'),
  thumbDown: stroke('<path d="M17 13V4h3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1Z"/><path d="M17 13l-4.2 8a2 2 0 0 1-1.8-3v-3H5.6a2 2 0 0 1-2-2.5l1.5-6A2 2 0 0 1 7 4h10"/>'),
  doc: stroke('<path d="M6 3h9l3 3v15H6Z"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  plusCircle: stroke('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
  sailNav: stroke('<path d="M7 3v18"/><path d="M7 5c9 1 13 6 15 13-8 1-12 3-15 5Z"/>'),
  box: stroke('<rect x="4" y="2.5" width="16" height="19" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/>', 1.6),
  trash: stroke('<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>'),
  move: stroke('<path d="M12 3v18M3 12h18"/><path d="m8 7 4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4"/>', 1.8),
  chart: stroke('<path d="M4 4v16h16"/><path d="m7 15 4-5 3 3 4-6"/>', 2),
  // The saved mark, everywhere a piece can be saved. Two things are tuned here.
  // The bottom point is filleted with r=1.025, which is the star's own
  // round-join radius, so both glyphs are rounded by the same amount and read
  // as one family; the two edges run tangent to that fillet.
  // Then the whole path is scaled to 0.92 about its centre. At an equal box
  // height a heart carries 58.6% more ink than a star and so reads bigger, and
  // 0.92 is where they stop fighting. Carrying that correction in the path
  // rather than in CSS is what lets every call site below use one plain size.
  // Both glyphs are then nudged off their bounding-box centre, because a shape
  // reads from where its ink actually sits, not from its box. A five-point star
  // carries its mass 4.7% of its height BELOW its box centre (one point up, two
  // broad points down), so box-centring makes it read low; a heart carries its
  // mass 8.2% ABOVE (wide lobes, tapering point), so it reads high. Each is
  // corrected by 75% of that offset, which is where the two stop disagreeing
  // with each other and with a line of text - full correction overshoots and
  // pushes the star's point above the cap line.
  heart: '<svg viewBox="0 0 24 24.35" fill="currentColor"><path d="M11.37 21.4L10.67 20.74C5.93 16.37 2.8 13.48 2.8 9.93C2.8 7.04 5.03 4.76 7.86 4.76C9.46 4.76 11 5.53 12 6.72C13 5.53 14.54 4.76 16.14 4.76C18.97 4.76 21.2 7.04 21.2 9.93C21.2 13.48 18.07 16.37 13.33 20.75L12.63 21.4A0.95 0.97 0 0 1 11.37 21.4Z"/></svg>',
  // The unsaved state of the same mark: the identical outline, stroked rather
  // than filled. The path is inset by half the stroke so the stroke's outer
  // edge lands back on the filled heart's box, which means the two states are
  // the same size and tapping does not make the glyph jump.
  heartOutline: '<svg viewBox="0 0 24 24.35" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"><path d="M11.43 20.55L10.8 19.96C6.55 16.03 3.76 13.45 3.76 10.27C3.76 7.68 5.75 5.64 8.29 5.64C9.73 5.64 11.1 6.33 12 7.4C12.9 6.33 14.27 5.64 15.71 5.64C18.25 5.64 20.24 7.68 20.24 10.27C20.24 13.45 17.45 16.03 13.2 19.97L12.57 20.55A0.85 0.86 0 0 1 11.43 20.55Z"/></svg>',
};

/**
 * Product artwork, standing in for the uploaded shop-panel photographs until
 * an item has one. Each is the silhouette of the thing itself, so a list reads
 * at a glance even before any photos exist.
 */
export const art = {
  sail: '<svg class="art" viewBox="0 0 100 130" fill="none" stroke="#10788A" stroke-width="3" stroke-linejoin="round"><path d="M34 6v118"/><path d="M34 12C64 20 84 46 88 86 64 90 46 108 34 122Z" fill="#10788A" fill-opacity=".1"/></svg>',
  wing: '<svg class="art" viewBox="0 0 24 24" fill="none" stroke="#10788A" stroke-width="2" stroke-linejoin="round"><path d="M12 3c5 3 7 8 6 18-4-2-8-2-12 0-1-10 1-15 6-18Z" fill="#10788A" fill-opacity=".1"/></svg>',
  mast: '<svg class="art" viewBox="0 0 24 48" fill="none" stroke="#10788A" stroke-width="3.4" stroke-linecap="round"><path d="M12 4c1.2 13 1.2 27 0 40"/><path d="M8.5 44h7"/></svg>',
  ext: '<svg class="art" viewBox="0 0 40 24" fill="none" stroke="#10788A" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h6M29 12h6"/><rect x="12" y="7.5" width="16" height="9" rx="2.4" fill="#10788A" fill-opacity=".08"/></svg>',
  boom: '<svg class="art" viewBox="0 0 40 24" fill="none" stroke="#10788A" stroke-width="2.4" stroke-linejoin="round"><path d="M9 12c0-4 6-7 14-7s14 3 14 7-6 7-14 7-14-3-14-7Z" fill="#10788A" fill-opacity=".08"/><path d="M3 12h6"/></svg>',
  board: '<svg class="art" viewBox="0 0 44 22" fill="none" stroke="#10788A" stroke-width="2.4" stroke-linejoin="round"><path d="M3 11c9-6 29-6 38 0-9 6-29 6-38 0Z" fill="#10788A" fill-opacity=".08"/><path d="M16 8v6"/></svg>',
  fin: '<svg class="art" viewBox="0 0 24 24" fill="none" stroke="#10788A" stroke-width="2.2" stroke-linejoin="round"><path d="M7 4c9 1 12 8 11 16-4-1-8-1-11 0Z" fill="#10788A" fill-opacity=".08"/></svg>',
  foil: '<svg class="art" viewBox="0 0 24 24" fill="none" stroke="#10788A" stroke-width="2" stroke-linejoin="round"><path d="M3 9h13a3 3 0 0 0 0-6c-2 0-3 1-3 3" fill="#10788A" fill-opacity=".08"/><path d="M11 9v5l-3 7"/><path d="M11 14l4 7"/></svg>',
  uj: '<svg class="art" viewBox="0 0 24 24" fill="none" stroke="#10788A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v7"/><circle cx="12" cy="13" r="3" fill="#10788A" fill-opacity=".1"/><path d="M7 21h10"/><path d="M9 21l1-4M15 21l-1-4"/></svg>',
  misc: '<svg class="art" viewBox="0 0 24 24" fill="none" stroke="#10788A" stroke-width="2" stroke-linejoin="round"><path d="M4 7h16v13H4Z" fill="#10788A" fill-opacity=".07"/><path d="M4 7l2-3h12l2 3"/><path d="M10 11h4"/></svg>',
};

/** The right artwork for an item, whichever vocabulary the caller is in. */
export function artFor(kindOrType) {
  return raw(art[kindOrType] || art.misc);
}

export function icon(name) {
  return raw(icons[name] || '');
}
