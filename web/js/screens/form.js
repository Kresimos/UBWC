/**
 * The add / edit form.
 *
 * misc/spec.md: Edit opens the *same form as Add*, prefilled with the item, so
 * there is one form and this file renders both. It is generated from the field
 * metadata the server sends (store.forms), so it knows no windsurfing itself —
 * it draws whatever db.py says a type is made of, with three hand-built cases
 * the sketches call for:
 *
 *  - a sail's **luff** field carries the adjustable-top amount inline, because
 *    the two numbers are read off the sail together;
 *  - **cams** is a switch, not a text box;
 *  - **faults** are structured, one soft-tinted box each, severity toggled by
 *    tapping the dot.
 *
 * The server validates again on save — this is the club's ground truth, so the
 * form is a convenience and the API is the gate.
 */
import { html, mount, onClick, esc } from '../dom.js';
import { icon, artFor } from '../icons.js';
import { api } from '../api.js';
import { store } from '../store.js';
import { chooser, lightbox, toast } from '../ui/overlay.js';
import { go, back } from '../router.js';

export async function render(root, params) {
  const editing = Boolean(params.id);
  let type = params.type;
  let values = {};
  let faults = [];

  if (editing) {
    const item = await api.item(Number(params.id));
    type = item.component_type;
    values = { ...item.raw };
    // Only open faults are editable inline; cleared ones live in history.
    faults = item.fault_history
      .filter((f) => f.status === 'open')
      .map((f) => ({ title: f.title, description: f.description, severity: f.severity, existing: true }));
  }

  const fields = store.forms[type] || [];
  const required = new Set(store.required[type] || []);

  function paint() {
    mount(root, screen(type, editing, fields, required, values, faults));
    wire();
  }

  function wire() {
    root.querySelector('[data-back]').addEventListener('click', () => back(editing ? `/item/${params.id}` : '/add'));
    root.querySelector('[data-changetype]')?.addEventListener('click', () => {
      if (!editing) go('/add', { replace: true });
    });

    // text / number inputs write straight back to `values`
    root.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('input', () => {
        values[input.getAttribute('data-field')] = input.value;
        input.closest('.inp')?.classList.remove('bad');
      });
    });

    // condition chips
    onClick(root, 'data-cond', (value) => {
      values.condition = value;
      root.querySelectorAll('[data-cond]').forEach((chip) =>
        chip.classList.toggle('on', chip.getAttribute('data-cond') === value));
    });

    // cams switch
    onClick(root, 'data-cams', (_v, node) => {
      values.cams = values.cams ? 0 : 1;
      node.classList.toggle('on', Boolean(values.cams));
    });

    // box-type / site pickers via a sheet
    onClick(root, 'data-select', async (name) => {
      const options = name === 'location'
        ? store.sites.map((s) => ({ value: s.name, label: s.name }))
          .concat([{ value: '__new', label: 'A new site…' }])
        : (name === 'box_type' ? store.boxTypes : []).map((choice) => ({ value: choice, label: choice }));
      const chosen = await chooser({
        title: name === 'location' ? 'Which site?' : 'Box type',
        rows: options.map((o) => ({ ...o, on: values[name] === o.value })),
      });
      if (!chosen) return;
      if (chosen === '__new') {
        const site = prompt('New site name');
        if (site) { values.location = site.trim(); }
      } else {
        values[name] = chosen;
      }
      paint();
    });

    // adjustable-top popover
    onClick(root, 'data-extra', (_v, node, event) => {
      event.stopPropagation();
      const pop = node.closest('.grp').querySelector('.popover');
      if (pop) pop.hidden = !pop.hidden;
    });

    // faults editor
    onClick(root, 'data-sev', (index) => {
      const fault = faults[Number(index)];
      fault.severity = fault.severity === 'out_of_action' ? 'usable' : 'out_of_action';
      paint();
    });
    onClick(root, 'data-rmfault', (index) => {
      faults.splice(Number(index), 1);
      paint();
    });
    onClick(root, 'data-addfault', () => {
      faults.push({ title: '', description: '', severity: 'usable' });
      paint();
    });
    root.querySelectorAll('[data-ftitle]').forEach((input) => {
      input.addEventListener('input', () => { faults[Number(input.getAttribute('data-ftitle'))].title = input.value; });
    });
    root.querySelectorAll('[data-fdesc]').forEach((input) => {
      input.addEventListener('input', () => { faults[Number(input.getAttribute('data-fdesc'))].description = input.value; });
    });

    root.querySelector('[data-save]').addEventListener('click', save);
  }

  async function save() {
    const record = { component_type: type };
    fields.forEach((field) => {
      let value = values[field.name];
      if (field.kind === 'bool') value = values[field.name] ? 1 : 0;
      record[field.name] = value === undefined ? null : value;
    });

    const payload = {
      item: record,
      faults: faults
        .filter((f) => !f.existing && (f.title.trim() || f.description.trim()))
        .map((f) => ({ title: f.title.trim(), description: f.description.trim(), severity: f.severity })),
    };

    try {
      const result = editing
        ? await api.updateItem(Number(params.id), payload)
        : await api.createItem(payload);
      if (result.warnings && result.warnings.length) result.warnings.forEach((w) => toast(w));
      toast(editing ? 'Saved.' : `Added to the ${store.typeLabels[type]}s.`);
      go(editing ? `/item/${params.id}` : `/item/${result.id}`, { replace: true });
    } catch (error) {
      // The server points at the first missing field; flag every empty required
      // one so the member fixes them in one pass rather than one at a time.
      required.forEach((name) => {
        const value = values[name];
        if (value == null || value === '') {
          root.querySelector(`[data-field="${CSS.escape(name)}"]`)?.closest('.inp')?.classList.add('bad');
          root.querySelector(`[data-select="${CSS.escape(name)}"]`)?.classList.add('bad');
        }
      });
      toast(error.message, true);
    }
  }

  paint();
}

