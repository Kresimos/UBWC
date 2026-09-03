/**
 * The trailer solver on the terminal:  node web/js/rig/trailer.cli.mjs --help
 *
 * Everything the solver decides is printed with the number that decided it, so
 * a run is readable as an argument rather than an answer: which subsets were
 * asked about, what each term of the score contributed, what each piece on the
 * list is buying, and what the list would lose without it.
 */

import { readFileSync } from 'node:fs';
import { rigPlan, fmt, shortName } from './engine.js';
import { chooseTrailer, evaluate, scenarios, bruteForce, DEFAULT_WEIGHTS } from './trailer.js';
import { KIT, SAILS } from './fixture.mjs';

/* ------------------------------------------------------------- arguments */

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return next === undefined || next.startsWith('--') ? true : next;
};
const has = (name) => argv.includes(`--${name}`);

if (has('help')) {
  console.log(`
  node web/js/rig/trailer.cli.mjs [options]

    --sails 4.7,5.3,6.2     sails on the trip, by size or by id (default: all)
    --min 3                 fewest simultaneous rigs a subset must have to count
    --pin 16,23             item ids that must be on the list whatever happens
    --weights 1,.6,.35,.25  flex, reach, match, light (three still means f,m,l)
    --samples 60            how many sail subsets to judge the list against
    --seed 7                the sampler's seed
    --exact                 judge against EVERY subset, not a sample (2^sails)
    --full                  no dominance pruning: the ranking score is exact too
    --exact-score           optimise the ranking exactly inside the search, not just at the end
    --brute                 also search every possible list, to check the greedy
    --json path             real kit instead of the fixture:
                              curl -s localhost:8000/api/rig/kit > kit.json
    --quiet                 skip the search trace
`);
  process.exit(0);
}

const source = flag('json');
const kit = source
  ? (() => {
      const raw = JSON.parse(readFileSync(source, 'utf8'));
      return Array.isArray(raw) ? raw : (raw.kit || raw.items);
    })()
  : KIT;

const allSails = kit.filter((p) => p.kind === 'sail');
const wanted = flag('sails');
const sails = wanted === null || wanted === true
  ? allSails
  : String(wanted).split(',').map((token) => {
      const t = token.trim();
      return allSails.find((s) => String(s.id) === t)
          || allSails.find((s) => Math.abs(s.m2 - parseFloat(t)) < 0.05);
    }).filter(Boolean);

if (!sails.length) { console.error('no sails matched --sails'); process.exit(1); }

const min = Number(flag('min', 1));
const samples = Number(flag('samples', 60));
const seed = Number(flag('seed', 7));
const pin = flag('pin') && flag('pin') !== true ? String(flag('pin')).split(',').map((s) => s.trim()) : [];
const wArg = flag('weights');
const weights = wArg && wArg !== true
  ? (([f, r, m, l]) => (l === undefined
      ? { ...DEFAULT_WEIGHTS, flex: +f, match: +r, light: +m }   // the old three
      : { flex: +f, reach: +r, match: +m, light: +l }))(String(wArg).split(','))
  : DEFAULT_WEIGHTS;
const exhaustive = has('full');
const mode = has('exact') ? 'exact' : 'sample';

/* --------------------------------------------------------------- output */

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const D = (s) => `\x1b[2m${s}\x1b[0m`;
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const f2 = (n) => (n < 0 ? '' : ' ') + n.toFixed(3);
const rule = () => console.log(D('  ' + '-'.repeat(74)));

const counts = (role) => kit.filter((p) => p.kind === role).length;

console.log(`\n${B('UBWC trailer solver')}   ${D(source || 'built-in fixture')}`);
rule();
console.log(`  ${pad('inventory', 12)}${counts('mast')} masts  ${counts('ext')} extensions  ${counts('boom')} booms`);
console.log(`  ${pad('sails', 12)}${sails.length} on the trip: ${sails.map((s) => s.m2.toFixed(1)).join(', ')}`);
console.log(`  ${pad('minimum', 12)}${min} rig${min === 1 ? '' : 's'} at once for a subset to be counted`);
console.log(`  ${pad('weights', 12)}flex ${weights.flex}   reach ${weights.reach}   match ${weights.match}   light ${weights.light}`);

