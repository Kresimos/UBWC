/**
 * The one place that talks to the server.
 *
 * Every call returns parsed JSON or throws an Error carrying the server's own
 * sentence, which the screens show verbatim — the API already words its
 * refusals for a member ("Pick your name first", "That PIN is not right"),
 * so there is nothing for the browser to re-phrase.
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
  login: (userId) => request('POST', '/api/login', { user_id: userId }),
  logout: () => request('POST', '/api/logout'),
  unlockCommittee: (pin) => request('POST', '/api/committee', { pin }),

  items: (filters) => get('/api/items', filters),
  item: (id) => get(`/api/items/${id}`),
  createItem: (payload) => request('POST', '/api/items', payload),
  updateItem: (id, payload) => request('PUT', `/api/items/${id}`, payload),
  deleteItem: (id) => request('DELETE', `/api/items/${id}`),
  archiveItem: (id, reason) => request('POST', `/api/items/${id}/archive`, { reason }),
  unarchiveItem: (id) => request('POST', `/api/items/${id}/unarchive`, {}),
  moveItems: (itemIds, site, spot) =>
    request('POST', '/api/items/move', { item_ids: itemIds, site, spot }),

  vote: (id, value) => request('POST', `/api/items/${id}/vote`, { vote: value }),
  comment: (id, body, kind) => request('POST', `/api/items/${id}/comments`, { body, kind }),
  reportFault: (id, fault) => request('POST', `/api/items/${id}/faults`, fault),
  reportFix: (faultId, body) => request('POST', `/api/faults/${faultId}/fix`, { body }),
  clearFault: (faultId) => request('POST', `/api/faults/${faultId}/clear`, {}),

  rigKit: (site) => get('/api/rig/kit', { site }),
  setup: () => get('/api/setup'),
  saveSetup: (site, pieces) => request('POST', '/api/setup', { site, pieces }),
  derig: (setupId) => request('POST', `/api/setup/${setupId}/derig`, {}),
  binSetup: (setupId) => request('POST', `/api/setup/${setupId}/bin`, {}),

  sessions: (scope) => get('/api/sessions', { scope }),
  logSession: (payload) => request('POST', '/api/sessions', payload),
  wind: (site, start, end) => get('/api/wind', { site, start, end }),
};
