/**
 * Rig — the seven-step cascade.
 *
 * Settled steps collapse to a one-line summary, and only the step being asked
 * shows a list; the progress bar already says how many are left, so drawing the
 * steps still to come would just be noise.
 *
 * Two behaviours are worth stating outright:
 *
 *  - **nothing is picked by one tap.** The first tap opens an option in place
 *    for a closer look, with the list still around it, and only "Use this"
 *    commits. A rig is a physical commitment; a stray thumb should not make it.
 *  - **every listed option can still be finished.** The engine only offers kit
 *    that leaves a completable rig, so the cascade never dead-ends. The one way
 *    back into an impossible state is a hand-entered piece, which sidesteps the
 *    filtering — so after one of those the app re-checks and says, plainly,
 *    which earlier pick it had to drop and why.
 */
import { html, mount, raw, toHtml } from '../dom.js';
import { icon, artFor } from '../icons.js';
import { api } from '../api.js';
import { store, siteLabel, setSetup } from '../store.js';
import { needUser, pickSite, refreshSetup } from '../ui/chrome.js';
import { confirmSheet, toast } from '../ui/overlay.js';
import { go, back } from '../router.js';
import {
  STEPS, createEngine, stepIndex, stepFor, pieceName, shortName, sizeBits, specTags,
  specLine, chipsFor, consequence, rigPlan, planLabel, passes, whyMastFails, fmt, span,
} from '../rig/engine.js';
import { CUSTOM, activeSegs, toNumber } from '../rig/custom.js';

