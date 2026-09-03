/**
 * The small amount of state that outlives a screen.
 *
 * Two things are genuinely app-wide and everything else is local to a screen:
 *
 *  - **who you are** (the signed-in account, and whether it is a committee one),
 *    because it decides what every screen offers;
 *  - **which site you are at**, because it drives both the catalogue filter and
 *    what the rig assistant will suggest — it is the same question in two
 *    places, so it is answered once, at the top.
 *
 * The site choice is remembered on the device: a member at Cheddar is at
 * Cheddar next time too, and being asked again every visit would be noise.
 *
 * A **trip** the club is packing or out on is a place kit can be, so it sits in
 * the same toggle as the sites. Picking one narrows the catalogue and the rig
 * assistant to that trip's kit; `store.site` is left untouched underneath as
 * the place a member falls back to when the trip is cleared or ends.
 */

const SITE_KEY = 'ubwc.site';
const TRIP_KEY = 'ubwc.trip';

function readTrip() {
  try {
    const raw = localStorage.getItem(TRIP_KEY);
    const trip = raw ? JSON.parse(raw) : null;
    return trip && trip.id ? trip : null;
  } catch {
    return null;
  }
}

const listeners = new Set();

export const store = {
  user: null,
  committee: false,
  sites: [],
  spots: [],
  // display_name -> profile photo, for every place a member's name is shown.
  avatars: {},
  types: [],
  conditions: [],
  boxTypes: [],
  roleLabels: {},
  forms: {},
  required: {},
  typeLabels: {},
  site: localStorage.getItem(SITE_KEY) || 'all',
  // The packing/active trips offered in the location toggle, and the one that
  // is currently selected (a small {id, name, destination, lat, lon}) or null.
  trips: [],
  trip: readTrip(),
  setup: null,
  ready: false,
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit() {
  listeners.forEach((listener) => listener(store));
}

export function applyBootstrap(data) {
  store.user = data.user;
  store.committee = data.committee;
  store.sites = data.sites;
  store.spots = data.spots;
  store.avatars = data.avatars || {};
  store.types = data.types;
  store.conditions = data.conditions;
  store.boxTypes = data.box_types;
  store.roleLabels = data.role_labels;
  store.forms = data.forms;
  store.required = data.required;
  store.typeLabels = data.type_labels;
  store.trips = data.trips || [];
  // A remembered site that has since been renamed away falls back to "all"
  // rather than silently filtering the catalogue down to nothing.
  if (store.site !== 'all' && !data.sites.some((s) => s.name === store.site)) {
    setSite('all');
  }
  // A remembered trip that has since ended (or was never packing/active) drops
  // back to the site underneath rather than scoping everything to nothing.
  if (store.trip && !store.trips.some((t) => t.id === store.trip.id)) {
    setTrip(null);
  }
  store.ready = true;
  emit();
}

export function setSite(name) {
  store.site = name;
  localStorage.setItem(SITE_KEY, name);
  // Picking a real place means leaving the trip.
  store.trip = null;
  localStorage.removeItem(TRIP_KEY);
  emit();
}

/** Focus the whole app on one trip's kit, or clear back to the site. */
export function setTrip(trip) {
  store.trip = trip || null;
  if (trip) {
    localStorage.setItem(TRIP_KEY, JSON.stringify({
      id: trip.id, name: trip.name, destination: trip.destination ?? null,
      lat: trip.lat ?? null, lon: trip.lon ?? null,
    }));
  } else {
    localStorage.removeItem(TRIP_KEY);
  }
  emit();
}

export function setIdentity(user, committee) {
  store.user = user;
  store.committee = Boolean(committee);
  // Keep the avatar map in step so the member's own photo shows next to their
  // past notes and sessions straight away, without waiting for a reload.
  if (user) {
    for (const key of [user.display_name, user.username]) {
      if (key) {
        if (user.image_path) store.avatars[key] = user.image_path;
        else delete store.avatars[key];
      }
    }
  }
  emit();
}

export function setSetup(setup) {
  store.setup = setup;
  emit();
}

export const siteLabel = () => (store.trip ? store.trip.name
  : store.site === 'all' ? 'All locations' : store.site);

/** The spot sentence shown when a member taps a location, if we have one. */
export function spotNote(site, spot) {
  const match = store.spots.find((s) => s.site === site && s.name === spot);
  return match ? match.description : null;
}

/** The spot photo shown in the same popup, if committee has added one. */
export function spotImage(site, spot) {
  const match = store.spots.find((s) => s.site === site && s.name === spot);
  return match ? match.image_path : null;
}

/** Replace the spot list after a committee edit, so popups show it at once. */
export function setSpots(spots) {
  store.spots = spots || [];
  emit();
}

/** A member's profile photo by the name shown on their comment or fault. */
export const avatarFor = (name) => (name && store.avatars[name]) || null;

export const isCommittee = () => store.committee;
