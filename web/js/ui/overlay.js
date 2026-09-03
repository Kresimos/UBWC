/**
 * Sheets, photo popups, confirmations and toasts.
 *
 * Everything the app asks for beyond a screen's own content happens here, in
 * one bottom sheet vocabulary: pick a name, pick a site, type a fault, confirm
 * a de-rig. Keeping it to one shape means a member learns the interaction once.
 */
import { html, mount, raw, esc } from '../dom.js';
import { icon } from '../icons.js';
import { photoField, wirePhoto } from './photofield.js';

const layer = () => document.getElementById('overlay');

let closeCurrent = null;
// While a sheet is animating out, the node is still in the DOM. This holds the
// timer that finally clears it, so a new present() can cancel the exit and
// reuse the node rather than have it wiped out from under the new sheet.
let teardown = null;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function wipe(node) {
  if (teardown) { clearTimeout(teardown); teardown = null; }
  node.hidden = true;
  node.className = 'overlay';
  node.style.pointerEvents = '';
  node.onclick = null;
  node.innerHTML = '';
}

export function closeOverlay() {
  const node = layer();
  const fn = closeCurrent;
  closeCurrent = null;
  if (fn) fn();

  if (node.hidden || teardown) return;
  const card = node.querySelector('.sheet, .lbcard');
  if (reduceMotion() || !card) { wipe(node); return; }
  // Let the promise resolve now; the node slides out behind it and clears when
  // the animation is done.
  node.classList.add('closing');
  node.style.pointerEvents = 'none';
  teardown = setTimeout(() => { teardown = null; wipe(node); }, 240);
}

function present(markup, { centred = false, onClose = null, onDismiss = null } = {}) {
  const node = layer();
  if (teardown) { clearTimeout(teardown); teardown = null; }
  closeCurrent = onClose;
  node.style.pointerEvents = '';
  node.className = centred ? 'overlay centred' : 'overlay';
  mount(node, markup);
  node.hidden = false;
  node.onclick = (event) => {
    if (event.target === node) {
      if (onDismiss) onDismiss();
      closeOverlay();
    }
  };
  const focusable = node.querySelector('input, textarea, button');
  if (focusable && focusable.tagName !== 'BUTTON') setTimeout(() => focusable.focus(), 60);
  return node;
}

/**
 * A list to choose from. `rows` are {value, label, sub, avatar, on}; picking
 * one closes the sheet and resolves.
 */
export function chooser({ title, sub, rows, footer }) {
  return new Promise((resolve) => {
    const node = present(html`
      <div class="sheet" role="dialog" aria-label="${title}">
        <span class="grip"></span>
        <h2>${title}</h2>
        ${sub ? html`<p class="sub">${sub}</p>` : ''}
        <div class="list">
          ${rows.map((row) => html`
            <button class="sheetrow ${row.on ? 'on' : ''}" data-value="${row.value}">
              ${row.avatar ? html`<span class="av">${row.avatar}</span>` : ''}
              <span class="rowlabel"><b>${row.label}</b>${row.sub ? html`<span>${row.sub}</span>` : ''}</span>
              <span class="tick">${icon('tick')}</span>
            </button>`)}
        </div>
        ${footer ? html`<div class="foot">${raw(footer)}</div>` : ''}
      </div>`, { onDismiss: () => resolve(null) });

    node.querySelectorAll('[data-value]').forEach((button) => {
      button.addEventListener('click', () => {
        const value = button.getAttribute('data-value');
        closeOverlay();
        resolve(value);
      });
    });
  });
}

/**
 * A short form. `fields` are {name, label, type, value, placeholder, options,
 * required, rows}; resolves with the values, or null if cancelled.
 *
 * Pass `onSubmit` when something can refuse the answer: a password the server
 * rejects, a username already taken. The sheet then stays open and shows the
 * refusal against the form the member is still looking at, rather than closing
 * and dropping a toast over a screen they have already moved on from, and
 * resolves with whatever onSubmit returned. `alt` adds a second, quieter
 * button under it (sign in ⇄ create an account), which resolves as
 * {alt: true}.
 */
