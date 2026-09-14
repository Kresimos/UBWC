/**
 * The chrome that never changes: the tab bar, and the two questions any screen
 * can ask — who are you, and where are you.
 *
 * The tab bar is the app's backbone (misc/spec.md "Platform and global
 * layout"), so it lives outside the router and only ever changes which tab is
 * lit. The Log tab grows a dot when a session is waiting to be written up,
 * which is the one nudge the app makes on its own.
 */
import { html, mount } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { store, setSite, setTrip, setIdentity, setSites, setSpots, subscribe, emit } from '../store.js';
import { chooser, formSheet, confirmSheet, lightbox, toast } from './overlay.js';
import { avatar } from './bits.js';
import { go } from '../router.js';

// Trips sits between Log and Add rather than in the middle: Add is the end of
// the bar because it is the one tab that writes to the inventory, and a trip is
// closer to the club's own record than to filing a new board.
const TABS = [
  { key: 'catalogue', label: 'Catalogue', icon: 'gridIcon', path: '/catalogue' },
  { key: 'rig', label: 'Rig', icon: 'sailNav', path: '/rig' },
  { key: 'log', label: 'Log', icon: 'doc', path: '/log' },
  { key: 'trips', label: 'Trips', icon: 'flag', path: '/trips' },
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
  // Adding writes to the club's ground truth, so it is committee-only for now
  // (misc/spec.md future idea: bring it back for members adding personal kit).
  const tabs = TABS.filter((tab) => tab.key !== 'add' || store.committee);
  mount(document.getElementById('tabbar'), html`
    ${tabs.map((tab) => html`
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
 * The location selector. One answer drives both "what is in the catalogue" and
 * "what will the rig assistant offer", because at the boathouse they are the
 * same question.
 *
 * Below the club's own stores sit the trips it is packing or out on: a trip is
 * a place kit can be, the one place that is not a rack. Picking one scopes the
 * catalogue and the rig picker to that trip's kit and leaves `store.site` as
 * the place to fall back to.
 */
export async function pickSite({ allowAll = true, allowTrips = true } = {}) {
  const rows = [];
  if (allowAll) {
    rows.push({ value: 'all', label: 'All locations', sub: 'Everything the club owns', on: !store.trip && store.site === 'all' });
  }
  store.sites.forEach((site) => rows.push({
    value: site.name,
    label: site.name,
    sub: `${site.n_items} ${site.n_items === 1 ? 'piece' : 'pieces'} of kit`,
    on: !store.trip && store.site === site.name,
  }));

  if (allowTrips) {
    // The list can move on while the app is open (a trip marked active, one
    // ended), so refresh it here rather than trusting the boot-time snapshot.
    try {
      const data = await api.trips();
      store.trips = data.trips
        .filter((trip) => ['packing', 'active'].includes(trip.status))
        .map((trip) => ({
          id: trip.id, name: trip.name, destination: trip.destination,
          lat: trip.lat, lon: trip.lon, status: trip.status,
          n_items: trip.n_items,
        }));
    } catch { /* the boot-time snapshot stands in */ }
    store.trips.forEach((trip) => rows.push({
      value: `trip:${trip.id}`,
      label: trip.name,
      sub: trip.status === 'active'
        ? `On the water${trip.destination ? ` · ${trip.destination}` : ''}`
        : `Packing · ${trip.n_items} ${trip.n_items === 1 ? 'piece' : 'pieces'}`,
      on: Boolean(store.trip && store.trip.id === trip.id),
    }));
  }

  const chosen = await chooser({
    title: 'Where are you?',
    sub: 'This filters the catalogue and keeps the rig assistant to kit that is actually near you.',
    rows,
  });
  if (!chosen) return chosen;
  if (chosen.startsWith('trip:')) {
    const id = Number(chosen.slice(5));
    setTrip(store.trips.find((trip) => trip.id === id) || null);
  } else {
    setSite(chosen);
  }
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
    { value: 'photo', label: store.user.image_path ? 'Change photo' : 'Add a photo',
      sub: 'Shown next to your name on notes and faults' },
    { value: 'name', label: 'Change display name', sub: store.user.display_name || store.user.username },
    { value: 'password', label: 'Change password', sub: 'Signs your other devices out' },
  ];
  if (store.committee) {
    rows.push({ value: 'members', label: 'Members', sub: "Manage who's committee, and members' accounts" });
    rows.push({ value: 'locations', label: 'Locations', sub: 'Every site, its map pin, and the spots kit lives in' });
  }
  rows.push({ value: 'out', label: 'Sign out', sub: 'Browsing carries on working' });

  const choice = await chooser({
    title: store.user.display_name || store.user.username,
    sub: store.committee
      ? `Signed in as ${store.user.username}. Registered as committee.`
      : `Signed in as ${store.user.username}.`,
    rows,
  });

  if (choice === 'profile') { go('/me'); return store.user; }
  if (choice === 'photo') return changeAvatar();
  if (choice === 'name') return changeName();
  if (choice === 'password') return changePassword();
  if (choice === 'members') return manageMembers();
  if (choice === 'locations') return manageLocations();
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
    sub,
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
    fields: [
      { name: 'username', label: 'Username', required: true, autocomplete: 'username',
        hint: 'Letters, numbers, dots or dashes.' },
      { name: 'display_name', label: 'Display name', autocomplete: 'name',
        hint: 'Optional. Defaults to your username.' },
      { name: 'password', label: 'Password', type: 'password', required: true,
        autocomplete: 'new-password' },
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

async function changeAvatar() {
  const result = await formSheet({
    title: 'Your photo',
    sub: 'Stands in for your initials on the app bar and next to your name on notes and faults.',
    fields: [{ name: 'image_path', label: 'Photo', type: 'photo', aspect: 1,
               value: store.user.image_path || null,
               hint: 'A clear headshot works best. Remove it to go back to initials.' }],
    submitLabel: 'Save',
    onSubmit: (values) => api.setAvatar(values.image_path || null),
  });
  if (!result) return store.user;
  setIdentity(result.user, result.committee);
  toast(result.user.image_path ? 'Photo saved.' : 'Photo removed.');
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
    sub: 'You will be signed out on other devices.',
    fields: [
      { name: 'current', label: 'Current password', type: 'password', required: true,
        autocomplete: 'current-password' },
      { name: 'password', label: 'New password', type: 'password', required: true,
        autocomplete: 'new-password' },
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
 * The committee's member list: who can sign in, who is committee, striking
 * out somebody's ratings when they have been spammed to move the numbers,
 * and (the one destructive action here) deleting a fake or test account
 * outright. Everything except delete is reversible.
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
      avatar: avatar(member.display_name || member.username, member.image_path),
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
      { value: 'delete', label: 'Delete this account', sub: 'For a fake or test account. Cannot be undone.' },
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
                   autocomplete: 'new-password' }],
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
    } else if (choice === 'delete') {
      const sure = await confirmSheet({
        title: `Delete ${name}?`,
        sub: 'Their account, ratings, logged sessions, trip requests and favourites are all gone for good. '
          + 'Only use this for a fake or test account, not a real member’s history.',
        confirmLabel: 'Delete it',
      });
      if (sure) {
        await api.deleteMember(member.id);
        toast(`${name} deleted.`);
      }
    }
  } catch (error) {
    toast(error.message, true);
  }
  return store.user;
}

