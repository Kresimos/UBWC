/**
 * The trailer solver: given the sails somebody wants to take, decide which
 * masts, extensions and booms go on the trailer with them.
 *
 * This is the combinatorial half of the trip wizard. The rig rules themselves
 * are CLAUDE.md's and are restated here in section 1 rather than imported, so
 * this file runs on its own under `node` with nothing else loaded.
 *
 * The shape of the problem, and why it is not as bad as it looks:
 *
 *  - **The boom is independent of the mast and extension.** Nothing about a
 *    boom constrains which mast a sail ends up on. So "can these sails all be
 *    rigged at once" factors into two assignment problems sharing no resources.
 *  - **Each sail accepts a window of mast lengths**, `[luff - 50, luff + top]`,
 *    and masts come on a 30cm grid, so a sail has two or three lengths open to
 *    it. The branching factor per sail is tiny however big the club's rack is.
 *  - **Kit is interchangeable within a class.** Two 430 RDM Duotone masts are
 *    the same mast as far as rigging goes. So a packing list is a vector of
 *    small counts over a dozen classes, not a subset of a 200-item inventory.
 *
 * That last point is what makes the outer search tractable: the space to search
 * is a small integer lattice, and section 5 walks it.
 *
 * Everything here works on the three rig slots only. Boards, fins and bases are
 * a counting exercise with one hard rule (box type) and are handled elsewhere.
 */

export const EXT_MAX = 50; // the physical travel of a mast extension, in cm
const EPS = 1e-9;
const BIG = 1000; // one rigged sail outranks any amount of kit-match quality

const known = (v) => v !== null && v !== undefined;
const popcount = (m) => { let c = 0; while (m) { m &= m - 1; c++; } return c; };

const CONDITION_RANK = { 'very good': 3, good: 2, fair: 1, poor: 0 };
const conditionScore = (p) => CONDITION_RANK[String(p.cond || '').toLowerCase()] ?? 1.5;
const ratingScore = (p) => (p.rate ? p.rate.avg : 3);

/* ================================================== 1. the hard rig rules */

/**
 * The window of mast lengths this sail accepts. A mast shorter than the luff
 * needs an extension to bridge the gap, and an extension only has 50cm of
 * travel; a mast longer than the luff is only legal if the head opens far
 * enough to swallow the overshoot. Hence `[luff - 50, luff + adjustable top]`.
 */
export function mastWindow(sail) {
  if (!known(sail.luff)) return null;
  return [sail.luff - EXT_MAX, sail.luff + (sail.topExt || 0)];
}

export function mastFits(sail, mast) {
  // Cams are moulded to one diameter. Everything else takes either.
  if (sail.cams && sail.diam && mast.diam && sail.diam !== mast.diam) return false;
  const w = mastWindow(sail);
  // A missing measurement is somebody not having written it down, and must
  // never be read as a "no".
  if (!w || !known(mast.len)) return true;
  return mast.len >= w[0] - EPS && mast.len <= w[1] + EPS;
}

/** The band of extension settings that make this mast total this sail's luff. */
export function extNeed(sail, mast) {
  if (!known(sail.luff) || !known(mast.len)) return null;
  const low = Math.max(0, sail.luff - mast.len);
  const high = Math.min(EXT_MAX, sail.luff + (sail.topExt || 0) - mast.len);
  return high < low ? null : [low, high];
}

/**
 * The setting a person actually uses: head kept shut, extension making up the
 * difference. The head only opens when the mast is longer than the luff.
 */
export function extSetting(sail, mast) {
  if (!known(sail.luff) || !known(mast.len)) return null;
  return Math.max(0, sail.luff - mast.len);
}

export function extFits(sail, mast, ext) {
  // An extension bolts into its mast, so those two must agree whatever the
  // sail is.
  if (ext.diam && mast.diam && ext.diam !== mast.diam) return false;
  const need = extNeed(sail, mast);
  if (!need || !known(ext.min)) return true;
  return Math.max(need[0], ext.min) <= Math.min(need[1], ext.max) + EPS;
}

export function boomFits(sail, boom) {
  if (!known(sail.boom) || !known(boom.min)) return true;
  return sail.boom >= boom.min - EPS && sail.boom <= boom.max + EPS;
}

/* ==================================================== 2. the soft ranking */

/**
 * A piece's score splits cleanly in two, and the split is what lets section 4
 * stay exact:
 *
 *  - `itemPart` depends on the physical item alone (how the club rates it, what
 *    condition it is in, what is broken). Every sail values it the same.
 *  - `sailPart` depends on the sail and on the *class* spec (brand, length,
 *    range), never on which individual item of that class you happen to hold.
 *
 * So the total match quality of an assignment is
 * `sum over sails of sailPart` plus `sum over classes of the itemParts of the
 * items actually taken`, and the second sum does not care who got what. That
 * makes it a per-class prefix sum the solver can charge incrementally.
 */
export const itemPart = (p) =>
  ratingScore(p) * 1.2 + conditionScore(p) - 2 * ((p.faults || []).length);

function mastPart(sail, mast) {
  let s = 0;
  if (sail.mfr && mast.mfr === sail.mfr) s += 2.5;   // brand match is a nudge, never a rule
  const x = extSetting(sail, mast);
  if (x !== null) s += 2 - Math.min(2, x / 25);      // least extension rigs cleanest
  if (sail.diam && mast.diam === sail.diam) s += 1;  // free when it was free to choose
  return s;
}

function extPart(sail, mast, ext) {
  let s = 0;
  if (sail.mfr && ext.mfr === sail.mfr) s += 2.5;
  const x = extSetting(sail, mast);
  // Sitting at the top of its travel means a hard downhaul, so room to spare wins.
  if (x !== null && known(ext.max)) s += Math.min(1.5, Math.max(0, ext.max - x) / 10);
  if (mast.diam && ext.diam === mast.diam) s += 1.5;
  return s;
}

function boomPart(sail, boom) {
  let s = 0;
  if (sail.mfr && boom.mfr === sail.mfr) s += 2.5;
  if (known(sail.boom) && known(boom.min)) {
    const headroom = Math.min(sail.boom - boom.min, boom.max - sail.boom);
    s += Math.min(1.5, Math.max(0, headroom) / 15);
  }
  return s;
}

/* ============================================= 3. classes and the model */

/**
 * Two pieces are the same piece to the solver when they rig identically and
 * rank identically. Brand is in the key because it changes the ranking (a Neil
 * Pryde sail prefers a Neil Pryde mast), so keeping it here means a class has
 * one `sailPart` for a given sail and the split in section 2 holds exactly.
 *
 * But brand only ever earns a piece points for matching a sail that is actually
 * going, so a brand no sail on this trip shares cannot change any score, and
 * splitting the rack by it just doubles the classes for nothing. Those pieces
 * are keyed as one anonymous brand instead. This is not a nicety: the solver's
 * state is a count per class, so the class list is what decides whether it
 * answers in milliseconds or minutes, and a club rack carries plenty of brands
 * that no given trip cares about.
 */
const ANY_BRAND = '~';

function classKeyOf(p, brandsThatMatter) {
  const b = brandsThatMatter.has(p.mfr) ? p.mfr : ANY_BRAND;
  if (p.kind === 'mast') return `mast|${p.len}|${p.diam || '?'}|${b}`;
  if (p.kind === 'ext') return `ext|${p.min}-${p.max}|${p.diam || '?'}|${b}`;
  if (p.kind === 'boom') return `boom|${p.min}-${p.max}|${b}`;
  return null;
}

export function classLabel(c) {
  const p = c.rep;
  const brand = c.key.endsWith(ANY_BRAND) ? 'any brand' : (p.mfr || 'unbranded');
  if (c.kind === 'mast') return `${p.len} ${p.diam || ''} ${brand}`.replace(/\s+/g, ' ').trim();
  if (c.kind === 'ext') return `${p.min}-${p.max} ${p.diam || ''} ${brand} ext`.replace(/\s+/g, ' ').trim();
  return `${p.min}-${p.max} ${brand} boom`;
}

