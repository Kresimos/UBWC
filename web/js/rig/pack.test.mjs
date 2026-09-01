/**
 * The trailer solver's check:  node web/js/rig/pack.test.mjs
 *
 * Three kinds of assertion, in rising order of how much they are worth:
 *
 *  1. the hard rig rules, on hand-built cases where the right answer is obvious;
 *  2. the promises the trip makes (nothing shared, pins honoured, shortfalls named);
 *  3. **differential tests against brute force** on hundreds of random racks.
 *     The solver is a dynamic program and the outer search is a heuristic, so
 *     the only real evidence either is right is that an exhaustive enumeration
 *     of the same instance agrees. That is what section 3 does, and it is the
 *     reason to trust anything above.
 */
import assert from 'node:assert/strict';
import {
  buildModel, solve, allRiggable, chooseTrailer, exhaustive, scoreP,
  packingList, rigSheet, arrangements, spanReport, checkGroup, reachGroup,
  shortfalls, itemPart, reachVector,
  mastFits, extFits, boomFits, extSetting,
} from './pack.mjs';
import { SAILS, KIT } from './pack.fixtures.mjs';

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.equal(a, b, msg); };

const sail = (id, luff, boom, extra = {}) =>
  ({ id, kind: 'sail', mfr: 'Test', model: id, luff, boom, topExt: 0, cams: 0, diam: null, ...extra });
const mast = (id, len, diam = null, mfr = 'Test') =>
  ({ id, kind: 'mast', mfr, model: id, len, diam, cond: 'good', rate: { avg: 3 }, faults: [] });
const ext = (id, min, max, diam = null, mfr = 'Test') =>
  ({ id, kind: 'ext', mfr, model: id, min, max, diam, cond: 'good', rate: { avg: 3 }, faults: [] });
const boom = (id, min, max, mfr = 'Test') =>
  ({ id, kind: 'boom', mfr, model: id, min, max, cond: 'good', rate: { avg: 3 }, faults: [] });

const full = (model) => model.cap.slice();

/* ================================================== 1. the hard rig rules */

// A mast and extension must total the luff, and an extension has 50cm of travel.
{
  const s = sail('s', 490, 200);
  ok(mastFits(s, mast('m', 460)), '460 reaches a 490 luff on a +30 extension');
  ok(mastFits(s, mast('m', 440)), '440 reaches it at +50, the very limit');
  ok(!mastFits(s, mast('m', 439)), '439 is out of reach of any extension');
  ok(!mastFits(s, mast('m', 500)), 'a 500 mast will not go into a fixed 490 luff');
  eq(extSetting(s, mast('m', 460)), 30, 'head shut, extension makes up the rest');
}

// An adjustable top lets a longer mast poke out, and only that far.
{
  const s = sail('s', 490, 200, { topExt: 20 });
  ok(mastFits(s, mast('m', 500)), '500 fits with the head opened 10');
  ok(mastFits(s, mast('m', 510)), '510 fits with the head fully open');
  ok(!mastFits(s, mast('m', 511)), 'past the head is past the head');
  eq(extSetting(s, mast('m', 500)), 0, 'a mast over the luff needs no extension at all');
}

// Cams are moulded to one diameter. A camless sleeve takes either.
{
  const cammed = sail('c', 460, 190, { cams: 1, diam: 'SDM' });
  ok(mastFits(cammed, mast('m', 460, 'SDM')), 'cammed SDM sail on an SDM mast');
  ok(!mastFits(cammed, mast('m', 460, 'RDM')), 'cammed SDM sail must not take RDM');
  const camless = sail('p', 460, 190, { diam: 'SDM' });
  ok(mastFits(camless, mast('m', 460, 'RDM')), 'a camless sleeve takes either diameter');
}

// A missing measurement is somebody not writing it down, never a "no".
{
  const s = sail('s', null, null);
  ok(mastFits(s, mast('m', 460)), 'unknown luff does not block a mast');
  ok(boomFits(s, boom('b', 140, 190)), 'unknown boom length does not block a boom');
  ok(mastFits(sail('t', 460, 190), mast('m', null)), 'unknown mast length does not block');
}

