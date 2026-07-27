/**
 * A short tick under the thumb whenever a tap changes something.
 *
 * One caveat worth knowing before relying on it: `navigator.vibrate` is an
 * Android/Chrome API. **iOS Safari has never shipped it**, so on an iPhone —
 * which is what most of the club will open this on — every call here is a
 * silent no-op. It is wired up regardless because it costs nothing, degrades to
 * nothing, and the club sails with both kinds of phone.
 *
 * Patterns are deliberately tiny. A stepper held down fires dozens of these a
 * second, and anything longer than about 10ms stops reading as a tick and
 * starts reading as a fault in the phone.
 */
const supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

/** Nudging a value, and the same tick a physical detent would give. */
export const TICK = 8;
/** Committing to something: a piece of kit chosen. */
export const PICK = [0, 14];
/** Something settled that a member would want confirming without looking. */
export const CONFIRM = [0, 12, 38, 20];

let lastAt = 0;

export function haptic(pattern = TICK) {
  if (!supported) return;
  // A fast drag through ten values must stay ten ticks, not one long buzz.
  const now = Date.now();
  if (now - lastAt < 24) return;
  lastAt = now;
  // Blocked outside a user gesture, and by some power-saving modes. Neither is
  // worth telling anyone about.
  try { navigator.vibrate(pattern); } catch { /* not this time */ }
}
