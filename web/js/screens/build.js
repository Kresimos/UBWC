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
import { worstFault } from '../ui/bits.js';
import { itemTile, faultPopup } from '../ui/itemTile.js';
import { pickSite } from '../ui/chrome.js';
import { haptic, TICK, PICK } from '../ui/haptics.js';
import { go, back, path } from '../router.js';
import { building } from '../rig/session.js';
import {
  TARGETS, TARGET_KEYS, matches, tagsFor, nearestStocked, clampTarget,
  sizeBits, modelShort,
} from '../rig/engine.js';

const VIEW_KEY = 'ubwc.buildview';
// Shown once, to a signed-in member who has never logged a session: what the
// number is and how to move it. Dismissed for good the moment they act on it.
const COACH_KEY = 'ubwc.buildcoach';

/** How far a drag or a scroll travels per size step, in pixels. */
const DRAG_PER_STEP = 22;
const WHEEL_PER_STEP = 40;

/* Throw and catch. Letting go of the wheel mid-flick keeps it running and
   slowing, the way a real detented dial would, so the whole size range is
   reachable from one gesture instead of several short drags. All three are in
   pixels per millisecond of finger travel except the decay, which is the time
   constant the speed falls off over. */
const FLING_START = 0.4;   // below this a lift is a stop, not a throw
const FLING_STOP = 0.05;   // slow enough to be finished
const FLING_DECAY = 240;   // ms for the speed to fall to ~a third

