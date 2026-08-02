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
 */

const SITE_KEY = 'ubwc.site';

const listeners = new Set();

export const store = {
  user: null,
  committee: false,
  sites: [],
  spots: [],
  types: [],
  conditions: [],
  boxTypes: [],
  roleLabels: {},
  forms: {},
  required: {},
  typeLabels: {},
  site: localStorage.getItem(SITE_KEY) || 'all',
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
  store.types = data.types;
  store.conditions = data.conditions;
  store.boxTypes = data.box_types;
  store.roleLabels = data.role_labels;
  store.forms = data.forms;
  store.required = data.required;
  store.typeLabels = data.type_labels;
  // A remembered site that has since been renamed away falls back to "all"
  // rather than silently filtering the catalogue down to nothing.
  if (store.site !== 'all' && !data.sites.some((s) => s.name === store.site)) {
    setSite('all');
  }
  store.ready = true;
  emit();
}

export function setSite(name) {
  store.site = name;
  localStorage.setItem(SITE_KEY, name);
  emit();
}

export function setIdentity(user, committee) {
  store.user = user;
  store.committee = Boolean(committee);
  emit();
}

export function setSetup(setup) {
  store.setup = setup;
  emit();
}

export const siteLabel = () => (store.site === 'all' ? 'All locations' : store.site);

/** The spot sentence shown when a member taps a location, if we have one. */
export function spotNote(site, spot) {
  const match = store.spots.find((s) => s.site === site && s.name === spot);
  return match ? match.description : null;
}

export const isCommittee = () => store.committee;