// The extension bolts into the mast, so those two must agree whatever the sail is.
{
  const s = sail('s', 460, 190);
  ok(!extFits(s, mast('m', 430, 'RDM'), ext('e', 0, 50, 'SDM')), 'RDM mast will not take an SDM extension');
  ok(extFits(s, mast('m', 430, 'RDM'), ext('e', 0, 50, 'RDM')), 'RDM to RDM is fine');
  ok(!extFits(s, mast('m', 430, 'RDM'), ext('e', 0, 20, 'RDM')), '430 under a 460 luff needs 30, not 20');
  ok(extFits(s, mast('m', 430, 'RDM'), ext('e', 0, 30, 'RDM')), '30 of travel is exactly enough');
}

// A boom's range has to cover the sail's boom length.
{
  const s = sail('s', 460, 190);
  ok(boomFits(s, boom('b', 140, 190)), '190 is its maximum, which still covers it');
  ok(!boomFits(s, boom('b', 140, 189)), 'one centimetre short is short');
  ok(!boomFits(s, boom('b', 191, 240)), 'a boom that will not wind in far enough');
}

/* ========================================= 2. what the trip promises */

// Nothing on a trailer is shared: every rig stands up at the same time.
{
  const sails = [sail('a', 430, 180), sail('b', 460, 190)];
  const kit = [mast('m1', 430), mast('m2', 460), ext('e1', 0, 50), ext('e2', 0, 50),
               boom('b1', 140, 200), boom('b2', 140, 200)];
  const model = buildModel(sails, kit);
  const r = solve(model, full(model));
  eq(r.rigs, 2, 'both sails rig');
  const sheet = rigSheet(model, r);
  const ids = sheet.flatMap((x) => [x.mast.id, x.ext.id, x.boom.id]);
  eq(new Set(ids).size, ids.length, 'no piece is handed out twice');
}

// Running out is an answer, not a shared mast.
{
  const sails = [sail('a', 430, 180), sail('b', 430, 180)];
  const kit = [mast('m1', 430), ext('e1', 0, 50), ext('e2', 0, 50),
               boom('b1', 140, 200), boom('b2', 140, 200)];
  const model = buildModel(sails, kit);
  const r = solve(model, full(model));
  eq(r.rigs, 1, 'one mast rigs one sail');
  eq(shortfalls(model, r, full(model)).length, 1, 'the other is reported short');
}

// A sail nothing in the club fits says so, rather than dragging the rest down.
{
  const sails = [sail('fits', 430, 180), sail('nope', 620, 300)];
  const kit = [mast('m1', 430), ext('e1', 0, 50), boom('b1', 140, 200)];
  const model = buildModel(sails, kit);
  const r = solve(model, full(model));
  eq(r.rigs, 1, 'the one that fits still rigs');
  eq(shortfalls(model, r, full(model))[0].why, 'nothing in the club fits it',
     'and the other is named for what it is');
}

// The most-constrained sail gets the piece only it can use.
{
  // Both sails take a 430. Only the 460-luff sail can also take the 460.
  const sails = [sail('picky', 430, 180), sail('easy', 460, 190)];
  const kit = [mast('m430', 430), mast('m460', 460), ext('e1', 0, 50), ext('e2', 0, 50),
               boom('b1', 140, 200), boom('b2', 140, 200)];
  const model = buildModel(sails, kit);
  eq(solve(model, full(model)).rigs, 2, 'a greedy that gave the 430 away would strand one');
}

// Pinned kit is on the trailer, is used, and drags the rest of the list to it.
{
  const sails = [sail('a', 430, 180), sail('b', 460, 190)];
  const kit = [mast('m430', 430), mast('m460', 460),
               ext('good', 0, 50, null, 'Nice'), ext('short', 0, 30, null, 'Odd'),
               ext('e3', 0, 50), boom('b1', 140, 200), boom('b2', 140, 200)];
  const model = buildModel(sails, kit, ['short']);
  const best = chooseTrailer(model, { minRigs: 1 });
  const ids = packingList(model, best.counts).map((p) => p.id);
  ok(ids.includes('short'), 'a pinned extension is on the list whatever it scores');
  eq(best.rigs, 2, 'and rigs are built around it, not beside it');
  const usedExts = rigSheet(model, best).map((r) => r.ext.id);
  ok(usedExts.includes('short'), 'the pinned extension is actually used');
}

