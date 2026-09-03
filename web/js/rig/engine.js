/**
 * The rig's reasoning: what a size target matches, and what a sail and board
 * imply about the rest of the kit.
 *
 * The flow this serves has two halves, and so does this file:
 *
 *  - **Build** asks for two numbers, a sail size and a board volume, and shows
 *    what the club has near each. Nothing here filters one by the other,
 *    because they do not constrain each other: a rider picks a rig for the wind
 *    and a board for their weight and skill (CLAUDE.md, "The two independent
 *    kit groups"). The only ordering is distance from the number asked for.
 *  - **Your rig** takes those two and works out the rest. That half is the
 *    strict, measurement-driven one, and it follows CLAUDE.md exactly:
 *
 *      - a sail needs a **luff length**, and does not care which mast and
 *        extension reach it, only that they total it. An adjustable head widens
 *        that to [luff, luff + adjustable top] by letting a longer mast poke out;
 *      - a sail's **boom length** must sit inside the boom's adjustable range;
 *      - **diameter** (RDM/SDM) is a hard rule only for a cambered sail, whose
 *        cams are moulded to one size. A camless sail's sleeve takes either. An
 *        extension must always match its own mast, whatever the sail is;
 *      - a **fin's box type** must match the board's exactly.
 *
 * Brand is never a constraint. A Bic mast fits a Neil Pryde sail; matching
 * brands only earns a "brand match" nudge, which is what ranking is for.
 */

const EXT_MAX = 50; // the physical travel of a mast extension, in cm
const STD_MASTS = [370, 400, 430, 460];

const known = (value) => value !== null && value !== undefined;

export const fmt = (value) => String(Math.round(value * 10) / 10);
export const span = (low, high) => `${fmt(low)} to ${fmt(high)} cm`;
// A sail's size stays meaningfully precise at a round number, so it never drops the .0 the way fmt() does.
export const fmtSail = (value) => (Math.round(value * 10) / 10).toFixed(1);

/* ------------------------------------------------------------------ Build */

/**
 * The two things Build asks for. `step` is what one press of the stepper moves,
 * and the bounds are only there so a long press cannot run off into nonsense —
 * the list itself is never empty-by-filter, it just gets further from the mark.
 */
export const TARGETS = {
  sail: {
    k: 'sail', kind: 'sail', label: 'Sail', noun: 'sail', unit: 'm²',
    step: 0.1, dp: 1, min: 1.5, max: 12.5, fallback: 5.5,
    size: (piece) => piece.m2,
  },
  board: {
    k: 'board', kind: 'board', label: 'Board', noun: 'board', unit: 'L',
    step: 5, dp: 0, min: 50, max: 260, fallback: 120,
    size: (piece) => piece.vol,
  },
};

export const TARGET_KEYS = ['sail', 'board'];

/**
 * The filter chips, in the order a member reaches for them. Riding style,
 * then the two rigging facts that decide what a sail will go on.
 *
 * Only chips that actually match something in the kit on site are offered, so
 * the row never contains a filter that can only ever return nothing. Anything
 * the club owns that is not on this list is appended, which is how "Kids" and
 * "Beginner" reach the row without being hard-coded.
 */
const TAG_ORDER = {
  sail: ['Freewave', 'Freeride', 'Wave', 'Freestyle', 'Slalom', 'Cammed', 'RDM', 'SDM', 'Adjustable top'],
  board: ['Freewave', 'Freeride', 'Slalom', 'Wave', 'Formula', 'Foil'],
};

function tagMatches(tag, piece) {
  if (tag === 'Cammed') return Boolean(piece.cams);
  if (tag === 'RDM' || tag === 'SDM') return piece.diam === tag;
  if (tag === 'Adjustable top') return Number(piece.topExt || 0) > 0;
  return String(piece.type || '') === tag;
}

/** The chip row for one target: the agreed order first, then anything else real. */
export function tagsFor(pool, key) {
  const live = (tag) => pool.some((piece) => tagMatches(tag, piece));
  const chips = TAG_ORDER[key].filter(live);
  pool.forEach((piece) => {
    const type = String(piece.type || '').trim();
    if (type && !chips.includes(type) && !TAG_ORDER[key].includes(type)) chips.push(type);
  });
  return chips;
}