export function formSheet({ title, sub, fields, submitLabel = 'Save', danger = false,
                            onSubmit = null, alt = null, cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    // A photo field uploads on pick rather than on submit, so its chosen path
    // lives here and collect() reads it out alongside the text inputs.
    const photos = {};
    for (const field of fields) {
      if (field.type === 'photo') photos[field.name] = field.value || null;
    }
    const repaintPhoto = (field) => {
      const wrap = node.querySelector(`[data-photowrap="${CSS.escape(field.name)}"]`);
      if (!wrap) return;
      mount(wrap, photoField(photos[field.name], { hint: field.hint }));
      wirePhoto(wrap, photos, field.name, () => repaintPhoto(field), { aspect: field.aspect || 1 });
    };

    const node = present(html`
      <div class="sheet" role="dialog" aria-label="${title}">
        <span class="grip"></span>
        <h2>${title}</h2>
        ${sub ? html`<p class="sub">${sub}</p>` : ''}
        <div class="list">
          ${fields.map((field) => field.type === 'photo'
            ? html`
              <div class="field">
                <label>${field.label}</label>
                <div data-photowrap="${field.name}">${photoField(field.value || null, { hint: field.hint })}</div>
              </div>`
            : html`
              <div class="field">
                <label for="f-${field.name}">${field.label}</label>
                ${raw(control(field))}
                ${field.hint ? html`<span class="hint">${field.hint}</span>` : ''}
              </div>`)}
        </div>
        <div class="err" hidden></div>
        <div class="foot">
          <button class="bigbtn ${danger ? 'danger' : ''}" data-submit>${submitLabel}</button>
          ${alt ? html`<button class="bigbtn ghost" data-alt>${alt}</button>` : ''}
          <button class="bigbtn ghost" data-cancel>${cancelLabel}</button>
        </div>
      </div>`, { onDismiss: () => resolve(null) });

    const error = node.querySelector('.err');
    const submit = node.querySelector('[data-submit]');

    fields.filter((field) => field.type === 'photo').forEach((field) => {
      const wrap = node.querySelector(`[data-photowrap="${CSS.escape(field.name)}"]`);
      if (wrap) wirePhoto(wrap, photos, field.name, () => repaintPhoto(field), { aspect: field.aspect || 1 });
    });

    const show = (message) => {
      error.textContent = message;
      error.hidden = false;
    };

    node.querySelector('[data-cancel]').addEventListener('click', () => {
      closeOverlay();
      resolve(null);
    });
    if (alt) {
      node.querySelector('[data-alt]').addEventListener('click', () => {
        closeOverlay();
        resolve({ alt: true });
      });
    }

    const collect = () => {
      const values = {};
      for (const field of fields) {
        if (field.type === 'photo') {
          values[field.name] = photos[field.name] ?? null;
          continue;
        }
        const input = node.querySelector(`#f-${CSS.escape(field.name)}`);
        if (input && input.type === 'checkbox') {
          values[field.name] = input.checked;
          continue;
        }
        values[field.name] = input ? input.value.trim() : '';
        if (field.required && !values[field.name]) {
          show(`${field.label} is needed.`);
          input.focus();
          return null;
        }
      }
      return values;
    };

    const send = async () => {
      const values = collect();
      if (!values) return;
      if (!onSubmit) {
        closeOverlay();
        resolve(values);
        return;
      }
      submit.disabled = true;
      error.hidden = true;
      try {
        const result = await onSubmit(values);
        closeOverlay();
        resolve(result === undefined ? values : result);
      } catch (failure) {
        show(failure.message);
        submit.disabled = false;
      }
    };

    submit.addEventListener('click', send);
    // Enter anywhere in the form submits it, the way a browser's own form
    // would. A phone keyboard's Go key is how most members will send this.
    node.querySelectorAll('input').forEach((input) => {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          send();
        }
      });
    });
  });
}

function control(field) {
  const id = `f-${esc(field.name)}`;
  if (field.type === 'select') {
    const options = (field.options || []).map(
      (option) => `<option value="${esc(option.value ?? option)}"${
        String(option.value ?? option) === String(field.value ?? '') ? ' selected' : ''
      }>${esc(option.label ?? option)}</option>`
    ).join('');
    return `<select id="${id}">${options}</select>`;
  }
  if (field.type === 'checkbox') {
    return `<input id="${id}" type="checkbox"${field.value ? ' checked' : ''}>`;
  }
  if (field.type === 'textarea') {
    return `<textarea id="${id}" rows="${field.rows || 3}" placeholder="${
      esc(field.placeholder || '')}">${esc(field.value || '')}</textarea>`;
  }
  // autocomplete/autocapitalize matter on the sign-in sheet: a phone that
  // capitalises the first letter of a username, or a password manager that
  // cannot see which field is which, both turn signing in into a fight.
  return `<input id="${id}" type="${esc(field.type || 'text')}" value="${
    esc(field.value ?? '')}" placeholder="${esc(field.placeholder || '')}"${
    field.inputmode ? ` inputmode="${esc(field.inputmode)}"` : ''}${
    field.autocomplete ? ` autocomplete="${esc(field.autocomplete)}"` : ''}${
    field.type === 'password' || field.autocomplete === 'username'
      ? ' autocapitalize="off" autocorrect="off" spellcheck="false"' : ''}>`;
}

