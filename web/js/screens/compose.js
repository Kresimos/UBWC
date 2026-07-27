/**
 * Compose — writing a session up.
 *
 * Where de-rig lands you. The kit is prefilled from the setup you were out on,
 * the wind is auto-fetched for the rig-to-de-rig window (and stays editable),
 * and the only required decision is the one 1-5 star overall — author-only,
 * decorative in the feed, not a per-item review others rely on.
 *
 * The per-item pass is the main way kit gets rated: a quick thumb over each
 * piece you used, optionally a small note. A thumb here becomes your standing
 * vote on that piece, and a note becomes a comment on it, so both surface on
 * the item page rather than staying buried in the log.
 */
import { html, mount, num, onClick, clockTime } from '../dom.js';
import { icon, artFor } from '../icons.js';
import { api } from '../api.js';
import { store, setSetup } from '../store.js';
import { refreshSetup, needUser } from '../ui/chrome.js';
import { formSheet, toast } from '../ui/overlay.js';
import { go, back } from '../router.js';

export async function render(root, _params, query) {
  if (!(await needUser('A session is saved to your logbook and the club feed.'))) {
    go('/log', { replace: true });
    return;
  }

  const setup = store.setup || (await refreshSetup());
  if (!setup) {
    // Nothing to prefill from; the composer still works, just empty.
    toast('Rig something first, or repeat a past session.', true);
    go('/log', { replace: true });
    return;
  }

  // No stars until the member gives them: an unasked question must not answer
  // itself, and a pre-filled four would go into the feed as their verdict.
  const draft = {
    stars: 0,
    note: '',
    wind: null,
    windEdited: false,
    pieces: setup.pieces
      .filter((piece) => piece.item)
      .map((piece) => ({
        role: piece.role,
        role_label: piece.role_label,
        item_id: piece.item.id,
        name: `${piece.item.manufacturer} ${piece.item.model}`,
        kind: piece.item.rig_kind || piece.item.component_type,
        vote: null,
        comment: '',
      })),
  };

  mount(root, screen(setup, draft));
  paintStars();
  paintWind();
  fetchWind();

  root.querySelector('[data-back]').addEventListener('click', () => back('/log'));

  root.querySelectorAll('[data-star]').forEach((button) => {
    button.addEventListener('click', () => {
      draft.stars = Number(button.getAttribute('data-star'));
      paintStars();
    });
  });

  const noteBox = root.querySelector('[data-notebox]');
  noteBox.addEventListener('input', () => { draft.note = noteBox.value; });

  onClick(root, 'data-editwind', async () => {
    const values = await formSheet({
      title: 'Wind',
      sub: 'Auto-fetched for when you sailed. Edit if it was different on the water.',
      fields: [
        { name: 'kn', label: 'Wind (knots)', type: 'text', inputmode: 'numeric', value: draft.wind ? num(draft.wind.kn, 0) : '' },
        { name: 'gust', label: 'Gusts (knots)', type: 'text', inputmode: 'numeric', value: draft.wind && draft.wind.gust_kn != null ? num(draft.wind.gust_kn, 0) : '' },
        { name: 'dir', label: 'Direction', type: 'text', value: draft.wind ? draft.wind.dir || '' : '' },
      ],
      submitLabel: 'Set wind',
    });
    if (!values) return;
    draft.wind = {
      kn: values.kn ? Number(values.kn) : null,
      gust_kn: values.gust ? Number(values.gust) : null,
      dir: values.dir,
      source: 'manual',
    };
    draft.windEdited = true;
    paintWind();
  });

  onClick(root, 'data-prow', (_value, node) => {
    const comment = node.nextElementSibling;
    if (comment && comment.classList.contains('pcomment')) comment.toggleAttribute('hidden');
  });

  onClick(root, 'data-thumb', (value, node, event) => {
    event.stopPropagation();
    const [role, dir] = value.split(':');
    const piece = draft.pieces.find((p) => p.role === role);
    const vote = dir === 'up' ? 1 : -1;
    piece.vote = piece.vote === vote ? null : vote;
    node.closest('.thumbs2').querySelectorAll('.t2').forEach((button) => {
      const isThis = button.getAttribute('data-thumb') === value;
      button.classList.toggle('sel', isThis && piece.vote === vote);
      if (!isThis) button.classList.remove('sel');
    });
  });

  root.querySelectorAll('[data-comment]').forEach((input) => {
    input.addEventListener('input', () => {
      const piece = draft.pieces.find((p) => p.role === input.getAttribute('data-comment'));
      piece.comment = input.value;
      const row = root.querySelector(`[data-prow="${piece.role}"]`);
      if (row) row.classList.toggle('noted', Boolean(input.value.trim()));
    });
  });

  root.querySelector('[data-save]').addEventListener('click', save);

  function paintStars() {
    root.querySelectorAll('[data-star]').forEach((button) => {
      button.querySelector('svg').classList.toggle('off', Number(button.getAttribute('data-star')) > draft.stars);
    });
    root.querySelector('[data-starlabel]').innerHTML = draft.stars
      ? `<b>${draft.stars}</b> / 5 · how was the whole session?`
      : 'How was the whole session? Tap a star.';
  }

  function paintWind() {
    const card = root.querySelector('[data-windcard]');
    if (!draft.wind || draft.wind.kn == null) {
      mount(card, html`
        <span class="big">${icon('wind')}</span>
        <span class="wm">
          <span class="v">—</span>
          <span class="src manual"><span class="dot"></span>${draft.windEdited ? 'Set by hand' : 'No reading — add it by hand'}</span>
        </span>
        <button class="editbtn" data-editwind>${draft.windEdited ? 'Edit' : 'Add'}</button>`);
      return;
    }
    const extras = [draft.wind.dir, draft.wind.gust_kn != null ? `gusts ${num(draft.wind.gust_kn, 0)}` : null]
      .filter(Boolean).join(' · ');
    mount(card, html`
      <span class="big">${icon('wind')}</span>
      <span class="wm">
        <span class="v">${num(draft.wind.kn, 0)} kn${extras ? html`<small>${extras}</small>` : ''}</span>
        <span class="src ${draft.wind.source === 'manual' ? 'manual' : ''}">
          <span class="dot"></span>${draft.wind.source === 'manual'
            ? 'Set by hand'
            : `Auto from Open-Meteo · ${setup.site || store.site}${draft.wind.at ? ', ' + clockTime(draft.wind.at) : ''}`}
        </span>
      </span>
      <button class="editbtn" data-editwind>Edit</button>`);
  }

  async function fetchWind() {
    if (draft.windEdited) return;
    const site = setup.site || (store.site !== 'all' ? store.site : null);
    if (!site) { paintWind(); return; }
    const start = setup.rigged_at;
    const end = setup.derigged_at || new Date().toISOString();
    try {
      const data = await api.wind(site, start, end);
      if (data.wind) { draft.wind = data.wind; paintWind(); }
    } catch {
      // A missing reading is fine — the member adds it by hand.
    }
  }

  async function save() {
    const payload = {
      setup_id: setup.id,
      site: setup.site || (store.site !== 'all' ? store.site : null),
      started_at: setup.rigged_at,
      ended_at: setup.derigged_at || new Date().toISOString(),
      wind_kn: draft.wind ? draft.wind.kn : null,
      wind_gust_kn: draft.wind ? draft.wind.gust_kn : null,
      wind_dir: draft.wind ? draft.wind.dir : null,
      wind_source: draft.wind ? draft.wind.source : 'manual',
      // An untouched rating is no rating, not a nought: the column only accepts
      // 1 to 5, and the feed reads a missing one as "they did not say".
      stars: draft.stars || null,
      note: draft.note.trim() || null,
      pieces: draft.pieces.map((piece) => ({
        role: piece.role,
        item_id: piece.item_id,
        vote: piece.vote,
        comment: piece.comment.trim() || null,
      })),
    };
    try {
      await api.logSession(payload);
      setSetup(await refreshSetup());
      toast('Session saved to the club feed.');
      go('/log', { replace: true });
    } catch (error) {
      toast(error.message, true);
    }
  }
}