// Pinning something useless still packs it, and still packs everything else.
{
  const sails = [sail('a', 430, 180)];
  const kit = [mast('m430', 430), mast('junk', 600), ext('e1', 0, 50), boom('b1', 140, 200)];
  const model = buildModel(sails, kit, ['junk']);
  const best = chooseTrailer(model, { minRigs: 1 });
  ok(packingList(model, best.counts).map((p) => p.id).includes('junk'), 'the pin is honoured');
  eq(best.rigs, 1, 'and it does not cost the sail its rig');
}

// The extension a sail can reach depends on which mast it got, which is the
// coupling the whole solver exists for.
{
  // One 430 and one 460 mast; one full extension and one that only reaches 30.
  // The 490 sail needs +30 on the 460 and +60 on the 430, so it must have the
  // 460, and then the 460-luff sail must take the 430 on +30, needing the
  // short extension to go to the 490. Only one assignment works.
  const sails = [sail('big', 490, 200), sail('mid', 460, 190)];
  const kit = [mast('m430', 430), mast('m460', 460),
               ext('full', 0, 50), ext('short', 0, 30),
               boom('b1', 140, 210), boom('b2', 140, 210)];
  const model = buildModel(sails, kit);
  eq(solve(model, full(model)).rigs, 2, 'both rig, but only one way round');
}

// A shortfall says which slot ran out, and whether the club even owns another.
// An extra rig needs a mast *and* an extension *and* a boom, so a diagnosis
// that probes one slot at a time can only ever come back "no".
{
  // The fixture rack owns seven extensions, so the eighth sail cannot rig
  // however the rest is arranged. Asking for a group of all eight forces the
  // search to pack every rig it can and still come up one short.
  const model = buildModel(SAILS, KIT);
  const best = chooseTrailer(model, { minRigs: 7 });
  eq(best.rigs, 7, 'seven extensions rig seven sails');
  const short = shortfalls(model, best, best.counts);
  eq(short.length, 1, 'exactly one sail is left off');
  eq(short[0].slot, 'ext', 'and the extensions are what ran out');
  ok(/all on other sails/.test(short[0].why), `got: ${short[0].why}`);
}

// Kit left on the rack by choice is a different answer from kit the club has
// run out of, because one of them the kit sec can overrule.
{
  const sails = [sail('a', 430, 180), sail('b', 430, 180)];
  const kit = [mast('m1', 430), mast('m2', 430), ext('e1', 0, 50), ext('e2', 0, 50),
               boom('b1', 140, 200), boom('b2', 140, 200)];
  const model = buildModel(sails, kit);
  // A charge per piece high enough that a second rig cannot pay for itself.
  const best = chooseTrailer(model, { minRigs: 1, weights: { light: 20 } });
  eq(best.rigs, 1, 'the second rig is not worth its weight');
  ok(/save weight/.test(shortfalls(model, best, best.counts)[0].why),
     'and it says so, rather than claiming the club is out');
}

// Every arrangement is a legal, non-sharing way to stand the same group up, and
// the first one is the best-matching.
{
  const sails = [sail('a', 430, 180), sail('b', 460, 190)];
  // Two 430s and a 460: the 460-luff sail can take either length, so its group
  // of two stands up more than one way.
  const kit = [mast('m1', 430), mast('m2', 430), mast('m3', 460),
               ext('e1', 0, 50), ext('e2', 0, 50), ext('e3', 0, 50),
               boom('b1', 140, 210), boom('b2', 140, 210), boom('b3', 140, 210)];
  const model = buildModel(sails, kit);
  const counts = full(model);
  const r = solve(model, counts);
  eq(r.rigs, 2, 'both sails rig');

  const ways = arrangements(model, r, counts);
  ok(ways.count >= 2, `the 460 sail can take a 430 or the 460, so >= 2 arrangements (got ${ways.count})`);
  ok(!ways.capped, 'a rack this small is not capped');

  ways.list.forEach((sheet, n) => {
    eq(sheet.length, r.rigs, `arrangement ${n}: covers the whole group`);
    const ids = sheet.flatMap((x) => [x.mast.id, x.ext.id, x.boom.id]);
    eq(new Set(ids).size, ids.length, `arrangement ${n}: no piece handed out twice`);
    sheet.forEach((x) => {
      ok(mastFits(x.sail, x.mast), `arrangement ${n}: legal mast`);
      ok(extFits(x.sail, x.mast, x.ext), `arrangement ${n}: legal extension`);
      ok(boomFits(x.sail, x.boom), `arrangement ${n}: legal boom`);
    });
  });

  const key = (sheet) => sheet
    .map((x) => `${x.sailIdx}:${x.mast.id}-${x.ext.id}-${x.boom.id}`)
    .sort().join('|');
  eq(new Set(ways.list.map(key)).size, ways.list.length, 'the arrangements shown are distinct');

  // The first arrangement is the one rigSheet shows, class for class.
  const cls = (x) => `${x.sailIdx}:${x.mast.len}${x.mast.diam}/${x.ext.min}-${x.ext.max}/${x.boom.min}-${x.boom.max}`;
  const canon = rigSheet(model, r).map(cls).sort().join('|');
  eq(ways.list[0].map(cls).sort().join('|'), canon, 'arrangement 1 is the canonical rig sheet');

  // The rest run best mean kit-match first.
  const means = ways.list.slice(1).map((sheet) =>
    sheet.reduce((a, x) => a + x.quality, 0) / sheet.length);
  for (let i = 1; i < means.length; i++) {
    ok(means[i] <= means[i - 1] + 1e-9, 'arrangements after the first are ordered best kit-match first');
  }
}

