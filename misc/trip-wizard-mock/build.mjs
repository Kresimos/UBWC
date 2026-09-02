/**
 * Build the rigging-wizard mockup:  node misc/trip-wizard-mock/build.mjs
 *
 * Writes trip-wizard-mock.html next to this file. Nothing is transcribed:
 *   - web/css/tokens.css and web/css/screens.css are spliced in byte for byte
 *     from this branch, so every bar and chip in the handset is the shipped
 *     design and not a copy of it;
 *   - web/js/icons.js is turned into plain script (its one import dropped, its
 *     `export` keywords stripped, a `raw` shim prepended);
 *   - pack.mjs and pack.fixtures.mjs are spliced at the __SOLVER__ marker the
 *     same way misc/pack-playground does, so the page runs the real solver.
 *
 * The solver lives in the `trip-packer-solver` worktree, not on this branch.
 * build.mjs looks for it at .claude/worktrees/trip-packer-solver/web/js/rig,
 * or wherever $SOLVER_DIR points. If that worktree is gone, check it out again
 * or pass SOLVER_DIR=... (see README.md).
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

const solverDir = process.env.SOLVER_DIR
  || join(repo, '.claude', 'worktrees', 'trip-packer-solver', 'web', 'js', 'rig');

if (!existsSync(join(solverDir, 'pack.mjs'))) {
  console.error(
    `\n  Can't find the solver.\n\n` +
    `  Looked in: ${solverDir}\n\n` +
    `  pack.mjs lives in the trip-packer-solver worktree, which is not on this\n` +
    `  branch. Check it out again, or point SOLVER_DIR at a copy:\n\n` +
    `    SOLVER_DIR=/path/to/web/js/rig node misc/trip-wizard-mock/build.mjs\n`);
  process.exit(1);
}

const stripExports = (s) => s.replace(/^export /gm, '');

const solver = [
  '/* ---- inlined from pack.fixtures.mjs ---- */',
  stripExports(read(join(solverDir, 'pack.fixtures.mjs'))),
  '/* ---- inlined from web/js/rig/pack.mjs ---- */',
  stripExports(read(join(solverDir, 'pack.mjs'))),
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
  app('web/css/screens.css'),
  '/* ===================== src/wizard.css (proposed) ===================== */',
  read(join(src, 'wizard.css')),
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