/**
 * The committee's location list: every site the club stores kit at, gathered
 * with the same two things a member otherwise only finds one item at a time
 * (an item page's spot pin) - the map pin used for the forecast strip, and
 * the spots kit lives in, each with its photo and note.
 *
 * Every level below here loops back to its own sheet once a sub-action
 * finishes, and only unwinds a level when that level's own sheet is
 * dismissed - so closing a section steps back one sheet at a time (list ->
 * location -> pin/spot) rather than dropping the member straight out of the
 * whole flow, the way a single dead-end chooser would.
 */
async function manageLocations() {
  for (;;) {
    const chosen = await chooser({
      title: 'Locations',
      sub: 'Tap one for its map pin and the spots kit lives in.',
      rows: store.sites.map((site) => ({
        value: site.name,
        label: site.name,
        sub: [
          `${site.n_items} ${site.n_items === 1 ? 'piece' : 'pieces'} of kit`,
          site.lat != null ? 'pinned' : 'no map pin',
        ].join(' · '),
      })),
    });
    if (!chosen) return store.user;
    await locationDetail(chosen);
  }
}

async function locationDetail(site) {
  for (;;) {
    const info = store.sites.find((s) => s.name === site);
    if (!info) return;   // renamed or deleted out from under us: back to the list
    const spots = store.spots.filter((s) => s.site === site);

    const rows = [
      { value: 'pin', label: 'Map pin', sub: info.lat != null
        ? `${info.lat.toFixed(4)}, ${info.lon.toFixed(4)} · tap to open in Maps`
        : `No map pin recorded${store.committee ? ' · tap to add one' : ''}` },
    ];
    if (store.committee) {
      rows.push({ value: 'rename', label: 'Rename this location',
                  sub: 'Updates every piece of kit and spot filed under it' });
    }
    if (spots.length || store.committee) {
      rows.push({ heading: 'Spots' });
      rows.push(...spots.map((spot) => ({
        value: `spot:${spot.name}`,
        label: spot.name,
        sub: spot.description || 'No description recorded yet.',
        avatar: avatar(spot.name, spot.image_path),
        indent: true,
      })));
      if (store.committee) {
        rows.push({ value: 'addspot', label: 'Add a spot',
                    sub: 'A rack, shelf or area within this location',
                    avatar: icon('plus'), indent: true });
      }
    }
    if (store.committee && info.n_items === 0) {
      rows.push({ value: 'delete', label: 'Delete this location',
                  sub: 'No kit is stored here. This cannot be undone.' });
    }

    const choice = await chooser({
      title: site,
      sub: `${info.n_items} ${info.n_items === 1 ? 'piece' : 'pieces'} of kit stored here.`,
      rows,
    });
    if (!choice) return;   // back to the location list

    if (choice === 'pin') { await sitePin(info); continue; }
    if (choice === 'rename') {
      const renamed = await renameLocation(info);
      if (renamed) site = renamed;
      continue;
    }
    if (choice === 'addspot') { await editSpotSheet(site, ''); continue; }
    if (choice === 'delete') { if (await deleteLocation(info)) return; continue; }
    if (choice.startsWith('spot:')) { await spotDetail(site, choice.slice(5)); continue; }
  }
}