export async function render(root, params) {
  // The Rig tab is where you are when you are out on kit, so an active setup
  // owns this tab until it is de-rigged.
  const setup = await refreshSetup();
  if (setup && setup.status === 'active' && !params.pin) {
    go('/setup', { replace: true });
    return;
  }
  if (setup && setup.status === 'active' && params.pin) {
    const swap = await confirmSheet({
      title: 'You are already out on a rig',
      sub: 'One setup at a time. De-rig the one you have first, then build the next.',
      confirmLabel: 'Take me to my setup',
    });
    go(swap ? '/setup' : '/catalogue', { replace: true });
    return;
  }

  const site = store.site === 'all' ? null : store.site;
  const data = await api.rigKit(site);
  const engine = createEngine(data.kit, site || 'the club');

  const state = {
    picks: {},
    skipped: {},
    openStep: null,
    preview: null,
    justPicked: null,
    notice: null,
    customFor: null,
    draft: null,
  };

  // Arriving from a catalogue item: that piece is simply already picked, with
  // no special treatment, and every other step narrows around it.
  if (params.pin) {
    const pinned = engine.byId(Number(params.pin));
    if (pinned) state.picks[pinned.kind] = pinned;
    else toast('That piece is not available at this site.', true);
  }

  mount(root, shell());
  const body = root.querySelector('[data-body]');
  const segs = root.querySelector('[data-segs]');
  const label = root.querySelector('[data-plabel]');
  const summary = root.querySelector('[data-sum]');
  const confirm = root.querySelector('[data-confirm]');

  root.querySelector('[data-back]').addEventListener('click', () => {
    if (Object.keys(state.picks).some((k) => state.picks[k])) reset();
    else back('/catalogue');
  });
  root.querySelector('[data-pick-site]').addEventListener('click', async () => {
    if (await pickSite({ allowAll: false })) go('/rig', { replace: true });
  });
  confirm.addEventListener('click', finish);

  // ------------------------------------------------------------------ state
  function reset() {
    state.picks = {};
    state.skipped = {};
    state.openStep = null;
    state.preview = null;
    state.justPicked = null;
    state.notice = null;
    state.customFor = null;
    state.draft = null;
    paint();
  }

  function activeIndex() {
    if (state.openStep !== null) return stepIndex(state.openStep);
    return STEPS.findIndex((step) => !state.picks[step.k] && !state.skipped[step.k]);
  }

  const pickedCount = () => STEPS.filter((step) => state.picks[step.k]).length;

  /**
   * A hand-entered piece sidesteps the filtering, so it can still strand an
   * earlier pick. Drop only those, and say which and why.
   */
  function revalidate() {
    const broken = [];
    STEPS.forEach((step) => {
      const piece = state.picks[step.k];
      if (!piece || step.k === state.justPicked) return;
      if (!passes(step.k, piece, state.picks)) {
        broken.push({ label: step.label, why: breakReason(step.k, piece) });
        state.picks[step.k] = null;
      }
    });
    state.notice = broken.length ? broken : null;
  }

  function breakReason(key, piece) {
    if (key === 'mast') {
      return state.picks.sail
        ? whyMastFails(state.picks.sail, piece).replace(`${pieceName(piece)}: `, '')
        : 'no sail chosen.';
    }
    if (key === 'ext') {
      if (state.picks.mast && piece.diam && state.picks.mast.diam && piece.diam !== state.picks.mast.diam) {
        return `it is ${piece.diam} and the mast is ${state.picks.mast.diam}.`;
      }
      const plan = rigPlan(state.picks.sail, state.picks.mast);
      if (plan) return `this rig needs ${fmt(plan.ext)} cm, and it travels ${span(piece.min, piece.max)}.`;
      return 'the mast it was chosen for has gone.';
    }
    if (key === 'boom') {
      return state.picks.sail
        ? `the ${state.picks.sail.model} wants ${state.picks.sail.boom} cm, and it covers `
          + `${piece.min} to ${piece.max} cm.`
        : 'no sail chosen.';
    }
    if (key === 'fin') {
      return state.picks.board
        ? `it is ${piece.box} and the board takes ${state.picks.board.box}.`
        : 'no board chosen.';
    }
    return 'it no longer fits.';
  }

  // --------------------------------------------------------------- painting
  function paint() {
    const index = activeIndex();
    let markup = '';

    if (state.notice) markup += toHtml(noticeBlock());

    STEPS.forEach((step, i) => {
      const piece = state.picks[step.k];
      if (piece) markup += toHtml(pickedRow(step, piece));
      else if (state.skipped[step.k] && i !== index) markup += toHtml(skipRow(step));
    });

    if (index >= 0) {
      const step = STEPS[index];
      const options = engine.options(step.k, state.picks, state.skipped);
      markup += toHtml(sectionLabel(step, options));
      if (state.customFor === step.k) {
        markup += toHtml(customForm(step));
      } else {
        markup += options.length
          ? options.map((piece) => toHtml(
              state.preview && state.preview.k === step.k && state.preview.id === piece.id
                ? previewCard(step, piece)
                : listRow(step, piece))).join('')
          : toHtml(emptyStep());
        markup += toHtml(otherRow(step));
      }
    }

    body.innerHTML = markup;
    paintProgress(index);
    wire();
  }

  function paintProgress(index) {
    const picked = pickedCount();
    const gaps = STEPS.filter((step) => state.skipped[step.k]).length;
    segs.innerHTML = STEPS.map((step) =>
      `<i class="${state.picks[step.k] ? 'on' : ''}"></i>`).join('');

    let tail;
    if (picked === 7) tail = ' · ready to rig';
    else if (index >= 0) tail = ` · ${STEPS[index].label.toLowerCase()} next`;
    else tail = ` · ${gaps} ${gaps === 1 ? 'step skipped' : 'steps skipped'}`;
    label.innerHTML = `<b>${picked} of 7 picked</b>${tail}`;

    summary.innerHTML = `<b>${picked} of 7 parts</b>${gaps ? `<span class="g">·</span>${gaps} skipped` : ''}`;

    if (picked === 7) {
      confirm.className = 'bigbtn';
      confirm.innerHTML = `${toHtml(icon('tick'))}Confirm and rig it`;
    } else {
      confirm.className = 'bigbtn mute';
      confirm.textContent = picked === 0
        ? `Pick a ${index >= 0 ? STEPS[index].label.toLowerCase() : 'sail'} to start`
        : `Pick the last ${7 - picked} ${7 - picked === 1 ? 'part to confirm' : 'parts to confirm'}`;
    }
  }

  // ------------------------------------------------------------ interaction
  function wire() {
    body.querySelectorAll('[data-preview]').forEach((node) =>
      node.addEventListener('click', () => openPreview(node.getAttribute('data-preview'))));
    body.querySelectorAll('[data-use]').forEach((node) =>
      node.addEventListener('click', () => use(node.getAttribute('data-use'))));
    body.querySelectorAll('[data-skip]').forEach((node) =>
      node.addEventListener('click', () => {
        const key = node.getAttribute('data-skip');
        state.skipped[key] = true;
        state.picks[key] = null;
        state.openStep = null;
        state.preview = null;
        state.customFor = null;
        state.draft = null;
        paint();
      }));
    body.querySelectorAll('[data-unskip]').forEach((node) =>
      node.addEventListener('click', () => {
        delete state.skipped[node.getAttribute('data-unskip')];
        state.openStep = node.getAttribute('data-unskip');
        state.preview = null;
        state.customFor = null;
        paint();
      }));
    body.querySelectorAll('[data-close-preview]').forEach((node) =>
      node.addEventListener('click', () => { state.preview = null; paint(); }));
    body.querySelectorAll('[data-change]').forEach((node) =>
      node.addEventListener('click', () => {
        const key = node.getAttribute('data-change');
        state.picks[key] = null;
        state.openStep = key;
        state.preview = null;
        state.justPicked = null;
        state.customFor = null;
        state.draft = null;
        state.notice = null;
        paint();
      }));
    body.querySelectorAll('[data-other]').forEach((node) =>
      node.addEventListener('click', () => {
        state.customFor = node.getAttribute('data-other');
        state.openStep = state.customFor;
        state.draft = {};
        paint();
      }));
    body.querySelectorAll('[data-seg]').forEach((node) =>
      node.addEventListener('click', () => {
        const [key, value] = node.getAttribute('data-seg').split(':');
        state.draft[key] = value;
        paint();
      }));
    body.querySelectorAll('[data-cf]').forEach((node) =>
      node.addEventListener('input', () => { state.draft[node.getAttribute('data-cf')] = node.value; }));

    const cancel = body.querySelector('[data-ccancel]');
    if (cancel) cancel.addEventListener('click', () => {
      state.customFor = null;
      state.draft = null;
      paint();
    });
    const useCustom = body.querySelector('[data-cuse]');
    if (useCustom) useCustom.addEventListener('click', () => commitCustom(useCustom.getAttribute('data-cuse')));
    const dismiss = body.querySelector('[data-dismiss]');
    if (dismiss) dismiss.addEventListener('click', () => { state.notice = null; paint(); });
  }

  function openPreview(value) {
    const [key, id] = value.split(':');
    state.preview = { k: key, id: Number(id) };
    state.notice = null;
    paint();
    // Bring the whole opened card into view, "Use this" included, without
    // scrolling its own heading off the top.
    const card = body.querySelector('.opt');
    if (!card) return;
    const cardBox = card.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    const top = cardBox.top - bodyBox.top + body.scrollTop;
    const bottom = top + cardBox.height;
    if (bottom > body.scrollTop + body.clientHeight) {
      body.scrollTop = Math.min(top - 10, bottom - body.clientHeight + 12);
    }
  }

  function use(value) {
    const [key, id] = value.split(':');
    state.picks[key] = engine.byId(Number(id));
    delete state.skipped[key];
    state.justPicked = key;
    state.preview = null;
    state.openStep = null;
    state.customFor = null;
    state.draft = null;
    state.notice = null;
    revalidate();
    paint();
  }

  function commitCustom(key) {
    const config = CUSTOM[key];
    const missing = [];
    config.fields.forEach((field) => {
      if (field.req && toNumber(state.draft[field.k]) === null) missing.push(field.l);
    });
    const segsNeeded = activeSegs(config, state.draft);
    segsNeeded.forEach((seg) => { if (seg.req && !state.draft[seg.k]) missing.push(seg.l); });
    if (missing.length) {
      state.draft.err = `Still needed: ${missing.join(', ')}.`;
      paint();
      return;
    }

    const step = stepFor(key);
    const piece = {
      id: -stepIndex(key) - 1,
      kind: step.kind,
      custom: true,
      kindLabel: step.label.toLowerCase(),
      label: (state.draft.label || '').trim() || null,
      cond: 'Unknown',
      site: engine.site,
      faults: [],
      rate: null,
    };
    config.fields.forEach((field) => { piece[field.k] = toNumber(state.draft[field.k]); });
    segsNeeded.forEach((seg) => {
      if (seg.k === 'cams') piece.cams = state.draft.cams === 'Yes' ? 1 : 0;
      else piece[seg.k] = state.draft[seg.k] || seg.opts[0];
    });
    // A hand-entered sail is treated as a fixed luff, so the head stays shut
    // and the extension does the work — which is what the rest of the cascade
    // now says out loud.
    if (key === 'sail') { piece.topExt = 0; piece.type = 'Yours'; }
    if (key === 'ext') piece.min = 0;
    if (key === 'uj') piece.fit = 'Standard';

    state.picks[key] = piece;
    delete state.skipped[key];
    state.justPicked = key;
    state.openStep = null;
    state.preview = null;
    state.customFor = null;
    state.draft = null;
    state.notice = null;
    revalidate();
    paint();
  }

  async function finish() {
    if (pickedCount() < 7) return;
    if (!(await needUser('Your setup is saved to your account so you can de-rig and log it.'))) return;

    const pieces = STEPS.map((step) => {
      const piece = state.picks[step.k];
      const settings = {};
      if (step.k === 'ext' || step.k === 'mast') {
        const plan = rigPlan(state.picks.sail, state.picks.mast, state.picks.ext);
        if (plan) { settings.ext_cm = plan.ext; settings.head_cm = plan.head; }
      }
      if (step.k === 'boom' && state.picks.sail && state.picks.sail.boom != null) {
        settings.boom_cm = state.picks.sail.boom;
      }
      return {
        role: step.k,
        item_id: piece.custom ? null : piece.id,
        custom: piece.custom ? { ...piece } : null,
        settings,
      };
    });

    try {
      const saved = await api.saveSetup(store.site === 'all' ? null : store.site, pieces);
      setSetup(saved.setup);
      go('/setup');
      toast('That is your setup. Here is where each piece lives.');
    } catch (error) {
      toast(error.message, true);
    }
  }

  // Everything the paint depends on is declared by now, so draw the first frame.
  paint();

  // --------------------------------------------------------------- fragments
  function shell() {
    return html`
      <div class="appbar">
        <div class="row">
          <button class="backbtn" data-back aria-label="Back">${icon('back')}</button>
          <span class="ttl">Build a rig</span>
          <button class="site" data-pick-site>${icon('pin')}${siteLabel()}</button>
        </div>
        <div class="prog">
          <div class="segs" data-segs></div>
          <div class="lb" data-plabel></div>
        </div>
      </div>
      <div class="body" data-body></div>
      <div class="actionbar">
        <div class="sum" data-sum></div>
        <button class="bigbtn mute" data-confirm></button>
      </div>`;
  }

  function pickedRow(step, piece) {
    const size = sizeBits(step.k, piece);
    // The extension length belongs to the mast that decided it, so it is not
    // repeated on the sail above: one consequence, stated once, where caused.
    const settled = step.k === 'sail' && state.picks.mast ? '' : consequence(step.k, piece, state.picks);
    return html`
      <div class="picked">
        <span class="dot">${icon('tick')}</span>
        <span class="pm">
          <span class="k">${step.label}</span>
          <span class="nm">${size ? html`${size.v}${size.u ? html`<u> ${size.u}</u>` : ''} · ` : ''}${shortName(piece)}</span>
          ${settled ? html`<span class="fit">${settled}</span>` : ''}
        </span>
        <button class="chg" data-change="${step.k}">Change</button>
      </div>`;
  }

  function skipRow(step) {
    return html`
      <div class="picked skip">
        <span class="dot"></span>
        <span class="pm"><span class="k">${step.label}</span><span class="nm">Skipped</span></span>
        <button class="chg" data-unskip="${step.k}">Pick one</button>
      </div>`;
  }

  function sectionLabel(step, options) {
    const total = engine.onSite(step.k).length;
    let hint;
    if (!options.length) hint = 'nothing here fits';
    else if (options.length === total) hint = `${total} at ${engine.site}`;
    else hint = `${options.length} of ${total} fit`;
    return html`
      <div class="sectlabel">
        <h3>${step.label}</h3>
        <span class="hint">${hint}</span>
        <button class="skip" data-skip="${step.k}">Skip</button>
      </div>`;
  }

  function listRow(step, piece) {
    const size = sizeBits(step.k, piece);
    const settled = consequence(step.k, piece, state.picks);
    const tags = specTags(step.k, piece);
    return html`
      <button class="lrow" data-preview="${step.k}:${piece.id}">
        <span class="thumb">${artFor(step.kind)}</span>
        <span class="lmid">
          <span class="sub">${shortName(piece)}</span>
          <span class="big">${size ? html`${size.v}${size.u ? html`<u>${size.u}</u>` : ''}` : pieceName(piece)}</span>
          ${tags.length ? html`<span class="tags">${tags.map((tag) => html`<span class="tag">${tag}</span>`)}</span>` : ''}
          ${settled ? html`<span class="fit">${settled}</span>` : ''}
        </span>
        <span class="lright">
          <span class="cond ${piece.cond === 'Fair' ? 'fair' : ''}">${piece.cond}</span>
          <span class="spot">${piece.spot || engine.site}</span>
        </span>
        <span class="chev">${icon('chevronRight')}</span>
      </button>`;
  }

  function previewCard(step, piece) {
    const size = sizeBits(step.k, piece);
    const faults = piece.faults || [];
    const faultLine = faults.length
      ? faults.map((f) => `${f.t} (${f.s === 'usable' ? 'usable' : 'out of action'})`).join('; ')
      : 'no open faults';
    return html`
      <div class="opt">
        <button class="lead" data-close-preview>
          <span class="thumb lg">${artFor(step.kind)}</span>
          <span class="info">
            <span class="nm">${shortName(piece)}</span>
            <span class="big">${size ? html`${size.v}${size.u ? html`<u>${size.u}</u>` : ''}` : pieceName(piece)}</span>
            <span class="dims">${piece.cond} · ${piece.spot || engine.site}</span>
          </span>
          <span class="shut">${icon('chevronUp')}</span>
        </button>
        <div class="fchips">
          ${chipsFor(step.k, piece, state.picks).map((chip) => html`
            <span class="fchip ${chip.cls}">${chip.tick ? icon('tick') : ''}${chip.text}</span>`)}
        </div>
        <div class="detail">
          <div class="drow"><span class="dh">Spec</span><span class="spec2">${specLine(step.k, piece)}</span></div>
          <div class="drow">
            <span class="dh">Condition</span>
            <span class="cond2 ${piece.cond === 'Fair' ? 'fairc' : ''}">${piece.cond}
              <span class="none">· ${faultLine}</span></span>
          </div>
          <div class="drow"><span class="dh">Member rating</span>${starBlock(piece.rate)}</div>
        </div>
        <button class="optuse" data-use="${step.k}:${piece.id}">${icon('tick')}Use this ${step.label.toLowerCase()}</button>
      </div>`;
  }

  function starBlock(rate) {
    const filled = rate ? Math.round(rate.avg) : 0;
    return html`<span class="rate5"><span class="st">${raw(
      Array.from({ length: 5 }, (_, i) =>
        toHtml(icon('star')).replace('<svg', `<svg class="${i < filled ? 'f' : ''}"`)).join(''))}</span>
      ${rate
        ? html`<span class="rn">${rate.avg.toFixed(1)}</span><span class="rc">${rate.n} ${rate.n === 1 ? 'vote' : 'votes'}</span>`
        : html`<span class="rc">Not yet rated</span>`}</span>`;
  }

  function otherRow(step) {
    return html`
      <button class="lrow other" data-other="${step.k}">
        <span class="ic">${icon('plus')}</span>
        <span class="lmid">
          <span class="nm">Something else</span>
          <span class="sub">your own, or a piece the app does not know</span>
        </span>
        <span class="chev">${icon('chevronRight')}</span>
      </button>`;
  }

  function emptyStep() {
    return html`
      <div class="emptyq">
        <b>Nothing at ${engine.site} works with the kit you entered by hand.</b>
        <span>Change one of your picks above, or add this piece with "Something else".</span>
      </div>`;
  }

  function noticeBlock() {
    // entry.why carries item model names, which a member controls via the add
    // form, so each line is built with the escaping `html` tag; only the <br>
    // between lines is trusted markup.
    const lines = state.notice.map((entry, i) =>
      html`${i ? raw('<br>') : ''}<b>${entry.label}</b> cleared: ${entry.why}`);
    return html`
      <div class="notice">
        ${icon('warning')}
        <span class="tx">
          <b>${state.notice.length === 1 ? 'One part no longer fits' : `${state.notice.length} parts no longer fit`}</b>
          <p>${lines}</p>
        </span>
        <button class="x" data-dismiss aria-label="Dismiss">×</button>
      </div>`;
  }

  function customForm(step) {
    const config = CUSTOM[step.k];
    const segsNeeded = activeSegs(config, state.draft);
    return html`
      <div class="cform">
        <div class="ch">
          <b>${config.title}</b>
          <span>${config.note} Used for this rig only, and not added to the inventory.</span>
        </div>
        ${config.fields.length ? html`
          <div class="pair">
            ${config.fields.map((field) => html`
              <div class="fld">
                <label>${field.l}${field.req ? html` <span class="req">required</span>` : ''}</label>
                <input type="text" inputmode="decimal" data-cf="${field.k}"
                       value="${state.draft[field.k] ?? ''}">
              </div>`)}
          </div>` : ''}
        ${segsNeeded.map((seg) => html`
          <div class="fld">
            <label>${seg.l}${seg.req && !state.draft[seg.k] ? html` <span class="req">required</span>` : ''}</label>
            <div class="seg">
              ${seg.opts.map((option) => html`
                <button data-seg="${seg.k}:${option}" class="${
                  state.draft[seg.k] === option || (seg.k === 'cams' && state.draft.cams === undefined && option === 'No')
                    ? 'on' : ''}">${option}</button>`)}
            </div>
          </div>`)}
        <div class="fld">
          <label>Name it, optional</label>
          <input type="text" data-cf="label" value="${state.draft.label || ''}">
        </div>
        ${state.draft.err ? html`<div class="err">${state.draft.err}</div>` : ''}
        <div class="acts">
          <button class="cancel" data-ccancel>Cancel</button>
          <button class="use" data-cuse="${step.k}">Use this</button>
        </div>
      </div>`;
  }
}
