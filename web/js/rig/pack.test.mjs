/**
 * The pack solver's check:  node web/js/rig/pack.test.mjs
 *
 * The three things that would make a trailer wrong if `packList` broke: kit
 * being handed out twice, a hard rig rule being ignored across many sails at
 * once, and running out silently. Nothing else is asserted here — the rules
 * themselves are `ranked`'s, and Your rig exercises those.
 *
 * (`web/package.json` marks this tree as ESM so node will load engine.js at
 * all; the browser never reads it.)
 */
import assert from 'node:assert/strict';
import { packList, packBoardKit, FOIL_BOX_WINDFOIL, FOIL_BOX_WINGFOIL } from './engine.js';

const sail = (id, luff, boom, extra = {}) => ({
  id, kind: 'sail', mfr: 'Test', model: `Sail ${id}`, cond: 'Good',
  luff, boom, topExt: 0, cams: 0, diam: null, faults: [], ...extra,
});
const mast = (id, len, diam = null) => ({
  id, kind: 'mast', mfr: 'Test', model: `Mast ${id}`, cond: 'Good',
  len, diam, faults: [],
});
const ext = (id, diam = null) => ({
  id, kind: 'ext', mfr: 'Test', model: `Ext ${id}`, cond: 'Good',
  min: 0, max: 50, diam, faults: [],
});
const boom = (id) => ({
  id, kind: 'boom', mfr: 'Test', model: `Boom ${id}`, cond: 'Good',
  min: 140, max: 220, faults: [],
});
const board = (id, box = 'Powerbox') => ({
  id, kind: 'board', mfr: 'Test', model: `Board ${id}`, cond: 'Good',
  vol: 120, box, faults: [],
});
const fin = (id, box = 'Powerbox') => ({
  id, kind: 'fin', mfr: 'Test', model: `Fin ${id}`, cond: 'Good',
  len: 34, box, faults: [],
});
const uj = (id) => ({ id, kind: 'uj', mfr: 'Test', model: `UJ ${id}`,
                      cond: 'Good', fit: 'Standard', faults: [] });
const foil = (id, box = FOIL_BOX_WINDFOIL) => ({
  id, kind: 'foil', mfr: 'Test', model: `Foil ${id}`, cond: 'Good', box, area: null, faults: [],
});

const of = (result, role) => result.assigned.filter((a) => a.role === role);

// 1. Two sails take two different masts, extensions and booms: nothing on a
//    trailer is shared, because both rigs stand up at the same time.
{
  const sails = [sail(1, 430, 180), sail(2, 460, 190)];
  const kit = [...sails, mast(10, 430), mast(11, 460), ext(20), ext(21),
               boom(30), boom(31)];
  const { assigned, short } = packList(kit, { sails, boards: [] });

  assert.equal(short.length, 0, 'everything should be coverable');
  ['mast', 'ext', 'boom'].forEach((role) => {
    const ids = of({ assigned }, role).map((a) => a.piece.id);
    assert.equal(ids.length, 2, `expected two ${role}s`);
    assert.equal(new Set(ids).size, 2, `${role}s must not be shared`);
  });
}

// 2. A cambered sail's cams are moulded to one diameter, so the SDM mast is
//    never handed to the RDM sail even when it is the only one left.
{
  const cammed = sail(1, 430, 180, { cams: 1, diam: 'RDM' });
  const plain = sail(2, 430, 180);
  const sails = [cammed, plain];
  const kit = [...sails, mast(10, 430, 'SDM'), mast(11, 430, 'RDM'),
               ext(20, 'SDM'), ext(21, 'RDM'), boom(30), boom(31)];
  const { assigned } = packList(kit, { sails, boards: [] });

  const forCammed = assigned.find((a) => a.role === 'mast' && a.for.id === cammed.id);
  assert.equal(forCammed.piece.diam, 'RDM', 'a cammed RDM sail needs an RDM mast');
  // ...and the extension bolted into it has to match the mast, whatever the sail.
  const extForCammed = assigned.find((a) => a.role === 'ext' && a.for.id === cammed.id);
  assert.equal(extForCammed.piece.diam, 'RDM', 'an extension must match its mast');
}

// 3. Three sails and two masts is a shortfall the kit sec is told about, not a
//    mast quietly listed twice.
{
  const sails = [sail(1, 430, 180), sail(2, 430, 180), sail(3, 430, 180)];
  const kit = [...sails, mast(10, 430), mast(11, 430),
               ext(20), ext(21), ext(22), boom(30), boom(31), boom(32)];
  const { assigned, short } = packList(kit, { sails, boards: [] });

  assert.equal(of({ assigned }, 'mast').length, 2);
  const missing = short.filter((s) => s.role === 'mast');
  assert.equal(missing.length, 1, 'the third sail should report a missing mast');
  assert.equal(missing[0].why, 'all taken');
}

// 4. A board brings a fin of its own box and a base, one each.
{
  const boards = [board(1), board(2)];
  const kit = [...boards, fin(40), fin(41, 'Tuttle'), uj(50), uj(51)];
  const { assigned, short } = packList(kit, { sails: [], boards });

  const fins = of({ assigned }, 'fin');
  assert.equal(fins.length, 1, 'only one fin has the right box');
  assert.equal(fins[0].piece.id, 40);
  assert.equal(short.filter((s) => s.role === 'fin').length, 1);
  assert.equal(of({ assigned }, 'uj').length, 2, 'one base per board');
}

// 5. packBoardKit: a windfoil board takes a box-matched foil in place of a
//    fin, and still takes a base; a wingfoil board takes a foil and NO
//    base at all — a wing has no UJ to bolt in.
{
  const windfoilBoard = board(1, FOIL_BOX_WINDFOIL);
  const wingfoilBoard = board(2, FOIL_BOX_WINGFOIL);
  const kit = [
    windfoilBoard, wingfoilBoard,
    foil(40, FOIL_BOX_WINDFOIL), foil(41, FOIL_BOX_WINGFOIL),
    uj(50), uj(51),
  ];
  const { assigned, short } = packBoardKit(kit, [windfoilBoard, wingfoilBoard], 'standard');

  const foilFor = (b) => assigned.find((a) => a.role === 'foil' && a.for.id === b.id);
  assert.equal(foilFor(windfoilBoard).piece.id, 40, 'the windfoil board gets the matching foil');
  assert.equal(foilFor(wingfoilBoard).piece.id, 41, 'the wingfoil board gets the matching foil');
  assert.equal(assigned.filter((a) => a.role === 'fin').length, 0, 'neither board asks for a fin');

  const basesTaken = assigned.filter((a) => a.role === 'uj' && a.for);
  assert.equal(basesTaken.length, 1, 'only the windfoil board takes a base');
  assert.equal(basesTaken[0].for.id, windfoilBoard.id);
  assert.equal(short.some((s) => s.role === 'uj' && s.for.id === wingfoilBoard.id), false,
    'the wingfoil board never asked for a base, so it is not a shortfall either');
}

console.log('pack.test.mjs: ok');