// One rigid group has exactly one arrangement.
{
  // The 490 must have the 460 (the 430 cannot reach even at +50), which leaves
  // the 460-luff sail on the 430; one extension class and one boom class, so
  // nothing else is open to choose.
  const sails = [sail('a', 490, 200), sail('b', 460, 190)];
  const kit = [mast('m430', 430), mast('m460', 460),
               ext('e1', 0, 50), ext('e2', 0, 50),
               boom('b1', 140, 210), boom('b2', 140, 210)];
  const model = buildModel(sails, kit);
  const counts = full(model);
  const r = solve(model, counts);
  eq(r.rigs, 2, 'both rig, but only one way round');
  eq(arrangements(model, r, counts).count, 1, 'so there is a single arrangement');
}

// spanReport only ever asks about size-contiguous bands, and reads the grid right.
{
  // Five sails on a 30cm ladder; kit for three rigs at a time. So a run of three
  // neighbours rigs, a run of four does not.
  const sails = [sail('s1', 400, 150), sail('s2', 415, 158), sail('s3', 430, 166),
                 sail('s4', 445, 175), sail('s5', 460, 183)];
  const kit = [mast('m1', 400), mast('m2', 430), mast('m3', 460),
               ext('e1', 0, 50), ext('e2', 0, 50), ext('e3', 0, 50),
               boom('b1', 140, 200), boom('b2', 140, 200), boom('b3', 150, 210)];
  const model = buildModel(sails, kit);
  const counts = full(model);
  const rep = spanReport(model, counts, { minRigs: 3 });

  eq(rep.ord.length, 5, 'every sail is placed on the size ladder');
  for (let a = 0; a < 5; a++) {
    ok(rep.grid[a][a], `sail ${a} rigs on its own`);
    eq(rep.grid[a].slice(0, a).every((x) => x === false), true, 'grid is upper-triangular');
  }
  // The grid agrees with allRiggable on the contiguous bands it covers.
  for (let a = 0; a < 5; a++) {
    for (let b = a; b < 5; b++) {
      let mask = 0;
      for (let k = a; k <= b; k++) mask |= 1 << rep.ord[k];
      eq(rep.grid[a][b], allRiggable(model, counts, mask), `grid[${a}][${b}] matches allRiggable`);
    }
  }
  ok(rep.widest.len >= 3 && rep.widest.len < 5, `widest band is a run of three or four (got ${rep.widest.len})`);
  ok(rep.band.every((x, p) => x.a <= p && p <= x.b), 'each sail sits inside its own band');
  eq(rep.dead.length, 0, 'nothing is dead here');
}

// A sail nothing rigs shows up in `dead`, not `short`.
{
  const sails = [sail('ok', 430, 180), sail('ok2', 445, 185), sail('nope', 650, 300)];
  const kit = [mast('m1', 430), mast('m2', 460), ext('e1', 0, 50), ext('e2', 0, 50),
               boom('b1', 140, 210), boom('b2', 140, 210)];
  const model = buildModel(sails, kit);
  const rep = spanReport(model, buildModel(sails, kit).cap, { minRigs: 2 });
  const nopePos = rep.ord.indexOf(2);
  ok(rep.dead.includes(nopePos), 'the 650-luff sail is dead');
  ok(!rep.short.includes(nopePos), 'and not merely short');
}

