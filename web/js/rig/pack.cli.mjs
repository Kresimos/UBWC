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
 *   --min N         the flexibility count is over groups of at least N sails (default 3)
 *   --pin id,id     item ids that must be on the trailer whatever the score says
 *   --w-flex N      weight on flexibility        (default 100)
 *   --w-match N     weight on kit matching       (default 30)
 *   --w-light N     charge per piece of kit      (default 2)
 *   --exact         also walk the whole lattice and say whether the search found it
 *   --explain       show the scoring arithmetic term by term
 *   --trace         show every move the search made
 *   --list          print the fixture rack's item ids and exit
 */

import {
  buildModel, chooseTrailer, exhaustive, packingList, rigSheet,
  shortfalls, DEFAULT_WEIGHTS,
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
  flex: num('w-flex', DEFAULT_WEIGHTS.flex),
  match: num('w-match', DEFAULT_WEIGHTS.match),
  light: num('w-light', DEFAULT_WEIGHTS.light),
};

const known = new Set(KIT.map((p) => p.id));
const unknownPins = pins.filter((id) => !known.has(id));
if (unknownPins.length) {
  console.error(`No such kit: ${unknownPins.join(', ')}. Try --list.`);
  process.exit(1);
}

const opts = { minRigs, weights };
const model = buildModel(sails, KIT, pins);

console.log();
console.log(`Sails      ${sails.map((s) => `${s.m2}`).join(', ')}  (${sails.length})`);
console.log(`Groups     at least ${minRigs} sails rigged at once`);
console.log(`Weights    flex ${weights.flex}, match ${weights.match}, ${weights.light} per piece`);
if (pins.length) console.log(`Pinned     ${pins.join(', ')}`);

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

const short = shortfalls(model, best, best.counts);
if (short.length) {
  console.log();
  console.log('Short:');
  short.forEach((s) => console.log(`  ${s.sail.m2}m2 ${s.sail.mfr} ${s.sail.model}: ${s.why}`));
}

/* ----------------------------------------------------------- the score */

head('The score');
const t = best.terms;
table([
  ['flexibility', `${best.flex.count} of ${best.flex.total} groups riggable`,
   `${n2(best.flex.frac)} x ${weights.flex}`, `= ${n1(t.flex)}`],
  ['kit matching', `mean ${Math.round(best.match * 100)}% of each sail's best possible kit`,
   `${n2(best.match)} x ${weights.match}`, `= ${n1(t.match)}`],
  ['lightness', `${best.pieces} pieces on the trailer`,
   `${best.pieces} x -${weights.light}`, `= ${n1(t.light)}`],
  ['', '', 'total', `= ${n1(best.total)}`],
], ['l', 'l', 'r', 'r']);

if (args.flags.has('explain')) {
  head('Riggable groups, by size');
  table([['sails at once', 'groups riggable', 'groups there are'],
         ...best.flex.bySize.map((c, k) => (c === undefined ? null : [
           `${k}${k >= minRigs ? ' *' : ''}`, String(c),
           String(choose(sails.length, k)),
         ])).filter(Boolean)], ['r', 'r', 'r']);
  console.log();
  console.log(`* counted toward flexibility (groups of at least ${minRigs}).`);
  console.log('A group is only tested when every group one smaller already worked,');
  console.log('which is why this is not 2^n assignments.');
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
