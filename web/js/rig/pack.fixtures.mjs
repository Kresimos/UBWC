/**
 * A club-shaped rack to try the solver against, standing in for the real
 * inventory until the DB is wired up. Sizes are the ones UBWC actually owns
 * shapes of: masts on the 30cm grid, two diameter classes, a couple of short
 * extensions that only reach 30cm so the mast and extension choices genuinely
 * couple, and two cammed sails locked to SDM.
 */

const rate = (avg) => ({ avg });

export const SAILS = [
  { id: 's45', kind: 'sail', mfr: 'Neil Pryde', model: 'Fusion 4.5', m2: 4.5, luff: 400, topExt: 0, boom: 150, cams: 0, diam: null },
  { id: 's50', kind: 'sail', mfr: 'Neil Pryde', model: 'Fusion 5.0', m2: 5.0, luff: 415, topExt: 0, boom: 158, cams: 0, diam: null },
  { id: 's55', kind: 'sail', mfr: 'Duotone', model: 'Super Hero 5.5', m2: 5.5, luff: 430, topExt: 0, boom: 166, cams: 0, diam: null },
  { id: 's60', kind: 'sail', mfr: 'Duotone', model: 'Super Hero 6.0', m2: 6.0, luff: 445, topExt: 20, boom: 175, cams: 0, diam: null },
  { id: 's65', kind: 'sail', mfr: 'Bic', model: 'Techno 6.5', m2: 6.5, luff: 458, topExt: 0, boom: 183, cams: 0, diam: null },
  { id: 's70', kind: 'sail', mfr: 'Bic', model: 'Techno 7.0', m2: 7.0, luff: 470, topExt: 0, boom: 192, cams: 0, diam: null },
  { id: 's78', kind: 'sail', mfr: 'Gaastra', model: 'Matrix 7.8', m2: 7.8, luff: 490, topExt: 0, boom: 202, cams: 1, diam: 'SDM' },
  { id: 's85', kind: 'sail', mfr: 'Gaastra', model: 'Matrix 8.5', m2: 8.5, luff: 505, topExt: 0, boom: 212, cams: 1, diam: 'SDM' },
];

const mast = (id, mfr, len, diam, cond, avg, faults = []) =>
  ({ id, kind: 'mast', mfr, model: `${diam} ${len}`, len, diam, cond, rate: rate(avg), faults });

export const MASTS = [
  mast('m370a', 'Neil Pryde', 370, 'RDM', 'good', 4),
  mast('m370b', 'Neil Pryde', 370, 'RDM', 'fair', 3),
  mast('m400a', 'Neil Pryde', 400, 'RDM', 'very good', 4.5),
  mast('m400b', 'Neil Pryde', 400, 'RDM', 'good', 4),
  mast('m430a', 'Duotone', 430, 'RDM', 'very good', 4.5),
  mast('m430b', 'Duotone', 430, 'RDM', 'good', 3.5),
  mast('m430c', 'Bic', 430, 'SDM', 'fair', 3),
  mast('m460a', 'Bic', 460, 'SDM', 'good', 4),
  mast('m460b', 'Bic', 460, 'SDM', 'fair', 3, [{ title: 'scuffed base' }]),
  mast('m460c', 'Duotone', 460, 'RDM', 'very good', 4.5),
  mast('m490a', 'Gaastra', 490, 'SDM', 'good', 4),
];

const ext = (id, mfr, min, max, diam, cond, avg) =>
  ({ id, kind: 'ext', mfr, model: `${diam} ${min}-${max}`, min, max, diam, cond, rate: rate(avg), faults: [] });

export const EXTS = [
  ext('e1', 'Neil Pryde', 0, 50, 'RDM', 'very good', 4.5),
  ext('e2', 'Neil Pryde', 0, 50, 'RDM', 'good', 4),
  ext('e3', 'Neil Pryde', 0, 50, 'RDM', 'fair', 3),
  ext('e4', 'Bic', 0, 50, 'SDM', 'good', 4),
  ext('e5', 'Bic', 0, 50, 'SDM', 'fair', 3),
  ext('e6', 'Chinook', 0, 30, 'RDM', 'good', 3.5),
  ext('e7', 'Chinook', 0, 30, 'RDM', 'good', 3.5),
];

const boom = (id, mfr, min, max, cond, avg) =>
  ({ id, kind: 'boom', mfr, model: `${min}-${max}`, min, max, cond, rate: rate(avg), faults: [] });

export const BOOMS = [
  boom('b1', 'Neil Pryde', 140, 190, 'good', 4),
  boom('b2', 'Neil Pryde', 140, 190, 'fair', 3),
  boom('b3', 'Duotone', 150, 200, 'very good', 4.5),
  boom('b4', 'Duotone', 150, 200, 'good', 4),
  boom('b5', 'Bic', 160, 210, 'good', 4),
  boom('b6', 'Bic', 160, 210, 'fair', 3),
  boom('b7', 'Gaastra', 180, 230, 'good', 4),
  boom('b8', 'Gaastra', 180, 230, 'very good', 4.5),
  boom('b9', 'Chinook', 190, 240, 'fair', 3),
];

export const KIT = [...MASTS, ...EXTS, ...BOOMS];

/** Sails picked by size, so the CLI can take `--sails 5.5,7.0,8.5`. */
export function sailsBySize(list) {
  return list.map((size) => {
    const hit = SAILS.find((s) => Math.abs(s.m2 - size) < 0.051);
    if (!hit) throw new Error(`no ${size}m sail in the fixture rack`);
    return hit;
  });
}
