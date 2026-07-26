/**
 * The rig cascade: which pieces still go together, and what each pick settles.
 *
 * This is the app's only real reasoning, and it follows CLAUDE.md exactly:
 *
 *  - a sail needs a **luff length**, and it does not care which mast and
 *    extension reach it, only that they total it. An adjustable head widens
 *    that to [luff, luff + adjustable top] by letting a longer mast poke out;
 *  - a sail's **boom length** must sit inside the boom's adjustable range;
 *  - **diameter** (RDM/SDM) is a hard rule only for a cambered sail, whose cams
 *    are moulded to one size. A camless sail's sleeve takes either. An
 *    extension must always match its own mast, whatever the sail is;
 *  - a **fin's box type** must match the board's exactly. Nothing else on the
 *    board side is a hard rule.
 *
 * Brand is never a constraint. A Bic mast fits a Neil Pryde sail; matching
 * brands only earns a "brand match" nudge.
 *
 * The important behavioural choice is `completable`: a candidate is only listed
 * if picking it still leaves a rig that can actually be finished from the kit on
 * site. A backtracking search over the unpicked steps is exact and, at tens of
 * pieces per step, instant — so the wizard never walks a member into a corner
 * and then apologises.
 */

export const EXT_MAX = 50; // the physical travel of a mast extension, in cm

export const STEPS = [
  { k: 'sail', label: 'Sail', kind: 'sail', group: 'rig' },
  { k: 'mast', label: 'Mast', kind: 'mast', group: 'rig' },
  { k: 'ext', label: 'Extension', kind: 'ext', group: 'rig' },
  { k: 'boom', label: 'Boom', kind: 'boom', group: 'rig' },
  { k: 'board', label: 'Board', kind: 'board', group: 'board' },
  { k: 'fin', label: 'Fin', kind: 'fin', group: 'board' },
  { k: 'uj', label: 'Base / UJ', kind: 'uj', group: 'board' },
];

export const stepIndex = (key) => STEPS.findIndex((step) => step.k === key);
export const stepFor = (key) => STEPS[stepIndex(key)];

export const pieceName = (piece) =>
  piece.custom ? (piece.label || `Your own ${piece.kindLabel}`) : `${piece.mfr} ${piece.model}`.trim();

export const fmt = (value) => String(Math.round(value * 10) / 10);
export const span = (low, high) => `${fmt(low)} to ${fmt(high)} cm`;

const known = (value) => value !== null && value !== undefined;

/**
 * The window of extension lengths that make a mast total the sail's luff.
 * [low, high] in cm, 'unknown' when a measurement is missing, or null when no
 * legal extension can bridge the gap.
 */
export function extRange(sail, mast) {
  if (!sail || !mast) return null;
  if (!known(sail.luff) || !known(mast.len)) return 'unknown';
  if (sail.cams && sail.diam && mast.diam && sail.diam !== mast.diam) return null;
  const low = Math.max(0, sail.luff - mast.len);
  const high = Math.min(EXT_MAX, sail.luff + (sail.topExt || 0) - mast.len);
  return high < low ? null : [low, high];
}

export function whyMastFails(sail, mast) {
  if (sail.cams && sail.diam && mast.diam && sail.diam !== mast.diam) {
    return `${pieceName(mast)}: ${mast.diam}, and a cambered sail needs ${sail.diam}.`;
  }
  if (mast.len > sail.luff + (sail.topExt || 0)) {
    return `${pieceName(mast)}: ${mast.len} cm is too long for a ${sail.luff} cm luff.`;
  }
  return `${pieceName(mast)}: would need ${Math.round(sail.luff - mast.len)} cm of extension, `
    + 'more than an extension travels.';
}

/**
 * Can these two pieces be in the same setup? Symmetric, so a part picked at any
 * step filters every other step's list whichever order they were chosen in. A
 * piece that fails this is never shown, rather than shown and then dead-ended.
 */
