/**
 * The trailer solver: which kit to load, given the sails going on the trip.
 *
 * `packList` in engine.js answers a simpler question, and answers it greedily:
 * given these sails, hand each one the best mast, extension and boom still
 * free. This file answers the question behind it. Of everything the club owns,
 * *which* kit should go on the trailer at all, so that the most combinations of
 * those sails can stand up at once, on kit that suits them, without loading the
 * van with things nobody will rig?
 *
 * Nothing here restates a rig rule. The three hard rules live in engine.js and
 * are asked for by name (`fitsMast`, `fitsExt`, `fitsBoom`), and the ranking
 * nudges are engine's `pieceScore`. This file is only the search.
 *
 *
 * ## The shape of the problem
 *
 * Three facts do all the work, and every shortcut below comes from one of them.
 *
 * **1. The boom is independent of the mast and extension.** Nothing about a
 * boom constrains which mast a sail ends up on, or the reverse. So a rig is
 * really two separate assignments that happen to be needed by the same sail.
 *
 * **2. Both halves are interval problems, not arbitrary graphs.** A sail is a
 * point `boom` and a boom is an interval `[min, max]`; a mast is a point `len`
 * and a sail accepts any mast landing in the window `[luff - 50, luff + top]`.
 * That is the same primitive twice, and it is why feasible kit for a sail is a
 * short contiguous run rather than a scattering.
 *
 * **3. Kit is interchangeable within classes.** Two masts of the same length
 * and diameter are the same mast as far as the rules are concerned. So the
 * search does not run over the inventory (2^n), it runs over a vector of small
 * integers: how many of each class to load. A club-sized inventory collapses to
 * something like a dozen classes, which is small enough to search properly.
 *
 * Which physical item fills a class unit is decided afterwards, because that
 * choice is about condition, rating and brand match, not about whether the rig
 * stands up.
 *
 *
 * ## What is actually guaranteed
 *
 * The rig **count** is exact: `solveRigs` is a branch and bound, not a greedy,
 * and it proves its answer. The **list** is hill climbed, so it is exact only
 * as far as its moves reach; `node web/js/rig/trailer.test.mjs` checks that
 * against every possible list on random trips, and currently finds the optimum
 * on all of them. The **ranking** is taken greedily inside the search and
 * optimised exactly once the list is settled, so the number reported is never
 * the estimate the search steered by.
 *
 * ponytail: fact 2 is not exploited directly (no Glover sweep here). The search
 * is an exact branch and bound over class counts, which is fast enough at club
 * scale and is much easier to keep honest against engine.js's rules. The
 * interval structure is what makes its branching factor small.
 *
 * ponytail: this packs sails. Boards, fins and bases have no combinatorics
 * worth searching (one fin per board, and the box either matches or it does
 * not), so `packList` still handles those.
 *
 * Try it:  node web/js/rig/trailer.cli.mjs --help
 */

import { fitsBoom, fitsMast, fitsExt, pieceScore } from './engine.js';

/* ------------------------------------------------------------- 1. classes */

/** The roles the trailer solver stocks. Boards and fins are packed elsewhere. */
export const ROLES = ['mast', 'ext', 'boom'];

const num = (v) => (v === null || v === undefined ? '?' : String(v));

/**
 * What makes two pieces the same piece, to the rules. Anything not in the key
 * (brand, condition, who rated it) is a preference, and preferences are settled
 * after the search, when the class units are filled with real items.
 */
const CLASS_KEY = {
  mast: (p) => `${num(p.len)}/${p.diam || 'any'}`,
  ext: (p) => `${p.diam || 'any'} ${num(p.min)}-${num(p.max)}`,
  boom: (p) => `${num(p.min)}-${num(p.max)}`,
};

const CLASS_LABEL = {
  mast: (p) => `${num(p.len)}cm ${p.diam || 'unmarked'}`,
  ext: (p) => `${p.diam || 'unmarked'} ${num(p.min)}-${num(p.max)}cm`,
  boom: (p) => `${num(p.min)}-${num(p.max)}cm`,
};

/** A piece nobody should be loading: it is out of action. */
const usable = (piece) =>
  !(piece.faults || []).some((f) => f.severity === 'out_of_action');