function screen(setup, draft) {
  const sail = setup.pieces.find((p) => p.role === 'sail');
  const board = setup.pieces.find((p) => p.role === 'board');
  const heading = [
    sail && sail.item ? `${num(sail.item.size_value)} ${(sail.item.model || '').split(' ')[0]} rig` : null,
    board && board.item ? board.item.model : null,
  ].filter(Boolean).join(', ');

  return html`
    <div class="appbar">
      <div class="row">
        <button class="backbtn" data-back aria-label="Back">${icon('back')}</button>
        <span class="ttl sm">Log this session</span>
      </div>
    </div>

    <div class="body pad">
      <div class="field">
        <span class="fl">Kit used</span>
        <div class="kitcard">
          <span class="ph">${artFor(sail && sail.item ? (sail.item.rig_kind || 'sail') : 'sail')}</span>
          <span class="kk">
            <span class="nm">${heading || 'Your rig'}</span>
            <span class="sub">Prefilled from your setup · ${setup.pieces.length} pieces</span>
          </span>
        </div>
      </div>

      <div class="field">
        <span class="fl">Wind</span>
        <div class="windcard" data-windcard></div>
      </div>

      <div class="field">
        <span class="fl">Overall</span>
        <div class="ratebox">
          <span class="bigstars">
            ${[1, 2, 3, 4, 5].map((n) => html`
              <button data-star="${n}" aria-label="${n} stars">${
                icon('star')}</button>`)}
          </span>
          <span class="lb" data-starlabel>How was the whole session? Tap a star.</span>
        </div>
      </div>

      <div class="field">
        <span class="fl">Note <span class="opt">· shared to the club feed</span></span>
        <textarea class="textbox" data-notebox placeholder="How was it? Conditions, how the kit went, anything worth saying."></textarea>
      </div>

      <div class="field">
        <span class="fl">Rate the kit <span class="hint">· tap a row to leave a note</span></span>
        <div class="peritems">
          <div class="ph">
            <span class="pt">Each piece you used</span>
            <span class="opt">a quick thumb feeds its rating</span>
          </div>
          ${draft.pieces.map(pieceRow)}
        </div>
      </div>
    </div>

    <div class="actionbar">
      <button class="bigbtn" data-save>Save session${icon('tick')}</button>
      <span class="helper">Saves to your logbook and the club feed. Your thumbs feed each item's rating; a note attaches to that item.</span>
    </div>`;
}

function pieceRow(piece) {
  return html`
    <div class="prow" data-prow="${piece.role}">
      <span class="pn"><span class="k">${piece.role_label}</span><span class="nm">${piece.name}</span></span>
      <div class="pv">
        <div class="thumbs2">
          <button class="t2 up" data-thumb="${piece.role}:up" aria-label="Thumbs up">${icon('thumbUp')}</button>
          <button class="t2 down" data-thumb="${piece.role}:down" aria-label="Thumbs down">${icon('thumbDown')}</button>
        </div>
      </div>
    </div>
    <div class="pcomment" hidden>
      <input type="text" data-comment="${piece.role}" placeholder="Add a note about this ${piece.role_label.toLowerCase()}…">
    </div>`;
}