// checkGroup rigs a good set, and names the piece that would rescue a bad one.
{
  const sails = [sail('a', 430, 180), sail('b', 430, 180), sail('c', 430, 180)];
  const kit = [mast('m1', 430), mast('m2', 430), ext('e1', 0, 50), ext('e2', 0, 50),
               ext('e3', 0, 50), boom('b1', 140, 200), boom('b2', 140, 200), boom('b3', 140, 200)];
  const model = buildModel(sails, kit);
  const counts = full(model); // two masts, so two of the three rig

  const good = checkGroup(model, counts, [0, 1]);
  ok(good.riggable, 'two sails rig on two masts');
  eq(good.sheet.length, 2, 'and the sheet has them both');

  const bad = checkGroup(model, counts, [0, 1, 2]);
  ok(!bad.riggable, 'the third has no mast');
  eq(bad.missing.length, 1, 'one sail is missing');
  ok(bad.need && bad.need.kind === 'mast', `a mast is what is short (got ${bad.need && bad.need.kind})`);
}

// reachGroup hands back a real co-riggable group with the sail in it.
{
  const sails = [sail('a', 400, 160), sail('b', 460, 190), sail('c', 490, 200)];
  const kit = [mast('m1', 400), mast('m2', 460), mast('m3', 490),
               ext('e1', 0, 50), ext('e2', 0, 50), ext('e3', 0, 50),
               boom('b1', 140, 210), boom('b2', 140, 210), boom('b3', 140, 210)];
  const model = buildModel(sails, kit);
  const counts = full(model);
  for (let i = 0; i < 3; i++) {
    const g = reachGroup(model, counts, i);
    ok(g.includes(i), `reachGroup keeps sail ${i} in its own group`);
    let mask = 0;
    g.forEach((s) => { mask |= 1 << s; });
    ok(allRiggable(model, counts, mask), `reachGroup ${i} is actually riggable at once`);
  }
}

// reachGroup hands back a real co-riggable group with the sail in it.
{
  const sails = [sail('a', 400, 160), sail('b', 460, 190), sail('c', 490, 200)];
  const kit = [mast('m1', 400), mast('m2', 460), mast('m3', 490),
               ext('e1', 0, 50), ext('e2', 0, 50), ext('e3', 0, 50),
               boom('b1', 140, 210), boom('b2', 140, 210), boom('b3', 140, 210)];
  const model = buildModel(sails, kit);
  const counts = full(model);
  for (let i = 0; i < 3; i++) {
    const g = reachGroup(model, counts, i);
    ok(g.includes(i), `reachGroup keeps sail ${i} in its own group`);
    let mask = 0;
    g.forEach((s) => { mask |= 1 << s; });
    ok(allRiggable(model, counts, mask), `reachGroup ${i} is actually riggable at once`);
  }
}

/* =========================== 3. differential tests against brute force */

let seed = 20260901;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

/**
 * Every assignment there is, by hand. Each sail either takes one legal triple
 * or goes without, and a class can be drawn from only as often as it was
 * packed. Exponential and unusable in the app, which is exactly why it is the
 * right thing to check the dynamic program against.
 */
function bruteForce(model, counts) {
  const unit = model.classes.map((c) => c.items.map(itemPart));
  const caps = counts.slice();
  let best = { rigs: -1, value: -Infinity };

  (function rec(k, rigs, value) {
    if (k === model.rows.length) {
      if (value > best.value) best = { rigs, value };
      return;
    }
    rec(k + 1, rigs, value); // this sail goes without
    for (const t of model.rows[k].triples) {
      if (caps[t.m] <= 0 || caps[t.e] <= 0 || caps[t.b] <= 0) continue;
      const gain = 1000 + t.part
        + unit[t.m][counts[t.m] - caps[t.m]]
        + unit[t.e][counts[t.e] - caps[t.e]]
        + unit[t.b][counts[t.b] - caps[t.b]];
      caps[t.m]--; caps[t.e]--; caps[t.b]--;
      rec(k + 1, rigs + 1, value + gain);
      caps[t.m]++; caps[t.e]++; caps[t.b]++;
    }
  }(0, 0, 0));

  return best;
}