/** The map-pin row: open it, change it, or (committee) clear it. Every path
 *  returns to the location it was opened from - there is nothing under a pin
 *  worth its own back-step. */
async function sitePin(info) {
  if (info.lat == null || info.lon == null) {
    if (!store.committee) {
      toast('No map pin set for this location yet.');
      return;
    }
    return editSitePin(info);
  }
  const choice = await chooser({
    title: 'Map pin',
    sub: `${info.name} · ${info.lat.toFixed(4)}, ${info.lon.toFixed(4)}`,
    rows: [
      { value: 'open', label: 'Open in Maps', sub: 'Opens the pin in a new tab' },
      ...(store.committee ? [
        { value: 'edit', label: 'Change the pin', sub: 'Paste a new latitude and longitude' },
        { value: 'clear', label: 'Remove the pin', sub: 'No forecast will show here until it is set again' },
      ] : []),
    ],
  });
  if (choice === 'open') {
    window.open(`https://www.google.com/maps?q=${info.lat},${info.lon}`, '_blank', 'noopener');
  } else if (choice === 'edit') {
    return editSitePin(info);
  } else if (choice === 'clear') {
    const sure = await confirmSheet({
      title: `Remove the pin for ${info.name}?`,
      sub: 'No forecast will show for trips or logbook entries here until a pin is set again.',
      confirmLabel: 'Remove it',
    });
    if (sure) {
      try {
        const data = await api.setSiteCoords(info.name, null, null);
        setSites(data.sites);
        toast('Pin removed.');
      } catch (error) {
        toast(error.message, true);
      }
    }
  }
}

