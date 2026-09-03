/**
 * Hash routing over a screen stack.
 *
 * The tab bar is the backbone, so a route is "which tab, and how deep in it".
 * `back()` walks the browser's own history, which means the phone's back
 * gesture and the app's back arrow are the same action rather than two
 * behaviours that can disagree.
 */

import { openListenerScope } from './dom.js';

const routes = [];
let current = null;
let root = null;
let onChange = () => {};
// How many screens deep in this app's own history the current entry is. It is
// stamped onto the history entry itself, so the browser hands it back on a
// back/forward move and `back()` can tell "there is a screen of ours under
// this one" from "this is where the app was opened".
let depth = -1;
let replacing = false;

export function route(pattern, options) {
  // '/item/:id' -> a regex with named groups, in declaration order.
  const names = [];
  const source = pattern.replace(/:([a-z]+)/gi, (_, name) => {
    names.push(name);
    return '([^/]+)';
  });
  routes.push({ test: new RegExp(`^${source}$`), names, ...options });
}

export function start(container, changed) {
  root = container;
  onChange = changed || (() => {});
  window.addEventListener('hashchange', resolve);
  resolve();
}

export function go(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (location.hash === target) {
    resolve();
    return;
  }
  replacing = replace;
  if (replace) location.replace(target);
  else location.hash = target;
}

/**
 * The back arrow: return to whatever screen we actually came from.
 *
 * Anything the app itself opened sits on top of at least one entry of ours, so
 * the browser's own history is the honest answer, the same move as the phone's
 * back gesture. The fallback is only for a screen that was the entry point (a
 * deep link, a home-screen shortcut, a reload), where there is nothing of ours
 * underneath and stepping back would leave the app.
 */
export function back(fallback = '/catalogue') {
  if (depth > 0) history.back();
  else go(fallback, { replace: true });
}

export const path = () => location.hash.slice(1) || '/catalogue';

function resolve() {
  trackDepth();
  const full = path();
  const [target, queryString] = full.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString || ''));
  for (const entry of routes) {
    const match = entry.test.exec(target);
    if (!match) continue;
    const params = { ...query };
    entry.names.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });
    render(entry, params, full);
    return;
  }
  go('/catalogue', { replace: true });
}

async function render(entry, params, target) {
  if (current && current.teardown) current.teardown();
  // Delegated handlers bind to the screen root, which every screen shares, so
  // the outgoing screen's are dropped before the incoming one binds its own.
  openListenerScope();
  root.setAttribute('data-screen', entry.screen);
  root.innerHTML = '<div class="body"><div class="spinner"></div></div>';
  current = { entry, params };
  onChange(entry, target);
  try {
    const teardown = await entry.render(root, params);
    if (current && current.entry === entry) current.teardown = teardown;
  } catch (error) {
    // A stale, still-in-flight render from a screen the user has already
    // navigated away from can reject after a newer screen is showing. Only
    // paint the error over root if this render is still the active one, or
    // it stomps a perfectly good screen with "That did not load".
    if (current && current.entry === entry) {
      root.innerHTML = '';
      root.append(errorScreen(error));
    }
  }
}

function errorScreen(error) {
  const wrap = document.createElement('div');
  wrap.className = 'body';
  wrap.innerHTML = `
    <div class="emptystate">
      <b>That did not load</b>
      <span></span>
      <button class="bigbtn ghost" style="max-width:220px;margin-top:10px">Try again</button>
    </div>`;
  wrap.querySelector('span').textContent = error.message || String(error);
  wrap.querySelector('button').addEventListener('click', resolve);
  return wrap;
}

/**
 * Work out how deep the entry now showing is, and stamp it so a later
 * back/forward onto it reads the same number back.
 *
 * A hash the browser has seen before comes back with its stamp intact; an
 * unstamped one is a move we have just made, one deeper than the screen we
 * were on unless it replaced it.
 */
function trackDepth() {
  const stamped = history.state && typeof history.state.depth === 'number';
  if (stamped) {
    depth = history.state.depth;
  } else {
    depth = replacing ? Math.max(depth, 0) : depth + 1;
    // Two arguments only: passing a URL of '' would resolve against the
    // document and drop the fragment we are routing on.
    history.replaceState({ ...history.state, depth }, '');
  }
  replacing = false;
}

/** Re-run the active route, after something changed underneath it. */
export const refresh = resolve;