function classesOf(kit, role) {
  const groups = new Map();
  kit.filter((p) => p.kind === role && usable(p)).forEach((piece) => {
    const key = CLASS_KEY[role](piece);
    if (!groups.has(key)) {
      groups.set(key, { role, key, label: CLASS_LABEL[role](piece), rep: piece, items: [] });
    }
    groups.get(key).items.push(piece);
  });
  return [...groups.values()];
}

/* ------------------------------------------------------ 2. the model */

/**
 * Everything the search needs, worked out once: the classes, and for each sail
 * the (mast class, extension class) pairs and boom classes that fit it, each
 * carrying the ranking score it would earn.
 *
 * A class's score is its **best** item's, because the outer search loads best
 * items first. Units past the first are therefore scored a shade optimistically;
 * `assign` corrects that at the end by handing out the real items.
 */
export function buildModel(kit, sails) {
  const cls = [];
  const byRole = {};
  ROLES.forEach((role) => {
    byRole[role] = classesOf(kit, role).map((c) => {
      c.i = cls.length;
      cls.push(c);
      return c;
    });
  });

  const best = (items, key, picks) =>
    items.reduce((top, piece) => Math.max(top, pieceScore(key, piece, picks)), -Infinity);

  const masts = [];   // per sail: [{ m, ms, exts: [{ e, es }], extOk }]
  const booms = [];   // per sail: [{ b, bs }]
  const pairs = [];   // the same mast/extension options, flattened
  const bestRig = []; // per sail: the best rig score it could ever earn

  sails.forEach((sail) => {
    const mine = [];
    byRole.mast.forEach((mc) => {
      if (!fitsMast(sail, mc.rep)) return;
      const ms = best(mc.items, 'mast', { sail });
      const exts = [];
      const extOk = new Uint8Array(cls.length);
      byRole.ext.forEach((ec) => {
        if (!fitsExt(sail, mc.rep, ec.rep)) return;
        extOk[ec.i] = 1;
        exts.push({ e: ec.i, es: best(ec.items, 'ext', { sail, mast: mc.rep }) });
      });
      if (!exts.length) return;
      exts.sort((a, b) => b.es - a.es);
      mine.push({ m: mc.i, ms, exts, extOk, top: ms + exts[0].es });
    });
    const myBooms = byRole.boom
      .filter((bc) => fitsBoom(sail, bc.rep))
      .map((bc) => ({ b: bc.i, bs: best(bc.items, 'boom', { sail }) }));

    // Best first, so the bound below meets a strong answer early and the loops
    // can break rather than run to the end.
    mine.sort((a, b) => b.top - a.top);
    myBooms.sort((a, b) => b.bs - a.bs);

    masts.push(mine);
    booms.push(myBooms);
    pairs.push(mine.flatMap((mm) => mm.exts.map((ee) => ({ m: mm.m, e: ee.e, s: mm.ms + ee.es }))));
    bestRig.push(mine.length && myBooms.length ? mine[0].top + myBooms[0].bs : 0);
  });

  // Flat lookups, so the dominance checks in the inner loop cost an array read
  // rather than building a Set at every node.
  const boomOk = booms.map((list) => {
    const row = new Uint8Array(cls.length);
    list.forEach((b) => { row[b.b] = 1; });
    return row;
  });

  return { cls, byRole, sails, masts, booms, pairs, boomOk, bestRig,
           stock: cls.map((c) => c.items.length) };
}

/**
 * Which classes are never worth branching on. If class A covers a subset of
 * what class B covers, reaching for A first can never cost a rig later, so B is
 * not worth trying while A is on the trailer and free.
 *
 * Booms are where this pays most, because their ranges genuinely nest
 * (140-190 sits inside 140-230). Extensions nest too, by diameter and travel.
 * Masts are left alone: their windows overlap rather than nest, and their
 * ranking scores differ enough that skipping one would cost a real preference.
 *
 * It preserves the rig *count* exactly. It can in principle cost a nudge of
 * ranking score, by skipping a wider boom that happened to be a brand match, so
 * `exhaustive: true` turns it off and the harness's `--full` proves the two
 * agree on the count.
 */