/**
 * Everything the solver needs, worked out once: the classes in the club's rack,
 * and for each sail the list of (mast class, extension class, boom class)
 * triples that legally rig it.
 *
 * `pins` are item ids somebody has insisted on. A pinned item sorts to the
 * front of its class, so "take k from this class" always takes the pinned ones
 * first, and `floor[class]` records how many must be taken.
 */
export function buildModel(sails, kit, pins = []) {
  const pinned = new Set(pins);
  const classes = [];
  const byKey = new Map();
  // The only brands worth splitting the rack by are the ones a sail on this
  // trip could match.
  const brandsThatMatter = new Set(sails.map((s) => s.mfr).filter(Boolean));

  for (const p of kit) {
    const key = classKeyOf(p, brandsThatMatter);
    if (!key) continue;
    let c = byKey.get(key);
    if (!c) {
      c = { key, kind: p.kind, rep: p, items: [], idx: classes.length };
      byKey.set(key, c);
      classes.push(c);
    }
    c.items.push(p);
  }

  const floor = classes.map(() => 0);
  classes.forEach((c) => {
    c.items.sort((a, b) =>
      (pinned.has(b.id) ? 1 : 0) - (pinned.has(a.id) ? 1 : 0)
      || itemPart(b) - itemPart(a)
      || String(a.id).localeCompare(String(b.id)));
    floor[c.idx] = c.items.filter((i) => pinned.has(i.id)).length;
  });

  const masts = classes.filter((c) => c.kind === 'mast');
  const exts = classes.filter((c) => c.kind === 'ext');
  const booms = classes.filter((c) => c.kind === 'boom');

  const rows = sails.map((sail) => {
    const triples = [];
    for (const m of masts) {
      if (!mastFits(sail, m.rep)) continue;
      const mp = mastPart(sail, m.rep);
      for (const e of exts) {
        if (!extFits(sail, m.rep, e.rep)) continue;
        const me = mp + extPart(sail, m.rep, e.rep);
        for (const b of booms) {
          if (!boomFits(sail, b.rep)) continue;
          triples.push({ m: m.idx, e: e.idx, b: b.idx, part: me + boomPart(sail, b.rep) });
        }
      }
    }
    triples.sort((a, b) => b.part - a.part);
    return { sail, triples };
  });

  // The best a sail could ever score if it had the whole rack to itself. Used
  // only to put match quality on a 0..1 scale, so a number in the CLI means
  // something without knowing the weights.
  const ceiling = rows.map((row) => {
    let best = 0;
    for (const t of row.triples) {
      const v = t.part
        + itemPart(classes[t.m].items[0])
        + itemPart(classes[t.e].items[0])
        + itemPart(classes[t.b].items[0]);
      if (v > best) best = v;
    }
    return best;
  });

  // Never stock more of a class than there are sails that could use it: kit
  // beyond that can only ever add weight.
  const useful = classes.map(() => 0);
  rows.forEach((row) => {
    const seen = new Set();
    row.triples.forEach((t) => { seen.add(t.m); seen.add(t.e); seen.add(t.b); });
    seen.forEach((i) => { useful[i] += 1; });
  });
  const cap = classes.map((c, i) => Math.max(floor[i], Math.min(c.items.length, useful[i])));

  const model = { classes, rows, sails, floor, cap, ceiling, useful };

  // The deepest group each sail could ever be part of, if the trailer carried
  // everything on site. This is the bar the packing list is measured against,
  // so a sail the club simply cannot serve is never held against the list.
  model.possible = reachVector(model, cap);

  return model;
}

/* ================================================ 4. the inner assignment */

// Nodes the exact search may spend before the greedy fallback takes over.
// About 25 ms of work, and plenty for any trip of a handful of sails.
const DP_BUDGET = 20000;
// Nodes `allRiggable` may spend backtracking once its one-pass attempt has failed.
const ALL_RIGGABLE_BUDGET = 60;
// Groups of one size `sessionCoverage` will test. Past it, an even spread of them.
const COVERAGE_GROUPS = 60;
// Largest group `allRiggable` backtracks for after its one-pass attempt misses.
const BACKTRACK_UP_TO = 3;

/**
 * The exact answer to "with this trailer, how many of these sails can stand up
 * at the same time, and how well does each one match its kit".
 *
 * It is a dynamic program over sails, with the state being how much of each
 * class is left. Two things keep it small:
 *
 *  - sails are taken most-constrained-first, so the branches that fail fail early;
 *  - the state is a vector of counts, not a set of items, so two different ways
 *    of spending the same kit collapse to one memo entry.
 *
 * The value maximised is `rigs * 1000 + match`, which is lexicographic: it will
 * never give up a rigged sail to improve anybody's brand match.
 *
 * Options:
 *   `mask`    which sails are on the table at all (default: all of them)
 *   `require` sails that must come away with a rig; a solution that cannot give
 *             one of them a rig is no solution. This is what `reach` uses to ask
 *             "how big a group can this particular sail be part of".
 *   `budget`  caps the nodes explored. At club sizes it is never reached, and
 *             the result carries `exact: false` if it ever is.
 *
 * The exact search is exponential in the number of sails on the table, and the
 * trailer search calls it for every candidate trailer. A trip of 17 sails
 * against a 220-piece rack never finishes it (the wizard froze on the spinner),
 * so when it overflows its budget the answer falls back to `greedy` below, and
 * the model remembers the size so later calls skip the doomed attempt.
 */
