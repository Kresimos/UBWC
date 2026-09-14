/**
 * The rig you are part-way through building.
 *
 * Build hands Your rig two pieces, and Your rig hands back four more as they
 * are confirmed. That is a conversation between two screens, so it cannot live
 * inside either of them — but it is not app-wide state either, so it does not
 * belong in the store next to who you are and where you are.
 *
 * Only ids are kept, and only for the session. A piece is looked back up in the
 * kit list every time, so a fault reported while you were choosing shows up
 * rather than being frozen into a stale copy.
 */
import { DEFAULT_DISCIPLINE } from './engine.js';

const KEY = 'ubwc.building';
// Which sport was last built, remembered across visits (most members only
// ever build one). A Rig button from an item overrides it for that visit
// without overwriting what is remembered (build.js decides that, not here).
const SPORT_KEY = 'ubwc.sport';

const readSport = () => {
  try {
    const stored = localStorage.getItem(SPORT_KEY);
    return stored || DEFAULT_DISCIPLINE;
  } catch {
    return DEFAULT_DISCIPLINE;
  }
};

// A factory, not a constant: the arrays and objects inside it are mutated, so
// every session has to get its own.
const empty = () => ({
  discipline: readSport(), sail: null, board: null, wing: null,
  skipped: [], targets: {}, slots: {},
});

function load() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return stored ? { ...empty(), ...stored } : empty();
  } catch {
    return empty();
  }
}

let held = load();

function save() {
  try { sessionStorage.setItem(KEY, JSON.stringify(held)); } catch { /* private mode */ }
}

// The target whose change unsettles the derived slots. In every discipline
// exactly one target drives them (sail for windsurf/windfoil's mast/ext/boom,
// wing standing in for wingfoil's single foil slot) — the other target
// (board) is what a slot's `needs` actually reads, but changing it is rare
// enough mid-flow that only the driving target forces a re-derive.
const DRIVES_SLOTS = (key) => key === 'sail' || key === 'wing';

export const building = {
  get raw() { return held; },

  /** Which of the three pipelines is being built. */
  get discipline() { return held.discipline || DEFAULT_DISCIPLINE; },

  /**
   * Switch pipeline. This only ever changes `held.discipline` and persists it
   * as the remembered sport — it does not know which picks still fit the new
   * discipline, since that needs the actual kit (box types, etc.), which only
   * the screen holding the fetched kit list has. build.js applies the
   * keep/drop rule (docs/kit_options.md) with `pick`/`reopen` before calling
   * this, using the discipline this getter still reports as "the old one".
   */
  setDiscipline(next) {
    held.discipline = next;
    try { localStorage.setItem(SPORT_KEY, next); } catch { /* private mode */ }
    save();
  },

  /** The Build picks, as ids, keyed by target ('sail'/'board'/'wing'). */
  pick(key, id) {
    held[key] = id;
    held.skipped = held.skipped.filter((k) => k !== key);
    // Changing the target that drives the rig unsettles everything it decided.
    if (DRIVES_SLOTS(key)) held.slots = {};
    save();
  },

  skip(key) {
    held[key] = null;
    if (!held.skipped.includes(key)) held.skipped.push(key);
    if (DRIVES_SLOTS(key)) held.slots = {};
    save();
  },

  isSkipped: (key) => held.skipped.includes(key),

  /**
   * Back to unanswered: no pick, not skipped either. This is "Change" on Your
   * rig undoing a Build pick, and Build itself dropping the skip when it sends
   * a member back to a step they stepped past but still have to fill.
   */
  reopen(key) {
    held[key] = null;
    held.skipped = held.skipped.filter((k) => k !== key);
    if (DRIVES_SLOTS(key)) held.slots = {};
    save();
  },

  /** The size the stepper is sitting on, remembered between visits. */
  target(key) { return held.targets[key] ?? null; },
  setTarget(key, value) { held.targets[key] = value; save(); },

  /** A recommendation slot the member has said yes to. */
  confirm(key, id) {
    held.slots[key] = id;
    // A new mast re-opens the extension, because the extension length was the
    // old mast's number, not this one's.
    if (key === 'mast') delete held.slots.ext;
    save();
  },
  unconfirm(key) { delete held.slots[key]; save(); },
  confirmed: () => ({ ...held.slots }),

  clear() {
    held = empty();
    save();
  },

  /** Is there anything worth showing on Your rig? */
  started: () => Boolean(held.sail || held.board || held.wing),
};
