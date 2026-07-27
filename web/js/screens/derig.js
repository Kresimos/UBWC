/**
 * De-rig — the put-it-back checklist.
 *
 * De-rig is guidance only: it changes no records, because rigging never moved
 * the kit's location. It lists every piece taken out with the spot it belongs
 * in, so a newcomer can put kit away correctly without asking.
 *
 * It can be finished two ways with the same result — tick every box, or press
 * confirm straight away if the kit is already away. The checklist is an aid,
 * not a gate. On confirmation the member lands in the logbook, where the
 * un-logged-session prompt is waiting.
 */
import { html, mount, onClick } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { store, setSetup } from '../store.js';
import { refreshSetup } from '../ui/chrome.js';
import { lightbox, toast } from '../ui/overlay.js';
import { go, back } from '../router.js';
import { building } from '../rig/session.js';

export async function render(root) {
  let setup = store.setup || (await refreshSetup());
  // De-rig only makes sense on a rig you are still out on.
  if (!setup || setup.status !== 'active') {
    go(setup ? '/log' : '/rig', { replace: true });
    return;
  }

  const done = new Set();

  mount(root, screen(setup));
  const fill = root.querySelector('[data-fill]');
  const progress = root.querySelector('[data-progress]');
  const button = root.querySelector('[data-confirm]');
  const helper = root.querySelector('[data-helper]');
  const total = setup.pieces.length;

  function repaint() {
    root.querySelectorAll('.crow').forEach((row) => {
      row.classList.toggle('on', done.has(row.getAttribute('data-check')));
    });
    fill.style.width = `${(done.size / total * 100).toFixed(1)}%`;
    progress.textContent = `${done.size} of ${total} away`;
    const all = done.size === total;
    button.classList.toggle('done', all);
    button.firstChild.nodeValue = all ? 'Everything away, take me to the log' : 'All away, take me to the log';
    helper.textContent = all
      ? 'Every piece is back. Confirming opens the logbook with this session ready.'
      : 'Tick everything, or just confirm. Either way you land in the logbook.';
  }

  root.querySelector('[data-back]').addEventListener('click', () => back('/setup'));

  onClick(root, 'data-check', (value, node, event) => {
    if (event.target.closest('[data-spot]')) return;
    if (done.has(value)) done.delete(value);
    else done.add(value);
    repaint();
  });

  onClick(root, 'data-spot', (value, node, event) => {
    event.stopPropagation();
    lightbox({ title: value, sub: node.getAttribute('data-note') || 'No description recorded for this spot yet.' });
  });

  button.addEventListener('click', async () => {
    try {
      const data = await api.derig(setup.id);
      setSetup(data.setup);
      // The rig is over, so the half-built one Build and Your rig share goes
      // with it — otherwise the Rig tab reopens a setup already put away.
      building.clear();
      toast('De-rigged. Your session is waiting in the log.');
      go('/log', { replace: true });
    } catch (error) {
      toast(error.message, true);
    }
  });

  repaint();
}

function screen(setup) {
  return html`
    <div class="appbar">
      <div class="row">
        <button class="backbtn" data-back aria-label="Back">${icon('back')}</button>
        <span class="ttl">De-rig</span>
        <span class="site">${icon('pin')}${setup.site || store.site}</span>
      </div>
    </div>

    <div class="body pad">
      <div class="ask">
        <h2>Is everything back where it came from?</h2>
        <p>Tick each piece as you put it away, or confirm the lot if you are already done.</p>
      </div>

      <div class="prog">
        <span class="track"><span class="fill" data-fill style="width:0%"></span></span>
        <span class="lb" data-progress>0 of ${setup.pieces.length} away</span>
      </div>

      <div class="checks">
        ${setup.pieces.map(checkRow)}
      </div>

      <div class="guide">
        ${icon('info')}
        <p>These spots are where each piece is recorded as living. Nothing here changes the
          catalogue: if a piece genuinely lives somewhere else now, a committee member moves it.</p>
      </div>
    </div>

    <div class="actionbar">
      <button class="bigbtn" data-confirm>All away, take me to the log
        ${icon('arrowRight')}</button>
      <span class="helper" data-helper>Tick everything, or just confirm. Either way you land in the logbook.</span>
    </div>`;
}

function checkRow(piece) {
  const item = piece.item;
  const name = item ? `${item.manufacturer} ${item.model}` : (piece.custom && piece.custom.label) || `Your own ${piece.role_label.toLowerCase()}`;
  const spot = item ? item.spot : null;
  return html`
    <button class="crow" data-check="${piece.role}">
      <span class="box">${icon('tick')}</span>
      <span class="cm">
        <span class="k">${piece.role_label}</span>
        <span class="nm">${name}</span>
        ${item && spot
          ? html`<span class="to" data-spot="${spot}" data-note="${piece.spot_description || ''}">
              ${icon('pin')}${spot}</span>`
          : html`<span class="to">${icon('pin')}yours, keep hold of it</span>`}
      </span>
    </button>`;
}