export function pairOK(candidate, other, picks) {
  const pair = [candidate.kind, other.kind].sort().join('+');
  const pick = (kind) => (candidate.kind === kind ? candidate : other);

  if (pair === 'mast+sail') {
    return extRange(pick('sail'), pick('mast')) !== null;
  }
  if (pair === 'boom+sail') {
    const sail = pick('sail');
    const boom = pick('boom');
    if (!known(sail.boom) || !known(boom.min)) return true;
    return sail.boom >= boom.min && sail.boom <= boom.max;
  }
  if (pair === 'ext+mast') {
    const mast = pick('mast');
    const ext = pick('ext');
    if (ext.diam && mast.diam && ext.diam !== mast.diam) return false;
    if (!picks.sail) return true;
    const range = extRange(picks.sail, mast);
    if (range === null) return false;
    if (range === 'unknown' || !known(ext.min)) return true;
    return Math.max(range[0], ext.min) <= Math.min(range[1], ext.max);
  }
  if (pair === 'ext+sail') {
    // Only means anything once a mast is known: the three have to total the luff.
    const mast = picks.mast;
    if (!mast) return true;
    const sail = pick('sail');
    const ext = pick('ext');
    const range = extRange(sail, mast);
    if (range === null) return false;
    if (range === 'unknown' || !known(ext.min)) return true;
    return Math.max(range[0], ext.min) <= Math.min(range[1], ext.max);
  }
  if (pair === 'board+fin') {
    const board = pick('board');
    const fin = pick('fin');
    if (!board.box || !fin.box) return true;
    return board.box === fin.box;
  }
  return true;
}

/** Does this candidate sit happily with everything else currently picked? */
export function passes(stepKey, piece, picks) {
  return STEPS.every((step) =>
    step.k === stepKey || !picks[step.k] || pairOK(piece, picks[step.k], picks));
}

/**
 * A wizard bound to one site's kit. Everything below reads only from `kit`, so
 * changing site is a new engine rather than a reload.
 */
export function createEngine(kit, site) {
  const byId = (id) => kit.find((piece) => piece.id === id) || null;

  const pool = (stepKey) => {
    const { kind } = stepFor(stepKey);
    return kit.filter((piece) => piece.kind === kind);
  };

  /**
   * Can this set of picks still be finished? Backtracking over every step that
   * is neither picked nor deliberately skipped, smallest pool first so an
   * impossible slot fails on the first branch.
   */
  function completable(picks, skips) {
    const slots = STEPS
      .filter((step) => !picks[step.k] && !(skips && skips[step.k]))
      .map((step) => ({ k: step.k, dom: pool(step.k) }))
      .sort((a, b) => a.dom.length - b.dom.length);

    const assigned = {};
    STEPS.forEach((step) => { if (picks[step.k]) assigned[step.k] = picks[step.k]; });

    const fits = (key, piece) => STEPS.every((step) =>
      step.k === key || !assigned[step.k] || pairOK(piece, assigned[step.k], assigned));

    function search(depth) {
      if (depth === slots.length) return true;
      const slot = slots[depth];
      if (!slot.dom.length) return false; // nothing of this kind is on site
      for (const candidate of slot.dom) {
        if (!fits(slot.k, candidate)) continue;
        assigned[slot.k] = candidate;
        const done = search(depth + 1);
        delete assigned[slot.k];
        if (done) return true;
      }
      return false;
    }
    return search(0);
  }

  /** Candidates that fit, in the order this step should show them. */
  function options(stepKey, picks, skips) {
    const { kind } = stepFor(stepKey);
    const out = kit.filter((piece) => {
      if (piece.kind !== kind) return false;
      if (!passes(stepKey, piece, picks)) return false;
      const trial = {};
      STEPS.forEach((step) => { if (picks[step.k]) trial[step.k] = picks[step.k]; });
      trial[stepKey] = piece;
      return completable(trial, skips);
    });

    // Biggest first, because that is how a sailor scans for their size.
    if (stepKey === 'sail') out.sort((a, b) => b.m2 - a.m2);
    if (stepKey === 'board') out.sort((a, b) => b.vol - a.vol);
    if (stepKey === 'mast') out.sort((a, b) => b.len - a.len);
    return out;
  }

  const onSite = (stepKey) => pool(stepKey);

  return { kit, site, byId, pool, options, completable, onSite };
}

/**
 * What choosing this piece settles about the rest of the rig.
 *
 * Once a sail and a mast are both known there is one setting, not a window: the
 * head is kept shut and the extension makes up the difference, because that is
 * what a person actually does on the grass. The head only opens when the mast
 * is longer than the luff, which is the only case it is needed for.
 */
export function rigPlan(sail, mast, ext) {
  if (!sail || !mast) return null;
  if (!known(sail.luff) || !known(mast.len)) return null;
  let extension = Math.max(0, sail.luff - mast.len);
  if (ext && known(ext.min)) extension = Math.max(extension, ext.min);
  return { ext: extension, head: (mast.len + extension) - sail.luff };
}

