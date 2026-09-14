/**
 * The one place that talks to the server.
 *
 * Every call returns parsed JSON or throws an Error carrying the server's own
 * sentence, which the screens show verbatim — the API already words its
 * refusals for a member ("Sign in first", "That username and password do not
 * match"), so there is nothing for the browser to re-phrase.
 */

async function request(method, path, body) {
  const options = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error('No connection to the club server.');
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error((data && data.error) || `Something went wrong (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

/**
 * Photo upload. The one call that does not send JSON: the file goes up as
 * multipart form data, and the server hands back { image_path } — a path to
 * drop straight into an <img src> or the image_path field of whatever is being
 * saved next. The browser has already downscaled it (see ui/photofield.js);
 * the server resizes again and is the authority.
 */
async function uploadPhoto(file) {
  const form = new FormData();
  form.append('file', file);
  let response;
  try {
    response = await fetch('/api/uploads', {
      method: 'POST', body: form, credentials: 'same-origin',
    });
  } catch {
    throw new Error('No connection to the club server.');
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    throw new Error((data && data.error) || `Could not upload that photo (${response.status}).`);
  }
  return data.image_path;
}

const get = (path, params) => {
  const query = params
    ? '?' + new URLSearchParams(
        Object.entries(params).filter(([, v]) => v != null && v !== '')
      ).toString()
    : '';
  return request('GET', path + query);
};

export const api = {
  bootstrap: () => get('/api/bootstrap'),

  signup: (username, password, displayName) =>
    request('POST', '/api/signup', { username, password, display_name: displayName }),
  login: (username, password) => request('POST', '/api/login', { username, password }),
  logout: () => request('POST', '/api/logout'),
  me: () => get('/api/me'),
  changePassword: (current, password) =>
    request('POST', '/api/account/password', { current, password }),
  changeName: (displayName) =>
    request('POST', '/api/account/name', { display_name: displayName }),
  uploadPhoto,
  setAvatar: (imagePath) =>
    request('POST', '/api/account/photo', { image_path: imagePath }),

  members: () => get('/api/members'),
  setMemberAdmin: (id, isAdmin) =>
    request('POST', `/api/members/${id}/admin`, { is_admin: isAdmin }),
  setMemberPassword: (id, password) =>
    request('POST', `/api/members/${id}/password`, { password }),
  voidMemberRatings: (id, restore = false) =>
    request('POST', `/api/members/${id}/ratings/void`, { restore }),
  deleteMember: (id) => request('DELETE', `/api/members/${id}`),

  items: (filters) => get('/api/items', filters),
  item: (id) => get(`/api/items/${id}`),
  createItem: (payload) => request('POST', '/api/items', payload),
  updateItem: (id, payload) => request('PUT', `/api/items/${id}`, payload),
  deleteItem: (id) => request('DELETE', `/api/items/${id}`),
  archiveItem: (id, reason) => request('POST', `/api/items/${id}/archive`, { reason }),
  unarchiveItem: (id) => request('POST', `/api/items/${id}/unarchive`, {}),
  moveItems: (itemIds, site, spot) =>
    request('POST', '/api/items/move', { item_ids: itemIds, site, spot }),
  // Committee: set the note and photo for one spot. Returns the whole spot
  // list so the store can refresh what the spot popup shows.
  upsertSpot: (site, name, fields) =>
    request('POST', '/api/spots', { site, name, ...fields }),
  // Committee: set (or clear, with null/null) a location's map pin. Both
  // return the whole site list so the store can refresh at once.
  setSiteCoords: (name, lat, lon) =>
    request('POST', '/api/sites/coords', { name, lat, lon }),
  renameSite: (name, newName) =>
    request('POST', '/api/sites/rename', { name, new_name: newName }),
  deleteSite: (name) => request('POST', '/api/sites/delete', { name }),

  vote: (id, value) => request('POST', `/api/items/${id}/vote`, { vote: value }),
  favourite: (id, on) => request('POST', `/api/items/${id}/favourite`, { on }),
  comment: (id, body, kind) => request('POST', `/api/items/${id}/comments`, { body, kind }),
  reportFault: (id, fault) => request('POST', `/api/items/${id}/faults`, fault),
  reportFix: (faultId, body, imagePath) =>
    request('POST', `/api/faults/${faultId}/fix`, { body, image_path: imagePath || null }),
  clearFault: (faultId) => request('POST', `/api/faults/${faultId}/clear`, {}),

  // `trip` narrows the rig kit to one trip's inventory (its away flag ignored);
  // pass it instead of `site`, not as well.
  rigKit: (site, trip) => get('/api/rig/kit', { site, trip }),
  rigSuggest: (site) => get('/api/rig/suggest', { site }),
  profile: (site) => get('/api/profile', { site }),
  setup: () => get('/api/setup'),
  saveSetup: (site, pieces, tripId) =>
    request('POST', '/api/setup', { site, pieces, trip_id: tripId || null }),
  derig: (setupId) => request('POST', `/api/setup/${setupId}/derig`, {}),
  binSetup: (setupId) => request('POST', `/api/setup/${setupId}/bin`, {}),

  tripKit: () => get('/api/trips/kit'),
  trips: () => get('/api/trips'),
  trip: (id) => get(`/api/trips/${id}`),
  tripForecast: (id) => get(`/api/trips/${id}/forecast`),
  geocode: (q) => get('/api/geocode', { q }),
  createTrip: (payload) => request('POST', '/api/trips', payload),
  editTrip: (id, fields) => request('POST', `/api/trips/${id}/edit`, fields),
  // Replace is what the packing wizard saves; add and remove are what the
  // picker sheet and a long-press do, so one open sheet cannot overwrite a
  // list somebody else added to while it was open.
  setTripItems: (id, items) => request('POST', `/api/trips/${id}/items`, { items }),
  addTripItems: (id, items) => request('POST', `/api/trips/${id}/items/add`, { items }),
  removeTripItem: (id, itemId) =>
    request('POST', `/api/trips/${id}/items/remove`, { item_id: itemId }),
  // The Confirm screen's Continue: fix the chosen kit, drop the requests for
  // anything the kit sec did not take through.
  finaliseTripKit: (id, items) => request('POST', `/api/trips/${id}/finalise`, { items }),
  // The kit sec clearing one piece off the wishlist before Confirm.
  dropRequest: (id, itemId) =>
    request('POST', `/api/trips/${id}/request/drop`, { item_id: itemId }),
  setTripStage: (id, status) => request('POST', `/api/trips/${id}/stage`, { status }),
  tripPacked: (id, itemId, on) =>
    request('POST', `/api/trips/${id}/packed`, { item_id: itemId, on }),
  // Ending a trip is one act: every piece on the list goes back to being
  // available at the rack it never left. There is no per-piece return tick.
  closeTrip: (id, payload) => request('POST', `/api/trips/${id}/close`, payload || {}),
  tripRequest: (id, itemId, on) =>
    request('POST', `/api/trips/${id}/request`, { item_id: itemId, on }),

  sessions: (scope) => get('/api/sessions', { scope }),
  logSession: (payload) => request('POST', '/api/sessions', payload),
  // `coords` is a trip's own pin ({lat, lon}), used when the session was sailed
  // on a trip whose destination has no site row to look coordinates up on.
  wind: (site, start, end, coords) => get('/api/wind', {
    site, start, end, lat: coords && coords.lat, lon: coords && coords.lon,
  }),
};