function dominance(model) {
  const out = {};
  const build = (cover) => {
    const dom = new Map();
    cover.forEach((mine, i) => {
      const list = [];
      cover.forEach((other, j) => {
        if (i === j || other.size > mine.size) return;
        if (other.size === mine.size && j > i) return; // identical cover: keep one
        if ([...other].every((x) => mine.has(x))) list.push(j);
      });
      dom.set(i, Int32Array.from(list));
    });
    return dom;
  };

  const boomCover = new Map();
  const extCover = new Map();
  model.cls.forEach((c, i) => {
    if (c.role === 'boom') boomCover.set(i, new Set());
    if (c.role === 'ext') extCover.set(i, new Set());
  });
  model.sails.forEach((_, si) => {
    model.booms[si].forEach((b) => boomCover.get(b.b).add(si));
    model.masts[si].forEach((mm) => mm.exts.forEach((ee) => extCover.get(ee.e).add(`${si}:${mm.m}`)));
  });

  out.boom = build(boomCover);
  out.ext = build(extCover);
  return out;
}

/** Worked out once per model, because every scenario re-asks the same question. */
const dominanceOf = (model) => {
  if (!model.dom) model.dom = dominance(model);
  return model.dom;
};

/* ------------------------------- 3. the inner solve: one set of sails */

const BIG = 1e6; // rigs first, ranking second. No run of rigs scores near this.

/**
 * The most rigs that can stand up at once from these sails on this kit, and the
 * best-ranked way to do it.
 *
 * Branch and bound over class counts, memoised on (how far down the sail list
 * we are, what is left on the trailer). The rig count is exact. The ranking
 * score is exact too unless boom dominance skipped a wider boom that would have
 * scored better, which `exhaustive: true` rules out.
 *
 * Three things keep it quick, and all three come from the same place: rigs are
 * worth `BIG` and ranking is worth single digits, so the search is really
 * counting rigs and only breaks ties on ranking.
 *
 *  - sails go **most constrained first**, so a dead end is met at the top of
 *    the tree rather than the bottom;
 *  - the bound on what the rest of the list can still add is the smaller of the
 *    sails left and the kit left, which collapses the moment any one of the
 *    three roles runs out;
 *  - pairs and booms are tried **best first**, so once a pair cannot beat what
 *    a sibling already found, neither can any pair after it, and the loop
 *    breaks rather than continues.
 *
 * The bound only ever prunes against the best value found at the *same* node,
 * never against a global incumbent, which is what keeps it safe to memoise.
 *
 * `caps` is the packing list: one count per class, indexed as in `model.cls`.
 */