/** The plan as a person would say it, never as an equation. */
export function planLabel(plan) {
  if (!plan) return '';
  if (plan.head > 0 && plan.ext === 0) return `- ${fmt(plan.head)} cm head`;
  if (plan.head > 0) return `+ ${fmt(plan.ext)} cm extension, ${fmt(plan.head)} cm head`;
  return plan.ext === 0 ? 'no extension needed' : `+ ${fmt(plan.ext)} cm extension`;
}

export function consequence(stepKey, piece, picks) {
  if (stepKey === 'mast' && picks.sail) return planLabel(rigPlan(picks.sail, piece, picks.ext));
  if (stepKey === 'sail' && picks.mast) return planLabel(rigPlan(piece, picks.mast, picks.ext));
  if (stepKey === 'ext' && picks.sail && picks.mast) {
    const plan = rigPlan(picks.sail, picks.mast, piece);
    if (!plan) return '';
    return `set to ${fmt(plan.ext)} cm${plan.head > 0 ? `, head open ${fmt(plan.head)} cm` : ''}`;
  }
  if (stepKey === 'boom' && picks.sail && known(picks.sail.boom)) {
    return `set to ${fmt(picks.sail.boom)} cm`;
  }
  if (stepKey === 'fin' && picks.board && piece.box) return `fits the ${piece.box}`;
  return '';
}

/** The headline size a sailor picks this kind of kit by. */
export function sizeBits(stepKey, piece) {
  if (stepKey === 'sail') return known(piece.m2) ? { v: piece.m2.toFixed(1), u: 'm²' } : null;
  if (stepKey === 'mast') return known(piece.len) ? { v: fmt(piece.len), u: 'cm' } : null;
  if (stepKey === 'ext' || stepKey === 'boom') {
    return known(piece.max) ? { v: `${fmt(piece.min || 0)}-${fmt(piece.max)}`, u: 'cm' } : null;
  }
  if (stepKey === 'board') return known(piece.vol) ? { v: fmt(piece.vol), u: 'L' } : null;
  if (stepKey === 'fin') return known(piece.len) ? { v: fmt(piece.len), u: 'cm' } : null;
  if (stepKey === 'uj') return { v: piece.fit || 'Standard', u: '' };
  return null;
}

/**
 * The model with the size taken back out of it. Only a trailing number that IS
 * this piece's size is dropped, so a Bic Techno 293 keeps the name it is known by.
 */
export function shortName(piece) {
  if (piece.custom) return pieceName(piece);
  let model = piece.model || '';
  const tail = model.match(/^(.*[^\s-])[\s-]+(\d+(?:\.\d+)?)$/);
  if (tail) {
    const sizes = [piece.m2, piece.len, piece.vol, piece.min, piece.max];
    const value = parseFloat(tail[2]);
    if (sizes.some((size) => known(size) && Math.abs(size - value) < 0.051)) model = tail[1];
  }
  // An extension already says its diameter on its own line, so drop the prefix.
  if (piece.diam) model = model.replace(new RegExp(`^${piece.diam}\\s+`), '');
  return `${piece.mfr || ''} ${model}`.trim();
}

/** What kind of thing it is, as small tags. Never the size, never the maker. */
export function specTags(stepKey, piece) {
  const tags = [];
  if (stepKey === 'sail') {
    if (piece.type) tags.push(piece.type);
    if (piece.cams) tags.push('cambered');
  }
  if (stepKey === 'mast' && piece.diam) tags.push(piece.diam);
  if (stepKey === 'ext' && piece.diam) tags.push(`${piece.diam} fitting`);
  if (stepKey === 'boom') tags.push('outhaul range');
  if (stepKey === 'board') {
    if (piece.type) tags.push(piece.type);
    if (piece.box) tags.push(piece.box);
  }
  if (stepKey === 'fin') {
    if (piece.type) tags.push(piece.type);
    if (piece.box) tags.push(piece.box);
  }
  if (stepKey === 'uj') tags.push('universal joint');
  if (piece.custom) tags.push('not in the inventory');
  return tags;
}

