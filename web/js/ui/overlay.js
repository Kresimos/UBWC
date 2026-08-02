/**
 * Sheets, photo popups, confirmations and toasts.
 *
 * Everything the app asks for beyond a screen's own content happens here, in
 * one bottom sheet vocabulary: pick a name, pick a site, type a fault, confirm
 * a de-rig. Keeping it to one shape means a member learns the interaction once.
 */
import { html, mount, raw, esc } from '../dom.js';
import { icon } from '../icons.js';

const layer = () => document.getElementById('overlay');

let closeCurrent = null;

export function closeOverlay() {
  const node = layer();
  node.hidden = true;
  node.className = 'overlay';
  node.innerHTML = '';
  const fn = closeCurrent;
  closeCurrent = null;
  if (fn) fn();
}

function present(markup, { centred = false, onClose = null, onDismiss = null } = {}) {
  const node = layer();
  closeCurrent = onClose;
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
              <span class="rn"><b>${row.label}</b>${row.sub ? html`<span>${row.sub}</span>` : ''}</span>
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
    const node = present(html`
      <div class="sheet" role="dialog" aria-label="${title}">
        <span class="grip"></span>
        <h2>${title}</h2>
        ${sub ? html`<p class="sub">${sub}</p>` : ''}
        <div class="list">
          ${fields.map((field) => html`
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
        const input = node.querySelector(`#f-${CSS.escape(field.name)}`);
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
 * photo — both are diagnosis aids, so they get the same frame and a caption
 * that explains what is being shown.
 */
export function lightbox({ title, sub, image, glyph = 'camera' }) {
  present(html`
    <div class="lbcard" role="dialog" aria-label="${title}">
      <div class="lbphoto ${glyph === 'camera' ? '' : glyph}">
        ${image ? html`<img src="${image}" alt="">` : icon(glyph)}
      </div>
      <div class="lbcap"><b>${title}</b>${sub ? html`<span>${sub}</span>` : ''}</div>
      <button class="lbclose">Close</button>
    </div>`, { centred: true });
  layer().querySelector('.lbclose').addEventListener('click', closeOverlay);
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
