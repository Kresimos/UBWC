#!/usr/bin/env node
/**
 * The trailer solver at the terminal.
 *
 *   node web/js/rig/pack.cli.mjs --sails 5.5,6.0,7.0,8.5 --min 3
 *   node web/js/rig/pack.cli.mjs --pin e6,m430c --explain
 *   node web/js/rig/pack.cli.mjs --exact --trace
 *   node web/js/rig/pack.cli.mjs --list
 *
 * Options
 *   --sails a,b,c   sail sizes to take, from the fixture rack (default: all)
 *   --min N         every sail must rig in a group of at least N (default 3)
 *   --pin id,id     item ids that must be on the trailer whatever the score says
 *   --w-spare N     reward for spare kit beyond the promise (default 45)
 *   --w-short N     penalty per sail-slot short of it     (default 25)
 *   --w-match N     weight on kit matching                (default 30)
 *   --w-light N     charge per piece of kit               (default 2)
 *   --w-sessions N  reward for small groups that all rig  (default 12)
 *   --exact         also walk the whole lattice and say whether the search found it
 *   --explain       show the scoring arithmetic term by term
 *   --trace         show every move the search made
 *   --ways          list every way the packed trailer rigs the same group
 *   --group a,b,c   check whether this exact set of sail sizes rigs at once
 *   --must a,b;c,d   force the trailer to be able to stand up these sessions
 *   --list          print the fixture rack's item ids and exit
 */

import {
  buildModel, chooseTrailer, exhaustive, packingList, rigSheet, arrangements,
  unriggableGroups, checkGroup, classLabel, fragileKinds, DEFAULT_WEIGHTS,
} from './pack.mjs';
import { SAILS, KIT, sailsBySize } from './pack.fixtures.mjs';

/* ------------------------------------------------------------------ args */