const CONDITION_RANK = { 'very good': 3, good: 2, fair: 1, poor: 0 };
const conditionScore = (piece) => CONDITION_RANK[String(piece.cond || '').toLowerCase()] ?? 1.5;
const ratingScore = (piece) => (piece.rate ? piece.rate.avg : 3);

/**
 * Everything of one kind, nearest the target first. Ties break on condition
 * and then on how the club rates it, so the first tile is the one worth taking.
 */
export function matches(kit, key, target, tags) {
  const config = TARGETS[key];
  const active = tags || [];
  return kit
    .filter((piece) => piece.kind === config.kind)
    .filter((piece) => active.every((tag) => tagMatches(tag, piece)))
    .map((piece) => ({ piece, delta: distance(config, piece, target) }))
    .sort((a, b) => a.delta - b.delta
      || conditionScore(b.piece) - conditionScore(a.piece)
      || ratingScore(b.piece) - ratingScore(a.piece))
    .map((entry) => entry.piece);
}

function distance(config, piece, target) {
  const size = config.size(piece);
  return known(size) ? Math.abs(size - target) : Infinity;
}

/** "Exact", "+0.3", "−9" — how far this piece is from the number asked for. */
export function matchChip(key, piece, target) {
  const config = TARGETS[key];
  const size = config.size(piece);
  if (!known(size)) return 'size unknown';
  const gap = Math.round((size - target) * 10) / 10;
  if (Math.abs(gap) < 0.05) return 'Exact';
  return `${gap > 0 ? '+' : '−'}${fmt(Math.abs(gap))}`;
}

/** The sizes the club actually owns, so the stepper can start somewhere real. */
export function nearestStocked(kit, key, wanted) {
  const config = TARGETS[key];
  const sizes = kit
    .filter((piece) => piece.kind === config.kind)
    .map(config.size)
    .filter(known);
  if (!sizes.length) return wanted;
  return sizes.reduce((best, size) =>
    (Math.abs(size - wanted) < Math.abs(best - wanted) ? size : best), sizes[0]);
}

export function clampTarget(key, value) {
  const config = TARGETS[key];
  const stepped = Math.round(value / config.step) * config.step;
  return Number(Math.min(config.max, Math.max(config.min, stepped)).toFixed(config.dp));
}

/* ------------------------------------------------------------- rig maths */

/**
 * The window of extension lengths that make a mast total the sail's luff.
 * [low, high] in cm, 'unknown' when a measurement is missing, or null when no
 * legal extension can bridge the gap.
 */
function extRange(sail, mast) {
  if (!sail || !mast) return null;
  if (!known(sail.luff) || !known(mast.len)) return 'unknown';
  if (sail.cams && sail.diam && mast.diam && sail.diam !== mast.diam) return null;
  const low = Math.max(0, sail.luff - mast.len);
  const high = Math.min(EXT_MAX, sail.luff + (sail.topExt || 0) - mast.len);
  return high < low ? null : [low, high];
}

/**
 * What a sail and mast settle between them. There is one setting, not a window:
 * the head is kept shut and the extension makes up the difference, because that
 * is what a person actually does on the grass. The head only opens when the
 * mast is longer than the luff, which is the only case it is needed for.
 */
export function rigPlan(sail, mast, ext) {
  if (!sail || !mast) return null;
  if (!known(sail.luff) || !known(mast.len)) return null;
  let extension = Math.max(0, sail.luff - mast.len);
  if (ext && known(ext.min)) extension = Math.max(extension, ext.min);
  return { ext: extension, head: (mast.len + extension) - sail.luff };
}

/** The worked example on the item page: biggest standard mast under the luff. */
function textbookRig(luff) {
  if (!known(luff)) return null;
  const mast = STD_MASTS.reduce((best, size) => (size <= luff ? size : best), STD_MASTS[0]);
  return { mast, ext: Math.round(luff - mast) };
}

const boomFits = (sail, boom) => {
  if (!known(sail.boom) || !known(boom.min)) return true;
  return sail.boom >= boom.min && sail.boom <= boom.max;
};

const extFitsMast = (ext, mast, sail) => {
  if (ext.diam && mast.diam && ext.diam !== mast.diam) return false;
  const range = extRange(sail, mast);
  if (range === null) return false;
  if (range === 'unknown' || !known(ext.min)) return true;
  return Math.max(range[0], ext.min) <= Math.min(range[1], ext.max);
};