/** Yes/no, for anything that discards something a member made. */
export function confirmSheet({ title, sub, confirmLabel = 'Confirm', cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    const node = present(html`
      <div class="sheet" role="dialog" aria-label="${title}">
        <span class="grip"></span>
        <h2>${title}</h2>
        ${sub ? html`<p class="sub">${sub}</p>` : ''}
        <div class="foot">
          <button class="bigbtn" data-yes>${confirmLabel}</button>
          <button class="bigbtn ghost" data-no>${cancelLabel}</button>
        </div>
      </div>`, { onDismiss: () => resolve(false) });

    node.querySelector('[data-yes]').addEventListener('click', () => { closeOverlay(); resolve(true); });
    node.querySelector('[data-no]').addEventListener('click', () => { closeOverlay(); resolve(false); });
  });
}

/**
 * The photo popup. Used for a spot ("where does this live?") and for a fault
 * photo. Both are diagnosis aids, so they get the same frame and a caption
 * that explains what is being shown. `tone` recolours the band for a caller
 * that carries a severity of its own: "crit" for a fault that has taken the
 * piece out of action.
 */
export function lightbox({ title, sub, image, glyph = 'camera', tone = '', action = null }) {
  present(html`
    <div class="lbcard" role="dialog" aria-label="${title}">
      <div class="lbphoto ${glyph === 'camera' ? '' : glyph} ${tone}">
        ${image ? html`<img src="${image}" alt="">` : icon(glyph)}
      </div>
      <div class="lbcap"><b>${title}</b>${sub ? html`<span>${sub}</span>` : ''}</div>
      ${action ? html`<button class="lbaction" data-lbaction>${action.label}</button>` : ''}
      <button class="lbclose">Close</button>
    </div>`, { centred: true });
  layer().querySelector('.lbclose').addEventListener('click', closeOverlay);
  if (action) {
    layer().querySelector('[data-lbaction]').addEventListener('click', () => {
      closeOverlay();
      action.onClick();
    });
  }
}


/**
 * Crop and zoom a picked photo before it uploads. Resolves with a JPEG File of
 * the framed region (at most `maxPx` on its long side), or null if the member
 * backs out. `aspect` is width / height of the frame, chosen by the caller to
 * match where the photo will be shown (square for a profile or a piece of kit,
 * wide for a trip banner, 4:3 for a fault).
 *
 * It builds its own overlay rather than borrowing the shared #overlay layer,
 * because it is opened FROM a sheet (the fault form, the spot editor) and must
 * sit on top of it and clean up only itself when it closes.
 *
 * Vanilla: one <img> moved with a transform inside an overflow-hidden stage,
 * pointer events for drag and pinch, a range input for a thumb or a mouse.
 */
