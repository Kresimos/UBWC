/**
 * Item page — everything about one physical piece of kit.
 *
 * The order down the page is the order a member needs it in: what it is, what
 * it can do for me right now (Rig this kit), what is wrong with it, what it
 * measures, how the club rates it, what people say about it, and only then the
 * history of what has gone wrong before.
 *
 * Two details carry real domain weight:
 *
 *  - the **recommended mast + extension** is computed, never stored. Any mast
 *    and extension totalling the luff rigs the sail equally well, so this is a
 *    worked example for a newcomer and is labelled as one.
 *  - a **reported fix does not clear a fault**. Any member can report one;
 *    it then reads as awaiting committee sign-off until committee closes it.
 */
import { html, mount, num, numFixed, ago, onClick, initial } from '../dom.js';
import { icon, artFor } from '../icons.js';
import { api } from '../api.js';
import { store, isCommittee, spotImage, setSpots, avatarFor } from '../store.js';
import { starRow, conditionClass } from '../ui/bits.js';
import { needUser, needCommittee } from '../ui/chrome.js';
import { formSheet, lightbox, toast } from '../ui/overlay.js';
import { go, back } from '../router.js';

export async function render(root, params) {
  const id = Number(params.id);
  let item = await api.item(id);
  let historyOpen = false;

  // A repaint replaces `.body` wholesale, which would send the page back to the
  // top. `keepScroll` holds the reader where they were — a thumb vote redraws
  // the rating bar far down the page and should not move it.
  function paint({ keepScroll = false } = {}) {
    const y = keepScroll ? (root.querySelector('.body')?.scrollTop || 0) : 0;
    mount(root, screen(item, historyOpen));
    wire();
    if (y) {
      const body = root.querySelector('.body');
      if (body) body.scrollTop = y;
    }
  }

  function wire() {
    root.querySelector('[data-back]').addEventListener('click', () => back());
    // Editing is committee's, so the button is only drawn for them.
    const edit = root.querySelector('[data-edit]');
    if (edit) edit.addEventListener('click', () => go(`/edit/${id}`));

    onClick(root, 'data-spot', () => {
      const canEdit = isCommittee() && item.site && item.spot;
      lightbox({
        title: `${item.spot || 'Location'} · ${item.site || ''}`.trim(),
        image: spotImage(item.site, item.spot),
        sub: item.spot_description
          || (canEdit
            ? 'No description or photo yet. Add one so the next person can find it and put it back.'
            : 'No description recorded for this spot yet.'),
        action: canEdit ? { label: 'Edit spot', onClick: editSpot } : null,
      });
    });

    async function editSpot() {
      const values = await formSheet({
        title: `${item.spot} · ${item.site}`,
        sub: 'What the club sees when anyone taps this spot. Committee only.',
        fields: [
          { name: 'description', label: 'Where it is', type: 'textarea', rows: 2,
            value: item.spot_description || '',
            placeholder: 'Second bay in from the door, top rack.' },
          { name: 'image_path', label: 'Photo', type: 'photo', aspect: 4 / 3,
            value: spotImage(item.site, item.spot),
            hint: 'A shot of the rack, so kit goes back where it came from.' },
        ],
        submitLabel: 'Save the spot',
      });
      if (!values) return;
      const data = await api.upsertSpot(item.site, item.spot, {
        description: values.description || null,
        image_path: values.image_path || null,
      });
      setSpots(data.spots);
      item = await api.item(id);
      paint();
      toast('Spot updated.');
    }

    // A trip tag in the chips row is a live link to the trip the piece is
    // packed for.
    onClick(root, 'data-trip', (value) => go(`/trip/${value}`));

    onClick(root, 'data-fault-toggle', (_, node) => {
      node.closest('.faultitem').classList.toggle('open');
    });

    onClick(root, 'data-fault-photo', (value, node, event) => {
      event.stopPropagation();
      lightbox({
        title: 'Fault photo',
        sub: node.dataset.caption || null,
        image: value,
      });
    });

    onClick(root, 'data-fix', async (value, _node, event) => {
      event.stopPropagation();
      if (!(await needUser('Reporting a fix is attributed to you.'))) return;
      const values = await formSheet({
        title: 'Report a fix',
        sub: 'This flags the fault as repaired and waiting for committee sign-off. It does not close it.',
        fields: [
          {
            name: 'body', label: 'What did you do?', type: 'textarea', rows: 3, required: true,
            placeholder: 'Re-seated the cam spring and packed the base collar.',
          },
          { name: 'image_path', label: 'Photo', type: 'photo', aspect: 4 / 3,
            hint: 'The repair, so committee can sign it off from the photo. Optional.' },
        ],
        submitLabel: 'Report the fix',
      });
      if (!values) return;
      await api.reportFix(Number(value), values.body, values.image_path);
      item = await api.item(id);
      historyOpen = true;
      paint();
      toast('Fix reported. Committee will sign it off.');
    });

    onClick(root, 'data-clear-fault', async (value, _node, event) => {
      event.stopPropagation();
      if (!(await needCommittee('Only committee closes a fault.'))) return;
      await api.clearFault(Number(value));
      item = await api.item(id);
      paint();
      toast('Fault cleared.');
    });

    onClick(root, 'data-vote', async (value) => {
      if (!(await needUser('Ratings are signed with your name.'))) return;
      // Pressing the thumb you already gave withdraws it; the other one
      // replaces it. Rating the same piece again after another sail is fine and
      // expected: the club's stars count your latest word on it, not every one.
      const next = item.rating.mine === Number(value) ? 0 : Number(value);
      item.rating = await api.vote(id, next);
      paint({ keepScroll: true });
    });

    onClick(root, 'data-fav', async () => {
      if (!(await needUser('Saved kit is kept with your account.'))) return;
      const next = !item.favourite;
      const data = await api.favourite(id, next);
      item.favourite = data.favourite;
      paint();
      toast(item.favourite
        ? 'Favourited.'
        : 'Removed from your kit.');
    });

    const rigBtn = root.querySelector('[data-rig]');
    if (rigBtn) rigBtn.addEventListener('click', () => go(`/rig?pin=${id}`));

    onClick(root, 'data-note', async () => {
      if (!(await needUser('Notes are signed with your name.'))) return;
      const values = await formSheet({
        title: 'Add a note',
        sub: 'Rigging tips, quirks, things worth knowing. Something broken belongs in a fault instead.',
        fields: [{ name: 'body', label: 'Note', type: 'textarea', rows: 3, required: true }],
        submitLabel: 'Post note',
      });
      if (!values) return;
      const data = await api.comment(id, values.body, 'note');
      item.comments = data.comments;
      paint();
      toast('Note added.');
    });

    onClick(root, 'data-report', async () => {
      if (!(await needUser('Fault reports are attributed to you.'))) return;
      const values = await formSheet({
        title: 'Report a fault',
        fields: [
          { name: 'title', label: 'Short name (the flag label)', required: true, placeholder: 'Bottom cam falls off' },
          { name: 'description', label: 'What is wrong, and what it needs', type: 'textarea', rows: 3, required: true },
          {
            name: 'severity', label: 'Severity', type: 'select', value: 'usable',
            options: [
              { value: 'usable', label: 'Minor fault: usable' },
              { value: 'out_of_action', label: 'Major fault: out of action' },
            ],
          },
          { name: 'image_path', label: 'Photo', type: 'photo', aspect: 4 / 3,
            hint: 'A shot of the damage helps whoever fixes it. Optional.' },
        ],
        submitLabel: 'Report it',
      });
      if (!values) return;
      await api.reportFault(id, values);
      item = await api.item(id);
      paint();
      toast('Fault reported.');
    });

    onClick(root, 'data-history', () => {
      historyOpen = !historyOpen;
      paint();
      if (historyOpen) root.querySelector('.fhist').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  paint();
}

/**
 * The trip a piece is packed for, as a chip in the head. `item.away` is the
 * trip's name; a matching entry in the boot-time trip list turns it into a link.
 */
function tripPill(name) {
  const trip = (store.trips || []).find((t) => t.name === name);
  return trip
    ? html`<button class="pill trip" data-trip="${trip.id}">${icon('flag')}${name}</button>`
    : html`<span class="pill trip">${icon('flag')}${name}</span>`;
}

// ------------------------------------------------------------------ markup

/**
 * Every pipeline asks for exactly two things — a sail, a board, or a wing —
 * and works the rest out from them. So "Rig this kit" is only offered on the
 * three things a pipeline can actually pick: on a mast or a boom it would
 * promise a screen that has nowhere to put the piece. Which pipeline it opens
 * is `sportFor`'s rule (a sail's ambiguity with windfoil resolved to windsurf,
 * a board's discipline read off its box) — the button itself does not decide.
 */
const buildable = (item) => ['sail', 'board', 'wing'].includes(item.rig_kind);

function screen(item, historyOpen) {
  const open = item.fault_history.filter((f) => f.status === 'open');
  const rating = item.rating;

  return html`
    <div class="body">
      <div class="hero">
        <div class="hero-nav">
          <button class="iconbtn" data-back aria-label="Back">${icon('back')}</button>
          <span class="hero-acts">
            <button class="iconbtn ${item.favourite ? 'on' : ''}" data-fav
                    aria-pressed="${item.favourite ? 'true' : 'false'}"
                    aria-label="${item.favourite ? 'Remove from your kit' : 'Save to your kit'}">
              ${icon(item.favourite ? 'heart' : 'heartOutline')}
            </button>
            ${isCommittee()
              ? html`<button class="iconbtn" data-edit aria-label="Edit">${icon('edit')}</button>`
              : ''}
          </span>
        </div>
        ${item.image_path
          ? html`<img src="${item.image_path}" alt="">`
          : artFor(item.rig_kind || item.component_type)}
        ${rating.n
          ? html`<span class="rate">${icon('star')}<b>${num(rating.stars)}</b>
              <span>· ${rating.n} ${rating.n === 1 ? 'vote' : 'votes'}</span></span>`
          : html`<span class="rate"><span>Not yet rated</span></span>`}
      </div>

      <div class="inner">
        <div class="head">
          <span class="size">${item.size_value != null
            ? (item.component_type === 'sail' ? numFixed(item.size_value) : num(item.size_value))
            : item.size_label || '—'}
            ${item.size_unit ? html`<small>${item.size_unit}</small>` : ''}</span>
          <span class="nm">${item.manufacturer} · ${item.model}</span>
          <div class="chips">
            ${item.type ? html`<span class="pill">${item.type}</span>` : ''}
            ${item.component_type === 'sail'
              ? html`<span class="pill cam">${item.cams ? 'Cambered' : 'Camless'}</span>`
              : ''}
            ${item.diameter ? html`<span class="pill">${item.diameter}</span>` : ''}
            ${item.condition
              ? html`<span class="pill cond ${conditionClass(item.condition)}">${item.condition} condition</span>`
              : ''}
            ${item.away ? tripPill(item.away) : ''}
          </div>
          <div class="locrow">
            <button class="loc" data-spot>
              ${icon('pin')}<b>${item.site || 'Location unknown'}</b>${item.spot ? ` · ${item.spot}` : ''}
              <span class="spotcam">${icon('camera')}</span>
            </button>
          </div>
        </div>

        <div class="cta">
          ${buildable(item)
            ? html`<button class="btn primary" data-rig>Rig this kit${icon('arrowRight')}</button>`
            : ''}
        </div>

        ${item.archived ? html`
          <div class="info">
            ${icon('info')}
            <p>Archived${item.archived_reason ? `: ${item.archived_reason}` : ''}. Hidden from the
              catalogue and rig picker until a committee member restores it.</p>
          </div>` : ''}

        ${open.length ? html`<div class="faults">${open.map(faultBox)}</div>` : ''}

        <div class="sect">
          <h3>Specifications</h3>
          <div class="spec">
            ${item.spec.map((row) => html`
              <div class="row"><span class="k">${row.label}</span><span class="v">${row.value}</span></div>`)}
            ${item.recommended ? html`
              <div class="row">
                <span class="k">Recommended mast</span>
                <span class="v">${item.recommended.mast_cm} cm${
                  item.diameter ? html` <small>${item.diameter}</small>` : ''}</span>
              </div>
              <div class="row">
                <span class="k">Recommended extension</span>
                <span class="v">${item.recommended.extension_cm} cm</span>
              </div>` : ''}
          </div>
          ${item.recommended ? html`
            <p class="calc">Recommended mast and extension is only a suggestion. Any mast and extension
              totalling the ${num(item.raw.luff_cm)} cm luff rigs this sail equally well.</p>` : ''}
        </div>

        ${item.cams ? html`
          <div class="info">
            ${icon('info')}
            <p>Cambered sail: Grab a committee member if you have not rigged cams before.</p>
          </div>` : ''}

        ${item.notes ? html`
          <div class="sect">
            <h3>Notes on this piece</h3>
            <p style="margin:0;font-size:13.5px;line-height:1.5">${item.notes}</p>
          </div>` : ''}

        <div class="sect">
          <h3>Member rating</h3>
          <div class="ratebar">
            <div class="avg">
              ${rating.n
                ? html`<span class="num">${num(rating.stars)}</span>${starRow(rating.stars)}`
                : html`<span class="none">Not yet rated</span>`}
            </div>
            <div class="split">
              <button class="vt up ${rating.mine === 1 ? 'sel' : ''}" data-vote="1" aria-label="Thumbs up">
                ${icon('thumbUp')}<span class="n">${rating.up}</span>
              </button>
              <button class="vt down ${rating.mine === -1 ? 'sel' : ''}" data-vote="-1" aria-label="Thumbs down">
                ${icon('thumbDown')}<span class="n">${rating.down}</span>
              </button>
            </div>
          </div>
          <span class="cntline">${rating.n
            ? `${rating.n} ${rating.n === 1 ? 'member' : 'members'} · ${rating.up} up, ${rating.down} down`
            : 'Nobody has rated this yet. Yours is the first.'}</span>
        </div>

        <div class="sect">
          <h3>Members' notes</h3>
          ${item.comments.length
            ? item.comments.map(comment)
            : html`<p class="calc" style="margin:0">Nothing yet.</p>`}
          <button class="dashbtn" data-note>Add a note</button>
        </div>

        <div class="faults">
          <button class="dashbtn" data-report>Report a fault</button>
          ${item.fault_history.length ? html`
            <button class="histbtn" data-history>
              ${historyOpen ? 'Hide history' : html`Fault &amp; fix history <b>›</b>`}
            </button>
            <div class="fhist" ${historyOpen ? '' : 'hidden'}>
              ${item.fault_history.map(historyGroup)}
            </div>` : ''}
        </div>
      </div>
    </div>`;
}

function faultBox(fault) {
  return html`
    <div class="faultitem ${fault.severity === 'out_of_action' ? 'oos' : 'usable'}" data-fault-toggle role="button">
      <div class="fhead">
        <span class="sev"></span>
        <span class="fttl">${fault.title}</span>
        <span class="fchev">${icon('chevronDown')}</span>
      </div>
      <div class="fbody">
        <p class="fdesc">${fault.description}</p>
        ${fault.image_path
          ? html`<button class="photochip" data-fault-photo="${fault.image_path}" data-caption="${fault.description}">
              ${icon('image')}Photo · View</button>`
          : ''}
        ${fault.awaiting_signoff
          ? html`<span class="awaiting">${icon('clock')}Fix reported, awaiting committee sign-off</span>`
          : ''}
        <div class="fixrow">
          <button class="fixbtn" data-fix="${fault.id}">Report a fix</button>
          ${isCommittee()
            ? html`<button class="fixbtn clear" data-clear-fault="${fault.id}">Clear it</button>`
            : ''}
          <span class="fhint">A reported fix waits for committee sign-off before it clears.</span>
        </div>
      </div>
    </div>`;
}

const EVENT_LABELS = {
  reported: 'Fault reported',
  fix_reported: 'Fix reported',
  cleared: 'Cleared by committee',
  reopened: 'Reopened',
  note: 'Note',
};

function historyGroup(fault) {
  return html`
    <div class="fhgroup">
      <span class="fhttl">${fault.title}${fault.status === 'cleared' ? ' · cleared' : ''}</span>
      ${fault.events.map((event) => html`
        <div class="fhrow">
          <span class="fhdot ${event.kind}"></span>
          <div class="fx">
            <b>${EVENT_LABELS[event.kind] || event.kind}</b>
            ${avatarFor(event.author)
              ? html`<span class="fwav"><img src="${avatarFor(event.author)}" alt=""></span>`
              : ''}
            <span class="fw">${[event.author, ago(event.created_at)].filter(Boolean).join(' · ')}</span>
            ${event.body ? html`<p>${event.body}</p>` : ''}
            ${event.image_path
              ? html`<button class="photochip" data-fault-photo="${event.image_path}" data-caption="${event.body || ''}">
                  ${icon('image')}Photo · View</button>`
              : ''}
          </div>
        </div>`)}
      ${fault.awaiting_signoff ? html`
        <div class="fhrow">
          <span class="fhdot"></span>
          <div class="fx"><b>Awaiting committee sign-off</b><span class="fw">to clear</span></div>
        </div>` : ''}
    </div>`;
}

/** A member's initials, or their profile photo if they have set one. */
function whoMark(name) {
  const src = avatarFor(name);
  return src
    ? html`<span class="who has"><img src="${src}" alt=""></span>`
    : html`<span class="who">${initial(name || 'Someone')}</span>`;
}

function comment(entry) {
  const who = entry.user_name || entry.author || 'Someone';
  return html`
    <div class="rev">
      <div class="top">
        ${whoMark(who)}
        <span class="name">${who}</span>
        ${entry.kind && entry.kind !== 'note'
          ? html`<span class="tag">${entry.kind === 'usage' ? 'Session note' : entry.kind}</span>`
          : ''}
        <span class="when">${ago(entry.created_at)}</span>
      </div>
      <p>${entry.body}</p>
    </div>`;
}
