/**
 * Builds the playground:  node misc/pack-playground/build.mjs
 *
 * The page runs the real solver rather than a copy of it, so `app.html` carries
 * only the interface and this inlines `pack.mjs` and `pack.fixtures.mjs` at the
 * `__SOLVER__` marker with their `export` keywords stripped. Rebuild after any
 * change to the solver, or the page and the tests drift apart.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const rig = join(here, '..', '..', 'web', 'js', 'rig');

const strip = (file) =>
  readFileSync(join(rig, file), 'utf8').replace(/^export /gm, '');

const solver = [
  '/* ---- inlined from web/js/rig/pack.fixtures.mjs ---- */',
  strip('pack.fixtures.mjs'),
  '/* ---- inlined from web/js/rig/pack.mjs ---- */',
  strip('pack.mjs'),
].join('\n\n');

const page = readFileSync(join(here, 'app.html'), 'utf8')
  .replace('/*__SOLVER__*/', () => solver);

if (page.includes('__SOLVER__')) throw new Error('the solver marker was not replaced');

const out = join(here, 'index.html');
writeFileSync(out, page);
console.log(`${out}  ${(page.length / 1024).toFixed(1)}kB`);