export function solve(model, counts, options = {}) {
  const { mask, require = 0, budget = DP_BUDGET } = options;
  const rows = model.rows;
  const full = rows.length === 32 ? -1 : (1 << rows.length) - 1;
  const use = mask === undefined ? full : mask;

  const idxs = [];
  for (let i = 0; i < rows.length; i++) if ((use >> i) & 1) idxs.push(i);
  idxs.sort((a, b) => rows[a].triples.length - rows[b].triples.length);

  const unit = model.classes.map((c) => c.items.map(itemPart));
  const caps = counts.slice();
  const memo = new Map();
  let nodes = 0;
  let overflow = false;
  const tooBig = idxs.length >= (model.dpLimit ?? Infinity);

  // A count past what the club actually owns is a "what if we had one more",
  // which `shortfalls` asks to work out which slot ran out. Such a piece rigs
  // like the rest of its class and is worth nothing on condition or rating,
  // since there is no real item to have an opinion about.
  const partOf = (c, j) => unit[c][j] ?? 0;

  // Pinned items sit at the front of their class, so consuming index `j < floor`
  // means a rig is being built through a piece somebody asked for. A flat nudge,
  // well under BIG so it never trades away a rigged sail, steers `solve` towards
  // the arrangement that actually uses the requested kit rather than packing it
  // as a spare beside the rigs.
  const PIN_BONUS = 100;
  const pinOf = (c, j) => (j < model.floor[c] ? PIN_BONUS : 0);

  const gainOf = (t) => BIG + t.part
    + partOf(t.m, counts[t.m] - caps[t.m]) + pinOf(t.m, counts[t.m] - caps[t.m])
    + partOf(t.e, counts[t.e] - caps[t.e]) + pinOf(t.e, counts[t.e] - caps[t.e])
    + partOf(t.b, counts[t.b] - caps[t.b]) + pinOf(t.b, counts[t.b] - caps[t.b]);

  // The pin nudge, on the three items a triple is about to consume. Peeled back
  // out of the plan's recorded gain so match quality stays a pure kit score.
  const pinPart = (t) => pinOf(t.m, counts[t.m] - caps[t.m])
    + pinOf(t.e, counts[t.e] - caps[t.e])
    + pinOf(t.b, counts[t.b] - caps[t.b]);

  // The fallback: one pass, most-constrained sail first (required sails ahead
  // of those), each taking the best-scoring triple still in stock. A feasible
  // arrangement rather than the best one, so `exact` is false, but it costs
  // microseconds and a rack with kit to spare gives the same answer.
  function greedy() {
    const order = idxs.slice().sort((a, b) =>
      (((require >> b) & 1) - ((require >> a) & 1))
      || rows[a].triples.length - rows[b].triples.length);
    const plan = [];
    let pinTotal = 0;
    let partTotal = 0;
    for (const i of order) {
      let took = null;
      for (const t of rows[i].triples) {
        if (caps[t.m] <= 0 || caps[t.e] <= 0 || caps[t.b] <= 0) continue;
        const gain = gainOf(t);
        if (!took || gain > took.score) {
          took = {
            t, score: gain, bonus: pinPart(t),
            units: { m: counts[t.m] - caps[t.m], e: counts[t.e] - caps[t.e], b: counts[t.b] - caps[t.b] },
          };
        }
      }
      if (!took) {
        if ((require >> i) & 1) return { rigs: 0, part: 0, plan: [], exact: false, impossible: true };
        continue;
      }
      const { t } = took;
      caps[t.m]--; caps[t.e]--; caps[t.b]--;
      pinTotal += took.bonus;
      partTotal += took.score - BIG - took.bonus;
      plan.push({ sailIdx: i, t, units: took.units, gain: took.score - BIG - took.bonus });
    }
    plan.sort((a, b) => a.sailIdx - b.sailIdx);
    return { rigs: plan.length, part: partTotal, plan, exact: false };
  }

  if (tooBig) return greedy();

  function value(k) {
    if (k === idxs.length) return 0;
    const key = k + '|' + String.fromCharCode.apply(null, caps);
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    if (++nodes > budget) { overflow = true; return 0; }

    // Leaving a sail short is a shortfall line, not a shared mast. A required
    // sail does not get that branch, so a trailer that cannot rig it scores
    // -Infinity and the whole arrangement is discarded.
    let best = ((require >> idxs[k]) & 1) ? -Infinity : value(k + 1);
    for (const t of rows[idxs[k]].triples) {
      if (caps[t.m] <= 0 || caps[t.e] <= 0 || caps[t.b] <= 0) continue;
      const gain = gainOf(t);
      caps[t.m]--; caps[t.e]--; caps[t.b]--;
      const v = gain + value(k + 1);
      caps[t.m]++; caps[t.e]++; caps[t.b]++;
      if (v > best) best = v;
    }
    memo.set(key, best);
    return best;
  }

  const total = value(0);

  if (overflow) {
    model.dpLimit = Math.min(model.dpLimit ?? Infinity, idxs.length);
    caps.splice(0, caps.length, ...counts);
    return greedy();
  }

  // No arrangement rigs every required sail, so there is nothing to report.
  if (total === -Infinity) return { rigs: 0, part: 0, plan: [], exact: !overflow, impossible: true };

  // Replay the decisions to recover the assignment itself. Every memo entry is
  // already warm, so this walk is free.
  const plan = [];
  let pinTotal = 0;
  for (let k = 0; k < idxs.length; k++) {
    const target = value(k);
    let took = null;
    for (const t of rows[idxs[k]].triples) {
      if (caps[t.m] <= 0 || caps[t.e] <= 0 || caps[t.b] <= 0) continue;
      const gain = gainOf(t);
      const bonus = pinPart(t);
      const units = { m: counts[t.m] - caps[t.m], e: counts[t.e] - caps[t.e], b: counts[t.b] - caps[t.b] };
      caps[t.m]--; caps[t.e]--; caps[t.b]--;
      if (Math.abs(gain + value(k + 1) - target) < 1e-6) { took = { t, units, gain: gain - BIG - bonus }; pinTotal += bonus; break; }
      caps[t.m]++; caps[t.e]++; caps[t.b]++;
    }
    if (took) plan.push({ sailIdx: idxs[k], ...took });
  }

  return { rigs: plan.length, part: total - plan.length * BIG - pinTotal, plan, exact: !overflow };
}

/**
 * Can every sail in `mask` be rigged at once off this trailer? A yes/no, which
 * is a much cheaper question than `solve`'s: there is no skip branch and no
 * score to maximise, so the first complete assignment found ends it and a dead
 * branch is abandoned the moment a sail has nowhere to go.
 *
 * This is the hot path. Section 5 asks it once per group of sails, and the
 * outer search asks section 5 once per candidate trailer.
 */
export function allRiggable(model, counts, mask) {
  const rows = model.rows;
  const idxs = [];
  for (let i = 0; i < rows.length; i++) if ((mask >> i) & 1) idxs.push(i);
  if (!idxs.length) return true;

  // Cheap rejects first: a sail nothing fits, or more sails than there are
  // masts, extensions or booms of any use to them.
  const kinds = { mast: 0, ext: 0, boom: 0 };
  model.classes.forEach((c, i) => { kinds[c.kind] += counts[i]; });
  if (idxs.length > Math.min(kinds.mast, kinds.ext, kinds.boom)) return false;
  for (const i of idxs) if (!rows[i].triples.length) return false;

  idxs.sort((a, b) => rows[a].triples.length - rows[b].triples.length);
  const caps = counts.slice();
  const dead = new Set();

  // A yes is a yes however it is found, so try the one-pass answer first (each
  // sail on the triple that leaves the most stock behind). On a trailer with
  // kit to spare it succeeds at once; the backtracking below is only for the
  // tight ones, and it is capped, because a group of a dozen sails against a
  // thin trailer can otherwise search for minutes. Past the cap the answer is
  // no, which only ever makes the search pack a little more.
  const left = counts.slice();
  let fits = true;
  for (const i of idxs) {
    let took = null;
    let room = -1;
    for (const t of rows[i].triples) {
      if (left[t.m] <= 0 || left[t.e] <= 0 || left[t.b] <= 0) continue;
      const spare = left[t.m] + left[t.e] + left[t.b];
      if (spare > room) { room = spare; took = t; }
    }
    if (!took) { fits = false; break; }
    left[took.m]--; left[took.e]--; left[took.b]--;
  }
  if (fits) return true;
  // Backtracking is for the small groups, where a miss would be a visible hole.
  if (idxs.length > BACKTRACK_UP_TO) return false;

  let nodes = 0;
  function rec(k) {
    if (k === idxs.length) return true;
    const key = k + '|' + String.fromCharCode.apply(null, caps);
    if (dead.has(key)) return false;
    if (++nodes > ALL_RIGGABLE_BUDGET) return false;
    for (const t of rows[idxs[k]].triples) {
      if (caps[t.m] <= 0 || caps[t.e] <= 0 || caps[t.b] <= 0) continue;
      caps[t.m]--; caps[t.e]--; caps[t.b]--;
      const ok = rec(k + 1);
      caps[t.m]++; caps[t.e]++; caps[t.b]++;
      if (ok) return true;
    }
    dead.add(key);
    return false;
  }
  return rec(0);
}

/* ======================================================== 5. scoring a P */

export const DEFAULT_WEIGHTS = {
  // The reward, on a 0..1 scale: spare kit the promise does not strictly need,
  // so a broken piece still leaves a qualifying group and there is a wider
  // choice at the trailer. Measured per kind and run through a sharply concave
  // curve, so the first spare is worth far more than the fifth.
  spare: 45,
  // The penalty, charged per sail-slot short of the promise. At 25 a piece of
  // kit (2) is obviously worth taking to close a gap, and closing a gap always
  // beats improving anybody's brand match (30 across every sail at once).
  short: 25,
  match: 30,
  // Charged per piece on the trailer. Raise it for a smaller trailer.
  light: 2,
  // The reward, on a 0..1 scale: the fraction of small sail-groups (pairs, then
  // triples, up to the promise) that actually stand up at once. The promise
  // above only asks that every sail is in *some* qualifying group; this asks
  // that *every* small group is one, which is what stops a trailer that rigs
  // three at a time but not this particular three. At 15 it takes every gap the
  // search can close without adding a piece; raise it to chase the last few at a
  // point or two of brand match, lower it toward 0 for the old behaviour.
  sessions: 15,
};

/**
 * How far a sail can go: the size of the largest group of sails that can all
 * stand up at once with this one among them. 0 means it cannot rig at all.
 *
 * This is the whole of the flexibility measure, and it is a per-sail question
 * rather than a per-group one, which is why it is cheap. Riggability is
 * downward closed, so a sail that reaches a group of 6 also reaches every
 * smaller group; one number per sail says everything a count of groups did.
 */
export function reach(model, counts, sailIdx) {
  return maxRigsWith(model, counts, 1 << sailIdx).count;
}

