/**
 * Your rig — the sail and board you chose, and the four things they imply.
 *
 * Build asks two questions. Everything after them is arithmetic, so this screen
 * does not ask again: it names a mast, an extension, a boom and a fin, says why
 * each one, and lets a member overrule any of them from a list that is already
 * filtered to kit that actually fits. That is the difference between this and a
 * wizard — nothing here is a step you have to complete, it is a rig you are
 * being handed with its working shown.
 *
 * Two behaviours are worth stating outright:
 *
 *  - **the extension follows the mast.** Its "set to" number is this mast's
 *    number, so confirming a different mast re-opens the extension rather than
 *    quietly leaving a stale setting behind.
 *  - **a recommendation is not a commitment.** A row stays in Recommended,
 *    reorderable and swappable, until "Use this" moves it up into Selected kit.
 *    Only then does it reach the setup the de-rig checklist reads.
 */
import { html, mount, numify, num, on, onClick } from '../dom.js';
import { icon, artFor } from '../icons.js';
import { api } from '../api.js';
import { store, setSetup } from '../store.js';
import { starRow } from '../ui/bits.js';
import { needUser, refreshSetup } from '../ui/chrome.js';
import { lightbox, confirmSheet, toast } from '../ui/overlay.js';
import { go } from '../router.js';
import { building } from '../rig/session.js';
import {
  SLOTS, ranked, rigPlan, rowName, shortName, sizeBits, collapsedSub, altSub, setting,
  tagsForPiece, shoppingList, riggingSteps, camsNote, finBand, fmt, span,
} from '../rig/engine.js';

