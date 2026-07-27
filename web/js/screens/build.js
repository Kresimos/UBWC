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
 *
 * The size target is meant to be found by feel, on a beach, in gloves, so it
 * takes three kinds of input for the same thing: the whole left half of the row
 * is "smaller" and the whole right half is "bigger", a drag or a scroll over it
 * runs through the sizes, and each step ticks. Because a gesture must not have
 * the element it started on pulled out from under it, the picker is drawn once
 * and updated in place — only the results below it are re-rendered.
 */
import { html, mount, on, onClick } from '../dom.js';
import { icon, artFor } from '../icons.js';
import { api } from '../api.js';
import { store, siteLabel, subscribe } from '../store.js';
import { conditionClass, worstFault } from '../ui/bits.js';
import { pickSite } from '../ui/chrome.js';
import { lightbox, toast } from '../ui/overlay.js';
import { haptic, TICK, PICK } from '../ui/haptics.js';
import { go, back } from '../router.js';
import { building } from '../rig/session.js';
import {
  TARGETS, TARGET_KEYS, SLOTS, matches, matchChip, tagsFor, nearestStocked, clampTarget,
  sizeBits, modelShort,
} from '../rig/engine.js';

const VIEW_KEY = 'ubwc.buildview';

/** How far a drag or a scroll travels per size step, in pixels. */
const DRAG_PER_STEP = 22;
const WHEEL_PER_STEP = 40;

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
  // the flow opens on whichever step it belongs to.
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
  const valueNode = root.querySelector('[data-value]');
  const unitNode = root.querySelector('[data-unit]');
  const tagsNode = root.querySelector('[data-tags]');
  const countNode = root.querySelector('[data-count]');
  const resultsNode = root.querySelector('[data-results]');
  const helperNode = root.querySelector('[data-helper]');

  // ---------------------------------------------------------------- painting
  function paint() {
    const key = state.step;
    const config = TARGETS[key];
    const active = state.tags[key];
    const found = matches(kit, key, state.target[key], active);

    mount(stepsNode, TARGET_KEYS.map(stepTab));
    valueNode.textContent = state.target[key].toFixed(config.dp);
    unitNode.textContent = config.unit;

    mount(tagsNode, state.chips[key].length ? html`
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
      </div>` : '');

    mount(countNode, countLabel(found.length, key, active));
    root.querySelectorAll('[data-view]').forEach((button) => {
      button.classList.toggle('on', button.getAttribute('data-view') === state.view);
    });

    mount(resultsNode, found.length
      ? html`<div class="${state.view === 'grid' ? 'grid' : 'list'}">
          ${found.map((piece) => tile(key, piece))}</div>`
      : emptyState(key, active));

    mount(helperNode, active.length
      ? html`<p class="helper">Cleared a chip by mistake? Tap the × on it, or the circle to reset the lot.</p>`
      : '');
  }

  /** The number alone, for the frames of a drag between full repaints. */
  function paintValue() {
    valueNode.textContent = state.target[state.step].toFixed(TARGETS[state.step].dp);
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
    const flag = fault
      ? html`<button class="flagchip" data-fault="${piece.id}"
              aria-label="What is wrong with this ${config.noun}">${icon('warning')}Fault</button>`
      : '';
    const grid = state.view === 'grid';
    // A div rather than a button: the fault chip inside it is itself a button,
    // and a button inside a button is not a thing a browser will honour.
    return html`
      <div class="card" role="button" tabindex="0" data-pick="${piece.id}">
        <span class="shot">${artFor(config.kind)}${grid ? html`${chip}${flag}` : ''}</span>
        <span class="meta">
          <span class="size">${size ? size.v : '—'}${size ? html`<small>${size.u}</small>` : ''}</span>
          <span class="nm">${piece.mfr} · ${modelShort(piece)}</span>
          <span class="cond ${conditionClass(piece.cond)}">${piece.cond || 'Condition unknown'}</span>
          ${grid ? '' : html`${chip}${flag}`}
        </span>
      </div>`;
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

  // ------------------------------------------------------------ the target
  /**
   * Move the size by `steps` detents. During a drag only the number is
   * redrawn, because rebuilding the grid on every frame would both stutter and
   * pull the element the gesture started on out of the document.
   */
  function nudge(steps, { settle = true } = {}) {
    if (!steps) return;
    const key = state.step;
    const next = clampTarget(key, state.target[key] + steps * TARGETS[key].step);
    if (next === state.target[key]) return; // already at the end of the range
    state.target[key] = next;
    building.setTarget(key, next);
    haptic(TICK);
    if (settle) paint();
    else paintValue();
  }

  let settleTimer = null;
  function settleSoon() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(paint, 160);
  }

  onClick(root, 'data-nudge', (value) => nudge(Number(value)));

  // Scrolling up, or right, counts up.
  const wheel = { acc: 0 };
  on(root, 'wheel', '.picker', (event) => {
    event.preventDefault();
    wheel.acc += (-event.deltaY + event.deltaX);
    const steps = Math.trunc(wheel.acc / WHEEL_PER_STEP);
    if (!steps) return;
    wheel.acc -= steps * WHEEL_PER_STEP;
    nudge(steps, { settle: false });
    settleSoon();
  }, { passive: false });

  // Swiping down, or left, counts up — the content moves the other way, which
  // is the same direction of travel as the scroll above.
  let drag = null;
  on(root, 'touchstart', '.picker', (event) => {
    const touch = event.touches[0];
    drag = { x: touch.clientX, y: touch.clientY, acc: 0 };
  }, { passive: true });

  on(root, 'touchmove', '.picker', (event) => {
    if (!drag) return;
    const touch = event.touches[0];
    const down = touch.clientY - drag.y;
    const left = drag.x - touch.clientX;
    drag.x = touch.clientX;
    drag.y = touch.clientY;
    // Whichever axis the finger is actually travelling on, so a diagonal drag
    // does not count twice.
    drag.acc += Math.abs(down) >= Math.abs(left) ? down : left;
    const steps = Math.trunc(drag.acc / DRAG_PER_STEP);
    // Only a move that actually turns into a step is cancelled, and cancelling
    // is what tells the browser this touch was a drag rather than a tap. Doing
    // it on every move, including the pixel of wobble in an ordinary press,
    // swallowed the click, which is why + and − did nothing on a phone. The
    // row cannot scroll the page either way: `.picker` is `touch-action: none`.
    if (!steps) return;
    event.preventDefault();
    drag.acc -= steps * DRAG_PER_STEP;
    nudge(steps, { settle: false });
  }, { passive: false });

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    paint();
  };
  on(root, 'touchend', '.picker', endDrag, { passive: true });
  on(root, 'touchcancel', '.picker', endDrag, { passive: true });

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

  /**
   * The fault flag is readable where it is flagged. A member choosing between
   * two sails needs to know whether "Fault" means a scuffed batten or a torn
   * panel, and sending them to the item page to find out costs them their
   * place in the list.
   */
  onClick(root, 'data-fault', (value, _node, event) => {
    // Both handlers are delegated from the same root, so stopPropagation is not
    // enough: it stops the event climbing, not the next listener on this node.
    // Without this, reading a fault also picked the piece it is a fault on.
    event.stopImmediatePropagation();
    const piece = kit.find((item) => item.id === Number(value));
    const faults = (piece && piece.faults) || [];
    if (!faults.length) return;
    lightbox({
      glyph: 'warning',
      title: faults.length === 1 ? faults[0].t : `${faults.length} reported faults`,
      sub: faults.map((fault) => {
        const body = fault.d || 'No description was recorded with this one.';
        const label = faults.length > 1 ? `${fault.t} — ` : '';
        return `${label}${body}${fault.s === 'out_of_action' ? ' (out of action)' : ''}`;
      }).join('\n\n'),
    });
  });

  function choose(value) {
    const key = state.step;
    building.pick(key, Number(value));
    building.setTarget(key, state.target[key]);
    haptic(PICK);
    // Picking is the only way forward: on to the step still open, or out to the
    // rig once both are answered.
    const next = TARGET_KEYS.find((k) => !resolved(k));
    if (next) {
      state.step = next;
      paint();
      root.querySelector('[data-body]').scrollTop = 0;
    } else {
      go('/setup');
    }
  }

  // The fault chip lives inside the tile, so anything aimed at it is a question
  // about the piece rather than a decision to take it.
  const onFlag = (event) => Boolean(event.target.closest('[data-fault]'));

  onClick(root, 'data-pick', (value, _node, event) => { if (!onFlag(event)) choose(value); });
  on(root, 'keydown', '[data-pick]', (event, node) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (onFlag(event)) return;
    event.preventDefault();
    choose(node.getAttribute('data-pick'));
  });

  const unsubscribe = subscribe(() => {
    const label = root.querySelector('[data-sitelabel]');
    if (label) label.textContent = siteLabel();
  });

  paint();
  return () => { unsubscribe(); clearTimeout(settleTimer); };
}