/**
 * The actual sails in the biggest group this one can be part of, as a list of
 * sail indices. `reach` is its size; this is the group itself, which `coverage`
 * needs to show a doubting sail the session it stands up in.
 */
export function reachGroup(model, counts, sailIdx) {
  const set = maxRigsWith(model, counts, 1 << sailIdx).set;
  return model.rows.map((_, i) => i).filter((i) => (set >> i) & 1);
}

/**
 * Every sail's reach at once, in far fewer searches than one per sail.
 *
 * One unconstrained search returns the biggest group there is, and that group
 * settles most of the answer on its own: no sail can reach past it, and every
 * sail *in* it plainly reaches it, so all of those are done. Only the sails
 * left out of the biggest group have anything still to work out. On a rack that
 * rigs everything this is a single search; on the fixture rack, where seven
 * extensions cap the eighth sail, it is two.
 */
export function reachVector(model, counts) {
  const n = model.rows.length;
  const base = maxRigsWith(model, counts, 0);
  const out = new Array(n).fill(0);
  if (base.count === n) return out.fill(n);

  for (let i = 0; i < n; i++) {
    out[i] = ((base.set >> i) & 1)
      ? base.count
      : maxRigsWith(model, counts, 1 << i, base.count).count;
  }
  return out;
}

/**
 * The largest number of sails that rig at once, with `require` among them.
 *
 * Deliberately not `solve`: reach is a counting question, and dropping the
 * match score shrinks the value space to the integers 0..n, which both collapses
 * the memo and allows the early exit below. That exit is what makes this cheap
 * on a well-stocked rack, where the first branch tried usually rigs everything
 * left and the rest of the tree is never opened.
 */
function maxRigsWith(model, counts, require, ceiling = Infinity, budget = DP_BUDGET) {
  const rows = model.rows;
  const idxs = rows.map((_, i) => i)
    .sort((a, b) => rows[a].triples.length - rows[b].triples.length);
  const caps = counts.slice();
  const memo = new Map();
  let nodes = 0;
  let overflow = false;

  // The same escape as `solve`: when the exact count is out of reach, take a
  // feasible group instead. Required sails go first, then the most constrained,
  // each on the triple that leaves the most stock behind. A lower bound, never
  // an overcount, and the model remembers so later calls go straight here.
  function greedyCount() {
    const left = counts.slice();
    const order = idxs.slice().sort((a, b) =>
      (((require >> b) & 1) - ((require >> a) & 1))
      || rows[a].triples.length - rows[b].triples.length);
    let set = 0;
    let count = 0;
    for (const i of order) {
      let took = null;
      let room = -1;
      for (const t of rows[i].triples) {
        if (left[t.m] <= 0 || left[t.e] <= 0 || left[t.b] <= 0) continue;
        const spare = left[t.m] + left[t.e] + left[t.b];
        if (spare > room) { room = spare; took = t; }
      }
      if (!took) {
        if ((require >> i) & 1) return { count: 0, set: 0 };
        continue;
      }
      left[took.m]--; left[took.e]--; left[took.b]--;
      set |= 1 << i;
      count++;
    }
    return { count: Math.min(count, ceiling), set };
  }

  if (model.reachGreedy) return greedyCount();

  function rec(k) {
    if (k === idxs.length) return 0;
    const key = k + '|' + String.fromCharCode.apply(null, caps);
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    // A rack big enough to exhaust this is past what any club owns, but the
    // answer must still come back: a low count reads as a shortfall the kit sec
    // can see and argue with, where a hung wizard reads as a broken app.
    if (++nodes > budget) { overflow = true; return 0; }

    // Rigging this sail is tried before leaving it behind, and the order is the
    // whole performance of this function. `most` is every sail from here down,
    // which nothing can beat, so on a rack with enough kit the first triple
    // reaches it and the search returns without opening another branch. Trying
    // the skip first would explore that entire subtree before the exit could
    // ever fire, which is the difference between microseconds and seconds.
    const most = idxs.length - k;
    let best = -Infinity;

    for (const t of rows[idxs[k]].triples) {
      if (caps[t.m] <= 0 || caps[t.e] <= 0 || caps[t.b] <= 0) continue;
      caps[t.m]--; caps[t.e]--; caps[t.b]--;
      const v = 1 + rec(k + 1);
      caps[t.m]++; caps[t.e]++; caps[t.b]++;
      if (v > best) best = v;
      if (best >= most) break;
    }

    // Leaving it behind, which is only worth costing out if rigging it did not
    // already reach the ceiling.
    if (best < most && !((require >> idxs[k]) & 1)) {
      const skipped = rec(k + 1);
      if (skipped > best) best = skipped;
    }

    memo.set(key, best);
    return best;
  }

  const got = rec(0);
  if (overflow) {
    model.reachGreedy = true;
    return greedyCount();
  }
  if (got < 0) return { count: 0, set: 0 };

  // Replay the decisions to recover which sails were in the group. Every memo
  // entry is warm, so this walk costs nothing, and it is what lets `reachVector`
  // settle a whole group of sails from one search.
  let set = 0;
  for (let k = 0; k < idxs.length; k++) {
    const target = rec(k);
    for (const t of rows[idxs[k]].triples) {
      if (caps[t.m] <= 0 || caps[t.e] <= 0 || caps[t.b] <= 0) continue;
      caps[t.m]--; caps[t.e]--; caps[t.b]--;
      if (1 + rec(k + 1) === target) { set |= 1 << idxs[k]; break; }
      caps[t.m]++; caps[t.e]++; caps[t.b]++;
    }
  }
  return { count: Math.min(got, ceiling), set };
}


/**
 * The concave value of `s` spare pieces of one kind. The first spare is worth
 * 0.5, the second another 0.25, and so on: room to lose a piece matters a lot,
 * a deep bench much less. Zero below one spare so the promise's own kit earns
 * nothing here.
 */
const spareCurve = (s) => (s <= 0 ? 0 : 1 - Math.pow(0.5, s));

/**
 * Spare kit, counted per kind: pieces of each kind that fit some sail on the
 * trip, beyond the `datum` a single qualifying group needs. Only classes that
 * can serve a sail count, so a boom nothing on this trip can use is not spare,
 * it is dead weight. Monotone in the packing list (supply only rises, the datum
 * is fixed), which is what keeps `exhaustive`'s bound sound.
 */
export function spareByKind(model, counts, datum) {
  const fit = { mast: 0, ext: 0, boom: 0 };
  model.classes.forEach((c, i) => {
    if (counts[i] > 0 && model.useful[i] > 0) fit[c.kind] += counts[i];
  });
  return {
    mast: Math.max(0, fit.mast - datum),
    ext: Math.max(0, fit.ext - datum),
    boom: Math.max(0, fit.boom - datum),
  };
}

/** n choose k, as a float (only ever compared against a cap). */
function choose(n, k) {
  let out = 1;
  for (let i = 1; i <= k; i++) out = (out * (n - k + i)) / i;
  return Math.round(out);
}

/**
 * The fraction of small sail-groups that actually stand up at once — pairs,
 * then triples, up to `kMax`. Riggability is downward closed (a subset of a
 * riggable group rigs), so a group with a failing pair inside it fails too and
 * is scored 0 without a search. Weighted toward the small groups, since a pair
 * that will not rig is a worse surprise than a five that will not.
 *
 * Monotone in the packing list: every `allRiggable` is, so more kit can only
 * raise this. That is what lets `scoreP` add it and `exhaustive` bound with it.
 */
