/**
 * Your setup — where the wizard drops you, and what you look at on the grass.
 *
 * The rigging steps are generated from the kit actually picked, so the numbers
 * in them ("set the extension to 20 cm", "outhaul to 188 cm") are this rig's
 * numbers rather than a generic guide. That is the whole point of the screen:
 * a newcomer can rig from it without asking anyone.
 *
 * "Out now" is personal state, not a club-wide flag. The app deliberately does
 * not tell anyone else this kit is taken, because with ten people rigging at
 * once and non-app users grabbing kit unrecorded, a live status would be
 * trusted and then be wrong.
 */
import { html, mount, num, since, onClick, clockTime } from '../dom.js';
import { icon, artFor } from '../icons.js';
import { api } from '../api.js';
import { store, setSetup } from '../store.js';
import { starRow } from '../ui/bits.js';
import { refreshSetup, needUser } from '../ui/chrome.js';
import { lightbox, formSheet, confirmSheet, toast } from '../ui/overlay.js';
import { go } from '../router.js';

export async function render(root) {
  if (!store.user) {
    mount(root, signedOut());
    root.querySelector('[data-signin]').addEventListener('click', async () => {
      if (await needUser('Your setup is kept on your account.')) go('/rig', { replace: true });
    });
    return;
  }

  const setup = store.setup || (await refreshSetup());
  if (!setup) {
    go('/rig', { replace: true });
    return;
  }

  mount(root, screen(setup));

  onClick(root, 'data-howto', () => root.querySelector('.howto').classList.toggle('open'));

  // One card open at a time, so switching between pieces stays trackable.
  onClick(root, 'data-piece', (_value, node) => {
    const item = node.closest('.kitem');
    const wasOpen = item.hasAttribute('data-open');
    root.querySelectorAll('.kitem').forEach((other) => other.removeAttribute('data-open'));
    if (!wasOpen) item.setAttribute('data-open', '1');
  });

  onClick(root, 'data-open-item', (value, _node, event) => {
    // Only once the card is expanded does the photo become a link to the
    // catalogue; before that it is part of the row's tap target.
    if (!_node.closest('.kitem').hasAttribute('data-open')) return;
    event.stopPropagation();
    go(`/item/${value}`);
  });

  onClick(root, 'data-spot', (value, node, event) => {
    event.stopPropagation();
    lightbox({ title: value, sub: node.getAttribute('data-note') || 'No description recorded for this spot yet.' });
  });

  onClick(root, 'data-fault', async (value, _node, event) => {
    event.stopPropagation();
    if (!(await needUser('Fault reports are attributed to you.'))) return;
    const values = await formSheet({
      title: 'Report a fault',
      sub: 'Out of action hides the piece from the rig picker until committee clears it.',
      fields: [
        { name: 'title', label: 'Short name', required: true },
        { name: 'description', label: 'What is wrong, and what it needs', type: 'textarea', rows: 3, required: true },
        {
          name: 'severity', label: 'Severity', type: 'select', value: 'usable',
          options: [
            { value: 'usable', label: 'Usable — amber flag' },
            { value: 'out_of_action', label: 'Out of action — red flag' },
          ],
        },
      ],
      submitLabel: 'Report it',
    });
    if (!values) return;
    await api.reportFault(Number(value), values);
    toast('Fault reported. It shows on the item straight away.');
    setSetup(await refreshSetup());
  });

  onClick(root, 'data-swap', async () => {
    const yes = await confirmSheet({
      title: 'Change a piece?',
      sub: 'Swapping one part means rebuilding the rig, because every other step is filtered by it. Your current setup is discarded.',
      confirmLabel: 'Rebuild the rig',
    });
    if (!yes) return;
    await api.binSetup(setup.id);
    setSetup(null);
    go('/rig');
  });

  onClick(root, 'data-derig', () => go('/derig'));
  onClick(root, 'data-tolog', () => go('/log'));
}

// ------------------------------------------------------------------ markup
function signedOut() {
  return html`
    <div class="appbar"><div class="row"><span class="ttl">Your setup</span></div></div>
    <div class="body pad">
      <div class="emptystate">
        ${icon('sailNav')}
        <b>No setup yet</b>
        <span>Pick your name, then build a rig and the app will keep it here until you de-rig.</span>
        <button class="bigbtn ghost" data-signin style="max-width:220px;margin-top:10px">Pick my name</button>
      </div>
    </div>`;
}