// ------------------------------------------------------------------ markup
/**
 * The picker lives in the shell rather than in the repaint, so a drag keeps
 * the element it started on. Each arrow fills its whole half of the row, with
 * the glyph sitting where the sketch put it — the target is the half, not the
 * glyph.
 */
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

    <div class="body" data-body>
      <div class="picker">
        <button data-nudge="-1" aria-label="Smaller"><span>−</span></button>
        <div class="val" aria-live="polite"><b data-value></b><i data-unit></i></div>
        <button data-nudge="1" aria-label="Bigger"><span>+</span></button>
      </div>
      <div data-tags></div>
      <div class="subbar">
        <span class="count" data-count></span>
        <div class="viewtoggle">
          <button data-view="grid" aria-label="Grid view">${icon('gridIcon')}</button>
          <button data-view="list" aria-label="List view">${icon('listIcon')}</button>
        </div>
      </div>
      <div data-results></div>
      <div data-helper></div>
    </div>`;
}

const firstWord = (text) => String(text || '').trim().split(/\s+/)[0] || '';

/** Answered one way or the other: picked, or deliberately stepped past. */
const settled = (key) => Boolean(building.raw[key]) || building.isSkipped(key);

function listWords(words) {
  if (words.length === 1) return words[0].toLowerCase();
  return `${words.slice(0, -1).join(', ').toLowerCase()} and ${words[words.length - 1].toLowerCase()}`;
}