export function sessionCoverage(model, counts, kMax) {
  const n = model.rows.length;
  const k = Math.min(kMax, n);
  if (k < 2 || n < 2) return 1;

  const pair = Array.from({ length: n }, () => new Array(n).fill(false));
  let pairs = 0;
  let pairGood = 0;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const ok = allRiggable(model, counts, (1 << a) | (1 << b));
      pair[a][b] = ok;
      pairs += 1;
      if (ok) pairGood += 1;
    }
  }

  let num = pairs ? pairGood / pairs : 1;
  let den = 1;

  for (let size = 3; size <= k; size++) {
    const w = 1 / (size - 1);
    let total = 0;
    let good = 0;
    const idx = [];
    for (let i = 0; i < size; i++) idx.push(i);
    // Seventeen sails make 6,188 groups of five, each its own search. Past the
    // cap, test every stride-th group: the same ones on every call, so the
    // score still only rises as kit is added.
    const stride = Math.max(1, Math.ceil(choose(n, size) / COVERAGE_GROUPS));
    let at = 0;
    for (;;) {
      if (at++ % stride) {
        let p = size - 1;
        while (p >= 0 && idx[p] === n - size + p) p -= 1;
        if (p < 0) break;
        idx[p] += 1;
        for (let q = p + 1; q < size; q++) idx[q] = idx[q - 1] + 1;
        continue;
      }
      total += 1;
      let ok = true;
      for (let i = 0; i < size && ok; i++) {
        for (let j = i + 1; j < size; j++) if (!pair[idx[i]][idx[j]]) { ok = false; break; }
      }
      if (ok) {
        let mask = 0;
        for (const i of idx) mask |= 1 << i;
        if (allRiggable(model, counts, mask)) good += 1;
      }
      let p = size - 1;
      while (p >= 0 && idx[p] === n - size + p) p -= 1;
      if (p < 0) break;
      idx[p] += 1;
      for (let q = p + 1; q < size; q++) idx[q] = idx[q - 1] + 1;
    }
    num += w * (total ? good / total : 1);
    den += w;
  }

  return num / den;
}

/**
 * How good a packing list is, as five terms in their own units plus the
 * weighted sum the search actually maximises.
 *
 *   score(P) = w_spare * (mean over the three kinds of a concave count of spares)
 *            - w_short * (sail-slots short of the promised group size)
 *            + w_match * (mean kit-match quality over the rigged sails)
 *            - w_light * (pieces on the trailer)
 *
 * The promise being kept or broken is the point of this, and it is a promise
 * made to each sail separately: every sail on the list rigs, and every sail on
 * the list rigs in a group of at least `minRigs`. `short` counts, in sails, how
 * far off that promise the trailer is, so 0 means it is kept for everybody.
 * `spare` is the reward for going further: kit beyond the bare qualifying group,
 * so a snapped mast on day one still leaves one, and so there is a real choice
 * of rig at the trailer rather than exactly one arrangement that works.
 *
 * A sail the club's whole rack cannot rig, or cannot get to `minRigs` however
 * the trailer is packed, is an inventory problem rather than a packing one. It
 * is reported in `impossible` and never charged to the packing list, because
 * making the search buy kit for a sail nothing can help just costs weight.
 */
export function scoreP(model, counts, opts = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  const minRigs = opts.minRigs ?? 1;

  const full = solve(model, counts);
  const reaches = reachVector(model, counts);
  const pieces = counts.reduce((a, b) => a + b, 0);

  let shortBy = 0;
  let stranded = 0;
  let depthSum = 0;
  let counted = 0;
  const impossible = [];

  reaches.forEach((got, i) => {
    const best = model.possible[i];
    if (best === 0) { impossible.push(i); return; }
    // Never ask a sail for a bigger group than the club could ever give it.
    const asked = Math.min(minRigs, best);
    counted++;
    depthSum += got / best;
    if (got === 0) stranded++;
    shortBy += Math.max(0, asked - got);
  });

  const depth = counted ? depthSum / counted : 0;

  // The kit one qualifying group needs: `minRigs` of each kind, but never more
  // than the biggest group the whole rack can actually stand up (a trip with
  // three riggable sails and five the club cannot serve needs three of each
  // kind for its group, not eight). A constant given the trip and the rack, so
  // `spare` stays monotone in the packing list.
  const datum = Math.min(minRigs, Math.max(0, ...model.possible));
  const slack = spareByKind(model, counts, datum);
  const spare = (spareCurve(slack.mast) + spareCurve(slack.ext) + spareCurve(slack.boom)) / 3;

  let match = 0;
  for (const row of full.plan) {
    const ceil = model.ceiling[row.sailIdx];
    match += ceil > 0 ? Math.min(1, row.gain / ceil) : 1;
  }
  match = full.plan.length ? match / full.plan.length : 0;

  // Fraction of the small groups the promise cares about that actually rig. The
  // ceiling is a constant given the trip and the whole rack, so this term stays
  // monotone in the packing list.
  const kMax = Math.min(minRigs, Math.max(0, ...model.possible));
  const sessions = kMax >= 2 ? sessionCoverage(model, counts, kMax) : 1;

  const terms = {
    spare: weights.spare * spare,
    short: -weights.short * shortBy,
    match: weights.match * match,
    light: -weights.light * pieces,
    sessions: weights.sessions * sessions,
  };

  return {
    counts: counts.slice(),
    rigs: full.rigs, plan: full.plan, exact: full.exact,
    reaches, possible: model.possible, minRigs,
    depth, shortBy, stranded, impossible, keptPromise: shortBy === 0,
    minReach: counted ? Math.min(...reaches.filter((_, i) => model.possible[i] > 0)) : 0,
    spare, slack, datum,
    match, sessions, pieces, weights, terms,
    total: terms.spare + terms.short + terms.match + terms.light + terms.sessions,
  };
}

/**
 * Where the trailer is one breakage away from a broken promise. For each kind,
 * drop each packed class of it by one piece and check the promise still holds
 * for every sail; a kind that fails any of those drops is fragile. Three-ish
 * searches per packed class, so only worth running on the final list, not on
 * every candidate the search touches.
 */
export function fragileKinds(model, counts, opts = {}) {
  const minRigs = opts.minRigs ?? 1;
  const held = (probe) => reachVector(model, probe).every((got, s) =>
    model.possible[s] === 0 || got >= Math.min(minRigs, model.possible[s]));

  const out = [];
  for (const kind of ['mast', 'ext', 'boom']) {
    const idxs = model.classes
      .map((_, i) => i)
      .filter((i) => model.classes[i].kind === kind && counts[i] > 0);
    if (!idxs.length) continue;
    for (const i of idxs) {
      const probe = counts.slice();
      probe[i]--;
      if (!held(probe)) { out.push(kind); break; }
    }
  }
  return out;
}

/* ==================================================== 6. choosing the P */

/**
 * The starting trailer: walk the sails and give each one a rig.
 *
 * This exists because a marginal-gain greedy has nothing to climb from an empty
 * trailer. A mast on its own rigs nothing, and neither does a mast and a boom,
 * so every single-piece move scores exactly zero and the search never starts.
 * The smallest move that changes anything is a whole mast, extension and boom
 * at once, which is what this adds.
 *
 * Sails are served most-constrained-first, so the sail only one mast in the
 * club fits gets that mast rather than losing it to a sail anything would have
 * done for. Kit already on the trailer (anything pinned, or spare capacity from
 * an earlier sail's class) is spent before anything new is added, which is how
 * a pinned extension ends up with rigs built around it rather than beside it.
 */
function seedTrailer(model) {
  const { floor, cap } = model;
  const counts = floor.slice();
  const spare = floor.slice();

  // Ask the rack itself, exactly, rather than walking the sails and handing
  // each its favourite kit. A walk is greedy twice over and gets both wrong:
  // giving the first sail the extension it likes best can be the one thing
  // that stops a second sail rigging at all, and once that has happened no
  // later pass can see it, because the stranded sail's own kit is not what is
  // missing. `solve` over the whole rack settles who gets what in one go, and
  // its plan is the shortest list that rigs that many sails.
  const best = solve(model, cap);
  for (const row of best.plan) {
    for (const c of [row.t.m, row.t.e, row.t.b]) {
      if (spare[c] > 0) spare[c]--;
      else counts[c]++;
    }
  }
  return counts;
}

