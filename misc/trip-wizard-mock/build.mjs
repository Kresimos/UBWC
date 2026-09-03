/**
 * Build the rigging-wizard mockup:  node misc/trip-wizard-mock/build.mjs
 *
 * Writes trip-wizard-mock.html next to this file. Nothing is transcribed:
 *   - web/css/tokens.css and web/css/screens.css are spliced in byte for byte
 *     from this branch, so every bar and chip in the handset is the shipped
 *     design and not a copy of it - including the wizard and confirm component
 *     CSS, which now lives in screens.css under [data-screen="trip"];
 *   - web/js/icons.js is turned into plain script (its one import dropped, its
 *     `export` keywords stripped, a `raw` shim prepended);
 *   - web/js/rig/pack.js and web/js/rig/pack.fixtures.mjs are spliced at the
 *     __SOLVER__ marker, so the page runs the real trailer solver against the
 *     fixture rack.
 *
 * The solver is on this branch now (web/js/rig/pack.js); $SOLVER_DIR still
 * overrides where it is read from.
 *
 * Rebuild after any change to src/, and after any change to the solver.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const src = join(here, 'src');

const read = (p) => readFileSync(p, 'utf8');
const app = (f) => read(join(repo, f));

const solverDir = process.env.SOLVER_DIR || join(repo, 'web', 'js', 'rig');
const solverFile = existsSync(join(solverDir, 'pack.js')) ? 'pack.js' : 'pack.mjs';

if (!existsSync(join(solverDir, solverFile))) {
  console.error(
    `\n  Can't find the solver.\n\n` +
    `  Looked in: ${solverDir}\n\n` +
    `  pack.js is on this branch at web/js/rig/. Point SOLVER_DIR at a copy if\n` +
    `  you are building from somewhere it is not:\n\n` +
    `    SOLVER_DIR=/path/to/web/js/rig node misc/trip-wizard-mock/build.mjs\n`);
  process.exit(1);
}

const stripExports = (s) => s.replace(/^export /gm, '');

const solver = [
  '/* ---- inlined from web/js/rig/pack.fixtures.mjs ---- */',
  stripExports(read(join(solverDir, 'pack.fixtures.mjs'))),
  `/* ---- inlined from web/js/rig/${solverFile} ---- */`,
  stripExports(read(join(solverDir, solverFile))),
].join('\n\n');

const icons = [
  '/* ---- web/js/icons.js, module keywords stripped ---- */',
  'const raw = (s) => s;',
  app('web/js/icons.js')
    .replace(/^import .* from '\.\/dom\.js';\n?/m, '')
    .replace(/^export /gm, ''),
].join('\n');

let page = [
  read(join(src, 'head.html')),
  '/* ===================== web/css/tokens.css ===================== */',
  app('web/css/tokens.css'),
  '/* ===================== web/css/screens.css ===================== */',
  // The wizard and confirm component CSS now ships here, under
  // [data-screen="trip"], so the mockup gets it from the app like every other
  // bar and chip rather than from a copy in src/.
  app('web/css/screens.css'),
  '/* ===================== src/design.css (the knobs) ===================== */',
  read(join(src, 'design.css')),
  '/* ===================== src/canvas.css (the wall) ===================== */',
  read(join(src, 'canvas.css')),
  read(join(src, 'body.html')),
  '<script>',
  icons,
  read(join(src, 'app.js')),
  '</script>',
].join('\n');

page = page.replace('/*__SOLVER__*/', () => solver);
if (page.includes('__SOLVER__')) throw new Error('the __SOLVER__ marker was not replaced');

const out = join(here, 'trip-wizard-mock.html');
writeFileSync(out, page);
console.log(`wrote ${out}  (${(page.length / 1024).toFixed(0)} kB)`);