/** The soft fin band from board volume: a suggestion, never a filter. */
export function finBand(volume) {
  if (!known(volume)) return null;
  return [Math.round(volume / 4), Math.round(volume / 3.35)];
}

/* --------------------------------------------------- the recommendation */

/**
 * The four slots Your rig fills in, in the order they are rigged. Each knows
 * which picks it depends on, so a skipped sail simply leaves the three rig
 * slots asking for one rather than guessing.
 */
export const SLOTS = [
  { k: 'mast', kind: 'mast', label: 'MAST', noun: 'mast', needs: 'sail' },
  { k: 'ext', kind: 'ext', label: 'EXTENSION', noun: 'extension', needs: 'sail' },
  { k: 'boom', kind: 'boom', label: 'BOOM', noun: 'boom', needs: 'sail' },
  { k: 'fin', kind: 'fin', label: 'FIN', noun: 'fin', needs: 'board' },
];

const slotFor = (key) => SLOTS.find((slot) => slot.k === key);

/**
 * Everything of this kind that legally fits what is already chosen. `picks`
 * carries the sail and board from Build plus any slot already confirmed, so
 * the extension list narrows the moment a mast is settled.
 */
function candidates(kit, key, picks) {
  const { sail, board, mast } = picks;
  return kit.filter((piece) => {
    if (piece.kind !== slotFor(key).kind) return false;
    if (key === 'mast') return Boolean(sail) && extRange(sail, piece) !== null;
    if (key === 'ext') {
      if (!sail || !mast) return false;
      return extFitsMast(piece, mast, sail);
    }
    if (key === 'boom') return Boolean(sail) && boomFits(sail, piece);
    if (key === 'fin') {
      if (!board) return false;
      if (!board.box || !piece.box) return true;
      return board.box === piece.box;
    }
    return false;
  });
}

/**
 * Ranked candidates for a slot. Everything in here is a nudge rather than a
 * rule — the hard rules already decided who is in the list at all — so the
 * weights only ever reorder kit that would rig equally well.
 */