// ------------------------------------------------------------------ markup
function screen(type, editing, fields, required, values, faults) {
  return html`
    <div class="appbar">
      <div class="row">
        <button class="backbtn" data-back aria-label="Back">${icon('back')}</button>
        <span class="ttl sm">${editing ? 'Edit' : 'New'} ${store.typeLabels[type].toLowerCase()}</span>
      </div>
    </div>

    <div class="body pad">
      <div class="form">
        <button class="typechip" data-changetype>
          ${artFor(type)}${store.typeLabels[type]}
          ${editing ? '' : html`<span class="ch">Change type</span>`}
        </button>

        <button class="photo" type="button">
          <span class="cam">${icon('camera')}</span>
          <span class="t">Add photo</span>
          <span class="h">Shop-panel shot on a soft grey background. Optional for now.</span>
        </button>

        ${renderFields(type, fields, required, values)}

        <div class="grp">
          <span class="lab lab-warn">${icon('warning')}Faults <span class="opt">· optional, one box each</span></span>
          ${faults.map((fault, i) => faultBox(fault, i))}
          <button class="addfault" type="button" data-addfault>${icon('plus')}Add ${faults.length ? 'another' : 'a'} fault</button>
        </div>
      </div>
    </div>

    <div class="actionbar">
      <button class="bigbtn" data-save>${editing ? 'Save changes' : 'Add to inventory'}${icon('tick')}</button>
      <span class="helper">Saved as club ground truth. Required fields are marked with a teal dot.</span>
    </div>`;
}

function renderFields(type, fields, required, values) {
  // Group the numeric rig-spec of a sail into its own card, as the sketch does.
  const inline = fields.filter((f) => !['condition', 'location', 'spot', 'notes', 'cams',
    'luff_cm', 'top_extension_max_cm', 'req_boom_cm'].includes(f.name));

  const rows = [];
  // Pair up manufacturer/model, size/type, into two-up rows where they exist.
  for (let i = 0; i < inline.length; i += 2) {
    const pair = inline.slice(i, i + 2);
    rows.push(html`<div class="two">${pair.map((f) => field(f, required, values))}</div>`);
  }

  return html`
    ${rows}
    ${type === 'sail' ? camsSwitch(values) : ''}
    ${type === 'sail' ? sailRigCard(required, values) : ''}
    ${conditionField(required, values)}
    ${locationFields(required, values)}
    ${notesField(values)}`;
}

function field(f, required, values) {
  const req = required.has(f.name);
  const value = values[f.name];
  const unit = UNITS[f.name] || '';
  if (f.kind === 'select') {
    return html`
      <div class="grp">
        <span class="lab">${req ? html`<span class="req"></span>` : ''}${f.label}</span>
        <button class="inp sel" data-select="${f.name}">
          <span class="v ${value ? '' : 'p'}">${value || 'Choose…'}</span>${icon('chevronDown')}
        </button>
      </div>`;
  }
  return html`
    <div class="grp">
      <span class="lab">${req ? html`<span class="req"></span>` : ''}${f.label}</span>
      <div class="inp">
        <input data-field="${f.name}" type="text"
               inputmode="${f.kind === 'number' ? 'decimal' : 'text'}"
               value="${value ?? ''}" placeholder="${PLACEHOLDERS[f.name] || ''}">
        ${unit ? html`<span class="unit">${unit}</span>` : ''}
      </div>
    </div>`;
}