/** A small random rack, deliberately tight enough that things run out. */
function randomInstance() {
  const nSails = int(2, 4);
  const sails = [];
  for (let i = 0; i < nSails; i++) {
    const luff = pick([400, 415, 430, 445, 460, 470, 490]);
    const cams = rnd() < 0.3 ? 1 : 0;
    sails.push(sail(`s${i}`, luff, int(150, 215), {
      topExt: pick([0, 0, 0, 20]),
      cams, diam: cams ? pick(['RDM', 'SDM']) : null,
      mfr: pick(['A', 'B', 'C']),
    }));
  }
  const kit = [];
  for (let i = 0; i < int(2, 5); i++) {
    kit.push(mast(`m${i}`, pick([370, 400, 430, 460, 490]), pick(['RDM', 'SDM']), pick(['A', 'B'])));
  }
  for (let i = 0; i < int(2, 4); i++) {
    kit.push(ext(`e${i}`, 0, pick([20, 30, 50]), pick(['RDM', 'SDM']), pick(['A', 'B'])));
  }
  for (let i = 0; i < int(2, 4); i++) {
    const lo = pick([140, 150, 160, 180]);
    kit.push(boom(`b${i}`, lo, lo + pick([40, 50, 60]), pick(['A', 'B'])));
  }
  return { sails, kit };
}

// 3a. The dynamic program agrees with brute force, on the count of rigs and on
//     the exact value it maximises.
{
  let tested = 0;
  for (let n = 0; n < 400; n++) {
    const { sails, kit } = randomInstance();
    const model = buildModel(sails, kit);
    const counts = model.classes.map((c, i) => Math.min(c.items.length, model.cap[i]));
    const got = solve(model, counts);
    const want = bruteForce(model, counts);
    eq(got.rigs, want.rigs, `case ${n}: rig count disagrees with brute force`);
    ok(Math.abs((got.rigs * 1000 + got.part) - want.value) < 1e-6,
       `case ${n}: assignment value disagrees with brute force`);
    // The plan it hands back must actually be worth what it claims.
    const sheet = rigSheet(model, got);
    eq(sheet.length, got.rigs, `case ${n}: plan length disagrees with the rig count`);
    const ids = sheet.flatMap((r) => [r.mast.id, r.ext.id, r.boom.id]);
    eq(new Set(ids).size, ids.length, `case ${n}: a piece was handed out twice`);
    sheet.forEach((r) => {
      ok(mastFits(r.sail, r.mast), `case ${n}: illegal mast`);
      ok(extFits(r.sail, r.mast, r.ext), `case ${n}: illegal extension`);
      ok(boomFits(r.sail, r.boom), `case ${n}: illegal boom`);
    });
    tested++;
  }
  console.log(`  solve vs brute force:      ${tested} random racks agree`);
}

// 3b. allRiggable is exactly "solve rigs them all", but by the fast path.
{
  let tested = 0;
  for (let n = 0; n < 300; n++) {
    const { sails, kit } = randomInstance();
    const model = buildModel(sails, kit);
    const counts = model.classes.map((c, i) => Math.min(c.items.length, model.cap[i]));
    for (let mask = 1; mask < (1 << sails.length); mask++) {
      const fast = allRiggable(model, counts, mask);
      const slow = solve(model, counts, { mask }).rigs === (mask.toString(2).match(/1/g) || []).length;
      eq(fast, slow, `case ${n} mask ${mask}: the fast feasibility check disagrees`);
      tested++;
    }
  }
  console.log(`  allRiggable vs solve:      ${tested} sail groups agree`);
}

