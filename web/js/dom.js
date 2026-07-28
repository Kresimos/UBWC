/**
 * Rendering helpers.
 *
 * Screens are template strings turned into HTML in one go, exactly as the
 * sketches were written, and events are handled by delegation from the screen
 * root. That keeps the markup readable next to the design it came from, with
 * no framework and no build step.
 *
 * The `html` tag escapes every interpolated value, so item names, member notes
 * and fault descriptions typed by members can never inject markup. Nested
 * markup is passed through `raw()`, which is the only way in.
 */

const RAW = Symbol('raw');

export function raw(value) {
  return { [RAW]: String(value ?? '') };
}

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function part(value) {
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return value.map(part).join('');
  if (typeof value === 'object' && RAW in value) return value[RAW];
  return esc(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return raw(out);
}

/** A `html` result (or anything else) as a markup string. */
export function toHtml(value) {
  return typeof value === 'string' ? value : part(value);
}

/** Render a `html` result (or plain string) into an element. */
export function mount(root, content) {
  root.innerHTML = toHtml(content);
  return root;
}

export function el(markup) {
  const holder = document.createElement('div');
  holder.innerHTML = typeof markup === 'string' ? markup : part(markup);
  return holder.firstElementChild;
}

/**
 * Delegated event handling, matched by a data attribute or a selector. The
 * handler gets (value, element, event) for clicks, (event, element) otherwise.
 *
 * These bind to the *screen root*, which the router reuses for every screen, so
 * a handler outlives the markup it was written for unless something takes it
 * away. Two things do:
 *
 *  - the router opens a scope per render and aborts the previous one, so
 *    leaving a screen unbinds it. Without that, the Catalogue's `data-item`
 *    handler stayed live underneath Your rig, and because a vote button also
 *    carries the item's id, pressing a thumb navigated to the item page;
 *  - registering the same key twice inside one scope replaces the first, so a
 *    screen that re-wires on every repaint does not stack handlers.
 */
let scope = null;
const bound = new WeakMap();

/** Called by the router: everything bound after this belongs to this screen. */
export function openListenerScope() {
  if (scope) scope.abort();
  scope = new AbortController();
  bound.set(scope, new Map());
  return scope;
}

function delegate(root, type, key, listener, extra) {
  const options = { ...extra, ...(scope ? { signal: scope.signal } : {}) };
  const seen = scope && bound.get(scope);
  if (seen) {
    const id = `${type}:${key}`;
    const previous = seen.get(id);
    if (previous) root.removeEventListener(type, previous);
    seen.set(id, listener);
  }
  root.addEventListener(type, listener, options);
}

export function onClick(root, attribute, handler) {
  delegate(root, 'click', attribute, (event) => {
    const target = event.target.closest(`[${attribute}]`);
    if (target && root.contains(target)) {
      handler(target.getAttribute(attribute), target, event);
    }
  });
}

export function on(root, type, selector, handler, options) {
  delegate(root, type, selector, (event) => {
    const target = event.target.closest(selector);
    if (target && root.contains(target)) handler(event, target);
  }, options);
}

/**
 * The same text, with every number in it wrapped so it can be set in tabular
 * figures and a heavier weight. The value is escaped first, so this cannot be
 * used to smuggle markup in through an item's model name.
 */
export function numify(value) {
  return raw(esc(value).replace(
    /\d+(?:\.\d+)?(?:\s?[-–]\s?\d+(?:\.\d+)?)?/g,
    (match) => `<span class="num">${match}</span>`,
  ));
}

/** Numbers as a person writes them: 6.5, not 6.50; 490, not 490.0. */
export function num(value, decimals = 1) {
  if (value == null || value === '') return '';
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return String(value);
  return String(Math.round(parsed * 10 ** decimals) / 10 ** decimals);
}

export function initial(name) {
  return (String(name || '?').trim()[0] || '?').toUpperCase();
}

/**
 * The server hands back SQLite's "YYYY-MM-DD HH:MM:SS", which is UTC but says
 * so nowhere. Left alone, `new Date` reads it as local time and every stamp
 * drifts by the offset. Every reader below goes through here so they agree.
 */
export function stampDate(stamp) {
  if (!stamp) return null;
  const text = String(stamp);
  const parsed = new Date(text.replace(' ', 'T') + (text.includes('Z') ? '' : 'Z'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "3 days ago" for anything recent, a plain date once that stops being useful. */
export function ago(stamp) {
  if (!stamp) return '';
  const then = stampDate(stamp);
  if (!then) return String(stamp);
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) {
    const hours = Math.floor((Date.now() - then.getTime()) / 3600000);
    if (hours <= 0) return 'just now';
    return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function clockTime(stamp) {
  const when = stampDate(stamp);
  return when ? when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
}

/** How long a member has been out on a setup, for the setup screen's clock. */
export function since(stamp) {
  const from = stampDate(stamp);
  if (!from) return '';
  return spanOf(Math.max(0, Math.round((Date.now() - from.getTime()) / 60000)));
}

/** The same clock as `since`, over a pair of stamps rather than up to now. */
export function spanned(from, to) {
  const start = stampDate(from);
  const end = stampDate(to);
  if (!start || !end) return '';
  return spanOf(Math.round((end.getTime() - start.getTime()) / 60000));
}

function spanOf(minutes) {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