function parseArgs(argv) {
  const out = { flags: new Set(), opt: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out.flags.add(key);
    else { out.opt[key] = next; i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const num = (k, d) => (args.opt[k] === undefined ? d : Number(args.opt[k]));
const list = (k) => (args.opt[k] ? String(args.opt[k]).split(',').map((s) => s.trim()).filter(Boolean) : []);

/* --------------------------------------------------------------- output */

const pad = (s, w) => String(s).padEnd(w);
const lpad = (s, w) => String(s).padStart(w);
const n1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const n2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
const rule = (w = 74) => console.log('-'.repeat(w));
const head = (t) => { console.log(); console.log(t); rule(); };

function table(rows, aligns = []) {
  if (!rows.length) return;
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  rows.forEach((r) => {
    console.log(r.map((cell, i) =>
      (aligns[i] === 'r' ? lpad(cell, widths[i]) : pad(cell, widths[i]))).join('  ').trimEnd());
  });
}

const pieceName = (p) => {
  if (p.kind === 'mast') return `${p.len} ${p.diam} ${p.mfr}`;
  if (p.kind === 'ext') return `${p.min}-${p.max} ${p.diam} ${p.mfr}`;
  return `${p.min}-${p.max} ${p.mfr}`;
};

if (args.flags.has('list')) {
  head('The fixture rack');
  ['mast', 'ext', 'boom'].forEach((kind) => {
    table(KIT.filter((p) => p.kind === kind)
      .map((p) => [p.id, kind, pieceName(p), p.cond, `rated ${p.rate.avg}`,
                   (p.faults || []).length ? 'has a fault' : '']));
    console.log();
  });
  head('Sails');
  table(SAILS.map((s) => [s.id, `${s.m2}m2`, `${s.mfr} ${s.model}`,
                          `luff ${s.luff}`, `top +${s.topExt}`, `boom ${s.boom}`,
                          s.cams ? `cammed ${s.diam}` : '']));
  process.exit(0);
}

/* ----------------------------------------------------------------- run */

const sails = args.opt.sails ? sailsBySize(list('sails').map(Number)) : SAILS;
const pins = list('pin');
const minRigs = num('min', 3);
const weights = {
  spare: num('w-spare', DEFAULT_WEIGHTS.spare),
  short: num('w-short', DEFAULT_WEIGHTS.short),
  match: num('w-match', DEFAULT_WEIGHTS.match),
  light: num('w-light', DEFAULT_WEIGHTS.light),
  sessions: num('w-sessions', DEFAULT_WEIGHTS.sessions),
};

const known = new Set(KIT.map((p) => p.id));
const unknownPins = pins.filter((id) => !known.has(id));
if (unknownPins.length) {
  console.error(`No such kit: ${unknownPins.join(', ')}. Try --list.`);
  process.exit(1);
}

const model = buildModel(sails, KIT, pins);

// --must 5.5,6.0;7.0,7.8 -> sessions that have to be riggable at once
const mustRig = (args.opt.must ? String(args.opt.must).split(';') : [])
  .map((g) => g.split(',').map((s) => s.trim()).filter(Boolean).map(Number))
  .filter((g) => g.length >= 2)
  .map((g) => sailsBySize(g).map((w) => sails.indexOf(w)));

const opts = { minRigs, weights, mustRig };

console.log();
console.log(`Sails      ${sails.map((s) => `${s.m2}`).join(', ')}  (${sails.length})`);
console.log(`Promise    every sail rigs, in a group of at least ${minRigs}`);
console.log(`Weights    spare ${weights.spare}, short ${weights.short}, `
  + `match ${weights.match}, ${weights.light} per piece`);
if (pins.length) console.log(`Pinned     ${pins.join(', ')}`);
if (mustRig.length) console.log(`Must rig   ${mustRig
  .map((g) => g.map((i) => sails[i].m2).join('+')).join(', ')}`);

const t0 = Date.now();
const best = chooseTrailer(model, opts);
const ms = Date.now() - t0;

/* ------------------------------------------------------------ the list */

head(`The packing list  (${best.pieces} pieces)`);
const pinSet = new Set(pins);
['mast', 'ext', 'boom'].forEach((kind) => {
  const rows = [];
  model.classes.forEach((c, i) => {
    if (c.kind !== kind || !best.counts[i]) return;
    for (let j = 0; j < best.counts[i]; j++) {
      const item = c.items[j];
      rows.push([`  ${item.id}`, pieceName(item), item.cond,
                 pinSet.has(item.id) ? 'pinned' : '']);
    }
  });
  if (rows.length) { console.log(`${kind}s`); table(rows); }
});

/* ------------------------------------------------------------ the rigs */

head(`The rigs  (${best.rigs} of ${sails.length} sails stand up at once)`);
table([['sail', 'mast', 'extension', 'boom', 'match'],
       ...rigSheet(model, best).map((r) => [
         `${r.sail.m2}m2 ${r.sail.mfr}`,
         `${r.mast.len} ${r.mast.diam}`,
         `${r.ext.id} set to +${r.setting}`,
         `${r.boom.min}-${r.boom.max}`,
         `${Math.round(100 * r.quality)}%`,
       ])], ['l', 'l', 'l', 'l', 'r']);

// The smallest sail groups the packing list cannot stand up at once. A club
// sails a wide spread on a day, so scattered is fine; "these two won't rig
// together" is the mistake worth catching.
{
  const fails = unriggableGroups(model, best.counts, { maxSize: minRigs });
  head(`Groups that won't rig together  (${fails.length})`);
  if (!fails.length) {
    console.log(`Every group of up to ${Math.min(minRigs, best.rigs)} sails rigs at once.`);
  } else {
    fails.forEach((g) => console.log('  ' + g.map((i) => `${sails[i].m2}`).join(' + ')
      + `   (--must ${g.map((i) => sails[i].m2).join(',')} to pack for it)`));
  }
}

if (args.opt.group) {
  const want = sailsBySize(list('group').map(Number));
  const idxs = want.map((w) => sails.indexOf(w));
  const r = checkGroup(model, best.counts, idxs);
  head(`Can ${want.map((w) => w.m2).join(' + ')} rig at once?`);
  if (r.riggable) {
    console.log('Yes.');
    table([['sail', 'mast', 'extension', 'boom'],
           ...r.sheet.map((x) => [`${x.sail.m2}m2`, `${x.mast.len} ${x.mast.diam} ${x.mast.id}`,
             `${x.ext.id} +${x.setting}`, `${x.boom.min}-${x.boom.max} ${x.boom.id}`])], ['l', 'l', 'l', 'l']);
  } else {
    console.log(`No: ${r.sheet.length} of ${idxs.length} rig. `
      + `Missing ${r.missing.map((i) => `${sails[i].m2}m2`).join(', ')}.`);
    console.log(r.need
      ? `One more ${classLabel(r.need)} would do it.`
      : 'More than one piece short.');
  }
}

/* --------------------------------------------------------- the ways */

if (args.flags.has('ways')) {
  const ways = arrangements(model, best, best.counts, { limit: 40 });
  head(`Ways to rig this group  (${ways.capped ? ways.count + '+' : ways.count})`);
  console.log('Which mast each sail gets is the whole of the choice; the extension');
  console.log('follows the mast and the boom is fitted for the best match.');
  ways.list.forEach((sheet, n) => {
    const mean = Math.round(100 * sheet.reduce((a, r) => a + r.quality, 0) / sheet.length);
    console.log();
    console.log(`  ${n + 1}.  ${mean}% mean match${n === 0 ? '   (as scored above)' : ''}`);
    table(sheet.map((r) => [
      `    ${r.sail.m2}m2 ${r.sail.mfr}`,
      `${r.mast.len} ${r.mast.diam} ${r.mast.id}`,
      `${r.ext.id} +${r.setting}`,
      `${r.boom.min}-${r.boom.max} ${r.boom.id}`,
      `${Math.round(100 * r.quality)}%`,
    ]), ['l', 'l', 'l', 'l', 'r']);
  });
}

/* ----------------------------------------------------------- the score */

head('The promise');
table([['sail', 'rigs in a group of', 'best possible', '', 'verdict'],
       ...sails.map((sl, i) => {
         const got = best.reaches[i];
         const can = best.possible[i];
         const asked = Math.min(minRigs, can);
         const bar = can > 0 ? '#'.repeat(got) + '.'.repeat(Math.max(0, can - got)) : '';
         return [
           `${sl.m2}m2 ${sl.mfr}`,
           can > 0 ? String(got) : 'cannot rig',
           can > 0 ? String(can) : 'nothing fits it',
           bar,
           can === 0 ? 'not the trailer\'s fault'
             : got >= asked ? (got > asked ? `${got - asked} to spare` : 'just meets it')
             : `${asked - got} short`,
         ];
       })], ['l', 'r', 'r', 'l', 'l']);

head('The score');
const t = best.terms;
const s = best.slack;
table([
  ['spare kit', `${s.mast} mast, ${s.ext} extension, ${s.boom} boom spare, beyond the group of ${best.datum}`,
   `${n2(best.spare)} x ${weights.spare}`, `= ${n1(t.spare)}`],
  ['promise', best.shortBy === 0
    ? 'every sail rigs in a group of ' + minRigs
    : `${best.shortBy} sail-slots short of a group of ${minRigs}`,
   `${best.shortBy} x -${weights.short}`, `= ${n1(t.short)}`],
  ['kit matching', `mean ${Math.round(best.match * 100)}% of each sail's best possible kit`,
   `${n2(best.match)} x ${weights.match}`, `= ${n1(t.match)}`],
  ['sessions', `${Math.round(best.sessions * 100)}% of the small groups up to ${minRigs} all rig`,
   `${n2(best.sessions)} x ${weights.sessions}`, `= ${n1(t.sessions)}`],
  ['lightness', `${best.pieces} pieces on the trailer`,
   `${best.pieces} x -${weights.light}`, `= ${n1(t.light)}`],
  ['', '', 'total', `= ${n1(best.total)}`],
], ['l', 'l', 'r', 'r']);

if (best.impossible.length) {
  console.log();
  console.log('Not a packing problem:');
  best.impossible.forEach((i) => console.log(
    `  ${sails[i].m2}m2 ${sails[i].mfr} ${sails[i].model}: nothing in the club rigs it, `
    + 'so it is left out of the scoring entirely.'));
}

if (best.keptPromise) {
  const fragile = fragileKinds(model, best.counts, opts);
  console.log();
  console.log(fragile.length
    ? `One breakage from a broken promise: ${fragile.join(', ')}. Losing a single `
      + `${fragile[0]} drops a sail below its group of ${minRigs}.`
    : 'The promise survives losing any single piece on the trailer.');
}

if (args.flags.has('explain')) {
  head('What the promise means');
  console.log(`Each sail is promised two things: that it rigs at all, and that it rigs`);
  console.log(`while at least ${minRigs - 1} other sails are also up. Reach is the biggest group`);
  console.log('a sail can be part of, so the promise is kept when every reach is at');
  console.log(`least ${minRigs}. Spare kit rewards carrying more than that bare group needs,`);
  console.log('which is what leaves the trailer working when somebody snaps a mast on');
  console.log('the first day, and gives a real choice of rig at the trailer.');
  console.log();
  console.log('A sail is never charged for a group the club could not give it: the');
  console.log('"best possible" column is what the whole rack can do, and the promise');
  console.log('asks for the smaller of that and the minimum.');
}

if (args.flags.has('trace')) {
  head('How it got there');
  table([['move', 'piece', 'rigs', 'score'],
         ...best.trace.map((m) => [m.move, m.label, String(m.rigs), n1(m.total)])],
        ['l', 'l', 'r', 'r']);
}

/* --------------------------------------------------------- the check */

if (args.flags.has('exact')) {
  head('Checking against the whole lattice');
  const t1 = Date.now();
  const opt = exhaustive(model, opts);
  const ems = Date.now() - t1;
  const gap = opt.total - best.total;
  console.log(`search      ${n1(best.total)} in ${ms}ms`);
  console.log(`exhaustive  ${n1(opt.total)} in ${ems}ms over ${opt.nodes} lattice nodes`);
  console.log(gap <= 1e-6
    ? 'The search found the optimum.'
    : `The search was short by ${n1(gap)}. Optimal list: ${
        packingList(model, opt.counts).map((p) => p.id).join(', ')}`);
} else {
  console.log();
  console.log(`(${ms}ms. Add --exact to check this against the whole lattice.)`);
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}