export function specLine(stepKey, piece) {
  if (stepKey === 'sail') {
    return `${Number(piece.m2).toFixed(1)} m² · ${piece.type || 'sail'} · luff ${piece.luff} cm · `
      + `boom ${piece.boom} cm · ${piece.cams ? 'cambered' : 'camless'}`
      + (piece.topExt ? ` · head opens ${piece.topExt} cm` : '');
  }
  if (stepKey === 'mast') return `${piece.len} cm · ${piece.diam || 'diameter unknown'} · ${piece.mfr}`;
  if (stepKey === 'ext') return `travels ${piece.min} to ${piece.max} cm · ${piece.diam || ''} · ${piece.mfr}`;
  if (stepKey === 'boom') return `outhaul ${piece.min} to ${piece.max} cm · ${piece.mfr}`;
  if (stepKey === 'board') return `${piece.vol} L · ${piece.type} · ${piece.box} fin box · ${piece.mfr}`;
  if (stepKey === 'fin') return `${piece.len} cm · ${piece.box} · ${piece.type} · ${piece.mfr}`;
  if (stepKey === 'uj') return `${piece.fit || 'Standard'} fitting · ${piece.mfr}`;
  return '';
}

/**
 * The chips on an opened option: green means a hard rule met, teal means soft
 * or informational, amber means a fault worth knowing about.
 */
export function chipsFor(stepKey, piece, picks) {
  const chips = [];
  const add = (cls, text, tick = false) => chips.push({ cls, text, tick });

  if (stepKey === 'sail') {
    if (known(piece.luff)) add('neut', `${fmt(piece.luff)} cm luff`);
    if (known(piece.boom)) add('neut', `${fmt(piece.boom)} cm boom`);
    add(piece.cams ? 'warn' : 'neut', piece.cams
      ? `cambered, ${piece.diam ? `${piece.diam} mast` : 'diameter not recorded'}`
      : 'camless, any mast');
    const plan = rigPlan(piece, picks.mast, picks.ext);
    if (plan) add('ok', planLabel(plan), true);
  }
  if (stepKey === 'mast') {
    const plan = rigPlan(picks.sail, piece, picks.ext);
    if (plan) add('ok', planLabel(plan), true);
    else if (picks.sail) add('neut', 'fit not checked');
    if (piece.diam) {
      const cammed = Boolean(picks.sail && picks.sail.cams);
      add(cammed ? 'ok' : 'neut', cammed ? `${piece.diam} matches the cams` : piece.diam, cammed);
    }
    if (picks.sail && picks.sail.mfr === piece.mfr) add('soft', 'brand match');
  }
  if (stepKey === 'ext') {
    const plan = rigPlan(picks.sail, picks.mast, piece);
    if (plan) add('ok', `set to ${fmt(plan.ext)} cm`, true);
    if (known(piece.min)) add('neut', `travels ${span(piece.min, piece.max)}`);
    if (piece.diam) add('ok', `${piece.diam} mast fitting`, true);
  }
  if (stepKey === 'boom') {
    if (picks.sail && known(picks.sail.boom)) add('ok', `set to ${fmt(picks.sail.boom)} cm`, true);
    if (known(piece.min)) add('neut', `adjusts ${span(piece.min, piece.max)}`);
    if (picks.sail && picks.sail.mfr === piece.mfr) add('soft', 'brand match');
  }
  if (stepKey === 'board') {
    if (piece.type) add('neut', piece.type);
    if (piece.box) add('neut', `${piece.box} fin box`);
    // Board volume is a soft band, never a filter: it depends on the rider.
    if (picks.sail && known(piece.vol) && known(picks.sail.m2)) {
      add('soft', boardSailNote(piece.vol, picks.sail.m2));
    }
  }
  if (stepKey === 'fin') {
    if (piece.box && picks.board && picks.board.box) add('ok', `${piece.box}, fits the board`, true);
    else if (piece.box) add('neut', piece.box);
    if (piece.type) add('neut', piece.type);
  }
  if (stepKey === 'uj') add('neut', `${piece.fit || 'Standard'} fitting`);

  (piece.faults || []).forEach((fault) => {
    add('warn', `${fault.t}${fault.s === 'usable' ? ', still usable' : ', out of action'}`);
  });
  if (piece.custom) add('soft', 'not in the inventory');
  return chips;
}

/**
 * The soft board-to-sail band from CLAUDE.md, said as a sentence rather than
 * enforced. Bigger boards carry bigger sails; nothing here blocks a choice.
 */
function boardSailNote(volume, area) {
  const low = Math.max(3, Math.round((volume / 20) - 1.5));
  const high = Math.round(volume / 14);
  if (area >= low && area <= high) return `pairs well with a ${area} m²`;
  return `usually sails ${low}-${high} m²`;
}
