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
const KEY = 'ubwc.building';

// A factory, not a constant: the arrays and objects inside it are mutated, so
// every session has to get its own.
const empty = () => ({ sail: null, board: null, skipped: [], targets: {}, slots: {} });

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

export const building = {
  get raw() { return held; },

  /** The two Build picks, as ids. */
  pick(key, id) {
    held[key] = id;
    held.skipped = held.skipped.filter((k) => k !== key);
    // Changing the sail unsettles everything the sail decided.
    if (key === 'sail') held.slots = {};
    save();
  },

  skip(key) {
    held[key] = null;
    if (!held.skipped.includes(key)) held.skipped.push(key);
    if (key === 'sail') held.slots = {};
    save();
  },

  isSkipped: (key) => held.skipped.includes(key),

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
  started: () => Boolean(held.sail || held.board),
};