/**
 * Build the trailer.
 *
 * Three passes, each fixing the one before:
 *
 *  1. **Seed.** Give every sail a rig (above), so there is something to climb from.
 *  2. **Repair.** While some sail is short of the group size it was promised,
 *     add a whole rig for it. One piece at a time cannot fix a short sail,
 *     because a rig is three pieces and two of them buy nothing, so a
 *     piece-at-a-time greedy sees a flat score and stops. This move is the only
 *     one that can climb out of a broken promise.
 *  3. **Greedy.** Add the single piece with the best marginal gain, until
 *     nothing pays for itself. This is where a second 430 gets taken because it
 *     lets three more sails reach a full session, and where it does not.
 *  4. **Local search.** Greedy commits early and cannot undo, so drop and swap
 *     moves run until nothing improves. A swap is what rescues the case where
 *     one 430 was worth taking only if a 460 was not.
 *
 * `--exact` in the CLI runs `exhaustive` as well, which walks the whole lattice
 * and proves whether these found the optimum.
 *
 * `opts.mustRig` is a list of sail-index groups the kit sec has insisted must be
 * able to stand up at once (from the session checker). Each one raises the floor
 * to whatever that group needs, so the search can trim and swap around it but
 * never below it. A group only has to rig on its own, never alongside the other
 * required groups, so the floor is the per-class max across them, not the sum.
 */
export function chooseTrailer(model, opts = {}) {
  const { cap, classes, rows } = model;

  const floor = model.floor.slice();
  for (const group of opts.mustRig ?? []) {
    let mask = 0;
    for (const i of group) mask |= 1 << i;
    // Just this group on the table, all of it required: the kit is what those
    // sails alone need, not the biggest session that happens to contain them.
    const g = solve(model, cap, { mask, require: mask });
    if (!g.plan.length) continue; // unsatisfiable — the checker says so itself
    const need = floor.map(() => 0);
    g.plan.forEach((r) => { need[r.t.m]++; need[r.t.e]++; need[r.t.b]++; });
    need.forEach((v, c) => { if (v > floor[c]) floor[c] = v; });
  }
  const counts = seedTrailer({ ...model, floor });

  // A wall-clock backstop. The search is a hill climb that stops when nothing
  // improves, which on a big trip can be a long time; the wizard runs it on the
  // page's one thread, so past the deadline each pass stops and the best
  // trailer found so far is returned (`timedOut`). Generous, since the greedy
  // fallback in `solve` keeps every normal trip far under it.
  const deadline = Date.now() + (opts.deadlineMs ?? 4000);
  const late = () => Date.now() > deadline;

  // Local search revisits the same trailer many times over, so score each
  // distinct one once.
  const seen = new Map();
  const at = () => {
    const key = counts.join(',');
    let s = seen.get(key);
    if (!s) { s = scoreP(model, counts, opts); seen.set(key, s); }
    return s;
  };

  let cur = at();
  const trace = [{
    move: 'seed',
    label: `${cur.pieces} pieces, one rig per sail`,
    total: cur.total, rigs: cur.rigs,
  }];

  // Repair: carry enough kit for a whole qualifying group.
  //
  // This is where the promise and the seed part company. The seed packs for the
  // most rigs that can stand up together; the promise is made to each sail
  // separately, that *it* can be one of a group of `minRigs`. Those are
  // different lists. Four sails that can only ever rig two at a time still need
  // a trailer where each of the four is in some pair, and no amount of adding
  // one rig at a time finds it, because the sail that is short is not short of
  // its own kit: it is short of a companion it can rig alongside.
  //
  // So ask the rack directly for the best group containing this sail, and raise
  // each class to whatever that group needs. Raising rather than adding is the
  // point: the group only has to stand up on its own, never alongside the rest
  // of the list, so kit already packed for somebody else counts towards it.
  const minRigs = opts.minRigs ?? 1;
  for (let guard = 0; guard < rows.length + 1; guard++) {
    if (cur.keptPromise || late()) break;

    const behind = cur.reaches
      .map((got, i) => ({ i, gap: Math.min(minRigs, model.possible[i]) - got }))
      .filter((x) => model.possible[x.i] > 0 && x.gap > 0)
      .sort((a, b) => b.gap - a.gap);

    let moved = false;
    for (const { i } of behind) {
      const group = solve(model, cap, { require: 1 << i });
      if (!group.plan.length) continue;

      const need = counts.map(() => 0);
      group.plan.forEach((row) => { [row.t.m, row.t.e, row.t.b].forEach((c) => { need[c]++; }); });

      const before = counts.slice();
      let added = 0;
      need.forEach((n, c) => {
        if (n > counts[c]) { added += n - counts[c]; counts[c] = n; }
      });
      if (!added) continue;

      const after = at();
      // Judged on the promise alone. Whether those pieces were worth their
      // weight is the drop and unrig passes' question, not this one's.
      if (after.shortBy < cur.shortBy) {
        cur = after;
        moved = true;
        trace.push({
          move: 'repair', total: cur.total, rigs: cur.rigs,
          label: `${added} more for the ${rows[i].sail.m2}'s group`,
        });
        break;
      }
      before.forEach((v, c) => { counts[c] = v; });
    }
    if (!moved) break; // nothing on the rack closes any remaining gap
  }

  // Greedy: take whichever addition pays for itself best, and keep going until
  // none does. Two kinds of addition, because a piece and a rig are both real
  // moves and neither implies the other:
  //
  //  - one more piece, which is what widens the choice for a group already there;
  //  - a whole rig for a sail that has none, which brings another sail onto the
  //    packing list. A single piece cannot do that, because a rig is three
  //    pieces and two of them rig nothing on their own, so without this move the
  //    match reward and the spare capacity of a fuller list have nothing to
  //    climb from.
  for (;;) {
    if (late()) break;
    let best = cur;
    let move = null;

    for (let i = 0; i < counts.length; i++) {
      if (counts[i] >= cap[i]) continue;
      counts[i]++;
      const s = at();
      counts[i]--;
      if (s.total > best.total + EPS) {
        best = s;
        move = { slots: [i], label: classLabel(classes[i]), kind: 'add' };
      }
    }

    const rigged = new Set(cur.plan.map((p) => p.sailIdx));
    for (let i = 0; i < rows.length; i++) {
      if (rigged.has(i)) continue;
      const t = rows[i].triples.find((x) => [x.m, x.e, x.b].every((c) => counts[c] < cap[c]));
      if (!t) continue;
      const slots = [t.m, t.e, t.b];
      slots.forEach((c) => { counts[c]++; });
      const s = at();
      slots.forEach((c) => { counts[c]--; });
      if (s.total > best.total + EPS) {
        best = s;
        move = { slots, label: `a rig for the ${rows[i].sail.m2}`, kind: 'rig' };
      }
    }

    if (!move) break;
    move.slots.forEach((c) => { counts[c]++; });
    cur = best;
    trace.push({ move: move.kind, label: move.label, total: cur.total, rigs: cur.rigs });
  }

  // Drop what does not pay for itself, then swap within a kind, until nothing
  // improves. Run once after the greedy pass and once more after the gap pass
  // below, to trim whatever that made redundant.
  const polish = () => {
   for (;;) {
    if (late()) break;
    let moved = false;
    for (let i = 0; i < counts.length && !moved; i++) {
      if (counts[i] <= floor[i]) continue;
      counts[i]--;
      const s = at();
      if (s.total > cur.total + EPS) {
        cur = s; moved = true;
        trace.push({ move: 'drop', label: classLabel(classes[i]), total: cur.total, rigs: cur.rigs });
      } else counts[i]++;
    }
    // Drop a whole rig: the mirror of the repair move above. A rig that is not
    // worth its weight cannot be taken off a piece at a time either, because
    // the first piece removed loses the rig while the other two stay on the
    // trailer, so every single drop looks like a loss and the search stops on
    // a trailer it would rather not have packed.
    const plan = cur.plan.slice();
    for (let p = 0; p < plan.length && !moved; p++) {
      const t = plan[p].t;
      const slots = [t.m, t.e, t.b];
      if (slots.some((c) => counts[c] - 1 < floor[c])) continue;
      slots.forEach((c) => { counts[c]--; });
      const s = at();
      if (s.total > cur.total + EPS) {
        cur = s; moved = true;
        trace.push({
          move: 'unrig', total: cur.total, rigs: cur.rigs,
          label: `the ${rows[plan[p].sailIdx].sail.m2} rig, all three pieces`,
        });
      } else slots.forEach((c) => { counts[c]++; });
    }
    // Swaps stay within a kind. How many masts to take is what the add and drop
    // passes decide; a swap is only ever answering "which 430", and trading a
    // mast for a boom is both of those moves at once rather than a third one.
    for (let i = 0; i < counts.length && !moved; i++) {
      if (counts[i] <= floor[i]) continue;
      for (let j = 0; j < counts.length && !moved; j++) {
        if (i === j || classes[i].kind !== classes[j].kind || counts[j] >= cap[j]) continue;
        counts[i]--; counts[j]++;
        const s = at();
        if (s.total > cur.total + EPS) {
          cur = s; moved = true;
          trace.push({
            move: 'swap', total: cur.total, rigs: cur.rigs,
            label: `${classLabel(classes[i])} to ${classLabel(classes[j])}`,
          });
        } else { counts[i]++; counts[j]--; }
      }
    }
    if (!moved) break;
   }
  };
  polish();

  // Gap-closing pass. The score rewards small groups that all rig, but the move
  // that closes one is often a coordinated cross-class swap — a 460 RDM to a 460
  // SDM *and* its extension — that the local search does not make in one step.
  // So for each group the list still cannot stand up, raise the counts to what
  // that group needs and keep the change if the score holds; `polish` then trims
  // whatever went redundant, and often lands back on the same piece count.
  for (const group of unriggableGroups(model, counts, { maxSize: minRigs, limit: 30, budget: 4000 })) {
    if (late()) break;
    let mask = 0;
    for (const i of group) mask |= 1 << i;
    const g = solve(model, cap, { mask, require: mask });
    if (!g.plan.length) continue;
    const need = counts.map(() => 0);
    g.plan.forEach((r) => { need[r.t.m]++; need[r.t.e]++; need[r.t.b]++; });

    const before = counts.slice();
    let raised = false;
    need.forEach((v, c) => { if (v > counts[c]) { counts[c] = v; raised = true; } });
    if (!raised) continue;

    if (at().total >= cur.total - EPS) {
      cur = at();
      trace.push({
        move: 'close-gap', total: cur.total, rigs: cur.rigs,
        label: `${group.map((i) => rows[i].sail.m2).join('+')} rigs`,
      });
      polish();
    } else {
      before.forEach((v, c) => { counts[c] = v; });
    }
  }

  return { ...cur, trace, evaluated: seen.size, timedOut: late() };
}

