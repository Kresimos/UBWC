/**
 * The new-trip form, and the same form editing one.
 *
 * It is the add-kit form doing a second job: same app bar, same field groups,
 * same fixed save bar, so it needs no learning. What it asks for is what a trip
 * is - a name, where, when, what members should know - and then, last, the kit.
 *
 * Kit goes last on purpose. The blurb and the request-first switch are
 * decisions made once when the trip is set up; the kit list is filled in over
 * the days after and is the part that grows longest.
 *
 * "Let members request kit first" is the one switch that decides how the trip
 * starts. On, and it opens for the club to ask; off, and it goes straight to
 * packing because the kit sec already knows what is going.
 */
import { html, mount, onClick } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { store } from '../store.js';
import { cardTile } from '../ui/itemTile.js';
import { kitPicker } from '../ui/kitpicker.js';
import { needCommittee } from '../ui/chrome.js';
import { confirmSheet, toast } from '../ui/overlay.js';
import { photoField, wirePhoto } from '../ui/photofield.js';
import { fullName } from '../ui/bits.js';
import { go, back } from '../router.js';

const pinCoords = (lat, lon) => `${lat.toFixed(3)}, ${lon.toFixed(3)}`;

/** A club site whose name the typed destination matches, if it has a pin. */
function knownSite(name) {
  const wanted = (name || '').trim().toLowerCase();
  if (!wanted) return null;
  return (store.sites || []).find(
    (s) => s.name.toLowerCase() === wanted && s.lat != null && s.lon != null,
  ) || null;
}