async function editSitePin(info) {
  const values = await formSheet({
    title: `Pin ${info.name}`,
    sub: 'Paste coordinates copied from Maps. Used for the forecast strip on trips and logbook entries here.',
    fields: [
      { name: 'lat', label: 'Latitude', value: info.lat != null ? String(info.lat) : '',
        inputmode: 'decimal', placeholder: '51.4231' },
      { name: 'lon', label: 'Longitude', value: info.lon != null ? String(info.lon) : '',
        inputmode: 'decimal', placeholder: '-2.7702' },
    ],
    submitLabel: 'Save the pin',
    onSubmit: async (values) => {
      const lat = parseFloat(values.lat);
      const lon = parseFloat(values.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error('Enter a latitude and a longitude as numbers.');
      }
      const data = await api.setSiteCoords(info.name, lat, lon);
      setSites(data.sites);
      return data;
    },
  });
  if (values) toast('Pin saved.');
}

/** Renames the site everywhere it is stored by name. Returns the new name so
 *  the caller can keep following the (renamed) location, or null if the
 *  member backed out. */
async function renameLocation(info) {
  const newName = await formSheet({
    title: `Rename ${info.name}`,
    sub: 'Updates every piece of kit, spot and past session logged at this location.',
    fields: [{ name: 'name', label: 'Location name', required: true, value: info.name }],
    submitLabel: 'Rename',
    onSubmit: async (values) => {
      const trimmed = values.name.trim();
      if (trimmed !== info.name) {
        const data = await api.renameSite(info.name, trimmed);
        setSites(data.sites);
        setSpots(data.spots);
        if (store.site === info.name) setSite(trimmed);
      }
      return trimmed;
    },
  });
  if (!newName) return null;
  toast('Location renamed.');
  return newName;
}

/** Deletes an empty location. Returns whether it actually went, so the
 *  caller knows whether to keep showing a location that is no longer there. */
async function deleteLocation(info) {
  const sure = await confirmSheet({
    title: `Delete ${info.name}?`,
    sub: 'No kit is stored here, so this only removes the location and its spots. This cannot be undone.',
    confirmLabel: 'Delete it',
  });
  if (!sure) return false;
  try {
    const data = await api.deleteSite(info.name);
    setSites(data.sites);
    if (store.site === info.name) setSite('all');
    toast(`${info.name} deleted.`);
    return true;
  } catch (error) {
    toast(error.message, true);
    return false;
  }
}

/** The spot popup, the same shape as the one an item page opens off its own
 *  location pin, reached here from the location's own spot list instead. */
async function spotDetail(site, name) {
  const spot = store.spots.find((s) => s.site === site && s.name === name);
  const canEdit = store.committee;
  await lightbox({
    title: name,
    image: spot ? spot.image_path : null,
    sub: (spot && spot.description) || (canEdit
      ? 'No description or photo yet. Add one so members can find it and put kit back.'
      : 'No description recorded for this spot yet.'),
    action: canEdit ? { label: 'Edit spot', onClick: () => editSpotSheet(site, name) } : null,
  });
}

async function editSpotSheet(site, name) {
  const existing = name ? store.spots.find((s) => s.site === site && s.name === name) : null;
  const values = await formSheet({
    title: name ? `${name} · ${site}` : `New spot · ${site}`,
    sub: 'What the club sees when anyone taps this spot. Committee only.',
    fields: [
      ...(name ? [] : [{ name: 'name', label: 'Spot name', required: true,
                         placeholder: 'Wooden rack' }]),
      { name: 'description', label: 'Where it is', type: 'textarea', rows: 2,
        value: (existing && existing.description) || '',
        placeholder: 'Second bay in from the door, top rack.' },
      { name: 'image_path', label: 'Photo', type: 'photo', aspect: 4 / 3,
        value: (existing && existing.image_path) || null,
        hint: 'A shot of the rack, so kit goes back where it came from.' },
    ],
    submitLabel: name ? 'Save the spot' : 'Add the spot',
  });
  if (!values) return;
  const spotName = name || values.name;
  const data = await api.upsertSpot(site, spotName, {
    description: values.description || null,
    image_path: values.image_path || null,
  });
  setSpots(data.spots);
  toast(name ? 'Spot updated.' : 'Spot added.');
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
