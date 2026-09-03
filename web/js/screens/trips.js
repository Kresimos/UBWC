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
 * which is the only way the club ever finds out where the 5.2 went.
 */
import { html, mount, onClick, stampDate } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { store } from '../store.js';
import { wireWhoPill } from '../ui/bits.js';
import { openIdentity, needCommittee } from '../ui/chrome.js';
import { toast } from '../ui/overlay.js';
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

export async function render(root) {
  let trips = [];
  try {
    ({ trips } = await api.trips());
  } catch (error) {
    toast(error.message, true);
  }

  mount(root, screen(trips));
  const unwire = wireWhoPill(root, openIdentity, { compact: true });

  onClick(root, 'data-trip', (value) => go(`/trip/${value}`));
  onClick(root, 'data-newtrip', async () => {
    if (!(await needCommittee('Starting a trip is the kit sec\'s job.'))) return;
    go('/newtrip');
  });

  return unwire;
}

// ------------------------------------------------------------------ markup
function screen(trips) {
  const groups = GROUPS
    .map((group) => ({ ...group, rows: trips.filter((t) => group.stages.includes(t.status)) }))
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
      ${groups.length
        ? groups.map((group) => html`
            <div class="grouplab stage">${group.label}</div>
            ${group.rows.map(row)}`)
        : emptyState()}
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
