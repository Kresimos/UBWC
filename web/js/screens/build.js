/**
 * Build — sail, then board, but either order and never blind.
 *
 * The whole screen is one question asked twice: what size, and which of these.
 * A member says a number with the stepper, narrows it with the same chips the
 * Catalogue uses, and taps a tile. Nothing is filtered by the other pick,
 * because a sail and a board do not constrain each other (CLAUDE.md, "The two
 * independent kit groups") — the list is only ever sorted by how near the
 * number it is, so the club's actual sizes are always visible either side of it.
 *
 * The two step tabs double as the navigation. Tapping ahead to Board without
 * picking a sail marks the sail step skipped rather than picked, so it reads as
 * still open; tapping a resolved step goes back to change it without losing the
 * other one. That is why there is no Next button: picking is the only forward.
 */
import { html, mount, onClick } from '../dom.js';
import { icon, artFor } from '../icons.js';
import { api } from '../api.js';
import { store, siteLabel, subscribe } from '../store.js';
import { conditionClass, worstFault } from '../ui/bits.js';
import { pickSite } from '../ui/chrome.js';
import { toast } from '../ui/overlay.js';
import { go, back } from '../router.js';
import { building } from '../rig/session.js';
import {
  TARGETS, TARGET_KEYS, SLOTS, matches, matchChip, tagsFor, nearestStocked, clampTarget,
  sizeBits, modelShort,
} from '../rig/engine.js';

const VIEW_KEY = 'ubwc.buildview';