export function solveRigs(model, caps, sailIdx, opts = {}) {
  const budget = opts.nodeBudget || 400000;
  const dom = opts.exhaustive ? null : (opts.dominance || dominanceOf(model));
  // With `rank: false` the search counts rigs and nothing else, which lets it
  // stop the instant it hits the ceiling instead of proving no better-ranked
  // way to hit it exists. Because the options are held best-first, the plan it
  // returns is still the greedily best-ranked one of that size.
  const rank = opts.rank !== false;

  const order = [...sailIdx].sort((a, b) =>
    (model.pairs[a].length * model.booms[a].length)
    - (model.pairs[b].length * model.booms[b].length));
  const n = order.length;

  // What the sails from here down could add if kit were free: the ceiling the
  // capacity bound is then taken against.
  const suffixRigs = new Int32Array(n + 1);
  const suffixScore = new Float64Array(n + 1);
  for (let i = n - 1; i >= 0; i -= 1) {
    const si = order[i];
    const live = model.pairs[si].length > 0 && model.booms[si].length > 0;
    suffixRigs[i] = suffixRigs[i + 1] + (live ? 1 : 0);
    suffixScore[i] = suffixScore[i + 1] + (live ? model.bestRig[si] : 0);
  }

  const work = Int32Array.from(caps);
  const left = { mast: 0, ext: 0, boom: 0 };
  model.cls.forEach((c, i) => { left[c.role] += work[i]; });

  const memo = new Map();
  const key = new Uint16Array(work.length + 1);
  let nodes = 0;
  let overflow = false;

  /** Is a free, feasible class already covering everything this one does? */
  const beaten = (rivals, feasible) => {
    for (let r = 0; r < rivals.length; r += 1) {
      const j = rivals[r];
      if (work[j] > 0 && feasible[j]) return true;
    }
    return false;
  };

  const ceilingFrom = (depth, spent = 0) => {
    const kit = Math.min(left.mast, left.ext, left.boom) - spent;
    return Math.min(suffixRigs[depth], Math.max(0, kit)) * BIG
         + (rank ? suffixScore[depth] : 0);
  };

  function rec(depth) {
    if (depth === n) return ZERO;
    if (nodes++ > budget) { overflow = true; return ZERO; }
    key[0] = depth;
    key.set(work, 1);
    const memoKey = String.fromCharCode.apply(null, key);
    const hit = memo.get(memoKey);
    if (hit) return hit;

    const si = order[depth];
    const ceiling = ceilingFrom(depth);
    let best = { v: rec(depth + 1).v, take: null }; // leave this sail unrigged

    // Nothing below can beat what skipping already gave: stop before branching.
    if (ceiling > best.v) {
      const masts = model.masts[si];
      const booms = model.booms[si];
      // What the sails below could still add once this one has taken its three.
      const rest = ceilingFrom(depth + 1, 1);

      for (let mi = 0; mi < masts.length; mi += 1) {
        const mm = masts[mi];
        if (work[mm.m] === 0) continue;
        // Masts are best-first, so if this one cannot beat `best`, none can.
        if (BIG + (rank ? mm.top : 0) + booms[0].bs * (rank ? 1 : 0) + rest <= best.v) break;

        for (let ei = 0; ei < mm.exts.length; ei += 1) {
          const ee = mm.exts[ei];
          if (work[ee.e] === 0) continue;
          if (dom && beaten(dom.ext.get(ee.e), mm.extOk)) continue;
          if (BIG + (rank ? mm.ms + ee.es + booms[0].bs : 0) + rest <= best.v) break;

          for (let bi = 0; bi < booms.length; bi += 1) {
            const bb = booms[bi];
            if (work[bb.b] === 0) continue;
            if (dom && beaten(dom.boom.get(bb.b), model.boomOk[si])) continue;
            const s = mm.ms + ee.es + bb.bs;
            if (BIG + (rank ? s : 0) + rest <= best.v) break;

            work[mm.m] -= 1; work[ee.e] -= 1; work[bb.b] -= 1;
            left.mast -= 1; left.ext -= 1; left.boom -= 1;
            const sub = rec(depth + 1).v;
            work[mm.m] += 1; work[ee.e] += 1; work[bb.b] += 1;
            left.mast += 1; left.ext += 1; left.boom += 1;

            const v = BIG + (rank ? s : 0) + sub;
            if (v > best.v) best = { v, take: { m: mm.m, e: ee.e, b: bb.b, s } };
            if (best.v >= ceiling) { mi = masts.length; ei = mm.exts.length; break; }
          }
        }
      }
    }
    memo.set(memoKey, best);
    return best;
  }

  const total = rec(0);

  // Walk the decisions back out, replaying the counts the memo was keyed on.
  work.set(caps);
  const plan = [];
  for (let depth = 0; depth < n; depth += 1) {
    key[0] = depth;
    key.set(work, 1);
    const step = memo.get(String.fromCharCode.apply(null, key));
    if (step && step.take) {
      const { m, e, b, s: rigScore } = step.take;
      work[m] -= 1; work[e] -= 1; work[b] -= 1;
      plan.push({ sail: order[depth], m, e, b, s: rigScore });
    }
  }

  return {
    rigs: plan.length,
    matchScore: total.v - plan.length * BIG,
    plan,
    nodes,
    exact: !overflow,
  };
}

const ZERO = { v: 0, take: null };

/* ------------------------------------------ 4. how a packing list is scored */

/**
 * The three things a packing list is judged on, each normalised to roughly
 * [0, 1] so the weights below are directly comparable and mean something on
 * their own rather than only relative to each other.
 *
 *  - **flex**  the share of the scenarios asked about in which *every* sail in
 *              the scenario got a rig. This is the club's question ("could we
 *              all have gone out?") and it is the count of riggable subsets
 *              divided by the number of subsets looked at.
 *  - **reach** the share of sails that got a rig, averaged over the scenarios.
 *  - **match** the mean ranking score of the rigs actually made, as a fraction
 *              of the best that sail could have earned from the whole
 *              inventory. 1.0 means every sail got its first-choice kit.
 *  - **light** pieces loaded, as a fraction of `3 x sails`, which is the most
 *              that could ever be rigged at once. Above 1.0 is dead weight.
 *
 *      score = wFlex * flex + wReach * reach + wMatch * match - wLight * light
 *
 * **`reach` is there to make the search possible, and it is not decoration.**
 * `flex` alone is a cliff: with a minimum of four simultaneous rigs, a trailer
 * that rigs three sails scores exactly the same zero as one that rigs none, so
 * the first three rigs are all pure cost and the search stops on the first one.
 * `match` does not help, because it is a mean per rig and so does not grow when
 * a rig is added. `reach` is the same quantity as `flex` without the threshold,
 * it climbs with every rig added, and it is what turns the plateau into a
 * slope. Set `reach: 0` to score exactly the strict stated objective; the
 * search will then stall, which `--weights` in the harness will show you.
 *
 * Both are reported either way, so the strict count is always visible whatever
 * the search was steered by.
 */
