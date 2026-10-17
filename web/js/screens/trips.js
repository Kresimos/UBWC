/**
 * Trips - what is planned, what is being loaded, what is out, and what has been.
 *
 * The list is grouped by the stage a trip is at, and the group heading IS the
 * stage: a trip under Packing is being packed, and there is no chip on the row
 * to read as well. The one thing a grouped list cannot say, it says by having
 * groups. These headings get room to breathe (--stage-gap) precisely because
 * the type headings inside one trip's kit do not - they separate whole trips
 * from each other rather than dividing one trip's kit into sections.
 *
 * A finished trip is kept, not deleted. It is the record of what was packed,
 * which is the only way the club ever finds out where the 5.2 went. Once it is
 * old news the committee can press and hold it to archive it, which folds it
 * into a closed group at the bottom of the list; delete is for a trip started
 * by mistake, and works at any stage.
 */
import { html, mount, on, onClick, stampDate } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { store, setTrip } from '../store.js';
import { wireWhoPill } from '../ui/bits.js';
import { openIdentity, needCommittee } from '../ui/chrome.js';
import { chooser, confirmSheet, toast } from '../ui/overlay.js';
import { go } from '../router.js';

// The four groups the stages fall into. Packing and active are separate
// because they are different jobs; done and cancelled are one group because
// from the outside they are the same fact, that the trip is over.
const GROUPS = [
  { label: 'Upcoming', stages: ['requesting'] },
  { label: 'Packing', stages: ['packing'] },
  { label: 'Out now', stages: ['active'] },
  { label: 'Past trips', stages: ['done', 'cancelled'] },
];

const LONG_PRESS_MS = 420;

export async function render(root) {
  let trips = [];
  let showArchived = false;
  let unwire = () => {};
  let press = null;
  let suppressClick = false;

  async function load() {
    try {
      ({ trips } = await api.trips());
    } catch (error) {
      toast(error.message, true);
    }
    paint();
  }

  function paint() {
    unwire();
    mount(root, screen(trips, showArchived));
    unwire = wireWhoPill(root, openIdentity, { compact: true });
  }

  await load();

  onClick(root, 'data-trip', (value) => {
    if (suppressClick) { suppressClick = false; return; }
    go(`/trip/${value}`);
  });
  onClick(root, 'data-archtoggle', () => {
    showArchived = !showArchived;
    paint();
  });
  onClick(root, 'data-newtrip', async () => {
    if (!(await needCommittee('Starting a trip is a committee action.'))) return;
    go('/newtrip');
  });

  // Press and hold a trip to archive or delete it - the same gesture the
  // Catalogue and a trip's own kit list use. Committee only: for anybody else
  // the press is just a slow tap.
  on(root, 'pointerdown', '[data-trip]', (event, node) => {
    suppressClick = false;
    if (press || !store.committee) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const trip = trips.find((t) => t.id === Number(node.getAttribute('data-trip')));
    if (!trip) return;
    press = { x: event.clientX, y: event.clientY };
    press.timer = setTimeout(() => {
      press = null;
      suppressClick = true;
      tripActions(trip);
    }, LONG_PRESS_MS);
  });
  on(root, 'pointermove', '[data-trip]', (event) => {
    if (!press) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) {
      clearTimeout(press.timer);
      press = null;
    }
  });
  const endPress = () => {
    if (!press) return;
    clearTimeout(press.timer);
    press = null;
  };
  on(root, 'pointerup', '[data-trip]', endPress);
  on(root, 'pointercancel', '[data-trip]', endPress);
  // A held touch raises the browser's context menu; the hold is ours.
  on(root, 'contextmenu', '[data-trip]', (event) => {
    if (store.committee) event.preventDefault();
  });

  /** What a held trip offers, depending on its stage and whether it is archived. */
  async function tripActions(trip) {
    const finished = ['done', 'cancelled'].includes(trip.status);
    const rows = [];
    if (trip.archived_at) {
      rows.push({ value: 'restore', label: 'Restore',
        sub: 'Back in the Trips list with the rest' });
    } else if (finished) {
      rows.push({ value: 'archive', label: 'Archive',
        sub: 'Folded away at the bottom of Trips. Its kit list and requests are kept. Reversible.' });
    }
    rows.push({ value: 'delete', label: 'Delete permanently',
      sub: ['packing', 'active'].includes(trip.status)
        ? 'For a trip started by mistake. Its kit becomes available again. Cannot be undone.'
        : 'For a trip started by mistake. Its kit list and requests go too. Cannot be undone.' });

    const choice = await chooser({ title: trip.name, rows });
    try {
      if (choice === 'archive') {
        await api.archiveTrip(trip.id);
        toast('Archived.');
      } else if (choice === 'restore') {
        await api.unarchiveTrip(trip.id);
        toast('Restored.');
      } else if (choice === 'delete') {
        const sure = await confirmSheet({
          title: `Delete ${trip.name}?`,
          sub: 'The trip, its kit list and every request on it are gone for good. '
            + 'If it is just over, archive it instead.',
          confirmLabel: 'Delete it',
        });
        if (!sure) return;
        await api.deleteTrip(trip.id);
        // The app-bar location toggle lists packing/active trips; drop this one
        // from it, and from the selection if the club was working off it.
        store.trips = store.trips.filter((t) => t.id !== trip.id);
        if (store.trip && store.trip.id === trip.id) setTrip(null);
        toast(`${trip.name} deleted.`);
      } else {
        return;
      }
    } catch (error) {
      toast(error.message, true);
      return;
    }
    await load();
  }

  return () => unwire();
}

