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
  if (replace) location.replace(target);
  else location.hash = target;
}

export function back(fallback = '/catalogue') {
  if (history.length > 1 && document.referrer !== '') history.back();
  else if (history.state && history.length > 1) history.back();
  else go(fallback, { replace: true });
}

export const path = () => location.hash.slice(1) || '/catalogue';

function resolve() {
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
    root.innerHTML = '';
    root.append(errorScreen(error));
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

/** Re-run the active route, after something changed underneath it. */
export const refresh = resolve;
