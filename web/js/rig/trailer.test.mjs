/**
 * The trailer solver's check:  node web/js/rig/trailer.test.mjs
 *
 * Four things would make a trailer wrong, and they are what is asserted here:
 * a rig that does not stand up, a piece handed out twice, kit somebody asked
 * for left behind, and a search that settles for less than the best list.
 *
 * The last one is the interesting one. It is checked by scoring **every**
 * possible packing list and comparing, which is affordable only because
 * collapsing kit into classes turned the search space from a subset of the
 * inventory into a short vector of small integers.
 */

import assert from 'node:assert/strict';
import { fitsMast, fitsExt, fitsBoom, rigPlan } from './engine.js';
import { buildModel, chooseTrailer, evaluate, scenarios, solveRigs, bruteForce } from './trailer.js';
import { KIT, SAILS } from './fixture.mjs';

let checks = 0;
const ok = (cond, what) => { assert.ok(cond, what); checks += 1; };
const near = (a, b, what) => ok(Math.abs(a - b) < 1e-6, `${what} (${a} vs ${b})`);

const rand = (seed) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

/* 1. Every rig on the list actually stands up, by the rules in engine.js. */
{
  const out = chooseTrailer(KIT, SAILS, { min: 3 });
  out.plan.forEach((row) => {
    const { sail, mastItem, extItem, boomItem } = row;
    ok(mastItem && extItem && boomItem, `${sail.m2} got all three pieces`);
    ok(fitsMast(sail, mastItem), `${sail.m2}: mast reaches the luff`);
    ok(fitsExt(sail, mastItem, extItem), `${sail.m2}: extension fits that mast`);
    ok(fitsBoom(sail, boomItem), `${sail.m2}: boom covers ${sail.boom}`);

    // The measurement rule spelled out, rather than trusted to the predicate.
    const plan = rigPlan(sail, mastItem, extItem);
    const total = mastItem.len + plan.ext;
    ok(total >= sail.luff - 2 && total <= sail.luff + (sail.topExt || 0) + 2,
       `${sail.m2}: ${mastItem.len} + ${plan.ext} totals the luff ${sail.luff}`);
    ok(plan.ext >= (extItem.min || 0) - 1e-9 && plan.ext <= extItem.max + 1e-9,
       `${sail.m2}: +${plan.ext} is inside the extension's travel`);
    if (extItem.diam && mastItem.diam) {
      ok(extItem.diam === mastItem.diam, `${sail.m2}: extension bolts into its mast`);
    }
    if (sail.cams && sail.diam && mastItem.diam) {
      ok(sail.diam === mastItem.diam, `${sail.m2}: a cambered sail got its own diameter`);
    }
  });

  /* 2. Nothing is on the list twice, and the list is the counts it says. */
  const ids = out.picks.map((p) => p.piece.id);
  ok(new Set(ids).size === ids.length, 'no piece is loaded twice');
  near(out.picks.length, out.caps.reduce((a, b) => a + b, 0), 'picks match the counts');
  out.plan.forEach((row) => ['mastItem', 'extItem', 'boomItem'].forEach((k) =>
    ok(ids.includes(row[k].id), 'every rig is built from kit that is on the list')));
}

/* 3. Pinned kit is a floor: it goes on, and no amount of weight talks it off. */
{
  const shortExt = KIT.find((p) => p.kind === 'ext' && p.max === 30);
  const spareBoom = KIT.find((p) => p.kind === 'boom' && p.min === 190);
  const pin = [shortExt.id, spareBoom.id];
  [0.25, 4].forEach((light) => {
    const out = chooseTrailer(KIT, SAILS, { min: 3, pin, weights: { light } });
    pin.forEach((id) => ok(out.picks.some((p) => p.piece.id === id),
                           `pinned #${id} survives a light weight of ${light}`));
  });

  // A pin the trailer cannot stock is said so, not silently dropped.
  const out = chooseTrailer(KIT, SAILS, { min: 3, pin: [SAILS[0].id, 'nope'] });
  ok(out.unusedPins.length === 2, 'pins that are not rig kit come back as unused');
}