const sets = scenarios(sails.length, { min, mode, samples, seed });
console.log(`  ${pad('scenarios', 12)}${sets.length} ${mode === 'exact' ? 'subsets (every one)' : `sampled subsets (seed ${seed})`}`);

const t0 = Date.now();
const out = chooseTrailer(kit, sails, {
  min, pin, weights, sets, exhaustive, nodeBudget: 400000,
  rank: has('exact-score') ? true : undefined,
});
const ms = Date.now() - t0;
const { model, caps, evaluation: ev } = out;

/* ------------------------------------------------------------- the model */

rule();
console.log(`  ${B('classes')}  ${D('kit the rules cannot tell apart, and how many the club owns')}`);
model.cls.forEach((c, i) => {
  const users = model.sails.filter((_, si) =>
    (c.role === 'boom' ? model.booms[si].some((b) => b.b === i)
      : model.pairs[si].some((p) => (c.role === 'mast' ? p.m : p.e) === i))).length;
  console.log(`    ${pad(c.role, 6)}${pad(c.label, 22)}${D(`stock ${model.stock[i]}`)}  ${D(`fits ${users}/${sails.length} sails`)}`);
});

if (out.pinnedItems.length || out.unusedPins.length) {
  rule();
  console.log(`  ${B('pinned')}  ${D('on the list before the search starts, and never dropped')}`);
  out.pinnedItems.forEach(({ piece, ci }) =>
    console.log(`    #${pad(piece.id, 5)}${pad(shortName(piece), 26)}${D(`${piece.kind} ${model.cls[ci].label}`)}`));
  out.unusedPins.forEach(({ id, why }) => console.log(`    #${pad(id, 5)}${D(`ignored: ${why}`)}`));
}

/* ------------------------------------------------------------ the search */

if (!has('quiet')) {
  rule();
  console.log(`  ${B('search')}  ${D('best move first: add part of a rig, or drop or swap a piece')}`);
  console.log(D(`    ${pad('move', 46)}${lpad('flex', 7)}${lpad('reach', 8)}${lpad('match', 8)}${lpad('light', 8)}${lpad('score', 9)}`));
  out.trace.forEach((step) => {
    console.log(`    ${pad(step.move, 46)}${lpad(step.flex.toFixed(3), 7)}${lpad(step.reach.toFixed(3), 8)}${lpad(step.match.toFixed(3), 8)}${lpad(step.light.toFixed(3), 8)}${lpad(f2(step.score), 9)}`);
  });
}

/* ------------------------------------------------------- the packing list */

rule();
console.log(`  ${B(`packing list`)}  ${ev.pieces} pieces  ${D(`chosen in ${ms}ms`)}`);
['mast', 'ext', 'boom'].forEach((role) => {
  const lines = out.picks.filter((p) => p.cls.role === role);
  if (!lines.length) return;
  console.log(`    ${D(pad(role === 'ext' ? 'extensions' : `${role}s`, 12))}`);
  lines.forEach(({ piece, cls }) => {
    const pinned = out.pinnedItems.some((p) => p.piece.id === piece.id);
    console.log(`      ${pad(cls.label, 22)}${pad(shortName(piece), 24)}${D(piece.cond || '')}${pinned ? B('  pinned') : ''}`);
  });
});

/* ------------------------------------------------------------ the score */

rule();
console.log(`  ${B('score')}  ${f2(ev.score).trim()}   ${D('wF.flex + wR.reach + wM.match - wL.light')}`);
const term = (name, value, w, sign, note) =>
  console.log(`    ${pad(name, 8)}${lpad(value.toFixed(3), 6)} x ${pad(w, 5)}= ${lpad((sign * value * w).toFixed(3), 7)}   ${D(note)}`);