export async function render(root, params) {
  // Coming back to the Rig tab part-way through means "show me my rig", not
  // "start again". An explicit step (the Change link on Your rig) or a pinned
  // item says otherwise, and those are the only ways back into Build.
  if (!params.step && !params.pin && TARGET_KEYS.every(settled)) {
    go('/setup', { replace: true });
    return undefined;
  }

  const site = store.site === 'all' ? null : store.site;
  const trip = store.trip;
  // The suggestion is a nicety, not a dependency: if it cannot be worked out
  // (offline, no coordinates for the site, nobody signed in) the wheels open
  // where they always did. On a trip it is skipped outright — its wording is
  // about the wind at a home site, which is not where the member is.
  const [data, hint] = await Promise.all([
    api.rigKit(trip ? null : site, trip ? trip.id : null),
    trip ? Promise.resolve(null) : api.rigSuggest(store.site).catch(() => null),
  ]);
  const kit = data.kit;

  const state = {
    step: 'sail',
    view: localStorage.getItem(VIEW_KEY) || 'grid',
    tags: { sail: [], board: [] },
    target: {},
    chips: {},
    // Which wheels are still sitting where the app opened them. Moving one
    // retires its note: from then on the number is the member's own.
    hinted: {},
    // The one-time explainer over the sail wheel, for a signed-in member whose
    // logbook is still empty. Any nudge, pick or a tap outside it ends it for
    // good; until then the rest of the screen sits dimmed behind it.
    coach: Boolean(store.user) && hint != null && hint.sessions === 0
      && !localStorage.getItem(COACH_KEY),
  };

  const resolvedPiece = (key) => kit.find((piece) => piece.id === building.raw[key]) || null;
  const resolved = (key) => Boolean(resolvedPiece(key)) || building.isSkipped(key);

  TARGET_KEYS.forEach((key) => {
    state.chips[key] = tagsFor(kit.filter((piece) => piece.kind === TARGETS[key].kind), key);
    const remembered = building.target(key);
    // Three answers to "what size", in order of how much they know about this
    // member: what they were last on in this build, what their own logbook says
    // they rig in today's wind (suggest.py), and failing both the club default.
    const suggested = hint && hint[key] ? hint[key].value : null;
    if (remembered != null) {
      state.target[key] = clampTarget(key, remembered);
    } else if (suggested != null) {
      state.target[key] = clampTarget(key, suggested);
      state.hinted[key] = hint[key];
    } else {
      state.target[key] = clampTarget(key, nearestStocked(kit, key, TARGETS[key].fallback));
    }
  });

  // Arriving from a catalogue item ("Rig this kit"): that piece is already
  // picked, so open on the *other* half — the board step if a sail was pinned,
  // the sail step if a board was. Landing on the step you just filled would
  // leave you hunting for the one still to answer. If the other half is already
  // resolved (came back to Build with a rig underway) stay on the pinned step.
  if (params.pin) {
    const pinned = kit.find((piece) => piece.id === Number(params.pin));
    const key = pinned && TARGET_KEYS.find((k) => TARGETS[k].kind === pinned.kind);
    if (key) {
      building.pick(key, pinned.id);
      state.target[key] = clampTarget(key, TARGETS[key].size(pinned) ?? state.target[key]);
      building.setTarget(key, state.target[key]);
      const other = TARGET_KEYS.find((k) => k !== key);
      state.step = resolved(other) ? key : other;
    }
  }

  // Open on the step asked for, or on the first one still to answer, so coming
  // back to change one thing does not start over.
  if (params.step && TARGET_KEYS.includes(params.step)) state.step = params.step;
  else if (!params.pin) state.step = TARGET_KEYS.find((key) => !resolved(key)) || 'sail';

  // A member who walked here from Your rig (its back arrow, or a Change link)
  // gets a back arrow of their own, so they can return without being forced to
  // re-pick a sail or board they never meant to change. Coming in from the tab
  // bar, or from a catalogue "Rig this kit", there is nothing behind Build and
  // no arrow.
  const fromRig = params.from === 'rig';

  mount(root, shell(fromRig));
  const bodyNode = root.querySelector('[data-body]');
  const stepsNode = root.querySelector('[data-steps]');
  const valueNode = root.querySelector('[data-value]');
  const unitNode = root.querySelector('[data-unit]');
  const hintNode = root.querySelector('[data-hint]');
  const tagsNode = root.querySelector('[data-tags]');
  const countNode = root.querySelector('[data-count]');
  const resultsNode = root.querySelector('[data-results]');

  // ---------------------------------------------------------------- painting
  function paint() {
    const key = state.step;
    const config = TARGETS[key];
    const active = state.tags[key];
    const found = matches(kit, key, state.target[key], active);

    mount(stepsNode, TARGET_KEYS.map(stepTab));
    valueNode.textContent = state.target[key].toFixed(config.dp);
    unitNode.textContent = config.unit;

    // First run: the explainer floats over the dimmed kit (its own box is
    // absolutely placed, so the list stays put), in place of the caption.
    // Otherwise, where this number came from — but only while it is still the
    // app's number, because once the member moves the wheel it needs no caption.
    const coaching = state.coach && key === 'sail';
    bodyNode.classList.toggle('coached', coaching);
    mount(hintNode, coaching
      ? coachTip()
      : state.hinted[key]
        ? html`<p class="sizehint">${icon('chart')}${state.hinted[key].why}</p>`
        : '');

    // A chip is the same size whether or not it is on, and nothing is added
    // beside the row when one is: the bar used to shuffle sideways the moment
    // you picked something, which moved the chip you were about to tap next.
    // Tapping a chip again drops it, so there is no × and no reset button.
    mount(tagsNode, state.chips[key].length ? html`
      <div class="tagrow">
        <div class="tagscroll">
          ${state.chips[key].map((tag) => html`
            <button class="tag ${active.includes(tag) ? 'on' : ''}" data-tag="${tag}">${tag}</button>`)}
        </div>
      </div>` : '');

    mount(countNode, countLabel(found.length, key, active));
    root.querySelectorAll('[data-view]').forEach((button) => {
      button.classList.toggle('on', button.getAttribute('data-view') === state.view);
    });

    mount(resultsNode, found.length
      ? html`<div class="${state.view === 'grid' ? 'itemgrid' : 'itemlist'}">
          ${found.map((piece) => tile(key, piece))}</div>`
      : emptyState(key, active));

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
    return itemTile({
      grid: state.view === 'grid',
      pickAttr: 'pick',
      id: piece.id,
      art: artFor(config.kind),
      size: size ? { value: size.v, unit: size.u } : { label: '—' },
      name: `${piece.mfr} ${modelShort(piece)}`,
      type: piece.type,
      rating: piece.rate ? { stars: piece.rate.avg, n: piece.rate.n } : null,
      fault: worstFault((piece.faults || []).map((f) => ({ severity: f.s, title: f.t }))),
      saved: Boolean(piece.fav),
      faultNoun: config.noun,
    });
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

  /**
   * End the first-run explainer for good. Called by every way of engaging with
   * the wheel (a nudge, a pick) and by a tap on the dimmed area around it.
   * Returns whether it did anything, so a caller can force a full repaint.
   */
  function retireCoach() {
    if (!state.coach) return false;
    state.coach = false;
    localStorage.setItem(COACH_KEY, '1');
    return true;
  }

  function coachTip() {
    return html`
      <div class="coachtip" role="note">
        <p>Select the rough size sail you would like and the list will sort by
          closest to that size. Use the +/− buttons, swipe or scroll to change.</p>
        <p>As you record more sessions, the app will suggest a size based on the
          wind and your previous ratings.</p>
        <button type="button" data-coach-dismiss>Got it</button>
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
    delete state.hinted[key];
    building.setTarget(key, next);
    haptic(TICK);
    // A first move ends the explainer and un-dims the list, which is a full
    // repaint whatever the drag would otherwise have settled for.
    if (retireCoach() || settle) paint();
    else paintValue();
  }

  let settleTimer = null;
  function settleSoon() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(paint, 160);
  }

  onClick(root, 'data-nudge', (value) => { stopFling(); nudge(Number(value)); });

  /**
   * The throw. `speed` is the finger's last velocity in px/ms, carrying the
   * sign of the drag it came from; `carry` is the part of a step the drag had
   * already travelled, so the first detent after the lift lands where the
   * finger would have put it. It runs on animation frames and dies either when
   * it slows to nothing or when the size hits the end of its range, and any
   * new touch catches it (see touchstart below).
   */
  let fling = null;
  function stopFling() {
    if (!fling) return;
    cancelAnimationFrame(fling.frame);
    fling = null;
    paint();
  }

  function throwWheel(speed, carry) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || Math.abs(speed) < FLING_START) return false;
    fling = { v: speed, acc: carry, t: performance.now(), frame: 0 };
    const tick = (now) => {
      if (!fling) return;
      const dt = Math.min(now - fling.t, 50); // a backgrounded tab must not leap
      fling.t = now;
      fling.acc += fling.v * dt;
      fling.v *= Math.exp(-dt / FLING_DECAY);
      const steps = Math.trunc(fling.acc / DRAG_PER_STEP);
      if (steps) {
        fling.acc -= steps * DRAG_PER_STEP;
        const before = state.target[state.step];
        nudge(steps, { settle: false });
        // Nothing moved, so the wheel is against the end of its range and
        // there is nothing left to coast through.
        if (state.target[state.step] === before) { stopFling(); return; }
      }
      if (Math.abs(fling.v) < FLING_STOP) { stopFling(); return; }
      fling.frame = requestAnimationFrame(tick);
    };
    fling.frame = requestAnimationFrame(tick);
    return true;
  }

  // Scrolling up, or right, counts up.
  const wheel = { acc: 0 };
  on(root, 'wheel', '.picker', (event) => {
    event.preventDefault();
    stopFling();
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
    const button = event.target.closest('[data-nudge]');
    // A finger on a wheel that is still coasting catches it, and that touch
    // does nothing else: you stopped it, you did not also press what was under
    // it. `caught` is what carries that as far as touchend.
    const caught = Boolean(fling);
    stopFling();
    // Remembered so a tap that never turns into a drag can still be honoured
    // on touchend, rather than left to a synthesised click that a phone's own
    // tap-vs-scroll threshold (typically well under our own step size) may
    // have already decided not to send.
    drag = {
      x: touch.clientX, y: touch.clientY, acc: 0, moved: false, caught,
      nudge: button && button.getAttribute('data-nudge'),
      v: 0, t: event.timeStamp,
    };
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
    const travel = Math.abs(down) >= Math.abs(left) ? down : left;
    drag.acc += travel;
    // Speed for the throw, smoothed so one jittery frame at the moment of
    // lifting off does not decide how far the wheel runs on.
    const dt = event.timeStamp - drag.t;
    if (dt > 0) {
      drag.v = drag.v * 0.7 + (travel / dt) * 0.3;
      drag.t = event.timeStamp;
    }
    const steps = Math.trunc(drag.acc / DRAG_PER_STEP);
    // Only a move that actually turns into a step is cancelled, and cancelling
    // is what tells the browser this touch was a drag rather than a tap. Doing
    // it on every move, including the pixel of wobble in an ordinary press,
    // swallowed the click, which is why + and − did nothing on a phone. The
    // row cannot scroll the page either way: `.picker` is `touch-action: none`.
    if (!steps) return;
    event.preventDefault();
    drag.moved = true;
    drag.acc -= steps * DRAG_PER_STEP;
    nudge(steps, { settle: false });
  }, { passive: false });

  const endDrag = (event) => {
    if (!drag) return;
    const { moved, nudge: pressed, caught, v, acc } = drag;
    // A finger that went stale between frames was resting, not travelling, so
    // the wheel stops where it is rather than being thrown by an old reading.
    const stale = event.timeStamp - drag.t > 90;
    drag = null;
    // A tap that stayed under the step threshold still moved the finger more
    // than a phone's own (smaller) tolerance for calling it a tap, so the
    // click this touch would have synthesised cannot be relied on. The app
    // takes the press itself rather than a gesture the browser may or may not
    // forward. A tap that only caught a coasting wheel is not that press.
    if (!moved && pressed && !caught) {
      event.preventDefault();
      nudge(Number(pressed));
    }
    // Let go mid-flick and the wheel keeps running, slowing as it goes.
    if (moved && !stale && throwWheel(v, acc)) return;
    paint();
  };
  on(root, 'touchend', '.picker', endDrag, { passive: false });
  on(root, 'touchcancel', '.picker', () => { drag = null; stopFling(); }, { passive: true });

  // ---------------------------------------------------------------- events
  root.querySelector('[data-pick-site]').addEventListener('click', async () => {
    if (await pickSite({ allowAll: false })) go('/rig', { replace: true });
  });

  const backBtn = root.querySelector('[data-back]');
  if (backBtn) backBtn.addEventListener('click', () => back('/setup'));

  // The explainer goes away on its "Got it", and on a tap anywhere in the body
  // that is not the wheel itself — the dimmed kit below it is `pointer-events:
  // none`, so those taps land here rather than selecting a sail by accident.
  onClick(root, 'data-coach-dismiss', () => { if (retireCoach()) paint(); });
  bodyNode.addEventListener('click', (event) => {
    if (!state.coach) return;
    if (event.target.closest('.picker, .coachtip')) return;
    if (retireCoach()) paint();
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
  onClick(root, 'data-flag', (value, _node, event) => {
    // Both handlers are delegated from the same root, so stopPropagation is not
    // enough: it stops the event climbing, not the next listener on this node.
    // Without this, reading a fault also picked the piece it is a fault on.
    event.stopImmediatePropagation();
    const piece = kit.find((item) => item.id === Number(value));
    const faults = ((piece && piece.faults) || [])
      .map((f) => ({ title: f.t, description: f.d, severity: f.s }));
    faultPopup(faults);
  });

  function choose(value) {
    const key = state.step;
    retireCoach();
    building.pick(key, Number(value));
    building.setTarget(key, state.target[key]);
    haptic(PICK);
    // Picking is the only way forward, and it is the only thing that counts as
    // an answer: a step that was skipped past still has to be picked, so land
    // on it (dropping the skip so it reads as the live step, not a stepped-past
    // one) rather than falling through to the rig with a hole in it.
    const next = TARGET_KEYS.find((k) => !resolvedPiece(k));
    if (next) {
      building.reopen(next);
      state.step = next;
      paint();
      root.querySelector('[data-body]').scrollTop = 0;
    } else {
      go('/setup');
    }
  }

  // The fault chip lives inside the tile, so anything aimed at it is a question
  // about the piece rather than a decision to take it.
  const onFlag = (event) => Boolean(event.target.closest('[data-flag]'));

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
  return () => {
    unsubscribe();
    clearTimeout(settleTimer);
    // Leaving the screen mid-throw must not leave a frame loop repainting a
    // tree that is no longer on the page.
    if (fling) { cancelAnimationFrame(fling.frame); fling = null; }
    // Walking away from Build throws the half-made pick away: opening the Rig
    // tab again should ask the size question fresh, not resume a sail you
    // half-chose and wandered off from. Finishing Build hands the picks on to
    // Your rig, and the in-place moves (the site picker, a step tab) stay on
    // /rig — those keep what is chosen; anything else clears it.
    const dest = path().split('?')[0];
    if (dest !== '/rig' && dest !== '/setup') building.clear();
  };
}

// ------------------------------------------------------------------ markup
/**
 * The picker lives in the shell rather than in the repaint, so a drag keeps
 * the element it started on. Each arrow fills its whole half of the row, with
 * the glyph sitting where the sketch put it — the target is the half, not the
 * glyph.
 */
function shell(showBack) {
  return html`
    <div class="appbar">
      <div class="row">
        ${showBack ? html`<button class="backbtn" data-back aria-label="Back to your rig">${icon('back')}</button>` : ''}
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
      <div data-hint></div>
      <div data-tags></div>
      <div class="subbar">
        <span class="count" data-count></span>
        <div class="viewtoggle">
          <button data-view="grid" aria-label="Grid view">${icon('gridIcon')}</button>
          <button data-view="list" aria-label="List view">${icon('listIcon')}</button>
        </div>
      </div>
      <div data-results></div>
    </div>`;
}

const firstWord = (text) => String(text || '').trim().split(/\s+/)[0] || '';

/** Answered one way or the other: picked, or deliberately stepped past. */
const settled = (key) => Boolean(building.raw[key]) || building.isSkipped(key);

function listWords(words) {
  if (words.length === 1) return words[0].toLowerCase();
  return `${words.slice(0, -1).join(', ').toLowerCase()} and ${words[words.length - 1].toLowerCase()}`;
}
