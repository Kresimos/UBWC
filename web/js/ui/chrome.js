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
 * The account menu, or the sign-in sheet when there is nobody signed in.
 *
 * Committee is a property of the account now, not something unlocked on a
 * device, so there is nothing here to lock or unlock: a committee member is
 * committee wherever they sign in, and everybody else is not.
 */
export async function openIdentity() {
  if (!store.user) return signIn();

  const rows = [
    { value: 'profile', label: 'Your sailing', sub: 'The sizes you rig, and the kit you keep going back to' },
    { value: 'name', label: 'Change display name', sub: store.user.display_name || store.user.username },
    { value: 'password', label: 'Change password', sub: 'Signs your other devices out' },
  ];
  if (store.committee) {
    rows.push({ value: 'members', label: 'Members', sub: 'Who is committee, and rating clean-up' });
  }
  rows.push({ value: 'out', label: 'Sign out', sub: 'Browsing carries on working' });

  const choice = await chooser({
    title: store.user.display_name || store.user.username,
    sub: store.committee
      ? `Signed in as ${store.user.username}. Committee: you can move, delete and clear faults.`
      : `Signed in as ${store.user.username}.`,
    rows,
  });

  if (choice === 'profile') { go('/me'); return store.user; }
  if (choice === 'name') return changeName();
  if (choice === 'password') return changePassword();
  if (choice === 'members') return manageMembers();
  if (choice === 'out') {
    const data = await api.logout();
    setIdentity(data.user, data.committee);
    toast('Signed out.');
    return null;
  }
  return store.user;
}

/** Sign in, with a way across to signing up. */
export async function signIn({ sub } = {}) {
  const result = await formSheet({
    title: 'Sign in',
    sub: sub || 'Your account is what keeps your ratings, rigs and logbook yours.',
    fields: [
      { name: 'username', label: 'Username', required: true, autocomplete: 'username' },
      { name: 'password', label: 'Password', type: 'password', required: true,
        autocomplete: 'current-password' },
    ],
    submitLabel: 'Sign in',
    alt: 'Create an account',
    onSubmit: (values) => api.login(values.username, values.password),
  });
  if (!result) return null;
  if (result.alt) return signUp();
  setIdentity(result.user, result.committee);
  toast(`Signed in as ${result.user.display_name}.`);
  return result.user;
}

export async function signUp() {
  const result = await formSheet({
    title: 'Create an account',
    sub: 'Anyone in the club can. Your username is how you sign in; your display name is what the club sees.',
    fields: [
      { name: 'username', label: 'Username', required: true, autocomplete: 'username',
        hint: 'Letters, numbers, dots or dashes.' },
      { name: 'display_name', label: 'Display name', autocomplete: 'name',
        hint: 'Optional. Defaults to your username.' },
      { name: 'password', label: 'Password', type: 'password', required: true,
        autocomplete: 'new-password', hint: 'At least 8 characters.' },
    ],
    submitLabel: 'Create account',
    alt: 'I already have one',
    onSubmit: (values) => api.signup(values.username, values.password, values.display_name),
  });
  if (!result) return null;
  if (result.alt) return signIn();
  setIdentity(result.user, result.committee);
  toast(`Welcome, ${result.user.display_name}.`);
  return result.user;
}

async function changeName() {
  const result = await formSheet({
    title: 'Change display name',
    sub: 'What the club sees on your ratings, faults and logbook. Your username does not change.',
    fields: [{ name: 'display_name', label: 'Display name', required: true,
               value: store.user.display_name || '' }],
    submitLabel: 'Save',
    onSubmit: (values) => api.changeName(values.display_name),
  });
  if (!result) return store.user;
  setIdentity(result.user, result.committee);
  toast('Name changed.');
  return result.user;
}

async function changePassword() {
  const result = await formSheet({
    title: 'Change password',
    sub: 'Every other device signed in as you is signed out. This one stays.',
    fields: [
      { name: 'current', label: 'Current password', type: 'password', required: true,
        autocomplete: 'current-password' },
      { name: 'password', label: 'New password', type: 'password', required: true,
        autocomplete: 'new-password', hint: 'At least 8 characters.' },
    ],
    submitLabel: 'Change it',
    onSubmit: (values) => api.changePassword(values.current, values.password),
  });
  if (!result) return store.user;
  setIdentity(result.user, result.committee);
  toast('Password changed.');
  return result.user;
}