// ------------------------------------------------------------------ markup
function screen(trips, showArchived) {
  const live = trips.filter((t) => !t.archived_at);
  const archived = trips.filter((t) => t.archived_at);
  const groups = GROUPS
    .map((group) => ({ ...group, rows: live.filter((t) => group.stages.includes(t.status)) }))
    .filter((group) => group.rows.length);

  return html`
    <div class="appbar">
      <div class="row">
        <span class="ttl">Trips</span>
        <span data-who></span>
      </div>
    </div>
    <div class="body">
      ${store.committee ? html`
        <div style="padding:2px 0 4px">
          <button class="askbtn" data-newtrip>${icon('plusCircle')}Start a new trip</button>
        </div>` : ''}
      ${groups.length || archived.length
        ? groups.map((group) => html`
            <div class="grouplab stage">${group.label}</div>
            ${group.rows.map(row)}`)
        : emptyState()}
      ${archived.length ? html`
        <button class="grouplab stage archtoggle${showArchived ? ' open' : ''}" data-archtoggle>
          <span>Archived (${archived.length})</span>${icon('chevronRight')}
        </button>
        ${showArchived ? archived.map(row) : ''}` : ''}
    </div>`;
}

function row(trip) {
  return html`
    <button class="trow" data-trip="${trip.id}">
      <span class="tsq">${trip.image_path
        ? html`<img src="${trip.image_path}" alt="">`
        : icon('flag')}</span>
      <span class="tm"><b>${trip.name}</b><span>${sub(trip)}</span></span>
      ${icon('chevronRight')}
    </button>`;
}

/**
 * The line under the name: where and when, then the one number that stage is
 * actually about. A trip taking requests is counted in requests, one being
 * packed in how much is on the trailer, one coming home in how much is back.
 */
function sub(trip) {
  const bits = [trip.destination, dates(trip)].filter(Boolean);
  if (trip.status === 'requesting') {
    bits.push(`${trip.n_requests} requested`);
  } else if (trip.status === 'packing') {
    bits.push(`${trip.n_packed} of ${trip.n_items} packed`);
  } else if (trip.status === 'cancelled') {
    bits.push('Called off');
  } else {
    bits.push(`${trip.n_items} ${trip.n_items === 1 ? 'piece' : 'pieces'}`);
  }
  return bits.join(' · ');
}

/** "14 Mar", or "28-30 Mar" when a trip runs over more than a day. */
export function dates(trip) {
  const from = stampDate(trip.starts_on);
  const to = stampDate(trip.ends_on);
  if (!from) return '';
  const day = (when, withMonth) => when.toLocaleDateString('en-GB',
    withMonth ? { day: 'numeric', month: 'short' } : { day: 'numeric' });
  if (!to || to.getTime() === from.getTime()) return day(from, true);
  const sameMonth = from.getMonth() === to.getMonth();
  return `${day(from, !sameMonth)}-${day(to, true)}`;
}

function emptyState() {
  return html`
    <div class="emptystate">
      ${icon('flag')}
      <b>No trips yet</b>
      <span>${store.committee
        ? 'Start one and the club can begin asking for the kit they want on it.'
        : 'When the club plans one, it turns up here and you can ask for the kit you want.'}</span>
    </div>`;
}