export async function render(root, params) {
  // Coming back to the Rig tab part-way through means "show me my rig", not
  // "start again". An explicit step (the Change link on Your rig) or a pinned
  // item says otherwise, and those are the only ways back into Build.
  if (!params.step && !params.pin && TARGET_KEYS.every(settled)) {
    go('/setup', { replace: true });
    return undefined;
  }

  const site = store.site === 'all' ? null : store.site;
  const data = await api.rigKit(site);
  const kit = data.kit;

  const state = {
    step: 'sail',
    view: localStorage.getItem(VIEW_KEY) || 'grid',
    tags: { sail: [], board: [] },
    target: {},
    chips: {},
  };

  const resolvedPiece = (key) => kit.find((piece) => piece.id === building.raw[key]) || null;
  const resolved = (key) => Boolean(resolvedPiece(key)) || building.isSkipped(key);

  TARGET_KEYS.forEach((key) => {
    state.chips[key] = tagsFor(kit.filter((piece) => piece.kind === TARGETS[key].kind), key);
    const remembered = building.target(key);
    state.target[key] = remembered != null
      ? clampTarget(key, remembered)
      : clampTarget(key, nearestStocked(kit, key, TARGETS[key].fallback));
  });

  // Arriving from a catalogue item: that piece is simply already picked, and
  // the flow opens on whichever step it belongs to. Kit the two steps do not
  // ask for (a mast, a boom) is a recommendation, not a choice, so it is not
  // something this screen can honour.
  if (params.pin) {
    const pinned = kit.find((piece) => piece.id === Number(params.pin));
    const key = pinned && TARGET_KEYS.find((k) => TARGETS[k].kind === pinned.kind);
    if (key) {
      building.pick(key, pinned.id);
      state.target[key] = clampTarget(key, TARGETS[key].size(pinned) ?? state.target[key]);
      building.setTarget(key, state.target[key]);
      state.step = key;
    } else if (pinned) {
      const slot = SLOTS.find((s) => s.kind === pinned.kind);
      toast(slot
        ? `Pick a sail and a board, and the app suggests the ${slot.noun} itself.`
        : 'Build asks for a sail and a board; the rest follows from them.');
    } else {
      toast('That piece is not available at this site.', true);
    }
  }

  // Open on the step asked for, or on the first one still to answer, so coming
  // back to change one thing does not start over.
  if (params.step && TARGET_KEYS.includes(params.step)) state.step = params.step;
  else if (!params.pin) state.step = TARGET_KEYS.find((key) => !resolved(key)) || 'sail';

  mount(root, shell());
  const stepsNode = root.querySelector('[data-steps]');
  const bodyNode = root.querySelector('[data-body]');

  function paint() {
    const key = state.step;
    const config = TARGETS[key];
    const active = state.tags[key];
    const found = matches(kit, key, state.target[key], active);

    mount(stepsNode, TARGET_KEYS.map(stepTab));
    mount(bodyNode, html`
      <div class="picker">
        <button data-nudge="-1" aria-label="Smaller">−</button>
        <div class="val" aria-live="polite">
          <b>${state.target[key].toFixed(config.dp)}</b><i>${config.unit}</i>
        </div>
        <button data-nudge="1" aria-label="Bigger">+</button>
      </div>

      ${state.chips[key].length ? html`
        <div class="tagrow">
          ${active.length
            ? html`<button class="clearall" data-clear-tags aria-label="Clear all filters">${icon('close')}</button>`
            : ''}
          <div class="tagscroll">
            ${state.chips[key].map((tag) => html`
              <button class="tag ${active.includes(tag) ? 'on' : ''}" data-tag="${tag}">
                ${active.includes(tag) ? html`<span class="x">×</span>` : ''}${tag}
              </button>`)}
          </div>
        </div>` : ''}

      <div class="subbar">
        <span class="count">${countLabel(found.length, key, active)}</span>
        <div class="viewtoggle">
          <button data-view="grid" class="${state.view === 'grid' ? 'on' : ''}"
                  aria-label="Grid view">${icon('gridIcon')}</button>
          <button data-view="list" class="${state.view === 'list' ? 'on' : ''}"
                  aria-label="List view">${icon('listIcon')}</button>
        </div>
      </div>

      ${found.length
        ? html`<div class="${state.view === 'grid' ? 'grid' : 'list'}">
            ${found.map((piece) => tile(key, piece))}</div>`
        : emptyState(key, active)}

      ${active.length ? html`
        <p class="helper">Cleared a chip by mistake? Tap the × on it, or the circle to reset the lot.</p>`
        : ''}`);
  }

  function stepTab(key) {
    const piece = resolvedPiece(key);
    const config = TARGETS[key];
    const index = TARGET_KEYS.indexOf(key) + 1;
    let cls = 'step';
    if (state.step === key) cls += ' on';
    if (piece) cls += ' done';
    else if (building.isSkipped(key)) cls += ' skip';

    const size = piece && sizeBits(config.kind, piece);
    return html`
      <button class="${cls}" data-step="${key}">
        <b>${piece ? icon('tick') : index}</b>
        <span>${piece
          ? `${size ? size.v : ''} ${firstWord(piece.mfr)}`.trim()
          : config.label}</span>
      </button>`;
  }

  function tile(key, piece) {
    const config = TARGETS[key];
    const size = sizeBits(config.kind, piece);
    const fault = worstFault((piece.faults || []).map((f) => ({ severity: f.s, title: f.t })));
    // The size-match badge sits over the shot in the grid, the way the
    // Catalogue's rating chip does; laid flat there is no shot to sit on, so it
    // joins the line of facts instead.
    const chip = html`<span class="matchchip">${matchChip(key, piece, state.target[key])}</span>`;
    const flag = fault ? html`<span class="flagchip">${icon('warning')}Fault</span>` : '';
    const grid = state.view === 'grid';
    return html`
      <button class="card" data-pick="${piece.id}">
        <span class="shot">${artFor(config.kind)}${grid ? html`${chip}${flag}` : ''}</span>
        <span class="meta">
          <span class="size">${size ? size.v : '—'}${size ? html`<small>${size.u}</small>` : ''}</span>
          <span class="nm">${piece.mfr} · ${modelShort(piece)}</span>
          <span class="cond ${conditionClass(piece.cond)}">${piece.cond || 'Condition unknown'}</span>
          ${grid ? '' : html`${chip}${flag}`}
        </span>
      </button>`;
  }

  function countLabel(count, key, active) {
    const config = TARGETS[key];
    const near = `near ${state.target[key].toFixed(config.dp)} ${config.unit}`;
    if (active.length) return html`<b>${count}</b> match, ${near}`;
    return html`<b>${count}</b> ${config.noun}${count === 1 ? '' : 's'} ${near}`;
  }

  function emptyState(key, active) {
    const config = TARGETS[key];
    return html`
      <div class="emptystate">
        ${icon('box')}
        <b>No ${config.noun}s here</b>
        <span>${active.length
          ? `Nothing at ${siteLabel().toLowerCase()} is ${listWords(active)}. Drop a chip to widen it.`
          : `No ${config.noun} is recorded at ${siteLabel().toLowerCase()}.`}</span>
      </div>`;
  }

  // ---------------------------------------------------------------- events
  root.querySelector('[data-back]').addEventListener('click', () => back('/catalogue'));
  root.querySelector('[data-pick-site]').addEventListener('click', async () => {
    if (await pickSite({ allowAll: false })) go('/rig', { replace: true });
  });

  onClick(root, 'data-step', (key) => {
    if (key === state.step) return;
    // Stepping past something unanswered leaves it open rather than silently
    // forgotten: the badge becomes a dashed ring, and it can be filled any time.
    const from = TARGET_KEYS.indexOf(state.step);
    const to = TARGET_KEYS.indexOf(key);
    if (to > from && !resolved(state.step)) building.skip(state.step);
    state.step = key;
    paint();
  });

  onClick(root, 'data-nudge', (value) => {
    const key = state.step;
    const next = clampTarget(key, state.target[key] + Number(value) * TARGETS[key].step);
    state.target[key] = next;
    building.setTarget(key, next);
    paint();
  });

  onClick(root, 'data-tag', (tag) => {
    const active = state.tags[state.step];
    const at = active.indexOf(tag);
    if (at >= 0) active.splice(at, 1);
    else active.push(tag);
    paint();
  });

  onClick(root, 'data-clear-tags', () => {
    state.tags[state.step] = [];
    paint();
  });

  onClick(root, 'data-view', (value) => {
    state.view = value;
    localStorage.setItem(VIEW_KEY, value);
    paint();
  });

  onClick(root, 'data-pick', (value) => {
    const key = state.step;
    building.pick(key, Number(value));
    building.setTarget(key, state.target[key]);
    // Picking is the only way forward: on to the step still open, or out to the
    // rig once both are answered.
    const next = TARGET_KEYS.find((k) => !resolved(k));
    if (next) {
      state.step = next;
      paint();
      bodyNode.scrollTop = 0;
    } else {
      go('/setup');
    }
  });

  const unsubscribe = subscribe(() => {
    const label = root.querySelector('[data-sitelabel]');
    if (label) label.textContent = siteLabel();
  });

  paint();
  return unsubscribe;
}

// ------------------------------------------------------------------ markup
function shell() {
  return html`
    <div class="appbar">
      <div class="row">
        <button class="backbtn" data-back aria-label="Back">${icon('back')}</button>
        <span class="ttl">Build</span>
        <button class="site" data-pick-site>${icon('pin')}<span data-sitelabel>${siteLabel()}</span></button>
      </div>
      <div class="steps" data-steps></div>
    </div>
    <div class="body" data-body></div>`;
}

const firstWord = (text) => String(text || '').trim().split(/\s+/)[0] || '';

/** Answered one way or the other: picked, or deliberately stepped past. */
const settled = (key) => Boolean(building.raw[key]) || building.isSkipped(key);

function listWords(words) {
  if (words.length === 1) return words[0].toLowerCase();
  return `${words.slice(0, -1).join(', ').toLowerCase()} and ${words[words.length - 1].toLowerCase()}`;
}
