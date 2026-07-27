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

async function boot() {
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