function screen(setup) {
  const derigged = setup.status === 'derigged';
  const sail = setup.pieces.find((p) => p.role === 'sail');
  const board = setup.pieces.find((p) => p.role === 'board');

  return html`
    <div class="appbar">
      <div class="row">
        <span class="ttl">Your setup</span>
        <span class="clock" title="Since you rigged">
          ${icon('clock')}${derigged ? 'Sailed' : 'Out'} <b>${since(setup.rigged_at)}</b>
        </span>
      </div>
    </div>

    <div class="body pad">
      <div class="out">
        <div class="ot"><span class="dotpulse"></span><b>${derigged ? 'De-rigged, not logged' : 'Out now'}</b></div>
        <span class="kit">${headline(sail, board)}</span>
        <span class="sub">${derigged
          ? 'Everything is put away. Write it up in the Log tab whenever suits — the prompt waits for you.'
          : `Rigged at ${clockTime(setup.rigged_at)}. Nobody else is told this kit is taken, so put it back where you found it when you are done.`}</span>
      </div>

      ${derigged ? '' : rigGuide(setup)}

      <div class="partlist">
        <div class="ph">
          <span class="pt">Your kit</span>
          <span class="pc">${setup.pieces.length} pieces · tap for detail</span>
        </div>
        ${setup.pieces.map(pieceCard)}
      </div>

      <div class="actions">
        ${derigged
          ? html`<button class="bigbtn" data-tolog>Log this session${icon('arrowRight')}</button>`
          : html`<button class="bigbtn" data-derig>De-rig${icon('arrowRight')}</button>`}
      </div>
      <p class="aside">${derigged
        ? html`Your session is waiting in the <b>Log</b> tab until you write it up.`
        : html`Swap or fault a single piece from its card above. Finished sailing but not ready to
            write it up? De-rig now, your session waits for you in the <b>Log</b> tab.`}</p>
    </div>`;
}

function headline(sail, board) {
  const bits = [];
  if (sail && sail.item) bits.push(`${num(sail.item.size_value)} ${modelWord(sail.item)} rig`);
  else if (sail && sail.custom) bits.push('your own sail rig');
  if (board && board.item) bits.push(modelWord(board.item, true));
  else if (board && board.custom) bits.push('your own board');
  return bits.join(', ') || 'Your rig';
}

function modelWord(item, full = false) {
  const model = String(item.model || '').trim();
  if (full) return model;
  return model.split(/\s+/)[0] || item.manufacturer || 'sail';
}

/**
 * The rigging steps. Every number in them comes from the sail's own luff and
 * boom and the extension the cascade settled on, so they match the kit in the
 * member's hands rather than describing rigging in general.
 */
function rigGuide(setup) {
  const by = Object.fromEntries(setup.pieces.map((p) => [p.role, p]));
  const settings = (by.ext && by.ext.settings) || (by.mast && by.mast.settings) || {};
  const extCm = settings.ext_cm;
  const headCm = settings.head_cm;
  const boomCm = (by.boom && by.boom.settings && by.boom.settings.boom_cm) ?? null;
  const luff = by.sail && by.sail.item ? by.sail.item : null;
  const cammed = luff && luff.cams;

  return html`
    <div class="howto">
      <button class="hhead" data-howto>
        <span class="hplay">${icon('play')}</span>
        <span class="hm">
          <span class="ht">How to rig this</span>
          <span class="hs">Six steps, with this rig's numbers</span>
        </span>
        <span class="hchev">${icon('chevronDown')}</span>
      </button>
      <div class="hbody">
        <div class="steps">
          <div class="stephead">Follow the steps</div>
          <ol>
            <li>Slide the <b>mast</b> into the luff sleeve, tip first, until it seats at the top.</li>
            <li>Fit the <b>extension</b> at the base${extCm != null
              ? html` and set it to <b>${num(extCm)} cm</b>`
              : ''}${headCm > 0 ? html`, leaving <b>${num(headCm)} cm</b> of mast out of the head` : ''}.</li>
            <li>Thread the downhaul, then pull it tight. The sail looks loose until this is done.</li>
            <li>Clamp the <b>boom</b> on at shoulder height${boomCm != null
              ? html` and set the outhaul to <b>${num(boomCm)} cm</b>`
              : ''}.</li>
            <li>Tension the outhaul until the foot just flattens, then check the leech falls away cleanly at the top.</li>
            <li>Attach the <b>base</b> to the board, carry the rig down leech-first, and keep the nose into wind.</li>
          </ol>
          <p class="stepnote">${cammed
            ? 'This sail is cambered: seat each cam over the mast before you tension the downhaul, and expect it to fight you. Ask a committee member if it is your first time.'
            : 'Numbers come from this sail\'s luff and boom, so they match the kit you actually picked.'}</p>
        </div>
      </div>
    </div>`;
}