export function cropSheet(file, { aspect = 1, maxPx = 1600,
                                  title = 'Position the photo' } = {}) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    let settled = false;
    let root = null;

    const teardown = () => {
      if (!root) return;
      const node = root;
      root = null;
      if (reduceMotion()) { node.remove(); return; }
      node.classList.add('closing');
      setTimeout(() => node.remove(), 240);
    };
    const finish = (blob) => {
      if (settled) return;
      settled = true;
      teardown();
      URL.revokeObjectURL(url);
      resolve(blob);
    };

    img.onerror = () => finish(file);   // can't decode it here; let the server try
    img.onload = () => {
      const stageW = Math.max(200, Math.min(320, window.innerWidth - 72));
      const stageH = Math.max(120, Math.round(stageW / aspect));
      const iw = img.naturalWidth || 1;
      const ih = img.naturalHeight || 1;
      // The scale at which the image exactly covers the stage; zoom multiplies it.
      const cover = Math.max(stageW / iw, stageH / ih);

      root = document.createElement('div');
      root.className = 'overlay cropover';
      mount(root, html`
        <div class="sheet cropper" role="dialog" aria-label="${title}">
          <span class="grip"></span>
          <h2>${title}</h2>
          <p class="sub">Drag to move it. Pinch, scroll or use the slider to zoom.</p>
          <div class="cropstage" style="width:${stageW}px;height:${stageH}px">
            <img class="cropimg" src="${url}" alt="" draggable="false">
            <span class="cropgrid" aria-hidden="true"></span>
          </div>
          <input class="cropzoom" type="range" min="1" max="5" step="0.001" value="1"
                 aria-label="Zoom">
          <div class="foot">
            <button class="bigbtn" data-crop-use>Use photo</button>
            <button class="bigbtn ghost" data-crop-cancel>Cancel</button>
          </div>
        </div>`);
      (layer().parentNode || document.body).append(root);
      root.addEventListener('click', (e) => { if (e.target === root) finish(null); });

      const node = root;
      const stage = node.querySelector('.cropstage');
      const el = node.querySelector('.cropimg');
      const zoomInput = node.querySelector('.cropzoom');

      let z = 1;              // zoom on top of cover
      let ox = 0, oy = 0;     // image top-left, relative to the stage top-left
      const scale = () => cover * z;

      const clamp = () => {
        const s = scale();
        ox = Math.min(0, Math.max(stageW - iw * s, ox));
        oy = Math.min(0, Math.max(stageH - ih * s, oy));
      };
      const render = () => {
        const s = scale();
        el.style.width = iw * s + 'px';
        el.style.height = ih * s + 'px';
        el.style.transform = `translate(${ox}px, ${oy}px)`;
      };

      ox = (stageW - iw * scale()) / 2;
      oy = (stageH - ih * scale()) / 2;
      render();

      // Zoom about a point in stage coordinates, keeping that point over the
      // same part of the image.
      const setZoom = (nz, cx = stageW / 2, cy = stageH / 2) => {
        nz = Math.min(5, Math.max(1, nz));
        const before = scale();
        const ix = (cx - ox) / before;
        const iy = (cy - oy) / before;
        z = nz;
        const after = scale();
        ox = cx - ix * after;
        oy = cy - iy * after;
        clamp();
        render();
        zoomInput.value = String(z);
      };

      zoomInput.addEventListener('input', () => setZoom(parseFloat(zoomInput.value)));

      const pts = new Map();
      let pinch = null;
      stage.addEventListener('pointerdown', (e) => {
        stage.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, z };
        }
      });
      stage.addEventListener('pointermove', (e) => {
        if (!pts.has(e.pointerId)) return;
        const prev = pts.get(e.pointerId);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 1) {
          ox += e.clientX - prev.x;
          oy += e.clientY - prev.y;
          clamp();
          render();
        } else if (pts.size === 2 && pinch) {
          const [a, b] = [...pts.values()];
          const rect = stage.getBoundingClientRect();
          setZoom(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist),
                  (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
        }
      });
      const lift = (e) => {
        pts.delete(e.pointerId);
        if (pts.size < 2) pinch = null;
      };
      stage.addEventListener('pointerup', lift);
      stage.addEventListener('pointercancel', lift);
      stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = stage.getBoundingClientRect();
        setZoom(z * (e.deltaY < 0 ? 1.12 : 0.89),
                e.clientX - rect.left, e.clientY - rect.top);
      }, { passive: false });

      node.querySelector('[data-crop-cancel]').addEventListener('click', () => finish(null));
      node.querySelector('[data-crop-use]').addEventListener('click', () => {
        const s = scale();
        const sw = stageW / s;
        const sh = stageH / s;
        const out = Math.min(1, maxPx / Math.max(sw, sh));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sw * out));
        canvas.height = Math.max(1, Math.round(sh * out));
        canvas.getContext('2d').drawImage(
          img, -ox / s, -oy / s, sw, sh, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          finish(blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file);
        }, 'image/jpeg', 0.85);
      });
    };

    img.src = url;
  });
}

let toastTimer = null;

export function toast(message, bad = false) {
  const screen = document.querySelector('.screen');
  screen.querySelectorAll('.toast').forEach((node) => node.remove());
  const node = document.createElement('div');
  node.className = bad ? 'toast bad' : 'toast';
  node.textContent = message;
  node.setAttribute('role', 'status');
  screen.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), bad ? 4200 : 2600);
}
