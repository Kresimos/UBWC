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
 */
function classKeyOf(p) {
  if (p.kind === 'mast') return `mast|${p.len}|${p.diam || '?'}|${p.mfr || '?'}`;
  if (p.kind === 'ext') return `ext|${p.min}-${p.max}|${p.diam || '?'}|${p.mfr || '?'}`;
  if (p.kind === 'boom') return `boom|${p.min}-${p.max}|${p.mfr || '?'}`;
  return null;
}

export function classLabel(c) {
  const p = c.rep;
  const brand = p.mfr || 'unbranded';
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

  for (const p of kit) {
    const key = classKeyOf(p);
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

  return { classes, rows, sails, floor, cap, ceiling };
}

/* ================================================ 4. the inner assignment */

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
 * `budget` caps the nodes explored. At club sizes it is never reached, and the
 * result carries `exact: false` if it ever is.
 */
export function solve(model, counts, mask, budget = 400000) {
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

  // A count past what the club actually owns is a "what if we had one more",
  // which `shortfalls` asks to work out which slot ran out. Such a piece rigs
  // like the rest of its class and is worth nothing on condition or rating,
  // since there is no real item to have an opinion about.
  const partOf = (c, j) => unit[c][j] ?? 0;

  const gainOf = (t) => BIG + t.part
    + partOf(t.m, counts[t.m] - caps[t.m])
    + partOf(t.e, counts[t.e] - caps[t.e])
    + partOf(t.b, counts[t.b] - caps[t.b]);

  function value(k) {
    if (k === idxs.length) return 0;
    const key = `${k}|${caps.join(',')}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    if (++nodes > budget) { overflow = true; return 0; }

    let best = value(k + 1); // leave this sail short: a shortfall line, not a shared mast
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

  // Replay the decisions to recover the assignment itself. Every memo entry is
  // already warm, so this walk is free.
  const plan = [];
  for (let k = 0; k < idxs.length; k++) {
    const target = value(k);
    let took = null;
    for (const t of rows[idxs[k]].triples) {
      if (caps[t.m] <= 0 || caps[t.e] <= 0 || caps[t.b] <= 0) continue;
      const gain = gainOf(t);
      const units = { m: counts[t.m] - caps[t.m], e: counts[t.e] - caps[t.e], b: counts[t.b] - caps[t.b] };
      caps[t.m]--; caps[t.e]--; caps[t.b]--;
      if (Math.abs(gain + value(k + 1) - target) < 1e-6) { took = { t, units, gain: gain - BIG }; break; }
      caps[t.m]++; caps[t.e]++; caps[t.b]++;
    }
    if (took) plan.push({ sailIdx: idxs[k], ...took });
  }

  return { rigs: plan.length, part: total - plan.length * BIG, plan, exact: !overflow };
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

  function rec(k) {
    if (k === idxs.length) return true;
    const key = `${k}|${caps.join(',')}`;
    if (dead.has(key)) return false;
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
  // One full unit of flexibility (every qualifying group of sails riggable)
  // is worth 100. One unit of perfect kit matching is worth 30, so matching
  // never outranks being able to rig at all.
  flex: 100,
  match: 30,
  // Charged per piece on the trailer. At 2.0 a piece has to buy 2% of the
  // flexibility count, or two thirds of a sail's worth of match quality, to
  // earn its place. Raise it for a smaller trailer, drop it for a fuller one.
  light: 2,
};

/**
 * The flexibility term, exactly as specified: how many groups of at least
 * `minRigs` sails can be rigged simultaneously off this trailer, out of all the
 * groups there are.
 *
 * Counting that naively is 2^|S| assignments. It is cheap here because
 * riggability is **downward closed**: if a group can all stand up at once, so
 * can any part of it. So a group is worth testing only when every group one
 * smaller is already known to work, which is the Apriori join below and prunes
 * the search to a small fraction of the lattice.
 */
export function flexibility(model, counts, minRigs) {
  const n = model.rows.length;
  let total = 0;
  for (let k = Math.max(1, minRigs); k <= n; k++) total += choose(n, k);
  if (!total) return { count: 0, total: 0, frac: 0, bySize: [] };

  let level = [];
  for (let i = 0; i < n; i++) if (allRiggable(model, counts, 1 << i)) level.push(1 << i);

  const bySize = [];
  let count = minRigs <= 1 ? level.length : 0;
  bySize[1] = level.length;

  for (let k = 2; k <= n && level.length; k++) {
    const prev = new Set(level);
    const next = [];
    const seen = new Set();
    for (const a of level) {
      for (let i = 0; i < n; i++) {
        if (a & (1 << i)) continue;
        const m = a | (1 << i);
        if (seen.has(m)) continue;
        seen.add(m);
        let ok = true;
        for (let j = 0; j < n && ok; j++) if (m & (1 << j)) ok = prev.has(m ^ (1 << j));
        if (ok && allRiggable(model, counts, m)) next.push(m);
      }
    }
    level = next;
    bySize[k] = next.length;
    if (k >= minRigs) count += next.length;
  }

  return { count, total, frac: count / total, bySize };
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

/**
 * How good a packing list is, as three terms in their own units plus the
 * weighted sum the search actually maximises.
 *
 *   score(P) = w_flex  * (qualifying groups riggable / qualifying groups)
 *            + w_match * (mean kit-match quality over the rigged sails)
 *            - w_light * (pieces on the trailer)
 *
 * The first two are on 0..1 by construction, so the weights read as "how many
 * points is this worth", and the third is a flat charge per piece.
 */
export function scoreP(model, counts, opts = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  const minRigs = opts.minRigs ?? 1;

  const full = solve(model, counts);
  const flex = flexibility(model, counts, minRigs);
  const pieces = counts.reduce((a, b) => a + b, 0);

  let match = 0;
  for (const row of full.plan) {
    const ceil = model.ceiling[row.sailIdx];
    match += ceil > 0 ? Math.min(1, row.gain / ceil) : 1;
  }
  match = full.plan.length ? match / full.plan.length : 0;

  const terms = {
    flex: weights.flex * flex.frac,
    match: weights.match * match,
    light: -weights.light * pieces,
  };
  return {
    counts: counts.slice(),
    rigs: full.rigs, plan: full.plan, exact: full.exact,
    flex, match, pieces, weights, terms,
    total: terms.flex + terms.match + terms.light,
  };
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
  const { floor, cap, rows } = model;
  const counts = floor.slice();
  const spare = floor.slice();

  const order = rows.map((r, i) => i)
    .sort((a, b) => rows[a].triples.length - rows[b].triples.length);

  for (const i of order) {
    const t = rows[i].triples.find((x) =>
      [x.m, x.e, x.b].every((c) => spare[c] > 0 || counts[c] < cap[c]));
    if (!t) continue; // a shortfall the club's rack cannot answer
    for (const c of [t.m, t.e, t.b]) {
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
 *  2. **Greedy.** Add the single piece with the best marginal gain, until
 *     nothing pays for itself. This is where a second 430 gets taken because it
 *     turns a dozen more groups of sails riggable, and where it does not.
 *  3. **Local search.** Greedy commits early and cannot undo, so drop and swap
 *     moves run until nothing improves. A swap is what rescues the case where
 *     one 430 was worth taking only if a 460 was not.
 *
 * `--exact` in the CLI runs `exhaustive` as well, which walks the whole lattice
 * and proves whether these three found the optimum.
 */
export function chooseTrailer(model, opts = {}) {
  const { floor, cap, classes } = model;
  const counts = seedTrailer(model);

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

  for (;;) {
    let bestI = -1;
    let best = cur;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] >= cap[i]) continue;
      counts[i]++;
      const s = at();
      counts[i]--;
      if (s.total > best.total + EPS) { best = s; bestI = i; }
    }
    if (bestI < 0) break;
    counts[bestI]++;
    cur = best;
    trace.push({ move: 'add', label: classLabel(classes[bestI]), total: cur.total, rigs: cur.rigs });
  }

  for (;;) {
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

  return { ...cur, trace, evaluated: seen.size };
}

/**
 * The whole lattice, with a bound. Only for checking the search above on small
 * instances, but that check is the point: the bound is sound because
 * flexibility and match quality can only go up as kit is added, while weight
 * only goes up too. So the best a branch could do is the flexibility and match
 * of taking everything still on the table, paying only for what it has already
 * committed to.
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
    const bound = top.terms.flex + top.terms.match - weights.light * (committed + tailFloor[i]);
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
