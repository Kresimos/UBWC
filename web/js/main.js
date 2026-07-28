/**
 * Boot: load what the shell needs, wire the tab bar, register the routes.
 *
 * The route table is the whole map of the app. Each tab is a screen, and the
 * screens a tab drills into (an item, the rig setup, the log composer) hang off
 * it. `tab` says which tab lights up while a screen is open, so a member deep
 * in an item page still sees they are in the Catalogue.
 */
import { api } from './api.js';
import { applyBootstrap, store } from './store.js';
import { route, start } from './router.js';
import { initChrome, setActiveTab } from './ui/chrome.js';

import * as catalogue from './screens/catalogue.js';
import * as item from './screens/item.js';
import * as build from './screens/build.js';
import * as yourrig from './screens/yourrig.js';
import * as derig from './screens/derig.js';
import * as log from './screens/log.js';
import * as compose from './screens/compose.js';
import * as add from './screens/add.js';
import * as form from './screens/form.js';

const ROUTES = [
  { path: '/catalogue', screen: 'catalogue', tab: 'catalogue', render: catalogue.render },
  { path: '/item/:id', screen: 'item', tab: 'catalogue', render: item.render },
  { path: '/edit/:id', screen: 'form', tab: 'catalogue', render: form.render },

  { path: '/rig', screen: 'build', tab: 'rig', render: build.render },
  { path: '/setup', screen: 'yourrig', tab: 'rig', render: yourrig.render },
  { path: '/derig', screen: 'derig', tab: 'rig', render: derig.render },

  { path: '/log', screen: 'log', tab: 'log', render: log.render },
  { path: '/compose', screen: 'compose', tab: 'log', render: compose.render },

  { path: '/add', screen: 'add', tab: 'add', render: add.render },
  { path: '/new/:type', screen: 'form', tab: 'add', render: form.render },
];

/**
 * Refuse pinch-zoom.
 *
 * `user-scalable=no` in the viewport tag handles Android. iOS Safari has
 * ignored it since iOS 10 and instead fires its own non-standard `gesture*`
 * events for a pinch, so those are cancelled here, along with any touchmove
 * carrying a second finger. Double-tap zoom is not handled here — it is
 * `touch-action: manipulation` in tokens.css, because doing it in JS means
 * swallowing a second quick tap, and the size stepper is meant to be tapped
 * quickly.
 */
function refusePinch() {
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
    document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
  });
  document.addEventListener('touchmove', (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
  // iOS Safari only bothers computing :active at all, anywhere on the page,
  // once something has a touchstart listener — otherwise every button's press
  // feedback in tokens.css silently never shows on an iPhone. The listener
  // itself does nothing; its only job is to exist.
  document.body.addEventListener('touchstart', () => {}, { passive: true });
}

async function boot() {
  refusePinch();
  const appRoot = document.getElementById('app');
  try {
    applyBootstrap(await api.bootstrap());
    if (store.user) {
      // Pull the live setup once at boot so the Log tab's badge is right from
      // the first paint, before any tab is opened.
      try { store.setup = (await api.setup()).setup; } catch { /* browsing is fine */ }
    }
  } catch (error) {
    appRoot.innerHTML = `
      <div class="body"><div class="emptystate">
        <b>Could not reach the club server</b><span></span>
      </div></div>`;
    appRoot.querySelector('span').textContent = error.message;
    return;
  }

  initChrome();
  ROUTES.forEach((entry) => route(entry.path, entry));
  start(appRoot, (entry) => setActiveTab(entry.tab));
}

boot();
