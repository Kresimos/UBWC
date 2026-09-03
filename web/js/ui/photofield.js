/**
 * One photo picker, used everywhere a photo can be attached: the Add/Edit kit
 * form, the trip form, the fault and fix sheets, the profile menu and the spot
 * editor.
 *
 * The flow is always the same: tap, pick from the camera or the roll, the
 * browser downscales it, it uploads, and the returned path is written onto
 * whatever object is about to be saved. The server resizes again and is the
 * authority — the downscale here is only so a phone on lake wifi sends a few
 * hundred KB instead of a four-megabyte original.
 */
import { html } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { toast } from './overlay.js';

/**
 * Shrink a picked image in the browser before it uploads. Best-effort: on any
 * failure the original file is returned and the server deals with it.
 */
export async function downscaleImage(file, maxPx = 1920, quality = 0.82) {
  if (!file || !/^image\//.test(file.type || '')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, maxPx / longEdge);
    if (scale === 1 && file.size < 900_000) { bitmap.close?.(); return file; }
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

/**
 * The button, or a preview with Replace / Remove once a photo is set. `path`
 * is the current image_path or null.
 */
export function photoField(path, { label = 'Add photo', hint = '' } = {}) {
  if (path) {
    return html`
      <div class="photopick has" data-photofield>
        <img src="${path}" alt="">
        <span class="photopick-acts">
          <button type="button" class="pp-btn" data-photo-pick>${icon('camera')}Replace</button>
          <button type="button" class="pp-btn warn" data-photo-clear>${icon('trash')}Remove</button>
        </span>
      </div>`;
  }
  return html`
    <button type="button" class="photopick" data-photofield data-photo-pick>
      <span class="cam">${icon('camera')}</span>
      <span class="t">${label}</span>
      ${hint ? html`<span class="h">${hint}</span>` : ''}
    </button>`;
}

/**
 * Wire the photo field(s) inside `root`. `state[key]` holds the image_path;
 * `repaint()` re-renders so the preview swaps in. Safe to call again after a
 * repaint.
 */
export function wirePhoto(root, state, key, repaint) {
  root.querySelectorAll('[data-photo-pick]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      pick(state, key, repaint, button.closest('[data-photofield]'));
    });
  });
  root.querySelectorAll('[data-photo-clear]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      state[key] = null;
      repaint();
    });
  });
}

function pick(state, key, repaint, field) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  document.body.append(input);
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    if (field) field.classList.add('busy');
    try {
      const sized = await downscaleImage(file);
      state[key] = await api.uploadPhoto(sized);
      repaint();
    } catch (error) {
      toast(error.message, true);
      if (field) field.classList.remove('busy');
    }
  }, { once: true });
  input.click();
}