// 3b2. Reach is what it claims: the size of the largest group of sails that can
//      all rig at once with this one among them. Brute force finds that by
//      trying every group; the solver settles most sails from a single search,
//      so this is exactly where that shortcut would show up as wrong.
{
  let tested = 0;
  for (let n = 0; n < 250; n++) {
    const { sails, kit } = randomInstance();
    const model = buildModel(sails, kit);
    const counts = model.classes.map((c, i) => Math.min(c.items.length, model.cap[i]));
    const got = reachVector(model, counts);

    sails.forEach((_, s) => {
      let want = 0;
      for (let mask = 1; mask < (1 << sails.length); mask++) {
        if (!((mask >> s) & 1)) continue;
        const size = (mask.toString(2).match(/1/g) || []).length;
        if (size > want && allRiggable(model, counts, mask)) want = size;
      }
      eq(got[s], want, `case ${n} sail ${s}: reach disagrees with brute force`);
      tested++;
    });
  }
  console.log(`  reach vs brute force:      ${tested} sails agree`);
}

// 3c. The outer search finds what walking the whole lattice finds.
{
  let tested = 0;
  let optimal = 0;
  let worstGap = 0;
  let worstRel = 0;
  for (let n = 0; n < 150; n++) {
    const { sails, kit } = randomInstance();
    const pins = rnd() < 0.4 ? [pick(kit).id] : [];
    const model = buildModel(sails, kit, pins);
    const opts = { minRigs: Math.min(2, sails.length) };
    const got = chooseTrailer(model, opts);
    const want = exhaustive(model, opts);

    const ids = packingList(model, got.counts).map((p) => p.id);
    pins.forEach((p) => ok(ids.includes(p), `case ${n}: pin ${p} was dropped`));

    const gap = want.total - got.total;
    ok(gap > -1e-6, `case ${n}: the search beat the exhaustive optimum, which is a bug`);
    if (gap <= 1e-6) optimal++;
    worstGap = Math.max(worstGap, gap);
    if (Math.abs(want.total) > 1e-9) worstRel = Math.max(worstRel, gap / Math.abs(want.total));
    tested++;
  }
  console.log(`  chooseTrailer vs lattice:  ${optimal}/${tested} optimal, `
    + `worst gap ${worstGap.toFixed(2)} (${(worstRel * 100).toFixed(1)}%)`);
  ok(optimal / tested >= 0.9, `the search should be optimal on at least 9 in 10 racks, got ${optimal}/${tested}`);
  // The count alone would hide a search that misses badly but rarely. What
  // matters when it does miss is by how much, and a few points out of a hundred
  // is a second identically-specified extension picked over its twin.
  ok(worstRel <= 0.05, `the worst miss should be within 5% of optimal, was ${(worstRel * 100).toFixed(1)}%`);
}

// 3d. On the real fixture rack, the search comes within a whisker of the
//     lattice. It can pick the wrong length class for a mast when a better one
//     needs a matching extension swapped in at the same time, which the local
//     search does not do as one move; the cost is a point or two of kit match
//     on the same piece count, inside the 5% the random tests already allow.
{
  const model = buildModel(SAILS.slice(0, 4), KIT);
  const opts = { minRigs: 2 };
  const got = chooseTrailer(model, opts);
  const want = exhaustive(model, opts);
  ok((want.total - got.total) / Math.abs(want.total) <= 0.05,
     `on the fixture rack the search found ${got.total.toFixed(2)} against ${want.total.toFixed(2)}`);
  console.log(`  fixture rack:              search ${got.total.toFixed(1)}, lattice ${want.total.toFixed(1)}`);
}

// 3e. Adding kit can never make a trailer worse at rigging. The whole outer
//     search leans on this, and the exhaustive bound is unsound without it.
{
  for (let n = 0; n < 200; n++) {
    const { sails, kit } = randomInstance();
    const model = buildModel(sails, kit);
    const counts = model.floor.slice();
    for (let i = 0; i < model.classes.length; i++) counts[i] = int(0, model.cap[i]);
    const before = scoreP(model, counts, { minRigs: 1 });
    const i = int(0, model.classes.length - 1);
    if (counts[i] >= model.cap[i]) continue;
    counts[i]++;
    const after = scoreP(model, counts, { minRigs: 1 });
    ok(after.rigs >= before.rigs, `case ${n}: an extra piece lost a rig`);
    after.reaches.forEach((r, s) => {
      ok(r >= before.reaches[s], `case ${n}: an extra piece shortened a sail's reach`);
    });
    ok(after.shortBy <= before.shortBy, `case ${n}: an extra piece broke the promise further`);
  }
  console.log('  monotonicity:              adding kit never rigs fewer sails');
}

console.log();
console.log(`${checks} checks passed.`);
