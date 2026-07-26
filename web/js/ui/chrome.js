/**
 * The chrome that never changes: the tab bar, and the two questions any screen
 * can ask — who are you, and where are you.
 *
 * The tab bar is the app's backbone (misc/spec.md "Platform and global
 * layout"), so it lives outside the router and only ever changes which tab is
 * lit. The Log tab grows a dot when a session is waiting to be written up,
 * which is the one nudge the app makes on its own.
 */
import { html, mount, initial } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { store, setSite, setIdentity, subscribe, emit } from '../store.js';
import { chooser, formSheet, confirmSheet, toast } from './overlay.js';
import { go } from '../router.js';

const TABS = [
  { key: 'catalogue', label: 'Catalogue', icon: 'gridIcon', path: '/catalogue' },
  { key: 'rig', label: 'Rig', icon: 'sailNav', path: '/rig' },
  { key: 'log', label: 'Log', icon: 'doc', path: '/log' },
  { key: 'add', label: 'Add', icon: 'plusCircle', path: '/add' },
];

let activeTab = 'catalogue';

export function initChrome() {
  const bar = document.getElementById('tabbar');
  bar.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button) go(TABS.find((t) => t.key === button.getAttribute('data-tab')).path);
  });
  subscribe(paintTabs);
  paintTabs();
  startClock();
}

export function setActiveTab(key) {
  activeTab = key;
  paintTabs();
}

function paintTabs() {
  // A de-rigged but unlogged setup is exactly what the Log tab is for, so it
  // is the only thing that earns a badge.
  const waiting = store.setup && store.setup.status === 'derigged';
  mount(document.getElementById('tabbar'), html`
    ${TABS.map((tab) => html`
      <button class="tab ${tab.key === activeTab ? 'on' : ''}" data-tab="${tab.key}"
              aria-current="${tab.key === activeTab ? 'page' : 'false'}">
        ${icon(tab.icon)}${tab.label}
        ${tab.key === 'log' && waiting ? html`<span class="dotmark"></span>` : ''}
      </button>`)}
  `);
}

/** The fake status-bar clock only exists in the desktop handset frame. */
function startClock() {
  const node = document.querySelector('[data-clock]');
  const tick = () => {
    node.textContent = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit',
    });
  };
  tick();
  setInterval(tick, 30000);
}

/**
 * The site selector. One answer drives both "what is in the catalogue" and
 * "what will the rig assistant offer", because at the boathouse they are the
 * same question.
 */
export async function pickSite({ allowAll = true } = {}) {
  const rows = [];
  if (allowAll) {
    rows.push({ value: 'all', label: 'All locations', sub: 'Everything the club owns', on: store.site === 'all' });
  }
  store.sites.forEach((site) => rows.push({
    value: site.name,
    label: site.name,
    sub: `${site.n_items} ${site.n_items === 1 ? 'piece' : 'pieces'} of kit`,
    on: store.site === site.name,
  }));

  const chosen = await chooser({
    title: 'Where are you?',
    sub: 'This filters the catalogue and keeps the rig assistant to kit that is actually near you.',
    rows,
  });
  if (chosen) setSite(chosen);
  return chosen;
}

/**
 * Signing in is picking your name — no password. The shared committee PIN is
 * offered separately, because that is the real gate.
 */
export async function openIdentity() {
  if (!store.user) return pickName();

  const rows = [
    { value: 'switch', label: 'Switch member', sub: 'Pick a different name' },
    store.committee
      ? { value: 'lock', label: 'Lock committee actions', sub: 'Moving, deleting and clearing faults', on: true }
      : { value: 'unlock', label: 'Unlock committee actions', sub: 'Needs the shared PIN' },
    { value: 'out', label: 'Sign out', sub: 'Browsing carries on working' },
  ];

  const choice = await chooser({
    title: store.user.display_name || store.user.username,
    sub: store.committee
      ? 'Committee actions are unlocked on this device.'
      : 'Signed in for attribution. Committee actions need the PIN.',
    rows,
  });

  if (choice === 'switch') return pickName();
  if (choice === 'out') {
    const data = await api.logout();
    setIdentity(data.user, data.committee);
    toast('Signed out.');
    return null;
  }
  if (choice === 'lock') {
    // Re-picking the same name is what drops the committee flag.
    const data = await api.login(store.user.id);
    setIdentity(data.user, data.committee);
    toast('Committee actions locked.');
    return store.user;
  }
  if (choice === 'unlock') return unlockCommittee();
  return store.user;
}

export async function pickName() {
  const chosen = await chooser({
    title: 'Who are you?',
    sub: 'Pick your name from the roster. No password — this is for attribution, so the club knows who added, rated or reported what.',
    rows: store.roster.map((member) => ({
      value: String(member.id),
      label: member.display_name || member.username,
      sub: member.is_admin ? 'Committee' : 'Member',
      avatar: initial(member.display_name || member.username),
      on: store.user && store.user.id === member.id,
    })),
  });
  if (!chosen) return null;
  const data = await api.login(Number(chosen));
  setIdentity(data.user, data.committee);
  toast(`Signed in as ${data.user.display_name}.`);
  return data.user;
}

export async function unlockCommittee() {
  const values = await formSheet({
    title: 'Committee PIN',
    sub: 'Moving kit, deleting kit and clearing faults are committee actions.',
    fields: [{ name: 'pin', label: 'Shared PIN', type: 'password', required: true, inputmode: 'numeric' }],
    submitLabel: 'Unlock',
  });
  if (!values) return false;
  try {
    const data = await api.unlockCommittee(values.pin);
    setIdentity(data.user, data.committee);
    toast('Committee actions unlocked.');
    return true;
  } catch (error) {
    toast(error.message, true);
    return false;
  }
}

/**
 * Guard for anything that needs a name. Returns the member, or null after
 * offering the name-pick — so a member never hits a dead "you must log in".
 */
export async function needUser(reason) {
  if (store.user) return store.user;
  const proceed = await confirmSheet({
    title: 'Pick your name first',
    sub: reason,
    confirmLabel: 'Pick my name',
  });
  if (!proceed) return null;
  return pickName();
}

export async function needCommittee(reason) {
  const user = await needUser(reason);
  if (!user) return false;
  if (store.committee) return true;
  return unlockCommittee();
}

/** Load the member's live setup, so the Rig and Log tabs agree about it. */
export async function refreshSetup() {
  if (!store.user) {
    store.setup = null;
    emit();
    return null;
  }
  const data = await api.setup();
  store.setup = data.setup;
  emit();
  return data.setup;
}
