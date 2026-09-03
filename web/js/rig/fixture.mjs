/**
 * A club-shaped inventory to try the trailer solver on, in the same shape the
 * app's `/api/items` hands the browser. Not the real kit list (that lives in
 * the DB); it is sized and spread like one, which is what the solver's runtime
 * and its answers actually depend on.
 *
 * The interesting parts are deliberate:
 *  - two 7.x sails are cambered and SDM, so they are the sails that can be
 *    locked out by a diameter the trailer forgot;
 *  - one extension is short travel (0-30), so the extension is not purely a
 *    per-diameter headcount;
 *  - masts are on the real 30cm grid, so each sail accepts only two or three
 *    lengths, which is what keeps the search's branching small.
 */

const MAST_LINE = { Severne: 'Enigma', 'Neil Pryde': 'X9', Gaastra: 'Carbon', Bic: 'Techno' };
const EXT_LINE = { Severne: 'Powerjoint', 'Neil Pryde': 'X9', Gaastra: 'Alloy', Bic: 'Alloy' };
const BOOM_LINE = { Severne: 'Enigma', 'Neil Pryde': 'X9', Gaastra: 'Alloy', Bic: 'Alloy' };

let next = 1;
const id = () => next++;

const sail = (m2, luff, boom, extra = {}) => ({
  id: id(), kind: 'sail', mfr: extra.mfr || 'Neil Pryde', model: `${extra.line || 'Fusion'} ${m2}`,
  m2, luff, boom, topExt: extra.topExt || 0, cams: extra.cams || 0, diam: extra.diam || null,
  cond: extra.cond || 'Good', rate: extra.rate || null, spot: 'Rack A', faults: extra.faults || [],
});
const mast = (len, diam, mfr, cond = 'Good', faults = []) => ({
  id: id(), kind: 'mast', mfr, model: MAST_LINE[mfr] || 'Mast', len, diam, cond, rate: null, spot: 'Rack B', faults,
});
const ext = (diam, min, max, mfr, cond = 'Good') => ({
  id: id(), kind: 'ext', mfr, model: EXT_LINE[mfr] || 'Extension', min, max, diam, cond, rate: null, spot: 'Rack B', faults: [],
});
const boom = (min, max, mfr, cond = 'Good', faults = []) => ({
  id: id(), kind: 'boom', mfr, model: BOOM_LINE[mfr] || 'Boom', min, max, cond, rate: null, spot: 'Rack C', faults, diam: null,
});

export const SAILS = [
  sail(3.7, 370, 150, { line: 'Combat', mfr: 'Severne' }),
  sail(4.2, 385, 155, { line: 'Combat', mfr: 'Severne' }),
  sail(4.7, 400, 160, { line: 'Fusion' }),
  sail(5.0, 415, 165, { line: 'Fusion', topExt: 20 }),
  sail(5.3, 425, 170, { line: 'Fusion' }),
  sail(5.7, 440, 178, { line: 'Gaastra', mfr: 'Gaastra', topExt: 20 }),
  sail(6.2, 452, 186, { line: 'Fusion' }),
  sail(6.5, 462, 192, { line: 'Gaastra', mfr: 'Gaastra' }),
  sail(7.0, 475, 198, { line: 'V8', mfr: 'Severne', cams: 1, diam: 'SDM' }),
  sail(7.8, 492, 208, { line: 'V8', mfr: 'Severne', cams: 1, diam: 'SDM' }),
];

export const KIT = [
  ...SAILS,

  mast(370, 'RDM', 'Severne'),
  mast(370, 'RDM', 'Neil Pryde'),
  mast(400, 'RDM', 'Neil Pryde'),
  mast(400, 'RDM', 'Severne', 'Fair'),
  mast(400, 'SDM', 'Gaastra'),
  mast(430, 'RDM', 'Neil Pryde'),
  mast(430, 'RDM', 'Gaastra', 'Very good'),
  mast(430, 'SDM', 'Severne'),
  mast(460, 'RDM', 'Neil Pryde'),
  mast(460, 'SDM', 'Severne'),
  mast(460, 'SDM', 'Bic', 'Fair', [{ severity: 'usable', title: 'Scuffed base' }]),
  mast(490, 'SDM', 'Severne'),

  ext(  'RDM', 0, 50, 'Neil Pryde'),
  ext(  'RDM', 0, 50, 'Neil Pryde'),
  ext(  'RDM', 0, 50, 'Severne'),
  ext(  'RDM', 0, 30, 'Bic', 'Fair'),
  ext(  'SDM', 0, 50, 'Severne'),
  ext(  'SDM', 0, 50, 'Gaastra'),
  ext(  'SDM', 0, 40, 'Bic'),

  boom(140, 190, 'Neil Pryde'),
  boom(140, 190, 'Severne'),
  boom(150, 200, 'Neil Pryde'),
  boom(150, 200, 'Gaastra'),
  boom(160, 210, 'Severne'),
  boom(160, 210, 'Neil Pryde', 'Fair'),
  boom(180, 230, 'Severne'),
  boom(190, 240, 'Bic', 'Fair', [{ severity: 'usable', title: 'Stiff clamp' }]),
];

/** The sails on a trip, picked by size, the way the wizard's kit picker does. */
export const sailsBySize = (sizes) =>
  sizes.map((size) => SAILS.find((s) => Math.abs(s.m2 - size) < 0.05))
       .filter(Boolean);