/**
 * The committee's member list: who can sign in, who is committee, and the one
 * moderation tool the club needs: striking out somebody's ratings when they
 * have been spammed to move the numbers. Nothing here deletes anything.
 */
async function manageMembers() {
  let members;
  try {
    ({ members } = await api.members());
  } catch (error) {
    toast(error.message, true);
    return store.user;
  }

  const chosen = await chooser({
    title: 'Members',
    sub: 'Committee can hand out committee, reset a password, and clean up ratings.',
    rows: members.map((member) => ({
      value: String(member.id),
      label: member.display_name || member.username,
      sub: [
        member.is_admin ? 'Committee' : 'Member',
        member.has_password ? null : 'no password set',
        `${member.n_sessions} sessions`,
        `${member.n_ratings} ratings`,
      ].filter(Boolean).join(' · '),
      avatar: initial(member.display_name || member.username),
      on: member.is_admin,
    })),
  });
  if (!chosen) return store.user;
  return memberActions(members.find((m) => String(m.id) === chosen));
}

async function memberActions(member) {
  const name = member.display_name || member.username;
  const choice = await chooser({
    title: name,
    sub: `${member.username} · ${member.n_ratings} live ratings`,
    rows: [
      member.is_admin
        ? { value: 'demote', label: 'Stand down from committee', sub: 'Back to an ordinary member' }
        : { value: 'promote', label: 'Make committee', sub: 'Moving, deleting and clearing faults' },
      { value: 'password', label: 'Set a password', sub: 'For a forgotten one, or to claim an old roster name' },
      { value: 'void', label: 'Strike out their ratings', sub: 'Stops them counting. Reversible.' },
      { value: 'restore', label: 'Put struck-out ratings back', sub: 'Undoes the above' },
    ],
  });

  try {
    if (choice === 'promote' || choice === 'demote') {
      await api.setMemberAdmin(member.id, choice === 'promote');
      toast(choice === 'promote' ? `${name} is committee.` : `${name} stood down.`);
    } else if (choice === 'password') {
      const done = await formSheet({
        title: `Set a password for ${name}`,
        sub: 'Tell them what it is, and to change it once they are in. Signs them out everywhere.',
        fields: [{ name: 'password', label: 'New password', type: 'password', required: true,
                   autocomplete: 'new-password', hint: 'At least 8 characters.' }],
        submitLabel: 'Set it',
        onSubmit: (values) => api.setMemberPassword(member.id, values.password),
      });
      if (done) toast(`Password set for ${name}.`);
    } else if (choice === 'void') {
      const sure = await confirmSheet({
        title: `Strike out ${name}'s ratings?`,
        sub: 'Their ratings stop counting toward every star in the app. Nothing is deleted and you can put them back.',
        confirmLabel: 'Strike them out',
      });
      if (sure) {
        const { voided } = await api.voidMemberRatings(member.id);
        toast(`${voided} rating${voided === 1 ? '' : 's'} struck out.`);
      }
    } else if (choice === 'restore') {
      const { restored } = await api.voidMemberRatings(member.id, true);
      toast(`${restored} rating${restored === 1 ? '' : 's'} back in.`);
    }
  } catch (error) {
    toast(error.message, true);
  }
  return store.user;
}

/**
 * Guard for anything that needs an account. Returns the member, or null after
 * offering the sign-in sheet, so a member never hits a dead "you must log in".
 */
export async function needUser(reason) {
  if (store.user) return store.user;
  const proceed = await confirmSheet({
    title: 'Sign in first',
    sub: reason,
    confirmLabel: 'Sign in',
  });
  if (!proceed) return null;
  return signIn({ sub: reason });
}

/**
 * Committee is now who you are, not a PIN you type, so this can only report
 * the answer: either the signed-in account is committee or the job needs
 * somebody who is.
 */
export async function needCommittee(reason) {
  const user = await needUser(reason);
  if (!user) return false;
  if (store.committee) return true;
  toast('That one is committee only. Ask a committee member.', true);
  return false;
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