export const DEFAULT_WEIGHTS = { flex: 1, reach: 0.6, match: 0.35, light: 0.25 };

/** Deterministic RNG, so two runs of the harness compare like with like. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The sail subsets a packing list is judged against.
 *
 * `mode: 'exact'` is the objective exactly as stated: every subset of at least
 * `min` sails. It is 2^sails work and is meant for judging a finished list, not
 * for the inside of a search.
 *
 * `mode: 'sample'` draws subsets uniformly, sizes first then members, and is
 * what the search runs on. The full set is always included, because "can
 * everyone rig at once" is the one scenario somebody will definitely ask about.
 *
 * A real trip has a better source than either: `trip_votes` already records who
 * asked for what, so the scenarios that matter are the ones the club actually
 * generates. Pass those in as `mode: 'given'` when the wizard wires this up.
 */
export function scenarios(count, { min = 1, mode = 'sample', samples = 60, seed = 7, given } = {}) {
  const all = [...Array(count).keys()];
  if (mode === 'given') return given;
  if (mode === 'exact') {
    const out = [];
    for (let mask = 1; mask < (1 << count); mask += 1) {
      const set = all.filter((i) => mask & (1 << i));
      if (set.length >= min) out.push(set);
    }
    return out;
  }
  const rand = rng(seed);
  const out = [all];
  const seen = new Set([all.join(',')]);
  for (let i = 0; i < samples * 4 && out.length < samples; i += 1) {
    const size = min + Math.floor(rand() * (count - min + 1));
    const pool = [...all];
    for (let j = pool.length - 1; j > 0; j -= 1) {
      const k = Math.floor(rand() * (j + 1));
      [pool[j], pool[k]] = [pool[k], pool[j]];
    }
    const set = pool.slice(0, size).sort((a, b) => a - b);
    const key = set.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(set);
  }
  return out;
}

/**
 * One rig's ranking score as a fraction of the best that sail could ever have
 * got, from the whole inventory. Per sail, not per fleet: a trailer that rigs
 * only the easy sails should not score 100% for it.
 */
const share = (got, best) => (best > 0 ? Math.max(0, Math.min(1, got / best)) : 1);

export function evaluate(model, caps, sets, opts = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  let full = 0;
  let covered = 0;
  let rigs = 0;
  let score = 0;
  let exact = true;
  sets.forEach((set) => {
    const r = solveRigs(model, caps, set, opts);
    if (!r.exact) exact = false;
    if (r.rigs === set.length) full += 1;
    covered += set.length ? r.rigs / set.length : 0;
    rigs += r.rigs;
    r.plan.forEach((step) => { score += share(step.s, model.bestRig[step.sail]); });
  });

  const pieces = caps.reduce((a, b) => a + b, 0);
  const flex = sets.length ? full / sets.length : 0;
  const reach = sets.length ? covered / sets.length : 0;
  const match = rigs ? score / rigs : 0;
  const light = pieces / (3 * (model.sails.length || 1));

  return {
    flex, reach, match, light, pieces, exact,
    fullSets: full, sets: sets.length, rigsMade: rigs,
    score: weights.flex * flex + weights.reach * reach
         + weights.match * match - weights.light * light,
  };
}

/* -------------------------------------- 5. how a packing list is decided */

/**
 * Every rig the club could build, as a triple of classes, best-ranked first.
 *
 * These are what the search's moves are made of, because a lone mast rigs
 * nothing: the smallest thing that changes the score at all is a whole rig, so
 * a search that only ever adds one piece at a time never gets off the ground.
 */
