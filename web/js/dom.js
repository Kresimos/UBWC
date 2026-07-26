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
 * Delegated click handling: one listener per screen, matched by a data
 * attribute. The handler gets (value, element, event).
 */
export function onClick(root, attribute, handler) {
  root.addEventListener('click', (event) => {
    const target = event.target.closest(`[${attribute}]`);
    if (target && root.contains(target)) {
      handler(target.getAttribute(attribute), target, event);
    }
  });
}

export function on(root, type, selector, handler) {
  root.addEventListener(type, (event) => {
    const target = event.target.closest(selector);
    if (target && root.contains(target)) handler(event, target);
  });
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

/** "3 days ago" for anything recent, a plain date once that stops being useful. */
export function ago(stamp) {
  if (!stamp) return '';
  const then = new Date(String(stamp).replace(' ', 'T') + (String(stamp).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(then.getTime())) return String(stamp);
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
  if (!stamp) return '';
  const when = new Date(String(stamp).replace(' ', 'T') + (String(stamp).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(when.getTime())) return '';
  return when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** How long a member has been out on a setup, for the setup screen's clock. */
export function since(stamp) {
  if (!stamp) return '';
  const from = new Date(String(stamp).replace(' ', 'T') + (String(stamp).includes('Z') ? '' : 'Z'));
  const minutes = Math.max(0, Math.round((Date.now() - from.getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