export async function render(root, params) {
  const editing = Boolean(params.id);
  const id = editing ? Number(params.id) : null;
  // The catalogue's "Move → a new trip" lands here with the picked kit's ids in
  // the query, to seed the kit field once the inventory has loaded.
  const seedIds = editing ? [] : String(params.kit || '')
    .split(',').map((s) => Number(s.trim())).filter(Boolean);

  if (!(await needCommittee(editing
    ? 'Editing a trip is the kit sec\'s job.'
    : 'Starting a trip is the kit sec\'s job.'))) {
    back('/trips');
    return undefined;
  }

  const values = {
    name: '', destination: '', starts_on: '', ends_on: '', notes: '',
    image_path: null,
    requesting: true,
    // The forecast pin. lat/lon null means the trip page draws no wind strip;
    // pinLabel is only what the chip reads, it is never sent.
    lat: null, lon: null, pinLabel: '',
  };
  // The "Pin the spot" search: its own little state so a repaint of the rest of
  // the form does not throw away a dropdown mid-type.
  const geo = { q: '', results: [], busy: false, timer: null, seeded: false };
  // Before the trip exists its kit is held here and posted with it. Once it
  // exists, every pick is a write of its own, so this is only what to draw.
  let picked = [];
  let catalogue = null;        // /api/items cards: every site's kit, for the picker
  let cataloguePending = null; // the in-flight fetch, so two taps don't run it twice
  let picker = null;

  if (editing) {
    const { trip } = await api.trip(id);
    Object.assign(values, {
      name: trip.name || '',
      destination: trip.destination || '',
      starts_on: trip.starts_on || '',
      ends_on: trip.ends_on || '',
      notes: trip.notes || '',
      image_path: trip.image_path || null,
      requesting: trip.status === 'requesting',
      lat: trip.lat ?? null,
      lon: trip.lon ?? null,
      pinLabel: (trip.lat != null && trip.lon != null)
        ? (trip.destination || pinCoords(trip.lat, trip.lon)) : '',
    });
    geo.seeded = true;   // an existing trip already has whatever pin it has
    picked = trip.items.map((row) => row.item);
  }

  /**
   * A full repaint rebuilds the scrolling body too, so by default it lands back
   * at the top. `keepScroll` carries the offset over - the kit list is at the
   * foot of the form, and closing the picker or dropping a piece should leave
   * you looking at it, not back up at the trip name.
   */
  function paint({ keepScroll = false } = {}) {
    const y = keepScroll ? (root.querySelector('.body')?.scrollTop || 0) : 0;
    mount(root, screen());
    wire();
    maybeSeedPin();
    if (y) {
      const body = root.querySelector('.body');
      if (body) body.scrollTop = y;
    }
  }

  /** The pinned chip, or the place search with its results dropdown. */
  function pinField() {
    if (values.lat != null && values.lon != null) {
      return html`
        <button class="pinchip" type="button" data-unpin>
          <span class="i">${icon('pin')}</span>
          <span class="t">${values.pinLabel || 'Pinned'}</span>
          <span class="c">${pinCoords(values.lat, values.lon)}</span>
          <span class="x">${icon('close')}</span>
        </button>`;
    }
    return html`
      <div class="inp geo">
        <span class="gi">${icon('search')}</span>
        <input data-geo type="text" autocomplete="off" value="${geo.q}"
               placeholder="Search a place, e.g. Weymouth">
      </div>
      <div class="geores" data-geores>${geoResults()}</div>`;
  }

  function geoResults() {
    if (geo.busy) return html`<div class="geohint">Searching…</div>`;
    if (geo.q.trim().length >= 2 && !geo.results.length) {
      return html`<div class="geohint">No matching place. The trip still
        works without a pin.</div>`;
    }
    return html`${geo.results.map((r, i) => html`
      <button class="georow" type="button" data-geo-pick="${i}">
        <b>${r.name}</b>
        <span>${[r.admin1, r.country].filter(Boolean).join(', ')}</span>
      </button>`)}`;
  }

  function paintGeores() {
    const box = root.querySelector('[data-geores]');
    if (box) mount(box, geoResults());
  }

  function pinTo(lat, lon, label) {
    values.lat = lat;
    values.lon = lon;
    values.pinLabel = label || pinCoords(lat, lon);
    geo.results = [];
    geo.busy = false;
    paint();
  }

  function runGeo(query) {
    geo.busy = true;
    paintGeores();
    api.geocode(query).then((data) => {
      if (geo.q.trim() !== query) return;   // a later keystroke won the race
      geo.results = (data && data.results) || [];
      geo.busy = false;
      paintGeores();
    }).catch(() => { geo.busy = false; geo.results = []; paintGeores(); });
  }

  /** On first paint, pin a known club site outright, or seed the search box
   *  with the typed destination so one tap does it. */
  function maybeSeedPin() {
    if (geo.seeded) return;
    geo.seeded = true;
    const site = knownSite(values.destination);
    if (site) { pinTo(site.lat, site.lon, site.name); return; }
    const seed = values.destination.trim();
    if (seed.length >= 2) {
      geo.q = seed;
      const input = root.querySelector('[data-geo]');
      if (input) input.value = seed;
      runGeo(seed);
    }
  }

  function screen() {
    return html`
      <div class="appbar">
        <div class="row">
          <button class="backbtn" data-back aria-label="Back">${icon('back')}</button>
          <span class="ttl sm">${editing ? 'Edit trip' : 'New trip'}</span>
        </div>
      </div>

      <div class="body pad">
        <div class="form">
          ${photoField(values.image_path, {
            hint: 'A shot of the spot, so the trip is recognisable in the list. Optional.',
          })}

          <div class="grp">
            <span class="lab"><span class="req"></span>Trip name</span>
            <div class="inp">
              <input data-field="name" type="text" value="${values.name}"
                     placeholder="Cheddar, Saturday">
            </div>
          </div>

          <div class="grp">
            <span class="lab">Where</span>
            <div class="inp">
              <input data-field="destination" type="text" value="${values.destination}"
                     placeholder="Cheddar Reservoir">
            </div>
          </div>

          <div class="grp">
            <span class="lab">Pin the spot
              <span class="opt">· so the trip shows a forecast</span></span>
            ${pinField()}
          </div>

          <div class="two">
            <div class="grp">
              <span class="lab">Leaves</span>
              <div class="inp">
                <input data-field="starts_on" type="date" value="${values.starts_on}"
                       max="${values.ends_on || ''}">
              </div>
            </div>
            <div class="grp">
              <span class="lab">Back</span>
              <div class="inp">
                <input data-field="ends_on" type="date" value="${values.ends_on}"
                       min="${values.starts_on || ''}">
              </div>
            </div>
          </div>

          ${editing ? '' : html`
            <button class="switch ${values.requesting ? 'on' : ''}" type="button" data-requesting>
              <span class="tl"><b>Let members request kit first</b>
                <span>Otherwise it goes straight to packing</span></span>
              <span class="knob"></span>
            </button>`}

          <div class="grp">
            <span class="lab">Anything members should know</span>
            <div class="inp">
              <textarea data-field="notes"
                placeholder="Minibus leaves at half eight sharp. Bring a packed lunch.">${values.notes}</textarea>
            </div>
          </div>

          <div class="grp">
            <span class="lab">Kit <span class="opt">· optional, and you can add more later</span></span>
            <button class="askbtn ghost" type="button" data-pick>${icon('plusCircle')}Add kit</button>
            ${picked.length ? html`
              <div class="itemlist">${picked.map((item) => cardTile(item, false, {
                dotFault: true,
              }))}</div>` : ''}
          </div>
        </div>
      </div>

      <div class="actionbar">
        <button class="bigbtn" data-save>
          ${editing ? 'Save changes' : 'Start the trip'}${icon('tick')}</button>
        ${editing
          ? html`<span class="helper">The trip keeps whatever stage it is at.</span>`
          : ''}
      </div>`;
  }

  function wire() {
    root.querySelector('[data-back]').addEventListener('click',
      () => back(editing ? `/trip/${id}` : '/trips'));
    root.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('input', () => {
        const field = input.getAttribute('data-field');
        values[field] = input.value;
        input.closest('.inp')?.classList.remove('bad');
        // The two date fields are one span. Picking "Leaves" fills an empty
        // "Back" with the same day (most trips are day trips, so it is usually
        // done), and each field caps the other so you cannot land the end
        // before the start.
        if (field === 'starts_on') {
          const backInput = root.querySelector('[data-field="ends_on"]');
          if (backInput) {
            backInput.min = input.value;
            if (input.value && (!values.ends_on || values.ends_on < input.value)) {
              values.ends_on = input.value;
              backInput.value = input.value;
            }
          }
        }
        if (field === 'ends_on') {
          const goesInput = root.querySelector('[data-field="starts_on"]');
          if (goesInput) goesInput.max = input.value;
        }
        // Typing a known club site into "Where" pins it, if nothing is pinned.
        if (field === 'destination' && values.lat == null) {
          const site = knownSite(input.value);
          if (site) pinTo(site.lat, site.lon, site.name);
        }
      });
    });

    // Leaving "Where" carries the place into the pin search, so a trip to
    // somewhere new is one tap on a result rather than typing it twice.
    root.querySelector('[data-field="destination"]')?.addEventListener('blur', () => {
      const seed = values.destination.trim();
      if (values.lat == null && !geo.q.trim() && seed.length >= 2) {
        geo.q = seed;
        const box = root.querySelector('[data-geo]');
        if (box) box.value = seed;
        runGeo(seed);
      }
    });

    const geoInput = root.querySelector('[data-geo]');
    if (geoInput) {
      geoInput.addEventListener('input', () => {
        geo.q = geoInput.value;
        clearTimeout(geo.timer);
        const query = geo.q.trim();
        if (query.length < 2) {
          geo.results = [];
          geo.busy = false;
          paintGeores();
          return;
        }
        geo.timer = setTimeout(() => runGeo(query), 350);
      });
    }
    onClick(root, 'data-geo-pick', (value) => {
      const hit = geo.results[Number(value)];
      if (hit) pinTo(hit.lat, hit.lon,
                     [hit.name, hit.admin1].filter(Boolean).join(', '));
    });
    onClick(root, 'data-unpin', () => {
      values.lat = null;
      values.lon = null;
      values.pinLabel = '';
      geo.q = '';
      geo.results = [];
      paint();
    });
    onClick(root, 'data-requesting', (_v, node) => {
      values.requesting = !values.requesting;
      node.classList.toggle('on', values.requesting);
    });
    wirePhoto(root, values, 'image_path', () => paint({ keepScroll: true }), { aspect: 2 });
    onClick(root, 'data-pick', openPicker);
    onClick(root, 'data-item', async (value, _node, event) => {
      if (event.target.closest('[data-kitpicker]')) return;
      const item = picked.find((row) => row.id === Number(value));
      if (!item) return;
      const sure = await confirmSheet({
        title: `Take ${fullName(item)} off this trip?`,
        sub: 'Nothing moves. It goes back to being available to rig.',
        confirmLabel: 'Take it off',
      });
      if (sure) await drop(item);
    });
    root.querySelector('[data-save]').addEventListener('click', save);
  }

  /**
   * The picker's inventory: every site's kit, because a trailer is loaded from
   * wherever kit lives. Fetched once and kept, and warmed in the background
   * after first paint so the first "Add kit" tap opens onto a full sheet.
   */
  function loadCatalogue() {
    if (catalogue) return Promise.resolve();
    if (!cataloguePending) {
      cataloguePending = api.items({}).then((data) => { catalogue = data.items; });
    }
    return cataloguePending;
  }

  async function openPicker() {
    if (picker) return;
    try {
      await loadCatalogue();
    } catch (error) {
      cataloguePending = null;   // let the next tap try again
      toast(error.message, true);
      return;
    }
    picker = kitPicker({
      root,
      items: catalogue,
      chosen: () => new Set(picked.map((item) => item.id)),
      onPick: (item) => (picked.some((row) => row.id === item.id) ? drop(item) : take(item)),
      // A trip is loaded a trailer at a time, not a piece at a time, so this
      // sheet stays up and keeps taking picks until Done.
      multi: true,
      // Picks made in the sheet only live in `picked` until now, so the form
      // does need a full repaint - but one frame later, so the browser can
      // show the sheet gone before it spends time rebuilding underneath.
      onClose: () => {
        picker = null;
        requestAnimationFrame(() => paint({ keepScroll: true }));
      },
    });
  }

  async function take(item) {
    if (editing) {
      try {
        await api.addTripItems(id, [{ item_id: item.id, role: item.rig_kind || null,
                                      source: 'chosen' }]);
      } catch (error) { toast(error.message, true); return; }
    }
    picked = [...picked, item];
  }

  async function drop(item) {
    if (editing) {
      try {
        await api.removeTripItem(id, item.id);
      } catch (error) { toast(error.message, true); return; }
    }
    picked = picked.filter((row) => row.id !== item.id);
    if (!picker) paint({ keepScroll: true });
  }

  async function save() {
    if (!values.name.trim()) {
      root.querySelector('[data-field="name"]').closest('.inp').classList.add('bad');
      toast('Give the trip a name.', true);
      return;
    }
    const payload = {
      name: values.name.trim(),
      destination: values.destination.trim() || null,
      lat: values.lat,
      lon: values.lon,
      starts_on: values.starts_on || null,
      ends_on: values.ends_on || null,
      notes: values.notes.trim() || null,
      image_path: values.image_path ?? null,
    };
    try {
      if (editing) {
        await api.editTrip(id, payload);
        toast('Trip updated.');
        go(`/trip/${id}`, { replace: true });
      } else {
        const { trip } = await api.createTrip({
          ...payload,
          requesting: values.requesting,
          items: picked.map((item) => ({ item_id: item.id,
                                         role: item.rig_kind || null,
                                         source: 'chosen' })),
        });
        toast(values.requesting
          ? 'Trip started. The club can ask for kit now.'
          : 'Trip started. Straight to packing.');
        go(`/trip/${trip.id}`, { replace: true });
      }
    } catch (error) {
      toast(error.message, true);
    }
  }

  paint();
  // Warm the picker's inventory now: "Add kit" is always on this form, so the
  // fetch is certain to be needed and better done before the tap than after it.
  // It also carries the seeded kit, if the catalogue sent any over.
  loadCatalogue().then(() => {
    if (!seedIds.length || !catalogue) return;
    const byId = new Map(catalogue.map((row) => [row.id, row]));
    const seeded = seedIds.map((n) => byId.get(n)).filter(Boolean);
    if (seeded.length) { picked = seeded; paint(); }
  }).catch(() => { cataloguePending = null; });
  return () => { if (picker) picker.close(); };
}