term('flex', ev.flex, weights.flex, 1, `${ev.fullSets} of ${ev.sets} subsets rig in full`);
term('reach', ev.reach, weights.reach, 1, `${(ev.reach * 100).toFixed(0)}% of the sails asked for got a rig`);
term('match', ev.match, weights.match, 1, `rigs score ${(ev.match * 100).toFixed(0)}% of the best kit available`);
term('light', ev.light, weights.light, -1, `${ev.pieces} pieces, ${3 * sails.length} is the most that could ever rig`);
if (!ev.exact) console.log(D('    (a node budget was hit: at least one scenario is a lower bound)'));
if (Math.abs(out.searchScore - ev.score) > 1e-9) {
  console.log(D(`    the search steered by ${f2(out.searchScore).trim()}, taking the ranking greedily;`
    + ` scored again exactly here. --exact-score to use the exact one throughout.`));
}
console.log(D(`    ${out.evaluated} distinct packing lists were costed to get here`));

/* -------------------------------------------------------- the assignment */

rule();
console.log(`  ${B('everyone at once')}  ${out.rigs} of ${sails.length} rigs stand up together`);
out.plan
  .sort((a, b) => a.sail.m2 - b.sail.m2)
  .forEach((row) => {
    const { sail, mastItem, extItem, boomItem } = row;
    const plan = rigPlan(sail, row.mast.rep, row.ext.rep);
    const setting = plan ? `set to +${fmt(plan.ext)}cm` : '';
    console.log(`    ${pad(`${sail.m2.toFixed(1)}m2`, 7)}${D(pad(`luff ${sail.luff}  boom ${sail.boom}`, 20))}`);
    console.log(`      ${pad(row.mast.label, 14)}${shortName(mastItem)}`);
    console.log(`      ${pad(row.ext.label, 14)}${pad(shortName(extItem), 22)}${D(setting)}`);
    console.log(`      ${pad(row.boom.label, 14)}${pad(shortName(boomItem), 22)}${D(`set to ${sail.boom}cm`)}`);
  });
out.short.forEach(({ sail, why }) =>
  console.log(`    ${pad(`${sail.m2.toFixed(1)}m2`, 8)}${D(why)}`));

/* ------------------------------------------------------- why each piece */

rule();
console.log(`  ${B('what each piece is buying')}  ${D('the score if this one were left behind')}`);
const work = Int32Array.from(caps);
model.cls.forEach((c, i) => {
  if (!caps[i]) return;
  work[i] -= 1;
  const without = evaluate(model, work, sets, { weights, exhaustive });
  work[i] += 1;
  const drop = ev.score - without.score;
  const locked = out.floor[i] >= caps[i];
  console.log(`    ${pad(`${c.role} ${c.label}`, 30)}${lpad(`-${drop.toFixed(3)}`, 8)}   ${D(
    `${without.fullSets}/${without.sets} subsets  ${without.rigsMade} rigs`)}${locked ? D('   pinned') : ''}`);
});

/* ------------------------------------------------------------ the check */

if (has('brute')) {
  rule();
  const t1 = Date.now();
  const best = bruteForce(model, sets, { weights, exhaustive, floor: out.floor,
                                        rank: has('exact-score') ? true : undefined });
  const same = best.caps.every((k, i) => k === caps[i]);
  console.log(`  ${B('brute force')}  every list scored: ${best.seen} of them in ${Date.now() - t1}ms`);
  console.log(`    best possible   ${f2(best.score)}`);
  console.log(`    search found    ${f2(out.searchScore)}   ${same ? B('the same list') : `${D('gap')} ${(best.score - ev.score).toFixed(4)}`}`);
  if (!same) {
    console.log(D('    the best list differs:'));
    model.cls.forEach((c, i) => {
      if (best.caps[i] === caps[i]) return;
      console.log(`      ${pad(`${c.role} ${c.label}`, 30)}${D(`greedy ${caps[i]}  best ${best.caps[i]}`)}`);
    });
  }
}

console.log('');