function bundles(model) {
  const seen = new Set();
  const out = [];
  model.sails.forEach((_, si) => {
    model.pairs[si].forEach((p) => model.booms[si].forEach((b) => {
      const key = `${p.m},${p.e},${b.b}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ m: p.m, e: p.e, b: b.b, s: p.s + b.s });
    }));
  });
  return out.sort((a, b) => b.s - a.s);
}

/**
 * The moves the search may make.
 *
 * An addition is any part of a rig: the whole three, or the two that finish a
 * rig when the third is already loaded, or the one that finishes it when two
 * are. That set is what makes the search work, and it is the thing plain greedy
 * gets wrong here. A packing list holding two masts, two extensions and two
 * booms rigs two sails; the third sail needs an extension **and** a boom, and
 * neither of them alone changes the score by a thing, so a one-piece-at-a-time
 * greedy stops one rig short and calls it done.
 *
 * Removals and same-role swaps come with it, so the search can undo an early
 * commitment rather than only ever adding to it.
 */
function moveSet(model) {
  const seen = new Set();
  const adds = [];
  bundles(model).forEach(({ m, e, b }) => {
    const parts = [m, e, b];
    for (let mask = 1; mask < 8; mask += 1) {
      const add = parts.filter((_, i) => mask & (1 << i)).sort((x, y) => x - y);
      const key = add.join('.');
      if (seen.has(key)) continue;
      seen.add(key);
      adds.push(add);
    }
  });
  return adds;
}

/**
 * The packing list: best-improvement hill climbing over those moves, from a
 * trailer holding nothing but whatever was pinned.
 *
 * At every step it costs each legal move and takes the one that buys the most
 * score, stopping when the best move left is not worth its own weight. The
 * flexibility term is a matching size in expectation, so it is monotone and
 * submodular in the kit loaded and the objective is that minus a linear weight
 * cost, which is the shape greedy on marginal gain is the right move for. The
 * removals and swaps are what recover the cases it would otherwise be stuck in.
 *
 * `pin` is a floor, never a ceiling: kit somebody asked for goes on before the
 * search starts, is never removed by it, and the rest is built around it.
 */
export function chooseTrailer(kit, sails, opts = {}) {
  const model = buildModel(kit, sails);
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  const dominance = opts.exhaustive ? null : dominanceOf(model);
  const eps = opts.epsilon ?? 1e-9;

  // The search counts rigs exactly and takes the ranking greedily, which is
  // some two hundred times quicker per look and costs almost nothing: the
  // options are held best-first, so the plan it settles on is already the
  // well-ranked one. The list it lands on is then scored properly below, with
  // the ranking optimised exactly, so what gets reported is never the estimate.
  const solveOpts = { ...opts, dominance, weights, rank: opts.rank ?? false };
  const exactOpts = { ...solveOpts, rank: true };

  const sets = opts.sets || scenarios(sails.length, {
    min: opts.min || 1,
    mode: opts.mode || 'sample',
    samples: opts.samples || 60,
    seed: opts.seed || 7,
  });

  // The floor: every pinned item, filed under its class.
  const classOf = new Map();
  model.cls.forEach((c) => c.items.forEach((p) => classOf.set(p.id, c.i)));
  const floor = new Int32Array(model.cls.length);
  const pinnedItems = [];
  const unusedPins = [];
  (opts.pin || []).forEach((id) => {
    const piece = kit.find((p) => String(p.id) === String(id));
    if (!piece) { unusedPins.push({ id, why: 'not in the inventory' }); return; }
    const ci = classOf.get(piece.id);
    if (ci === undefined) {
      unusedPins.push({ id, why: usable(piece)
        ? `a ${piece.kind}, which the trailer solver does not stock`
        : 'out of action' });
      return;
    }
    floor[ci] += 1;
    pinnedItems.push({ piece, ci });
  });

  const caps = Int32Array.from(floor);
  const cache = new Map();
  const look = () => {
    const key = caps.join(',');
    if (!cache.has(key)) cache.set(key, evaluate(model, caps, sets, solveOpts));
    return cache.get(key);
  };

  const limit = opts.maxPieces || 3 * sails.length;
  const label = (i) => `${model.cls[i].role} ${model.cls[i].label}`;

  const adds = moveSet(model);
  const roles = model.cls.map((c) => c.role);
  const everyone = [...Array(sails.length).keys()];

  /**
   * Moving one sail onto different kit, mast and extension together.
   *
   * Neither half of that is a move on its own: a 430 RDM mast is no use unless
   * an RDM extension comes with it, and swapping the extension first strands
   * the sail that had it. So a search that only ever changes one class at a
   * time sits on a list that rigs everybody and cannot see the one beside it
   * that rigs everybody on better-matched kit. Reading the moves off the
   * current plan keeps this to a handful of candidates rather than every pair
   * of swaps there is.
   */
  const repairs = () => {
    const out = [];
    solveRigs(model, caps, everyone, solveOpts).plan.forEach((row) => {
      const options = [];
      model.masts[row.sail].forEach((mm) => mm.exts.forEach((ee) =>
        model.booms[row.sail].forEach((bb) => options.push([mm.m, ee.e, bb.b]))));
      options.forEach(([m, e, b]) => {
        if (m === row.m && e === row.e && b === row.b) return;
        const add = [m, e, b];
        const drop = [row.m, row.e, row.b];
        const net = (a, b) => a.filter((x) => {
          const at = b.indexOf(x);
          if (at === -1) return true;
          b.splice(at, 1);
          return false;
        });
        const keptDrop = [...drop];
        const keptAdd = net(add, keptDrop);
        if (keptAdd.length) out.push({ add: keptAdd, drop: keptDrop });
      });
    });
    return out;
  };
  let current = look();
  const trace = [{ move: pinnedItems.length ? `pinned (${pinnedItems.length})` : 'empty trailer',
                   caps: [...caps], ...current }];

  const legal = (add, drop) => {
    const after = Int32Array.from(caps);
    drop.forEach((i) => { after[i] -= 1; });
    add.forEach((i) => { after[i] += 1; });
    let pieces = 0;
    for (let i = 0; i < after.length; i += 1) {
      if (after[i] < floor[i] || after[i] > model.stock[i]) return false;
      pieces += after[i];
    }
    return pieces <= limit;
  };
  const apply = (add, drop, sign) => {
    add.forEach((i) => { caps[i] += sign; });
    drop.forEach((i) => { caps[i] -= sign; });
  };

  for (let step = 0; step < (opts.steps || 60); step += 1) {
    const candidates = [];
    adds.forEach((add) => candidates.push({ add, drop: [] }));
    repairs().forEach((move) => candidates.push(move));
    model.cls.forEach((c, i) => {
      if (caps[i] <= floor[i]) return;
      candidates.push({ add: [], drop: [i] });
      model.cls.forEach((d, j) => {
        if (i === j || roles[i] !== roles[j]) return;
        // Several at a time, not just one. Booms of nested ranges come in sets:
        // going from two 150-200s to two 160-210s can be worth it when going to
        // one of each is not, and a search that only ever swaps a single piece
        // sits between the two unable to see it.
        const most = Math.min(caps[i] - floor[i], model.stock[j] - caps[j], 3);
        for (let k = 1; k <= most; k += 1) {
          candidates.push({ add: Array(k).fill(j), drop: Array(k).fill(i) });
        }
      });
    });

    let best = null;
    for (const move of candidates) {
      if (!legal(move.add, move.drop)) continue;
      apply(move.add, move.drop, 1);
      const next = look();
      apply(move.add, move.drop, -1);
      const gain = next.score - current.score;
      if (!best || gain > best.gain) best = { ...move, gain, next };
    }
    if (!best || best.gain <= eps) break;

    apply(best.add, best.drop, 1);
    current = best.next;
    const words = [
      ...best.drop.map((i) => `- ${label(i)}`),
      ...best.add.map((i) => `+ ${label(i)}`),
    ];
    trace.push({ move: words.join('   '), caps: [...caps], ...current });
  }

  const evaluation = evaluate(model, caps, sets, exactOpts);
  return { model, caps: [...caps], floor: [...floor], sets, weights,
           evaluation, searchScore: current.score, trace,
           pinnedItems, unusedPins, evaluated: cache.size,
           ...assign(model, caps, sails, pinnedItems, exactOpts) };
}

/* ---------------------------------- filling the class units with real kit */

/**
 * The last step, and the only one that cares which physical mast it is: hand
 * each class unit an actual item. Pinned kit takes its own unit first, then the
 * rest go to whichever items suit the sails present best, which is where brand
 * match and condition finally get a say.
 */
export function assign(model, caps, sails, pinnedItems, opts) {
  const picks = [];
  const pool = new Map(); // class index -> the items of it that are on the trailer
  const pinnedIds = new Set(pinnedItems.map((p) => p.piece.id));

  model.cls.forEach((c, i) => {
    const want = caps[i];
    if (!want) return;
    const mine = pinnedItems.filter((p) => p.ci === i).map((p) => p.piece);
    const rest = c.items
      .filter((p) => !pinnedIds.has(p.id))
      .sort((a, b) => affinity(model, c, sails, b) - affinity(model, c, sails, a));
    const taken = [...mine, ...rest].slice(0, want);
    pool.set(i, [...taken]);
    taken.forEach((piece) => picks.push({ piece, cls: c }));
  });

  const all = [...Array(sails.length).keys()];
  const result = solveRigs(model, caps, all, opts);
  const rigged = new Set(result.plan.map((p) => p.sail));

  // Which physical piece goes to which sail. The class already settled that the
  // rig stands up, so this is only ever about preference: best pairing first,
  // which is where brand match and condition finally get a say.
  const plan = result.plan.map((p) => ({
    sail: sails[p.sail], si: p.sail,
    mast: model.cls[p.m], ext: model.cls[p.e], boom: model.cls[p.b],
    at: { mast: p.m, ext: p.e, boom: p.b },
  }));
  ['mast', 'ext', 'boom'].forEach((role) => {
    const rows = plan.filter((row) => pool.has(row.at[role]));
    const pairs = [];
    rows.forEach((row) => (pool.get(row.at[role]) || []).forEach((piece) => {
      pairs.push({ row, piece, s: fit(role, piece, row) });
    }));
    pairs.sort((a, b) => b.s - a.s);
    const doneRow = new Set();
    const donePiece = new Set();
    pairs.forEach(({ row, piece }) => {
      if (doneRow.has(row) || donePiece.has(piece.id)) return;
      doneRow.add(row); donePiece.add(piece.id);
      row[`${role}Item`] = piece;
    });
  });

  return {
    picks,
    rigs: result.rigs,
    plan,
    short: sails.map((sail, i) => ({ sail, i })).filter(({ i }) => !rigged.has(i))
      .map(({ sail, i }) => ({
        sail,
        why: !model.masts[i].length ? 'no mast in the club reaches its luff'
          : !model.booms[i].length ? 'no boom in the club covers its boom length'
          : 'the kit it needs went to another sail',
      })),
  };
}

/** How well one piece suits one rig, for handing the class units out. */
const fit = (role, piece, row) => (role === 'ext'
  ? pieceScore('ext', piece, { sail: row.sail, mast: row.mast.rep })
  : pieceScore(role, piece, { sail: row.sail }));

/** How well one piece suits the sails present, for deciding which to load. */
function affinity(model, c, sails, piece) {
  const scores = sails.map((sail) => {
    if (c.role === 'mast') return fitsMast(sail, piece) ? pieceScore('mast', piece, { sail }) : null;
    if (c.role === 'boom') return fitsBoom(sail, piece) ? pieceScore('boom', piece, { sail }) : null;
    return pieceScore('ext', piece, { sail, mast: c.rep });
  }).filter((x) => x !== null);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : -Infinity;
}

/* ------------------------------------------------- checking the search */

/**
 * Every packing list there is, scored, up to a cap on the total pieces. The
 * only honest way to know whether the greedy found the best list is to look at
 * all of them, which is affordable exactly because the class collapse made the
 * space a small integer lattice rather than a subset of the inventory.
 */
export function bruteForce(model, sets, opts = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  const floor = opts.floor || new Array(model.cls.length).fill(0);
  const cap = Math.min(opts.maxPieces || 3 * model.sails.length, 3 * model.sails.length);
  const serves = model.cls.map((c, i) => model.sails.some((_, si) =>
    (c.role === 'boom' ? model.booms[si].some((b) => b.b === i)
      : model.pairs[si].some((p) => (c.role === 'mast' ? p.m : p.e) === i))));
  const limits = model.cls.map((c, i) =>
    (serves[i] ? Math.min(model.stock[i], model.sails.length) : floor[i]));
  const caps = Int32Array.from(floor);
  let best = null;
  let seen = 0;

  const walk = (i, used) => {
    if (i === model.cls.length) {
      seen += 1;
      const e = evaluate(model, caps, sets, { ...opts, weights, rank: opts.rank ?? false });
      if (!best || e.score > best.score) best = { score: e.score, caps: [...caps], evaluation: e };
      return;
    }
    for (let k = floor[i]; k <= limits[i] && used + k <= cap; k += 1) {
      caps[i] = k;
      walk(i + 1, used + k);
    }
    caps[i] = floor[i];
  };
  walk(0, floor.reduce((a, b) => a + b, 0));
  return { ...best, seen };
}