/* 4. Counting rigs the fast way and the exact way agree. */
{
  const model = buildModel(KIT, SAILS);
  const caps = model.stock.map((s) => Math.min(s, 3));
  const nextRand = rand(11);
  for (let t = 0; t < 40; t += 1) {
    const set = [...Array(10).keys()].filter(() => nextRand() < 0.6);
    if (!set.length) continue;
    const fast = solveRigs(model, caps, set, { rank: false });
    const full = solveRigs(model, caps, set, { rank: true });
    const raw = solveRigs(model, caps, set, { exhaustive: true, rank: true });
    ok(fast.rigs === full.rigs, `rank-free counting agrees on {${set}}`);
    ok(full.rigs === raw.rigs, `dominance pruning costs no rig on {${set}}`);
    ok(full.matchScore >= fast.matchScore - 1e-9, 'exact ranking is never worse');
  }
}

/* 5. The sampled flexibility tracks the real thing it stands in for. */
{
  const model = buildModel(KIT, SAILS.slice(0, 6));
  const caps = model.stock.map((s) => Math.min(s, 2));
  const exact = evaluate(model, caps, scenarios(6, { min: 3, mode: 'exact' }), {});
  const drawn = evaluate(model, caps, scenarios(6, { min: 3, samples: 60 }), {});
  ok(Math.abs(exact.flex - drawn.flex) < 0.15,
     `sampled flex ${drawn.flex.toFixed(2)} tracks exact ${exact.flex.toFixed(2)}`);
}

/* 6. The search finds the best list there is. Checked against all of them.
 *
 * Twice over, because the search has two settings. With the ranking optimised
 * exactly it should hit the optimum on the nose. With the fast setting, which
 * counts rigs exactly and takes the ranking greedily, it should still land on a
 * list nobody could fault on flexibility, and be within a nudge on ranking.
 */
{
  const nextRand = rand(5);
  let tried = 0;
  let exactHits = 0;
  let fastHits = 0;
  let worst = 0;

  for (let t = 0; t < 14; t += 1) {
    const pool = [...SAILS];
    const sails = [];
    while (sails.length < 3) {
      const pick = pool.splice(Math.floor(nextRand() * pool.length), 1)[0];
      if (pick) sails.push(pick);
    }
    const min = 1 + Math.floor(nextRand() * 3);
    const sets = scenarios(3, { min, mode: 'exact' });
    if (!sets.length) continue;
    tried += 1;
    const name = `${sails.map((s) => s.m2).join('/')} min ${min}`;

    // exact ranking: nothing scores higher, full stop.
    const sharp = chooseTrailer(KIT, sails, { min, sets, rank: true });
    const bestSharp = bruteForce(sharp.model, sets, { floor: sharp.floor, rank: true });
    ok(sharp.searchScore >= bestSharp.score - 1e-9,
       `${name}: exact search ${sharp.searchScore.toFixed(4)} vs best ${bestSharp.score.toFixed(4)}`);
    exactHits += 1;

    // fast ranking: the same flexibility, within a nudge on score.
    const fast = chooseTrailer(KIT, sails, { min, sets });
    const gap = bestSharp.score - fast.evaluation.score;
    worst = Math.max(worst, gap);
    if (gap < 1e-9) fastHits += 1;
    ok(fast.evaluation.flex >= bestSharp.evaluation.flex - 1e-9,
       `${name}: the fast search gives up no flexibility`);
    ok(gap < 0.01, `${name}: fast search is within a nudge (${gap.toFixed(5)})`);
  }
  console.log(`  ${exactHits}/${tried} random trips: exact search hit the optimum`);
  console.log(`  ${fastHits}/${tried} random trips: fast search hit it too `
    + `(worst it gave up: ${worst.toFixed(5)} of ranking)`);
}

console.log(`\n  trailer.js: ${checks} checks passed\n`);