/**
 * The whole lattice, with a bound. Only for checking the search above on small
 * instances, but that check is the point: the bound is sound because spare kit
 * and match quality can only go up as kit is added, while weight only goes up
 * too. So the best a branch could do is the spare and match of taking everything
 * still on the table, paying only for what it has already committed to.
 */
export function exhaustive(model, opts = {}) {
  const { floor, cap } = model;
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  const n = model.classes.length;
  const counts = floor.slice();
  let best = null;
  let nodes = 0;

  const tailFloor = [];
  for (let i = n - 1; i >= 0; i--) tailFloor[i] = (tailFloor[i + 1] || 0) + floor[i];

  function rec(i, committed) {
    nodes++;
    if (i === n) {
      const s = scoreP(model, counts, opts);
      if (!best || s.total > best.total + EPS) best = s;
      return;
    }
    const ceilCounts = counts.slice();
    for (let j = i; j < n; j++) ceilCounts[j] = cap[j];
    const top = scoreP(model, ceilCounts, opts);
    // Spare, match and session coverage only rise as kit is added and the
    // shortfall only falls, so taking everything still on the table gives the
    // best any completion of this branch could reach on those. Weight is the one
    // term that can only get worse, so it is charged on what the branch has
    // already committed.
    const bound = top.terms.spare + top.terms.match + top.terms.short + top.terms.sessions
      - weights.light * (committed + tailFloor[i]);
    if (best && bound <= best.total + EPS) return;

    for (let v = cap[i]; v >= floor[i]; v--) {
      counts[i] = v;
      rec(i + 1, committed + v);
    }
    counts[i] = floor[i];
  }

  rec(0, 0);
  return { ...best, nodes };
}

/* ================================================= 7. reading the answer */

/** The chosen packing list as actual items, grouped by class. */
export function packingList(model, counts) {
  const out = [];
  model.classes.forEach((c, i) => {
    for (let j = 0; j < counts[i]; j++) out.push(c.items[j]);
  });
  return out;
}

/** Who ended up on what, and what each extension has to be wound out to. */
export function rigSheet(model, result) {
  return result.plan.map((row) => {
    const sail = model.rows[row.sailIdx].sail;
    const mast = model.classes[row.t.m].items[row.units.m];
    const ext = model.classes[row.t.e].items[row.units.e];
    const boom = model.classes[row.t.b].items[row.units.b];
    const ceil = model.ceiling[row.sailIdx];
    return {
      sailIdx: row.sailIdx, sail, mast, ext, boom,
      setting: extSetting(sail, mast),
      quality: ceil > 0 ? Math.min(1, row.gain / ceil) : 1,
    };
  });
}

/**
 * Every distinct way the packed trailer stands the same group of sails up at
 * once. `rigSheet` shows one; which mast lands on which sail is a real question
 * at the trailer, and a trailer with a length to spare usually answers it more
 * than one way.
 *
 * An arrangement is a **mast** per sail: a mast length and, for a cammed sail, a
 * diameter class, drawn from what was packed. That is the whole of the choice.
 * The extension follows from the mast (its setting is just luff minus length),
 * and the boom is independent of both, so among the extensions and booms that
 * fit, one is as riggable as another; each sail is handed the best-rated
 * extension and boom still free once the masts are settled. Two 430 RDM masts
 * are one choice, not two.
 *
 * Ranked by mean kit-match, so `list[0]` is the arrangement the score panel
 * describes, and capped at `opts.limit` (24). `count` is how many there are;
 * `capped` is true only if the walk was cut off (`opts.cap`) first. The group is
 * the one `rigSheet` shows (`result.plan`), not every same-size group the
 * trailer could rig instead.
 */
