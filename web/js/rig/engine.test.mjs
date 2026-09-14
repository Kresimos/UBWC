/**
 * The rig engine's discipline table: node web/js/rig/engine.test.mjs
 *
 * Covers the parts introduced for windfoil/wingfoil that pack.test.mjs and
 * pack.solver.test.mjs never exercise: which slots each discipline derives,
 * the foil box-match rule, `sportFor`'s table (the rule behind "Rig this
 * kit" and the `?pin=` shortcut), and which Build picks survive a discipline
 * switch. Everything else (the rig maths itself) is already covered by
 * ranked()/`candidates()` running under pack.test.mjs's windsurf fixtures.
 */
import assert from 'node:assert/strict';
import {
  DISCIPLINES, slotsFor, boardBoxOk, sportFor, survivingPicks, ranked,
  FOIL_BOX_WINDFOIL, FOIL_BOX_WINGFOIL,
} from './engine.js';

const board = (id, box = null, vol = 100) => ({
  id, kind: 'board', mfr: 'Test', model: `Board ${id}`, cond: 'Good', vol, box, faults: [],
});
const foil = (id, box = null) => ({
  id, kind: 'foil', mfr: 'Test', model: `Foil ${id}`, cond: 'Good', box, area: null, faults: [],
});
const sail = (id) => ({ id, kind: 'sail', mfr: 'Test', model: `Sail ${id}`, cond: 'Good', faults: [] });
const wing = (id) => ({ id, kind: 'wing', mfr: 'Test', model: `Wing ${id}`, cond: 'Good', faults: [] });

// 1. Each discipline's slot list is exactly what CLAUDE.md/docs/kit_options.md
// says it is: windsurf and windfoil both derive mast/ext/boom, differing only
// in fin vs foil; wingfoil derives nothing but a foil.
{
  assert.deepEqual(slotsFor('windsurf').map((s) => s.k), ['mast', 'ext', 'boom', 'fin']);
  assert.deepEqual(slotsFor('windfoil').map((s) => s.k), ['mast', 'ext', 'boom', 'foil']);
  assert.deepEqual(slotsFor('wingfoil').map((s) => s.k), ['foil']);
  assert.deepEqual(DISCIPLINES.windsurf.targets, ['sail', 'board']);
  assert.deepEqual(DISCIPLINES.windfoil.targets, ['sail', 'board']);
  assert.deepEqual(DISCIPLINES.wingfoil.targets, ['board', 'wing']);
}

// 2. boardBoxOk: the board step's box filter. Windsurf is the everything-else
// bucket — it excludes only the two foil-only boxes, and a board with no box
// recorded (nearly every windsurf board the club owns) still shows. Windfoil
// and wingfoil are a strict allow-list of their one box each: a board that
// has never been set up as a foil board (no box recorded) does NOT show,
// unlike every other NULL-never-blocks rule in the app.
{
  assert.equal(boardBoxOk('windsurf', 'Powerbox'), true);
  assert.equal(boardBoxOk('windsurf', FOIL_BOX_WINDFOIL), false);
  assert.equal(boardBoxOk('windsurf', FOIL_BOX_WINGFOIL), false);
  assert.equal(boardBoxOk('windsurf', null), true, 'an unset box is assumed windsurf-safe');
  assert.equal(boardBoxOk('windfoil', FOIL_BOX_WINDFOIL), true);
  assert.equal(boardBoxOk('windfoil', 'Powerbox'), false);
  assert.equal(boardBoxOk('windfoil', null), false, 'an unset box has never been made foil-ready');
  assert.equal(boardBoxOk('wingfoil', FOIL_BOX_WINGFOIL), true);
  assert.equal(boardBoxOk('wingfoil', FOIL_BOX_WINDFOIL), false);
  assert.equal(boardBoxOk('wingfoil', null), false, 'an unset box has never been made wingfoil-ready');
}

// 3. The foil box-match rule: exact box match only, same as a fin, and a
// piece with no box recorded (or a board with no box recorded) still fits.
{
  const b = board(1, FOIL_BOX_WINDFOIL);
  const kit = [b, foil(10, FOIL_BOX_WINDFOIL), foil(11, FOIL_BOX_WINGFOIL), foil(12, null)];
  const ids = ranked(kit, 'foil', { board: b }).map((p) => p.id);
  assert.deepEqual(new Set(ids), new Set([10, 12]), 'only the matching box and the unrecorded one fit');
}

// 4. sportFor: the rule behind "Rig this kit" / `?pin=`. A sail is ambiguous
// with windfoil and windsurf wins; a board's sport reads off its box, with a
// plain (or unrecorded) box reading as windsurf.
{
  assert.equal(sportFor(sail(1)), 'windsurf');
  assert.equal(sportFor(wing(1)), 'wingfoil');
  assert.equal(sportFor(board(1, FOIL_BOX_WINDFOIL)), 'windfoil');
  assert.equal(sportFor(board(1, FOIL_BOX_WINGFOIL)), 'wingfoil');
  assert.equal(sportFor(board(1, 'Deep Tuttle')), 'windsurf', 'the plain Deep Tuttle box is not a foil box');
  assert.equal(sportFor(board(1, null)), 'windsurf', 'no box recorded reads as windsurf');
  // The /api/items card shape (rig_kind/box_type) works the same way.
  assert.equal(sportFor({ rig_kind: 'board', box_type: FOIL_BOX_WINGFOIL }), 'wingfoil');
}

// 5. survivingPicks: switching mid-build keeps what still fits and drops the
// rest. A sail survives windsurf <-> windfoil (both ask for one) and dies
// going to wingfoil (not one of its targets); a board survives a switch INTO
// a foil discipline only if its box is that discipline's own foil box - a
// board with no box recorded has never been set up as a foil board, so it
// does not survive into windfoil/wingfoil (it does survive between two
// non-foil disciplines, since windsurf never required a box in the first
// place - there is only one non-foil discipline today, so that direction
// is covered by boardBoxOk's own tests above).
{
  const mySail = sail(1);
  const okBoard = board(2, FOIL_BOX_WINDFOIL);
  const wrongBoard = board(3, 'Powerbox');
  const blankBoard = board(4, null);

  assert.deepEqual(
    Object.keys(survivingPicks('windsurf', 'windfoil', { sail: mySail, board: okBoard })),
    ['sail', 'board'], 'sail and a foil-ready board both carry over to windfoil');

  assert.deepEqual(
    Object.keys(survivingPicks('windsurf', 'wingfoil', { sail: mySail, board: wrongBoard })),
    [], 'wingfoil has no sail target, and this board is the wrong box for it');

  assert.deepEqual(
    Object.keys(survivingPicks('windfoil', 'wingfoil', { sail: mySail, board: okBoard })),
    [], 'a Deep Tuttle (foil ready) board is the wrong box for wingfoil, and wingfoil has no sail target');

  assert.deepEqual(
    Object.keys(survivingPicks('windsurf', 'windfoil', { sail: mySail, board: blankBoard })),
    ['sail'], 'a board never set up as a foil board does not carry over into windfoil');
}

console.log('engine.test.mjs: ok');