function pieceCard(piece) {
  const item = piece.item;
  const name = item ? `${item.manufacturer} ${item.model}` : (piece.custom && piece.custom.label) || `Your own ${piece.role_label.toLowerCase()}`;
  const kind = item ? (item.rig_kind || item.component_type) : piece.role;
  const rating = item ? item.rating : null;
  const faults = item ? item.faults : [];

  return html`
    <div class="kitem">
      <div class="khead" data-piece="${piece.role}">
        <button class="kthumb" data-open-item="${item ? item.id : ''}" aria-label="${name}">
          ${artFor(kind)}
        </button>
        <span class="kmid">
          <span class="k">${piece.role_label}</span>
          <span class="nm">${name}</span>
          ${item && item.spot
            ? html`<button class="spotlink" data-spot="${item.spot}"
                    data-note="${piece.spot_description || ''}">${item.spot}${icon('camera')}</button>`
            : html`<span class="spotlink">yours, not the club's</span>`}
        </span>
        <span class="kchev">${icon('chevronDown')}</span>
      </div>
      <div class="kbody">
        <dl class="kspecs">${specPairs(piece).map((pair) => html`
          <div><dt>${pair[0]}</dt><dd>${pair[1]}</dd></div>`)}</dl>
        ${rating ? html`
          <div class="krate">
            ${rating.n
              ? html`${starRow(rating.stars)}<span class="rn">${num(rating.stars)}</span>
                  <span class="rc">${rating.n} ${rating.n === 1 ? 'vote' : 'votes'}</span>`
              : html`<span class="rc">Not yet rated</span>`}
          </div>` : ''}
        ${faults.map((fault) => html`
          <div class="kflag">${icon('warning')}<span>${fault.title}${
            fault.severity === 'usable' ? ' — still usable' : ''}</span></div>`)}
        ${piece.notes && piece.notes.length ? html`
          <div class="knotes">
            ${piece.notes.map((note) => html`
              <div class="kn"><span class="a">${note.who || 'A member'}</span><p>${note.body}</p></div>`)}
          </div>` : ''}
        <div class="kacts">
          <button class="kact swap" data-swap>${icon('refresh')}Change piece</button>
          ${item
            ? html`<button class="kact fault" data-fault="${item.id}">${icon('warning')}Report a fault</button>`
            : ''}
        </div>
      </div>
    </div>`;
}

/** Four facts per piece: enough to check you grabbed the right thing. */
function specPairs(piece) {
  const skip = new Set(['Manufacturer', 'Model', 'Site', 'Spot', 'Notes']);
  const pairs = (piece.spec || [])
    .filter((row) => !skip.has(row.label) && row.value !== '—')
    .map((row) => [row.label, row.value]);

  const settings = piece.settings || {};
  if (settings.ext_cm != null && piece.role === 'ext') pairs.unshift(['Set to', `${num(settings.ext_cm)} cm`]);
  if (settings.boom_cm != null && piece.role === 'boom') pairs.unshift(['Set to', `${num(settings.boom_cm)} cm`]);
  if (settings.head_cm > 0 && piece.role === 'mast') pairs.unshift(['Head open', `${num(settings.head_cm)} cm`]);

  if (!pairs.length && piece.custom) {
    return Object.entries(piece.custom)
      .filter(([key, value]) => value != null && ['m2', 'luff', 'boom', 'len', 'min', 'max', 'vol', 'box', 'diam'].includes(key))
      .slice(0, 4)
      .map(([key, value]) => [key, String(value)]);
  }
  return pairs.slice(0, 4);
}