export function arrangements(model, result, counts, opts = {}) {
  const limit = opts.limit ?? 24;
  const cap = opts.cap ?? 4000;
  const seedMasts = result.plan.map((p) => ({ sailIdx: p.sailIdx, m: p.t.m }));
  if (!seedMasts.length) return { list: [], count: 0, capped: false };

  const kindCounts = (kind) => counts.map((n, i) => (model.classes[i].kind === kind ? n : 0));
  const mastAvail = kindCounts('mast');
  const extAvail = kindCounts('ext');
  const boomAvail = kindCounts('boom');

  // The distinct mast classes each sail could take, most constrained sail first.
  const walk = seedMasts.map((p) => p.sailIdx);
  const mastOpts = walk.map((si) => [...new Set(model.rows[si].triples.map((t) => t.m))]);
  const order = walk.map((_, k) => k).sort((a, b) => mastOpts[a].length - mastOpts[b].length);

  const left = mastAvail.slice();
  const mastCombos = [];
  let count = 0;
  let capped = false;

  (function rec(j, bySail) {
    if (capped) return;
    if (j === order.length) {
      count++;
      mastCombos.push(bySail.slice());
      if (count >= cap) capped = true;
      return;
    }
    const k = order[j];
    for (const mc of mastOpts[k]) {
      if (left[mc] <= 0) continue;
      left[mc]--;
      bySail[k] = mc;
      rec(j + 1, bySail);
      left[mc]++;
    }
  }(0, walk.map(() => -1)));

  // Fit extensions then booms around a settled set of masts: the sail with the
  // fewest classes open to it picks first, taking the best-rated piece still
  // free. Null if the packed kit cannot actually dress every mast (the packing
  // list is built so it can, a hand-forced one might not).
  const fitKind = (mastBySail, avail, fits, part) => {
    const stock = avail.slice();
    const seats = walk.map((si, k) => {
      const sail = model.rows[si].sail;
      const mast = model.classes[mastBySail[k]].rep;
      const open = model.classes
        .map((c, i) => ({ i, c }))
        .filter(({ c, i }) => stock[i] > 0 && fits(sail, mast, c));
      return { si, k, sail, mast, open };
    }).sort((a, b) => a.open.length - b.open.length);

    const out = walk.map(() => -1);
    for (const seat of seats) {
      let best = -1;
      let bestVal = -Infinity;
      for (const { i, c } of seat.open) {
        if (stock[i] <= 0) continue;
        const v = part(seat.sail, seat.mast, c.rep) + itemPart(c.items[0]);
        if (v > bestVal) { bestVal = v; best = i; }
      }
      if (best < 0) return null;
      stock[best]--;
      out[seat.k] = best;
    }
    return out;
  };
  const extFor = (m) => fitKind(m, extAvail,
    (sail, mast, c) => c.kind === 'ext' && extFits(sail, mast, c.rep),
    (sail, mast, rep) => extPart(sail, mast, rep));
  const boomFor = (m) => fitKind(m, boomAvail,
    (sail, _m, c) => c.kind === 'boom' && boomFits(sail, c.rep),
    (sail, _m, rep) => boomPart(sail, rep));

  const sheetOf = (mastBySail, exts, booms) => {
    const take = counts.map(() => 0);
    return walk.map((si, k) => ({ si, k }))
      .sort((a, b) => model.rows[a.si].sail.m2 - model.rows[b.si].sail.m2)
      .map(({ si, k }) => {
        const sail = model.rows[si].sail;
        const mast = model.classes[mastBySail[k]].items[take[mastBySail[k]]++];
        const ext = model.classes[exts[k]].items[take[exts[k]]++];
        const boom = model.classes[booms[k]].items[take[booms[k]]++];
        const ceil = model.ceiling[si];
        const gain = mastPart(sail, mast) + extPart(sail, mast, ext) + boomPart(sail, boom)
          + itemPart(mast) + itemPart(ext) + itemPart(boom);
        return {
          sailIdx: si, sail, mast, ext, boom,
          setting: extSetting(sail, mast),
          quality: ceil > 0 ? Math.min(1, gain / ceil) : 1,
        };
      });
  };

  const sig = (mastBySail) => mastBySail.map((mc, k) => walk[k] + ':' + mc).join('|');
  const seedBySail = walk.map((si, k) => seedMasts.find((p) => p.sailIdx === si).m);

  const seen = new Set();
  const cand = [seedBySail, ...mastCombos];
  const scored = [];
  for (const m of cand) {
    const s = sig(m);
    if (seen.has(s)) continue;
    seen.add(s);
    const exts = extFor(m);
    const booms = boomFor(m);
    if (!exts || !booms) continue;
    const sheet = sheetOf(m, exts, booms);
    scored.push({ sheet, mean: sheet.reduce((a, r) => a + r.quality, 0) / sheet.length });
  }

  // The canonical arrangement keeps the front; the rest run best match first.
  const [first, ...rest] = scored;
  rest.sort((a, b) => b.mean - a.mean);

  return {
    list: [first, ...rest].slice(0, limit).map((s) => s.sheet),
    count: scored.length,
    capped,
  };
}

/**
 * The smallest sets of sails this packing list cannot stand up at once.
 *
 * A club sails a wide spread on any given day — a heavy beginner on a big sail
 * next to a light expert on a small one — so a scattered group is not a mistake.
 * "These two won't rig together" is. This walks sail combinations from pairs
 * upward, skips any superset of a set already known to fail, and returns the
 * minimal failures: the groups where every smaller group inside them is fine.
 *
 * Groups bigger than the trailer rigs at once are left out — they fail for the
 * trivial reason and say nothing. `opts.limit` caps the list (20), `opts.budget`
 * the combinations tried (20000). Each entry is a list of row indices.
 */
export function unriggableGroups(model, counts, opts = {}) {
  const n = model.rows.length;
  const rigs = solve(model, counts).rigs;
  const maxSize = Math.min(opts.maxSize ?? rigs, rigs, n);
  const limit = opts.limit ?? 20;
  const budget = opts.budget ?? 20000;

  const fails = [];
  const isSuper = (m) => fails.some((f) => (f.mask & m) === f.mask);
  let tried = 0;

  for (let size = 2; size <= maxSize && fails.length < limit && tried < budget; size++) {
    const idx = [];
    for (let i = 0; i < size; i++) idx.push(i);
    for (;;) {
      let mask = 0;
      for (const i of idx) mask |= 1 << i;
      tried++;
      if (!isSuper(mask) && !allRiggable(model, counts, mask)) {
        fails.push({ mask, sails: idx.slice() });
        if (fails.length >= limit) break;
      }
      let k = size - 1;
      while (k >= 0 && idx[k] === n - size + k) k -= 1;
      if (k < 0) break;
      idx[k] += 1;
      for (let j = k + 1; j < size; j++) idx[j] = idx[j - 1] + 1;
    }
  }

  return fails.map((f) => f.sails);
}

/**
 * Can this exact set of sails rig at once, and if not, the one piece that would
 * let it. The check behind the session picker.
 *
 * `sailIdxs` are row indices, in any order. Returns `{ riggable, rigs, sheet,
 * missing, need }` — `sheet` is the best `rigSheet` for the set (all of it when
 * `riggable`, as many as fit otherwise), `missing` the row indices left without
 * a rig, `need` the class one more of which rigs the whole set (or null when no
 * single piece does).
 */
export function checkGroup(model, counts, sailIdxs) {
  let mask = 0;
  for (const i of sailIdxs) mask |= 1 << i;
  const res = solve(model, counts, { mask });
  const up = new Set(res.plan.map((p) => p.sailIdx));
  const missing = sailIdxs.filter((i) => !up.has(i));
  const sheet = rigSheet(model, res);
  if (!missing.length) return { riggable: true, rigs: res.rigs, sheet, missing: [], need: null };

  const cand = new Set();
  for (const i of missing) {
    for (const t of model.rows[i].triples) { cand.add(t.m); cand.add(t.e); cand.add(t.b); }
  }
  let need = null;
  for (const c of cand) {
    const probe = counts.slice();
    probe[c] += 1;
    if (solve(model, probe, { mask }).rigs === sailIdxs.length) { need = model.classes[c]; break; }
  }
  return { riggable: false, rigs: res.rigs, sheet, missing, need };
}

/**
 * The sails that did not get a rig, and which slot ran out.
 *
 * "Kit all taken" is not much use at seven in the morning at a trailer. What
 * the kit sec needs is which of the three slots to go and find another of, and
 * whether the club even owns one, so each shortfall is answered by trying one
 * more of each kind and seeing which of them buys the rig back.
 */
const SLOT_OF = { mast: 'm', ext: 'e', boom: 'b' };

export function shortfalls(model, result, counts) {
  const got = new Set(result.plan.map((p) => p.sailIdx));

  return model.rows
    .map((row, i) => ({ row, i }))
    .filter(({ i }) => !got.has(i))
    .map(({ row }) => {
      if (!row.triples.length) {
        return { sail: row.sail, slot: null, inStock: false, why: 'nothing in the club fits it' };
      }
      // A rig is three pieces, so an extra rig always wants a mast *and* an
      // extension *and* a boom. Probing one kind at a time therefore always
      // comes back "no", which is why this adds one of every class the sail
      // could use and then asks which of the three the club is actually out of.
      const usable = {};
      for (const [kind, field] of Object.entries(SLOT_OF)) {
        usable[kind] = [...new Set(row.triples.map((t) => t[field]))];
      }

      const probe = counts.slice();
      Object.values(usable).flat().forEach((c) => { probe[c]++; });
      if (solve(model, probe).rigs <= result.rigs) {
        return { sail: row.sail, slot: null, out: [], why: 'kit all taken by other sails' };
      }

      const stocked = (c) => counts[c] < model.classes[c].items.length;
      const out = Object.keys(usable).filter((kind) => !usable[kind].some(stocked));

      if (!out.length) {
        return {
          sail: row.sail, slot: null, out,
          why: 'left off to save weight: a mast, extension and boom are all still on the rack',
        };
      }
      const owned = out.map((kind) =>
        `${usable[kind].reduce((a, c) => a + model.classes[c].items.length, 0)} ${kind}s`);
      return {
        sail: row.sail, slot: out[0], out,
        why: `the club owns ${owned.join(' and ')} that fit it, all on other sails`,
      };
    });
}