export async function render(root) {
  const known = store.setup || (store.user ? await refreshSetup() : null);

  // What the member is building beats anything on the server: a session that
  // has been de-rigged but not written up must not stand between them and the
  // rig they just picked. It is only when nothing is being built that a stored
  // setup decides where this screen sends them.
  if (!building.started()) {
    // A reload loses the session but not the setup, so rebuild one from the
    // other rather than dropping a member back at the start of Build.
    if (known && known.status === 'active') seedFrom(known);
    else if (known && known.status === 'derigged') {
      // Nothing in hand, and a session waiting to be written up: that is the
      // Log tab's business, not this screen's.
      go('/log', { replace: true });
      return;
    } else {
      go('/rig', { replace: true });
      return;
    }
  }

  const site = store.site === 'all' ? null : store.site;
  const kit = (await api.rigKit(site)).kit;
  const byId = (id) => kit.find((piece) => piece.id === id) || null;

  const ui = {
    howto: false,
    openSel: {},
    openRec: {},
    altOpen: {},
    query: {},
    chosen: {},
    detail: {},
    faultOpen: {},
  };

  mount(root, shell());
  const howtoNode = root.querySelector('[data-howto-slot]');
  const selNode = root.querySelector('[data-selected]');
  const recNode = root.querySelector('[data-rec]');

  /**
   * Work the four slots out in rigging order, feeding each answer into the
   * next: the extension's length is the mast's number, so the mast has to be
   * settled — recommended or confirmed — before the extension can be.
   */
  function resolve() {
    const raw = building.raw;
    const picks = { sail: byId(raw.sail), board: byId(raw.board) };
    const rows = SLOTS.map((slot) => {
      if (!picks[slot.needs]) return { slot, blocked: slot.needs, list: [], current: null };
      const list = ranked(kit, slot.k, picks);
      const confirmedId = raw.slots[slot.k];
      const confirmed = confirmedId ? byId(confirmedId) : null;
      const chosen = ui.chosen[slot.k] ? list.find((p) => p.id === ui.chosen[slot.k]) : null;
      const current = confirmed || chosen || list[0] || null;
      if (current) picks[slot.k] = current;
      return { slot, blocked: null, list, best: list[0] || null, current, confirmed: Boolean(confirmed) };
    });
    return { picks, rows };
  }

  // ---------------------------------------------------------------- painting
  function paint() {
    const { picks, rows } = resolve();

    mount(howtoNode, howtoCard(picks));
    if (ui.howto) howtoNode.querySelector('.howto').classList.add('open');

    const selected = [];
    if (picks.sail) selected.push({ key: 'sail', label: 'SAIL', kind: 'sail', piece: picks.sail });
    if (picks.board) selected.push({ key: 'board', label: 'BOARD', kind: 'board', piece: picks.board });
    rows.filter((row) => row.confirmed).forEach((row) => selected.push({
      key: row.slot.k, label: row.slot.label, kind: row.slot.kind, piece: row.current, slot: row.slot,
    }));

    mount(selNode, selected.map((entry) => selectedRow(entry, picks)));
    mount(recNode, html`
      ${rows.filter((row) => !row.confirmed).map((row) => recRow(row, picks))}
      ${picks.sail ? ujRow() : ''}`);

    selected.forEach((entry) => { if (ui.openSel[entry.key]) fillSelected(entry.key, picks); });
    rows.forEach((row) => { if (!row.confirmed && ui.openRec[row.slot.k]) fillRec(row.slot.k); });
  }

  /* -- Selected kit: the big rows, with the full item behind them ---------- */

  function selectedRow(entry, picks) {
    const { piece, kind } = entry;
    const size = sizeBits(kind, piece);
    return html`
      <div class="kitem big" data-selrow="${entry.key}">
        <div class="khead" data-selhead="${entry.key}">
          <span class="kthumb lg">${artFor(kind)}</span>
          <span class="kmid">
            <span class="k">${entry.label}</span>
            <span class="brandmodel">${shortName(piece)}</span>
            <span class="hero">${size ? numify(`${size.v} ${size.u}`) : shortName(piece)}</span>
            ${importantLines(entry, piece, picks)}
          </span>
          <span class="kchev">${icon('chevronDown')}</span>
        </div>
        <div class="kbody"></div>
      </div>`;
  }

  /** The one or two facts you check before you walk away with it. */
  function importantLines(entry, piece, picks) {
    const lines = [];
    if (entry.key === 'sail') {
      if (piece.luff != null) lines.push({ text: `Luff ${fmt(piece.luff)} cm` });
      if (piece.boom != null) lines.push({ text: `Boom ${fmt(piece.boom)} cm` });
    }
    if (entry.key === 'board') {
      if (piece.type) lines.push({ text: piece.type, plain: true });
      if (piece.box) lines.push({ text: piece.box, plain: true });
    }
    if (entry.key === 'mast') {
      if (piece.diam) lines.push({ text: piece.diam, strong: true });
    }
    const set = entry.slot ? setting(entry.key, piece, picks) : null;
    if (set) lines.push({ text: `set to ${set}` });
    return lines.map((line) => html`
      <span class="impline ${line.strong ? 'strong' : ''}">${
        line.plain ? line.text : numify(line.text)}</span>`);
  }

  async function fillSelected(key, picks) {
    const row = selNode.querySelector(`[data-selrow="${key}"]`);
    if (!row) return;
    const entry = entryFor(key, picks);
    if (!entry) return;
    const detail = ui.detail[entry.piece.id];
    mount(row.querySelector('.kbody'), detail
      ? selectedDetail(entry, detail, picks)
      : html`<div class="spinner"></div>`);
    row.setAttribute('data-open', '1');
  }

  function entryFor(key, picks) {
    if (key === 'sail' && picks.sail) return { key, label: 'SAIL', kind: 'sail', piece: picks.sail };
    if (key === 'board' && picks.board) return { key, label: 'BOARD', kind: 'board', piece: picks.board };
    const slot = SLOTS.find((s) => s.k === key);
    if (slot && picks[key]) return { key, label: slot.label, kind: slot.kind, piece: picks[key], slot };
    return null;
  }

  function selectedDetail(entry, item, picks) {
    const piece = entry.piece;
    const open = (item.fault_history || []).filter((fault) => fault.status === 'open');
    const rating = item.rating || { n: 0, stars: null, up: 0, down: 0, mine: null };
    const set = entry.slot ? setting(entry.key, piece, picks) : null;

    return html`
      <div class="quickfacts">
        <div class="tags expanded">
          ${item.spot
            ? html`<button class="tag spotlink" data-spot="${item.spot}"
                    data-site="${item.site || ''}"
                    data-note="${item.spot_description || ''}">${icon('pin')}${item.spot}</button>`
            : ''}
          ${item.condition ? html`<span class="tag ${condTag(item.condition)}">${item.condition}</span>` : ''}
          ${entry.key === 'sail' && item.cams ? html`<span class="tag warn">Cambered</span>` : ''}
          ${set ? html`<span class="tag ok">${icon('tick')}set to ${set}</span>` : ''}
        </div>
        <div class="krate">
          <span class="ratingrow">
            ${rating.n
              ? html`${starRow(rating.stars)}<span class="rn">${num(rating.stars)}</span
                  ><span class="rc">${rating.n} ${rating.n === 1 ? 'vote' : 'votes'}</span>`
              : html`<span class="rc">Not yet rated</span>`}
          </span>
          <span class="votes">
            <button class="vote ${rating.mine === 1 ? 'picked' : ''}" data-vote="1"
                    data-item="${item.id}" aria-label="Rate good">${icon('thumbUp')}<span>${rating.up}</span></button>
            <button class="vote ${rating.mine === -1 ? 'picked' : ''}" data-vote="-1"
                    data-item="${item.id}" aria-label="Rate bad">${icon('thumbDown')}<span>${rating.down}</span></button>
          </span>
        </div>
        <dl class="kspecs">
          ${specRows(entry, item).map((pair) => html`
            <div><dt>${pair[0]}</dt><dd>${numify(pair[1])}</dd></div>`)}
        </dl>
      </div>

      ${open.length ? html`
        <div class="faults">
          ${open.map((fault) => html`
            <div class="fault ${fault.severity === 'out_of_action' ? 'oos' : ''}"
                 ${ui.faultOpen[fault.id] ? html`data-open="1"` : ''}>
              <button class="faulthead" data-faulttoggle="${fault.id}">
                ${icon('warning')}<span class="ft">${fault.title}</span>${icon('chevronDown')}
              </button>
              <div class="faultbody"><p>${fault.description}</p></div>
            </div>`)}
        </div>` : ''}

      <div class="notesdivider"></div>
      <div class="knotes">
        ${(item.comments || []).length
          ? (item.comments || []).slice(0, 4).map((entryNote) => html`
              <div class="kn">
                <span class="a">${entryNote.user_name || entryNote.author || 'A member'}</span>
                <p>${entryNote.body}</p>
              </div>`)
          : html`<p class="knone">Nothing said about this one yet.</p>`}
        <form class="commentform" data-comment="${item.id}">
          <input class="field" type="text" placeholder="Add a comment" aria-label="Add a comment">
          <button class="mini" type="submit">Post</button>
        </form>
      </div>

      <div class="selacts">
        <button class="resetlink" data-change="${entry.key}">Change</button>
        <button class="resetlink ghost" data-openitem="${item.id}">Open item page</button>
      </div>`;
  }

  /** Four to six facts, in the order this kind of kit is checked. */
  function specRows(entry, item) {
    const skip = new Set(['Manufacturer', 'Model', 'Site', 'Spot', 'Notes', 'Condition']);
    const pairs = (item.spec || [])
      .filter((row) => !skip.has(row.label) && row.value && row.value !== '—')
      .map((row) => [row.label, String(row.value)]);

    if (entry.key === 'sail' && item.recommended) {
      pairs.push(['Rec. mast', `${item.recommended.mast_cm} cm`]);
      pairs.push(['Rec. extension', `${item.recommended.extension_cm} cm`]);
    }
    if (entry.key === 'board') {
      const band = finBand(entry.piece.vol);
      if (band) pairs.push(['Rec. fin', `${band[0]} to ${band[1]} cm`]);
    }
    if (item.condition) pairs.push(['Condition', item.condition]);
    return pairs.slice(0, 6);
  }

  /* -- Recommended: the small rows, answered from the kit list alone ------- */

  function recRow(row, picks) {
    const { slot } = row;
    if (row.blocked) return blockedRow(slot);
    if (!row.current) return emptyRow(slot, picks);

    const sub = collapsedSub(slot.k, row.current, picks);
    return html`
      <div class="kitem" data-recrow="${slot.k}">
        <div class="khead" data-rechead="${slot.k}">
          <span class="kthumb">${artFor(slot.kind)}</span>
          <span class="kmid">
            <span class="k">${slot.label}</span>
            <span class="namerow"><span class="nm">${numify(rowName(slot.kind, row.current))}</span></span>
            ${sub ? html`<span class="subline">${numify(sub)}</span>` : ''}
          </span>
          <span class="kchev">${icon('chevronDown')}</span>
        </div>
        <div class="kbody"></div>
      </div>`;
  }

  function blockedRow(slot) {
    return html`
      <button class="kitem needrow" data-need="${slot.needs}">
        <span class="kthumb">${artFor(slot.kind)}</span>
        <span class="kmid">
          <span class="k">${slot.label}</span>
          <span class="namerow"><span class="nm">Pick a ${slot.needs} first</span></span>
          <span class="subline">${slot.needs === 'sail'
            ? 'the mast, extension and boom all come from the sail'
            : 'the fin has to match the board\'s box'}</span>
        </span>
        <span class="kchev rot">${icon('chevronRight')}</span>
      </button>`;
  }

  function emptyRow(slot, picks) {
    return html`
      <div class="kitem">
        <div class="khead static">
          <span class="kthumb">${artFor(slot.kind)}</span>
          <span class="kmid">
            <span class="k">${slot.label}</span>
            <span class="namerow"><span class="nm">Nothing here fits</span></span>
            <span class="subline">${whyNothing(slot, picks)}</span>
          </span>
        </div>
      </div>`;
  }

  function whyNothing(slot, picks) {
    if (slot.k === 'mast' && picks.sail) {
      return `no mast reaches a ${fmt(picks.sail.luff)} cm luff within an extension's travel`;
    }
    if (slot.k === 'ext' && picks.mast) return `nothing ${picks.mast.diam || ''} travels far enough`.trim();
    if (slot.k === 'boom' && picks.sail && picks.sail.boom != null) {
      return `no boom here covers ${fmt(picks.sail.boom)} cm`;
    }
    if (slot.k === 'fin' && picks.board) return `no ${String(picks.board.box || '').toLowerCase()} fin is here`;
    return 'try another location';
  }

  function fillRec(key) {
    const { picks, rows } = resolve();
    const row = rows.find((r) => r.slot.k === key);
    const node = recNode.querySelector(`[data-recrow="${key}"]`);
    if (!row || !node || !row.current) return;
    mount(node.querySelector('.kbody'), recDetail(row, picks));
    node.setAttribute('data-open', '1');
  }

  function recDetail(row, picks) {
    const { slot, current, best, list } = row;
    const query = (ui.query[slot.k] || '').trim().toLowerCase();
    const others = list
      .filter((piece) => piece.id !== current.id)
      .filter((piece) => !query
        || `${rowName(slot.kind, piece)} ${altSub(slot.k, piece, picks)}`.toLowerCase().includes(query));
    const tags = tagsForPiece(slot.k, current, picks, best && current.id === best.id);

    return html`
      <div class="quickfacts">
        ${tags.length ? html`<div class="tags expanded">${tags.map(tagChip)}</div>` : ''}
        <span class="ratingrow recrating">
          ${current.rate
            ? html`${starRow(current.rate.avg)}<span class="rn">${num(current.rate.avg)}</span
                ><span class="rc">${current.rate.n} ${current.rate.n === 1 ? 'vote' : 'votes'}</span>`
            : html`<span class="rc">Not yet rated</span>`}
        </span>
        <dl class="kspecs">
          ${recSpecs(slot, current, picks).map((pair) => html`
            <div><dt>${pair[0]}</dt><dd>${numify(pair[1])}</dd></div>`)}
        </dl>
      </div>

      <button class="usebtn" data-use="${slot.k}">${icon('tick')}Use this ${slot.noun}</button>

      <div class="altwrap">
        <button class="altToggle ${ui.altOpen[slot.k] ? 'open' : ''}" data-alttoggle="${slot.k}">
          Show other ${slot.noun}s${icon('chevronDown')}
        </button>
        <div class="altbody ${ui.altOpen[slot.k] ? 'open' : ''}">
          <span class="search">${icon('search')}<input type="search" data-search="${slot.k}"
            value="${ui.query[slot.k] || ''}" placeholder="search ${slot.noun}s"></span>
          <div class="altlist">
            ${others.length
              ? others.map((piece) => html`
                  <button class="altrow" data-alt="${slot.k}:${piece.id}">
                    <span class="kthumb">${artFor(slot.kind)}</span>
                    <span class="altmid">
                      <span class="an">${numify(rowName(slot.kind, piece))}</span>
                      <span class="as">${numify(best && piece.id === best.id
                        ? 'the original recommendation'
                        : altSub(slot.k, piece, picks))}</span>
                    </span>
                  </button>`)
              : html`<div class="altempty">${query
                  ? 'Nothing here matches that.'
                  : `Every ${slot.noun} that fits is already the one above.`}</div>`}
          </div>
        </div>
      </div>`;
  }

  function recSpecs(slot, piece, picks) {
    const pairs = [];
    const set = setting(slot.k, piece, picks);
    if (slot.k === 'mast') {
      if (piece.len != null) pairs.push(['Length', `${fmt(piece.len)} cm`]);
      if (piece.diam) pairs.push(['Diameter', piece.diam]);
      const plan = picks.sail ? rigPlan(picks.sail, piece) : null;
      if (plan) pairs.push(['Extension', `+${fmt(plan.ext)} cm`]);
      if (plan && plan.head > 0) pairs.push(['Head open', `${fmt(plan.head)} cm`]);
    }
    if (slot.k === 'ext') {
      if (piece.min != null) pairs.push(['Travel', span(piece.min, piece.max)]);
      if (set) pairs.push(['Set to', set]);
      if (piece.diam) pairs.push(['Diameter', piece.diam]);
    }
    if (slot.k === 'boom') {
      if (piece.min != null) pairs.push(['Outhaul', span(piece.min, piece.max)]);
      if (set) pairs.push(['Set to', set]);
    }
    if (slot.k === 'fin') {
      if (piece.len != null) pairs.push(['Length', `${fmt(piece.len)} cm`]);
      if (piece.box) pairs.push(['Box type', piece.box]);
      if (piece.type) pairs.push(['Type', piece.type]);
    }
    // The maker on its own, not the full name: the row heading above already
    // says "430 Neil Pryde X6", so repeating it here would be a wasted cell.
    if (piece.mfr) pairs.push(['Make', piece.mfr]);
    if (piece.cond) pairs.push(['Condition', piece.cond]);
    if (piece.spot) pairs.push(['Lives in', piece.spot]);
    return pairs;
  }

  function ujRow() {
    return html`
      <div class="kitem">
        <div class="khead static inforow">
          <span class="kthumb">${artFor('uj')}</span>
          <span class="kmid">
            <span class="k">UJ / BASE</span>
            <span class="namerow"><span class="nm">Any standard UJ</span></span>
            <span class="subline">they all fit this extension</span>
          </span>
        </div>
      </div>`;
  }

  /* -- the how-to card ---------------------------------------------------- */

  function howtoCard(picks) {
    const find = shoppingList(picks);
    const steps = riggingSteps(picks);
    return html`
      <div class="howto">
        <div class="hhead" data-howtotoggle>
          <span class="hplay">${icon('play')}</span>
          <span class="hm">
            <span class="ht">How to rig</span>
            <span class="hs">What to find, the steps, and a video</span>
          </span>
          <span class="hchev">${icon('chevronDown')}</span>
        </div>
        <div class="hbody">
          ${find.length ? html`
            <div>
              <p class="stephead">What you need to find</p>
              <ol class="findlist">${find.map((line) => html`<li>${numify(line)}</li>`)}</ol>
            </div>` : ''}
          <div>
            <p class="stephead">Step by step</p>
            <ol class="steplist">
              ${steps.map((step) => html`<li>${numify(step.text)}${
                step.b ? html`<b>${step.b}</b>` : ''}${step.tail ? numify(step.tail) : ''}</li>`)}
            </ol>
          </div>
          ${camsNote(picks.sail) ? html`
            <p class="camnote">${icon('warning')}This sail is cambered: seat each cam over the mast before
              you tension the downhaul, and expect it to fight you. Ask a committee member if it is your
              first time.</p>` : ''}
          <div>
            <p class="stephead">Video</p>
            <button class="vid" type="button" data-video aria-label="Play the rigging video">
              <span class="vplay">${icon('play')}</span>
              <span class="vlb">Rigging a freeride sail, 4 min, UBWC</span>
            </button>
          </div>
        </div>
      </div>`;
  }

  /* -- interaction -------------------------------------------------------- */

  onClick(root, 'data-howtotoggle', () => {
    ui.howto = !ui.howto;
    howtoNode.querySelector('.howto').classList.toggle('open', ui.howto);
  });

  onClick(root, 'data-video', () => lightbox({
    title: 'No video yet',
    sub: 'The club has not filmed this one. Ask a committee member to walk you through it the first time.',
  }));

  onClick(root, 'data-selhead', async (key) => {
    const { picks } = resolve();
    const entry = entryFor(key, picks);
    if (!entry) return;
    const row = selNode.querySelector(`[data-selrow="${key}"]`);
    if (ui.openSel[key]) {
      ui.openSel[key] = false;
      row.removeAttribute('data-open');
      return;
    }
    ui.openSel[key] = true;
    mount(row.querySelector('.kbody'), html`<div class="spinner"></div>`);
    requestAnimationFrame(() => row.setAttribute('data-open', '1'));
    try {
      if (!ui.detail[entry.piece.id]) ui.detail[entry.piece.id] = await api.item(entry.piece.id);
      if (!ui.openSel[key]) return;
      mount(row.querySelector('.kbody'), selectedDetail(entry, ui.detail[entry.piece.id], picks));
    } catch (error) {
      toast(error.message, true);
      ui.openSel[key] = false;
      row.removeAttribute('data-open');
    }
  });

  onClick(root, 'data-rechead', (key) => {
    const row = recNode.querySelector(`[data-recrow="${key}"]`);
    if (!row) return;
    if (ui.openRec[key]) {
      ui.openRec[key] = false;
      row.removeAttribute('data-open');
      return;
    }
    ui.openRec[key] = true;
    const { picks, rows } = resolve();
    mount(row.querySelector('.kbody'), recDetail(rows.find((r) => r.slot.k === key), picks));
    requestAnimationFrame(() => row.setAttribute('data-open', '1'));
  });

  onClick(root, 'data-alttoggle', (key, node) => {
    ui.altOpen[key] = !ui.altOpen[key];
    node.classList.toggle('open', ui.altOpen[key]);
    node.parentElement.querySelector('.altbody').classList.toggle('open', ui.altOpen[key]);
  });

  onClick(root, 'data-alt', (value) => {
    const [key, id] = value.split(':');
    ui.chosen[key] = Number(id);
    ui.query[key] = '';
    // Choosing a mast changes what the extension has to do, so redraw the lot;
    // the row you are in stays open around it.
    paint();
  });

  on(root, 'input', '[data-search]', (event, input) => {
    const key = input.getAttribute('data-search');
    ui.query[key] = input.value;
    const row = recNode.querySelector(`[data-recrow="${key}"]`);
    const { picks, rows } = resolve();
    mount(row.querySelector('.kbody'), recDetail(rows.find((r) => r.slot.k === key), picks));
    const again = row.querySelector('[data-search]');
    if (again) {
      again.focus();
      const end = again.value.length;
      try { again.setSelectionRange(end, end); } catch { /* type="search" on some browsers */ }
    }
  });

  onClick(root, 'data-use', async (key) => {
    const { rows } = resolve();
    const row = rows.find((r) => r.slot.k === key);
    if (!row || !row.current) return;
    building.confirm(key, row.current.id);
    delete ui.openRec[key];
    delete ui.altOpen[key];
    delete ui.chosen[key];
    paint();
    await persist();
  });

  onClick(root, 'data-change', async (key) => {
    if (key === 'sail' || key === 'board') {
      go(`/rig?step=${key}`);
      return;
    }
    building.unconfirm(key);
    delete ui.openSel[key];
    paint();
    await persist();
  });

  onClick(root, 'data-need', (key) => go(`/rig?step=${key}`));
  onClick(root, 'data-openitem', (value) => go(`/item/${value}`));

  onClick(root, 'data-spot', (value, node) => lightbox({
    title: `${value}${node.getAttribute('data-site') ? ` · ${node.getAttribute('data-site')}` : ''}`,
    sub: node.getAttribute('data-note')
      || 'No description recorded for this spot yet. A committee member can add one when moving kit.',
  }));

  onClick(root, 'data-faulttoggle', (value, node) => {
    ui.faultOpen[value] = !ui.faultOpen[value];
    node.closest('.fault').toggleAttribute('data-open', ui.faultOpen[value]);
  });

  onClick(root, 'data-vote', async (value, node) => {
    if (!(await needUser('Rating kit is one standing vote per member.'))) return;
    const itemId = Number(node.getAttribute('data-item'));
    const detail = ui.detail[itemId];
    if (!detail) return;
    // Pressing the thumb you already gave withdraws it; the other replaces it.
    const next = detail.rating.mine === Number(value) ? 0 : Number(value);
    try {
      detail.rating = await api.vote(itemId, next);
      paint();
    } catch (error) {
      toast(error.message, true);
    }
  });

  on(root, 'submit', '[data-comment]', async (event, form) => {
    event.preventDefault();
    const itemId = Number(form.getAttribute('data-comment'));
    const input = form.querySelector('input');
    const body = input.value.trim();
    if (!body) return;
    if (!(await needUser('Comments are signed with your name.'))) return;
    try {
      const data = await api.comment(itemId, body, 'note');
      if (ui.detail[itemId]) ui.detail[itemId].comments = data.comments;
      input.value = '';
      paint();
      toast('Posted.');
    } catch (error) {
      toast(error.message, true);
    }
  });

  // Back is "change what I picked", so it opens Build rather than bouncing off
  // the redirect that sends a settled rig straight back here.
  root.querySelector('[data-back]').addEventListener('click', () => go('/rig?step=sail'));
  root.querySelector('[data-derig]').addEventListener('click', derig);

  /**
   * The setup only exists on the server for members who have said who they are,
   * because it is kept on their account. Everyone else gets the same screen as
   * guidance, and is asked for a name at the one point it starts to matter.
   */
  async function persist() {
    if (!store.user) return;
    const { picks } = resolve();
    const pieces = [];
    const add = (role, piece, settings) => {
      if (piece) pieces.push({ role, item_id: piece.id, custom: null, settings: settings || {} });
    };
    add('sail', picks.sail);
    add('board', picks.board);
    const confirmed = building.confirmed();
    SLOTS.forEach((slot) => {
      if (!confirmed[slot.k]) return;
      const piece = picks[slot.k];
      const settings = {};
      if (slot.k === 'ext') {
        const plan = rigPlan(picks.sail, picks.mast, piece);
        if (plan) { settings.ext_cm = plan.ext; settings.head_cm = plan.head; }
      }
      if (slot.k === 'boom' && picks.sail && picks.sail.boom != null) settings.boom_cm = picks.sail.boom;
      add(slot.k, piece, settings);
    });
    if (!pieces.length) return;
    try {
      const saved = await api.saveSetup(store.site === 'all' ? null : store.site, pieces);
      setSetup(saved.setup);
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function derig() {
    if (!(await needUser('Your setup is saved to your account so you can de-rig and log it.'))) return;
    const missing = SLOTS.filter((slot) => !building.confirmed()[slot.k]).length;
    if (missing) {
      const yes = await confirmSheet({
        title: `${missing} ${missing === 1 ? 'part is' : 'parts are'} still only suggested`,
        sub: 'De-rigging now records the sail and board and anything you pressed "Use this" on. The rest will not appear on the checklist.',
        confirmLabel: 'De-rig anyway',
      });
      if (!yes) return;
    }
    await persist();
    if (!store.setup) {
      toast('Could not save your setup.', true);
      return;
    }
    go('/derig');
  }

  paint();
  await persist();
}

/* ---------------------------------------------------------------- helpers */

function seedFrom(setup) {
  building.clear();
  setup.pieces.forEach((piece) => {
    if (!piece.item) return;
    if (piece.role === 'sail' || piece.role === 'board') building.pick(piece.role, piece.item.id);
    else if (SLOTS.some((slot) => slot.k === piece.role)) building.confirm(piece.role, piece.item.id);
  });
}

function condTag(condition) {
  const value = String(condition).toLowerCase();
  if (value === 'fair') return 'warn';
  if (value === 'poor') return 'warn';
  return 'ok';
}

function tagChip(tag) {
  return html`<span class="tag ${tag.warn ? 'warn' : ''}">${tag.tick ? icon('tick') : ''}${tag.t}</span>`;
}

function shell() {
  return html`
    <div class="appbar">
      <div class="row">
        <button class="backbtn" data-back aria-label="Back">${icon('back')}</button>
        <span class="ttl">Your rig</span>
        <button class="derigbtn" data-derig>${icon('logout')}De-rig</button>
      </div>
    </div>

    <div class="body" data-body>
      <div data-howto-slot></div>
      <div class="sectlabel">Selected kit</div>
      <div class="partlist" data-selected></div>
      <div class="sectlabel">Recommended</div>
      <div class="partlist" data-rec></div>
    </div>`;
}