function camsSwitch(values) {
  return html`
    <button class="switch ${values.cams ? 'on' : ''}" type="button" data-cams>
      <span class="tl"><b>Cambered</b><span>Has cams around the mast</span></span>
      <span class="knob"></span>
    </button>`;
}

function sailRigCard(required, values) {
  return html`
    <div class="subcard">
      <div class="sh"><b>Rig spec</b><span>Printed on the sail</span></div>
      <div class="grp popgrp">
        <div class="lab lab-split">
          <span><span class="req"></span>Luff length</span>
          <button class="extra" type="button" data-extra>extra <span class="q">?</span></button>
        </div>
        <div class="inp lufffield">
          <span class="mainval">
            <input data-field="luff_cm" type="text" inputmode="decimal" value="${values.luff_cm ?? ''}" placeholder="450">
            <span class="unit">cm</span>
          </span>
          <span class="topadd">+ <input data-field="top_extension_max_cm" type="text" inputmode="decimal"
            value="${values.top_extension_max_cm ?? 0}"> cm</span>
        </div>
        <div class="popover" hidden>How far the mast may stick out the top of the sail. 0 is a fixed
          luff; raise it to fit longer masts (the extra pokes out the top).</div>
      </div>
      <div class="grp">
        <span class="lab"><span class="req"></span>Boom length</span>
        <div class="inp"><input data-field="req_boom_cm" type="text" inputmode="decimal"
          value="${values.req_boom_cm ?? ''}" placeholder="188"><span class="unit">cm</span></div>
      </div>
    </div>`;
}

function conditionField(required, values) {
  return html`
    <div class="grp">
      <span class="lab"><span class="req"></span>Condition</span>
      <div class="chips">
        ${store.conditions.map((choice) => html`
          <span class="chip ${values.condition === choice ? 'on' : ''}" data-cond="${choice}">${choice}</span>`)}
      </div>
    </div>`;
}

function locationFields(required, values) {
  return html`
    <div class="two">
      <div class="grp">
        <span class="lab"><span class="req"></span>Site</span>
        <button class="inp sel" data-select="location">
          <span class="v ${values.location ? '' : 'p'}">${values.location || 'Choose…'}</span>${icon('chevronDown')}
        </button>
      </div>
      <div class="grp">
        <span class="lab">Spot <span class="opt">· optional</span></span>
        <div class="inp"><input data-field="spot" type="text" value="${values.spot ?? ''}" placeholder="wooden rack"></div>
      </div>
    </div>`;
}

function notesField(values) {
  return html`
    <div class="grp">
      <span class="lab">Notes <span class="opt">· optional</span></span>
      <div class="inp"><textarea data-field="notes" placeholder="Rigging tips, sailing quirks, things to watch. Cambered sails: start with RDM or SDM.">${esc(values.notes ?? '')}</textarea></div>
    </div>`;
}

function faultBox(fault, i) {
  return html`
    <div class="faultitem ${fault.severity === 'out_of_action' ? 'oos' : 'usable'}">
      <div class="faultbox">
        <div class="ftoprow">
          <button class="sevdrop" type="button" data-sev="${i}" aria-label="Switch severity">
            <span class="d"></span>${icon('chevronDown')}
          </button>
          <input class="ftitle" data-ftitle="${i}" value="${fault.title || ''}"
            placeholder="Name this fault" ${fault.existing ? 'disabled' : ''}>
          ${fault.existing ? '' : html`<button class="frm" type="button" data-rmfault="${i}" aria-label="Remove fault">${icon('close')}</button>`}
        </div>
        <div class="fdiv"></div>
        <textarea class="fdesc" data-fdesc="${i}" placeholder="What is wrong and what it needs, the diagnosis and the fix…" ${fault.existing ? 'disabled' : ''}>${esc(fault.description || '')}</textarea>
      </div>
    </div>`;
}

const UNITS = {
  size_l: 'L', size_m2: 'm²', luff_cm: 'cm', req_boom_cm: 'cm', length_cm: 'cm',
  min_size_cm: 'cm', max_size_cm: 'cm', fin_length_cm: 'cm', top_extension_max_cm: 'cm',
};
const PLACEHOLDERS = {
  manufacturer: 'Neil Pryde', model: 'Fusion', type: 'Freeride',
  size_generic: '0-30cm, M, Euro pin…',
};
