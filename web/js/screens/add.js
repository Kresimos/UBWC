/**
 * Add — pick what you are adding.
 *
 * One tap per component type, each opening the form tuned to that type. Adding
 * needs a name-pick (it writes to the club's ground truth), but the picker is
 * open so a member sees what is possible before being asked to sign in.
 */
import { html, mount, onClick } from '../dom.js';
import { icon, artFor } from '../icons.js';
import { store } from '../store.js';
import { whoPill } from '../ui/bits.js';
import { needUser, openIdentity } from '../ui/chrome.js';
import { go } from '../router.js';

const TYPES = [
  { key: 'sail', name: 'Sail', ex: 'm², luff, boom' },
  { key: 'board', name: 'Board', ex: 'volume, type, box' },
  { key: 'mast', name: 'Mast', ex: 'length, RDM / SDM' },
  { key: 'boom', name: 'Boom', ex: 'min / max range' },
  { key: 'fin', name: 'Fin', ex: 'box type, length' },
  { key: 'foil', name: 'Foil', ex: 'box, wing, mast' },
  { key: 'wing', name: 'Wing', ex: 'm² only' },
  { key: 'misc', name: 'Misc', ex: 'harness, spares…' },
];

export async function render(root) {
  mount(root, screen());

  root.querySelector('[data-identity]').addEventListener('click', openIdentity);

  onClick(root, 'data-type', async (value) => {
    if (!(await needUser('Adding kit writes to the club inventory, so it is signed with your name.'))) return;
    go(`/new/${value}`);
  });
}

function screen() {
  return html`
    <div class="appbar">
      <div class="row">
        <span class="ttl">Add kit</span>
        ${whoPill()}
      </div>
    </div>
    <div class="body pad">
      <p class="lead">Choose what you are adding. You can add several in a row.</p>
      <div class="typegrid">
        ${TYPES.map((type) => html`
          <button class="tcard" data-type="${type.key}">
            <span class="ic">${artFor(type.key)}</span>
            <span class="nm">${type.name}</span>
            <span class="ex">${type.ex}</span>
          </button>`)}
      </div>
      <div class="hintline">
        ${icon('info')}
        <p>Misc is the catch-all: harnesses, UJs, extensions, wetsuits, roof straps, repair kits,
          anything without its own type.</p>
      </div>
    </div>`;
}