export function ranked(kit, key, picks) {
  const partner = key === 'fin' ? picks.board : picks.sail;
  return candidates(kit, key, picks)
    .map((piece) => ({ piece, score: score(key, piece, picks, partner) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.piece);
}

function score(key, piece, picks, partner) {
  let total = ratingScore(piece) * 1.2 + conditionScore(piece);

  if (partner && partner.mfr && piece.mfr === partner.mfr) total += 2.5;
  if (partner && partner.spot && piece.spot === partner.spot) total += 0.6;
  if ((piece.faults || []).length) total -= 2;

  if (key === 'mast') {
    // The mast that needs least extension is the one that rigs cleanest, and a
    // cambered sail's diameter is a hard rule the list has already applied —
    // this only prefers a matching diameter when it was free to choose.
    const plan = rigPlan(picks.sail, piece);
    if (plan) total += 2 - Math.min(2, plan.ext / 25);
    if (picks.sail.diam && piece.diam === picks.sail.diam) total += 1;
  }
  if (key === 'ext') {
    // Sitting at the very top of its travel means a hard downhaul, so an
    // extension with room to spare above the setting wins.
    const plan = rigPlan(picks.sail, picks.mast, piece);
    if (plan && known(piece.max)) total += Math.min(1.5, (piece.max - plan.ext) / 10);
    if (picks.mast.diam && piece.diam === picks.mast.diam) total += 1.5;
  }
  if (key === 'boom') {
    // Same again: a boom wound near its limit is a boom at full extension.
    if (known(picks.sail.boom) && known(piece.max)) {
      const headroom = Math.min(picks.sail.boom - piece.min, piece.max - picks.sail.boom);
      total += Math.min(1.5, headroom / 15);
    }
  }
  if (key === 'fin') {
    const band = finBand(picks.board.vol);
    if (band && known(piece.len)) {
      const middle = (band[0] + band[1]) / 2;
      total += 2 - Math.min(2, Math.abs(piece.len - middle) / 6);
    }
  }
  return total;
}

/* ------------------------------------------- the rules, for the solver */

/**
 * The three hard rules, named and exported so the trailer solver can ask them
 * directly instead of restating them. `ranked` already applies all three; these
 * are the same predicates without the ranking, for code that has to test a pair
 * millions of times rather than sort a list once.
 *
 * `fitsExt` implies `fitsMast`: an extension can only bridge a gap that exists.
 */
export const fitsBoom = (sail, boom) => boomFits(sail, boom);
export const fitsMast = (sail, mast) => extRange(sail, mast) !== null;
export const fitsExt = (sail, mast, ext) => extFitsMast(ext, mast, sail);

/** One piece's ranking score for one slot: the nudges `ranked` sorts on. */
export function pieceScore(key, piece, picks) {
  return score(key, piece, picks, key === 'fin' ? picks.board : picks.sail);
}

/* --------------------------------------------------------- trip packing */

/**
 * The kit a trip needs, worked from the boards and sails somebody has decided
 * to take.
 *
 * This is the same reasoning as Your rig, run many times over instead of once,
 * so it goes through `ranked` and inherits every hard rule and every nudge
 * rather than restating them: a sail's mast still has to reach its luff, an
 * extension still has to match its mast's diameter, a fin still has to match
 * its board's box.
 *
 * Two things are different from rigging one rig on a beach:
 *
 *  - **nothing is shared.** Each sail gets its own mast, extension and boom and
 *    each board its own fin and base, because the point of the trailer is that
 *    every rig can be up at once. So a piece is assigned once and then out of
 *    the pool;
 *  - **running out is the answer.** A trip where the club owns three sails and
 *    two masts is a fact the kit sec has to know before they drive off, so a
 *    sail left without a mast comes back as a shortfall line rather than
 *    silently sharing one.
 *
 * Sails are served most-constrained-first: the sail only one mast in the club
 * fits gets that mast, rather than losing it to a sail anything would have done
 * for.
 *
 * ponytail: greedy assignment, not an optimal matching. It can only strand a
 * sail that a proper (Hungarian) match would have saved when the club's kit is
 * tight enough for two sails to want the last two masts in opposite orders;
 * with a shortfall line to read, that is visible rather than silent.
 */
export function packList(kit, chosen) {
  const sails = chosen.sails || [];
  const boards = chosen.boards || [];
  const used = new Set([...sails, ...boards,
                        ...(chosen.wings || []), ...(chosen.foils || [])]
                       .map((piece) => piece.id));
  const assigned = [];
  const short = [];
  const free = (piece) => !used.has(piece.id);

  const take = (role, piece, forPiece) => {
    used.add(piece.id);
    assigned.push({ role, piece, for: forPiece });
  };

  // The three rig slots, in the order they are rigged, so the extension is
  // chosen knowing which mast this sail ended up with.
  const mastFor = new Map();
  SLOTS.filter((slot) => slot.needs === 'sail').forEach((slot) => {
    sails
      .map((sail) => ({
        sail,
        options: ranked(kit, slot.k, { sail, mast: mastFor.get(sail.id) }),
      }))
      .sort((a, b) => a.options.length - b.options.length)
      .forEach(({ sail, options }) => {
        const pick = options.find(free);
        if (!pick) {
          short.push({ role: slot.k, for: sail, noun: slot.noun,
                       why: options.length ? 'all taken' : 'none fits' });
          return;
        }
        take(slot.k, pick, sail);
        if (slot.k === 'mast') mastFor.set(sail.id, pick);
      });
  });

  // One fin and one base per board. A base has no rule to apply — any UJ fits
  // any board — so it is only ever a count.
  boards.forEach((board) => {
    const fin = ranked(kit, 'fin', { board }).find(free);
    if (fin) take('fin', fin, board);
    else short.push({ role: 'fin', for: board, noun: 'fin', why: 'none fits' });

    const base = kit.filter((piece) => piece.kind === 'uj').find(free);
    if (base) take('uj', base, board);
    else short.push({ role: 'uj', for: board, noun: 'base', why: 'all taken' });
  });

  return { assigned, short };
}

/**
 * The board half of a trip's kit: one fin and one base per board, plus a few
 * spares scaled by how full the kit sec wants to pack.
 *
 * The trailer solver (`web/js/rig/pack.js`) only reasons about the three rig
 * slots; the board side has no combinatorics in it. A fin is either the right
 * box for the board or it is not, so each board simply takes its top-ranked
 * free fin through the same `ranked` the rig assistant uses, and a base has no
 * rule at all, so it is only ever a count.
 *
 * `preset` is the wizard's "how full to pack" dial. `light` carries nothing
 * spare; `standard` a fin and a base for the sizes people swap between;
 * `generous` a couple more bases, since a UJ is small and cheap to over-pack.
 * `usedIds` is everything the rig solve and any pinned kit already claimed, so
 * nothing is handed out twice.
 */
const FIN_SPARES = { light: 0, standard: 1, generous: 2 };
const UJ_SPARES = { light: 0, standard: 1, generous: 3 };

export function packBoardKit(kit, boards, preset, usedIds = []) {
  const used = new Set(usedIds);
  const assigned = [];
  const short = [];
  if (!boards.length) return { assigned, short };

  const free = (piece) => !used.has(piece.id);
  const take = (role, piece, forPiece) => {
    used.add(piece.id);
    assigned.push({ role, piece, for: forPiece });
  };
  const bases = () => kit.filter((piece) => piece.kind === 'uj');

  boards.forEach((board) => {
    const finOptions = ranked(kit, 'fin', { board });
    const fin = finOptions.find(free);
    if (fin) take('fin', fin, board);
    else short.push({ role: 'fin', for: board, noun: 'fin',
                      why: finOptions.length ? 'all taken' : 'none fits' });

    const base = bases().find(free);
    if (base) take('uj', base, board);
    else short.push({ role: 'uj', for: board, noun: 'base', why: 'all taken' });
  });

  // A handful of spares, never many. Fins for the box most of the boards use,
  // bases for anyone.
  const key = FIN_SPARES[preset] === undefined ? 'standard' : preset;
  const commonBox = mode(boards.map((board) => board.box).filter(Boolean));
  ranked(kit, 'fin', { board: { box: commonBox, vol: null } })
    .filter(free).slice(0, FIN_SPARES[key])
    .forEach((fin) => take('fin', fin, null));
  bases().filter(free).slice(0, UJ_SPARES[key])
    .forEach((base) => take('uj', base, null));

  return { assigned, short };
}

/** The value that turns up most often in a list, or null for an empty one. */
function mode(list) {
  const seen = new Map();
  let best = null;
  let bestN = 0;
  list.forEach((value) => {
    const n = (seen.get(value) || 0) + 1;
    seen.set(value, n);
    if (n > bestN) { bestN = n; best = value; }
  });
  return best;
}

/* -------------------------------------------------------------- wording */

/**
 * The model with the size taken back out of it. Only a trailing number that IS
 * this piece's size is dropped, so a Bic Techno 293 keeps the name it is known by.
 */
export function modelShort(piece) {
  let model = piece.model || '';
  const tail = model.match(/^(.*[^\s-])[\s-]+(\d+(?:\.\d+)?)$/);
  if (tail) {
    const sizes = [piece.m2, piece.len, piece.vol, piece.min, piece.max];
    const value = parseFloat(tail[2]);
    if (sizes.some((size) => known(size) && Math.abs(size - value) < 0.051)) model = tail[1];
  }
  // An extension already says its diameter on its own line, so drop the prefix.
  if (piece.diam) model = model.replace(new RegExp(`^${piece.diam}\\s+`), '');
  return model.trim();
}

export function shortName(piece) {
  return `${piece.mfr || ''} ${modelShort(piece)}`.trim();
}


/** The headline size a sailor picks this kind of kit by. */
export function sizeBits(kind, piece) {
  // A wing is sized the way a sail is, and is only ever seen by the trip packer.
  if (kind === 'sail' || kind === 'wing') {
    return known(piece.m2) ? { v: fmtSail(piece.m2), u: 'm²' } : null;
  }
  if (kind === 'mast' || kind === 'fin') return known(piece.len) ? { v: fmt(piece.len), u: 'cm' } : null;
  if (kind === 'ext' || kind === 'boom') {
    return known(piece.max) ? { v: `${fmt(piece.min || 0)}-${fmt(piece.max)}`, u: 'cm' } : null;
  }
  if (kind === 'board') return known(piece.vol) ? { v: fmt(piece.vol), u: 'L' } : null;
  return null;
}

/** "370 Duotone Platinum", "160-220 Neil Pryde X9" — size first, as a rack is read. */
export function rowName(kind, piece) {
  const size = sizeBits(kind, piece);
  const name = shortName(piece);
  if (!size) return name || 'Unnamed';
  return `${size.v}${kind === 'fin' ? 'cm' : ''} ${name}`.trim();
}

/** What this piece has to be set to, once the sail and mast have decided it. */
export function setting(key, piece, picks) {
  if (key === 'ext') {
    const plan = rigPlan(picks.sail, picks.mast, piece);
    return plan ? `+${fmt(plan.ext)}cm` : null;
  }
  if (key === 'boom') return known(picks.sail && picks.sail.boom) ? `${fmt(picks.sail.boom)}cm` : null;
  return null;
}

/**
 * The one line under a collapsed row. An extension and a boom get set to a
 * number; a fin only has to be the right box, which is a fact about it rather
 * than something you do to it, so it is stated plainly.
 */
export function collapsedSub(key, piece, picks) {
  const set = setting(key, piece, picks);
  if (set) return `set to ${set}`;
  if (key === 'fin' && piece.box) return String(piece.box).toLowerCase();
  if (key === 'mast' && piece.diam) return piece.diam;
  return '';
}

/** How an alternative differs from the one above it: the reason to take it. */
export function altSub(key, piece, picks) {
  const bits = [];
  if (key === 'mast') {
    if (piece.diam) bits.push(piece.diam);
    const plan = rigPlan(picks.sail, piece);
    if (plan && plan.ext > 0) bits.push(`needs +${fmt(plan.ext)} extension`);
    if (plan && plan.head > 0) bits.push(`head open ${fmt(plan.head)} cm`);
  }
  if (key === 'ext') {
    if (piece.diam) bits.push(piece.diam);
    const plan = rigPlan(picks.sail, picks.mast, piece);
    if (plan && known(piece.max) && plan.ext >= piece.max - 0.5) bits.push('at its limit');
  }
  if (key === 'boom') {
    const wanted = picks.sail && picks.sail.boom;
    if (known(wanted) && known(piece.max)) {
      if (wanted >= piece.max - 0.5) bits.push(`${fmt(wanted)} is its maximum`);
      else bits.push(`covers ${fmt(wanted)}`);
    }
  }
  if (key === 'fin') {
    if (piece.box) bits.push(String(piece.box).toLowerCase());
  }
  if (piece.spot) bits.push(piece.spot);
  return bits.join(' · ');
}

/**
 * The chips on a recommendation. "best match" is the ranking's own verdict;
 * everything else is a fact about the piece that made it rank where it did.
 *
 * The diameter chip is the one that can turn amber: an extension bolts into
 * its mast, so those two must agree whatever the sail is.
 */
export function tagsForPiece(key, piece, picks, isBest) {
  const tags = [];
  const partner = key === 'fin' ? picks.board : picks.sail;

  if (partner && partner.mfr && piece.mfr === partner.mfr) tags.push({ t: 'brand match' });
  if (key === 'fin' && piece.box && picks.board && picks.board.box === piece.box) {
    tags.push({ t: 'box match' });
  }
  // Green, because it is the one chip that is a verdict rather than a fact:
  // of everything that fits, this is the one the app would take.
  if (isBest) tags.push({ t: 'best match', ok: true });

  if ((key === 'mast' || key === 'ext') && piece.diam) {
    const other = key === 'mast' ? picks.ext : picks.mast;
    const otherDiam = other && other.diam;
    const clash = Boolean(otherDiam && otherDiam !== piece.diam);
    tags.push({ t: piece.diam, tick: !clash, warn: clash });
  }
  if (partner && partner.spot && piece.spot === partner.spot) {
    tags.push({ t: `same rack as your ${key === 'fin' ? 'board' : 'sail'}` });
  }
  if (piece.cond) tags.push({ t: piece.cond, cond: true });
  return tags;
}

/**
 * The "what you need to find" list, worked from this sail and board alone. It
 * deliberately names a total rather than one mast, because any mast and
 * extension reaching the luff rigs the sail equally well.
 */
export function shoppingList(picks) {
  const lines = [];
  const { sail, board } = picks;

  if (sail && known(sail.luff)) {
    const book = textbookRig(sail.luff);
    // The second option the club's own how-to reaches for first: the next mast
    // up, with the sail's head opened to swallow the overshoot. That only
    // exists on a sail with an adjustable top, so a shorter mast on a longer
    // extension is the fallback for a fixed-luff sail.
    const taller = STD_MASTS.find((size) =>
      size > sail.luff && size - sail.luff <= (sail.topExt || 0));
    const shorter = STD_MASTS.filter((size) =>
      size < book.mast && sail.luff - size <= EXT_MAX).pop();
    let line = `A ${book.mast} mast and an extension set to +${book.ext}`;
    if (taller) line += `, or a ${taller} mast with the sail top opened ${fmt(taller - sail.luff)} cm`;
    else if (shorter) line += `, or a ${shorter} mast set to +${Math.round(sail.luff - shorter)}`;
    line += `. Anything totalling ${fmt(sail.luff)} works`;
    if (sail.topExt > 0) line += `, up to ${fmt(sail.luff + sail.topExt)} with the head open`;
    lines.push(`${line}.`);
  } else if (sail) {
    lines.push('A mast and extension totalling this sail\'s luff. It is not recorded, so check the sail.');
  }

  if (sail && known(sail.boom)) {
    lines.push(`A boom set to ${fmt(sail.boom)}, any boom whose range covers ${fmt(sail.boom)}.`);
  }
  if (sail) lines.push('A standard UJ.');
  if (board) {
    lines.push(board.box
      ? `A ${String(board.box).toLowerCase()} fin.`
      : 'A fin matching the board\'s box. The box is not recorded, so check the board.');
  }
  return lines;
}

/**
 * The eight steps, in the club's own order (Garden, "How to rig (template)"),
 * carrying this rig's numbers rather than describing rigging in the abstract.
 * The rig is built first and the board last, which is why the UJ and the fin
 * are two steps at the end rather than one line about the extension.
 */
export function riggingSteps(picks) {
  const { sail, board, mast, ext } = picks;
  const plan = rigPlan(sail, mast, ext);
  const extText = plan ? `+${fmt(plan.ext)}cm` : null;
  const headText = plan && plan.head > 0 ? `${fmt(plan.head)}cm` : null;
  const boomText = sail && known(sail.boom) ? `${fmt(sail.boom)}cm` : null;
  const boxText = board && board.box ? String(board.box).toLowerCase() : null;

  return [
    { text: 'Unroll the sail out downwind from you.' },
    { text: 'Slide the mast into the sleeve, base last, and push it right up to the head.' },
    extStep(plan, extText, headText),
    { text: 'Thread the downhaul and pull until the leech goes soft to the second batten.' },
    boomText
      ? { text: 'Set the boom to ', b: boomText, tail: ', slide it onto the sail, then clamp it at shoulder height.' }
      : { text: 'Set the boom to the sail\'s boom length, slide it onto the sail, then clamp it at shoulder height.' },
    { text: 'At the other end of the boom, attach and tension the outhaul.' },
    { text: 'Slot your UJ into the board, and twist to secure.' },
    boxText
      ? { text: `Place the fin into the ${boxText} on the underside of the board and bolt it in with a screwdriver.` }
      : { text: 'Place the fin into the fin box on the underside of the board and bolt it in with a screwdriver.' },
  ];
}

/**
 * Step three. A mast longer than the luff needs no extension at all, and
 * "set it to +0cm" reads as an instruction to do nothing, so that rig is told
 * as what it is: closed right down, with the head taking the difference.
 */
function extStep(plan, extText, headText) {
  const head = headText ? `, leaving ${headText} of mast out of the top.` : '.';
  if (!extText) {
    return { text: 'Set the extension so the mast and extension total the luff, and slot it into the mast.' };
  }
  if (plan && plan.ext === 0) {
    return { text: `Slot the extension into the mast, closed right down${head}` };
  }
  return { text: 'Set the extension to ', b: extText, tail: ` and slot it into the mast${head}` };
}

/**
 * The cambered-sail warning. Cams clamp round the mast and have to rotate past
 * the boom head, which is a genuinely harder rig and worth saying so.
 */
export const camsNote = (sail) => Boolean(sail && sail.cams);
