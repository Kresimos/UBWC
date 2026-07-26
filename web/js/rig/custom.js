/**
 * "Something else": a piece the member has that the app does not know about.
 *
 * The escape hatch matters because the club's inventory is not the whole world
 * — a member's own boom, or a piece somebody has already taken off the rack
 * without telling the app. It sits at the bottom of every step's list at the
 * same weight as a real option.
 *
 * Each step asks for exactly the numbers its own rule and the steps after it
 * need, and nothing else. A segment with `when` is only asked once it matters:
 * a sail's diameter is asked the moment you say it is cambered, because from
 * then on it is a hard rule, and guessing it would quietly offer the wrong
 * masts in both directions.
 */
export const CUSTOM = {
  sail: {
    title: 'Your own sail',
    fields: [
      { k: 'm2', l: 'Size m²' },
      { k: 'luff', l: 'Luff cm', req: true },
      { k: 'boom', l: 'Boom cm', req: true },
    ],
    segs: [
      { k: 'cams', l: 'Cambered', opts: ['No', 'Yes'] },
      { k: 'diam', l: 'Cams moulded to', opts: ['RDM', 'SDM'], req: true, when: (d) => d.cams === 'Yes' },
    ],
    note: 'The luff is what any mast and extension has to total. The boom length is printed on the sail beside it.',
  },
  mast: {
    title: 'Your own mast',
    fields: [{ k: 'len', l: 'Length cm', req: true }],
    segs: [{ k: 'diam', l: 'Diameter', opts: ['RDM', 'SDM'] }],
    note: 'Length and diameter are all the rest of the cascade needs.',
  },
  ext: {
    title: 'Your own extension',
    fields: [{ k: 'max', l: 'Extends to cm', req: true }],
    segs: [{ k: 'diam', l: 'Diameter', opts: ['RDM', 'SDM'] }],
    note: 'Assumed to start at 0 cm. The diameter has to match your mast, whatever the sail is.',
  },
  boom: {
    title: 'Your own boom',
    fields: [{ k: 'min', l: 'Shortest cm', req: true }, { k: 'max', l: 'Longest cm', req: true }],
    note: 'The sail’s boom length has to sit inside this range.',
  },
  board: {
    title: 'Your own board',
    fields: [{ k: 'vol', l: 'Volume L' }],
    segs: [{ k: 'box', l: 'Fin box', opts: ['Powerbox', 'US Box', 'Tuttle'] }],
    note: 'The box type is the one hard rule on this side: it decides which fins are offered.',
  },
  fin: {
    title: 'Your own fin',
    fields: [{ k: 'len', l: 'Length cm' }],
    segs: [{ k: 'box', l: 'Fin box', opts: ['Powerbox', 'US Box', 'Tuttle'] }],
    note: 'Has to match the board’s box exactly.',
  },
  uj: {
    title: 'Your own base',
    fields: [],
    note: 'Universal joints are an industry standard fitting, so there is nothing to check.',
  },
};

export function activeSegs(config, draft) {
  return (config.segs || []).filter((seg) => !seg.when || seg.when(draft));
}

export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}
