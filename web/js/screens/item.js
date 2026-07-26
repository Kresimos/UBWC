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
import { html, mount, num, ago, onClick, initial } from '../dom.js';
import { icon, artFor } from '../icons.js';
import { api } from '../api.js';
import { store, isCommittee } from '../store.js';
import { starRow, conditionClass, fullName } from '../ui/bits.js';
import { needUser, needCommittee } from '../ui/chrome.js';
import { formSheet, confirmSheet, lightbox, chooser, toast } from '../ui/overlay.js';
import { go, back } from '../router.js';

export async function render(root, params) {
  const id = Number(params.id);
  let item = await api.item(id);
  let historyOpen = false;

  function paint() {
    mount(root, screen(item, historyOpen));
    wire();
  }

  function wire() {
    root.querySelector('[data-back]').addEventListener('click', () => back());
    root.querySelector('[data-edit]').addEventListener('click', () => go(`/edit/${id}`));

    onClick(root, 'data-spot', () => {
      lightbox({
        title: `${item.spot || 'Location'} · ${item.site || ''}`.trim(),
        sub: item.spot_description
          || 'No description recorded for this spot yet. A committee member can add one when moving kit.',
      });
    });

    onClick(root, 'data-fault-toggle', (_, node) => {
      node.closest('.faultitem').classList.toggle('open');
    });

    onClick(root, 'data-fault-photo', (value, _node, event) => {
      event.stopPropagation();
      lightbox({
        title: 'Fault photo',
        sub: 'Attached when the fault was reported, to help diagnose it.',
        image: value,
      });
    });

    onClick(root, 'data-fix', async (value, _node, event) => {
      event.stopPropagation();
      if (!(await needUser('Reporting a fix is attributed to you.'))) return;
      const values = await formSheet({
        title: 'Report a fix',
        sub: 'This flags the fault as repaired and waiting for committee sign-off. It does not close it.',
        fields: [{
          name: 'body', label: 'What did you do?', type: 'textarea', rows: 3, required: true,
          placeholder: 'Re-seated the cam spring and packed the base collar.',
        }],
        submitLabel: 'Report the fix',
      });
      if (!values) return;
      await api.reportFix(Number(value), values.body);
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
      if (!(await needUser('Rating kit is one standing vote per member.'))) return;
      // Pressing the thumb you already gave withdraws it; the other one
      // replaces it. Either way there is only ever one vote from you.
      const next = item.rating.mine === Number(value) ? 0 : Number(value);
      item.rating = await api.vote(id, next);
      paint();
    });

    root.querySelector('[data-rig]').addEventListener('click', () => go(`/rig?pin=${id}`));

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
        sub: 'One box per issue. Usable keeps it in the rig picker with an amber flag; out of action hides it until committee clears it.',
        fields: [
          { name: 'title', label: 'Short name (the flag label)', required: true, placeholder: 'Bottom cam falls off' },
          { name: 'description', label: 'What is wrong, and what it needs', type: 'textarea', rows: 3, required: true },
          {
            name: 'severity', label: 'Severity', type: 'select', value: 'usable',
            options: [
              { value: 'usable', label: 'Usable — amber flag, still sailable' },
              { value: 'out_of_action', label: 'Out of action — red flag, hidden from the rig picker' },
            ],
          },
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

    onClick(root, 'data-admin', async () => {
      const choice = await chooser({
        title: fullName(item),
        sub: 'Committee actions on this piece.',
        rows: [
          { value: 'move', label: 'Change location', sub: `Now at ${item.site}${item.spot ? ' · ' + item.spot : ''}` },
          { value: 'delete', label: 'Delete this item', sub: 'Removes it and its faults, notes and ratings' },
        ],
      });
      if (choice === 'move') return moveOne();
      if (choice === 'delete') return deleteOne();
    });
  }

  async function moveOne() {
    if (!(await needCommittee('Moving kit is a committee action.'))) return;
    const site = await chooser({
      title: 'Move this piece',
      sub: 'Moving overwrites where it lives. A trip is just a location.',
      rows: store.sites.map((s) => ({
        value: s.name, label: s.name, sub: `${s.n_items} pieces now`, on: s.name === item.site,
      })),
    });
    if (!site) return;
    const values = await formSheet({
      title: `Move to ${site}`,
      fields: [{ name: 'spot', label: 'Spot within the site', value: site === item.site ? item.spot || '' : '', placeholder: 'wooden rack' }],
      submitLabel: 'Move it',
    });
    if (!values) return;
    const result = await api.moveItems([id], site, values.spot);
    store.sites = result.sites;
    item = await api.item(id);
    paint();
    toast(`Moved to ${site}.`);
  }

  async function deleteOne() {
    if (!(await needCommittee('Deleting kit is a committee action.'))) return;
    const sure = await confirmSheet({
      title: `Delete ${fullName(item)}?`,
      sub: 'Its faults, notes and ratings go with it. There is no undo.',
      confirmLabel: 'Delete it',
    });
    if (!sure) return;
    await api.deleteItem(id);
    toast('Deleted.');
    go('/catalogue');
  }

  paint();
}

// ------------------------------------------------------------------ markup
function screen(item, historyOpen) {
  const open = item.fault_history.filter((f) => f.status === 'open');
  const rating = item.rating;

  return html`
    <div class="body">
      <div class="hero">
        <div class="hero-nav">
          <button class="iconbtn" data-back aria-label="Back">${icon('back')}</button>
          <button class="iconbtn" data-edit aria-label="Edit">${icon('edit')}</button>
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
          <span class="size">${item.size_value != null ? num(item.size_value) : item.size_label || '—'}
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
          </div>
          <button class="loc" data-spot>
            ${icon('pin')}<b>${item.site || 'Location unknown'}</b>${item.spot ? ` · ${item.spot}` : ''}
            <span class="spotcam">${icon('camera')}</span>
          </button>
        </div>

        <div class="cta">
          <button class="btn primary" data-rig>Rig this kit${icon('arrowRight')}</button>
          ${isCommittee()
            ? html`<button class="btn ghost" data-admin aria-label="Committee actions">${icon('move')}</button>`
            : ''}
        </div>

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
            <p class="calc">A worked example, not a requirement: any mast and extension totalling
              the ${num(item.raw.luff_cm)} cm luff rigs this sail equally well.</p>` : ''}
        </div>

        ${item.cams ? html`
          <div class="info">
            ${icon('info')}
            <p>Cambered sail: the cams have to rotate past the boom head when rigging, so it is a
              faff for a first-timer${item.diameter ? `, and the cams only fit a ${item.diameter} mast` : ''}.
              Grab a committee member if you have not rigged cams before.</p>
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
            ? `${rating.n} ${rating.n === 1 ? 'vote' : 'votes'} · ${rating.up} up, ${rating.down} down`
            : 'One thumb per member. Yours is the first.'}</span>
        </div>

        <div class="sect">
          <h3>Members' notes</h3>
          ${item.comments.length
            ? item.comments.map(comment)
            : html`<p class="calc" style="margin:0">Nothing yet. A rigging tip here saves the next person ten minutes.</p>`}
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
    <div class="faultitem ${fault.severity === 'out_of_action' ? 'oos' : 'usable'}" data-fault-toggle>
      <div class="fhead">
        <span class="sev"></span>
        <span class="fttl">${fault.title}</span>
        <span class="fchev">${icon('chevronDown')}</span>
      </div>
      <div class="fbody">
        <p class="fdesc">${fault.description}</p>
        ${fault.image_path
          ? html`<button class="photochip" data-fault-photo="${fault.image_path}">
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
            <span class="fw">${[event.author, ago(event.created_at)].filter(Boolean).join(' · ')}</span>
            ${event.body ? html`<p>${event.body}</p>` : ''}
          </div>
        </div>`)}
      ${fault.awaiting_signoff ? html`
        <div class="fhrow">
          <span class="fhdot"></span>
          <div class="fx"><b>Awaiting committee sign-off</b><span class="fw">to clear</span></div>
        </div>` : ''}
    </div>`;
}

function comment(entry) {
  const who = entry.user_name || entry.author || 'Someone';
  return html`
    <div class="rev">
      <div class="top">
        <span class="who">${initial(who)}</span>
        <span class="name">${who}</span>
        ${entry.kind && entry.kind !== 'note'
          ? html`<span class="tag">${entry.kind === 'usage' ? 'Session note' : entry.kind}</span>`
          : ''}
        <span class="when">${ago(entry.created_at)}</span>
      </div>
      <p>${entry.body}</p>
    </div>`;
}
