/* ============================================================================
   The wizard mockup's controller.

   The screen is not scripted: it runs the real solver (spliced in above this
   script by build.mjs: buildModel / chooseTrailer / unriggableGroups /
   checkGroup / classLabel, against pack.fixtures.mjs). Every control change
   re-solves and re-paints, with the transitions the plan calls for: a debounced
   recompute dip, a count-up roll on the headline numbers, a green<->amber hero
   crossfade, and rows animating between the two combination bands.

   Nothing here is app code. When this screen is built for real it lives in
   web/js/screens/trip.js and talks to the DB, not the fixture rack.
   ========================================================================== */
(function () {
  'use strict';

  var mountEl = document.querySelector('[data-wzbody]');
  var screenEl = document.querySelector('.screen');
  var rootCss = getComputedStyle(document.documentElement);
  var REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* -------------------------------------------------------- knob reading */

  function nums(prop) {
    return rootCss.getPropertyValue(prop).trim().split(/\s+/).map(Number).filter(function (n) { return !isNaN(n); });
  }
  function ms(prop, dflt) {
    var v = rootCss.getPropertyValue(prop).trim();
    if (v.slice(-2) === 'ms') return parseFloat(v);
    if (v.slice(-1) === 's') return parseFloat(v) * 1000;
    return dflt;
  }
  function weights(arr) { return { spare: arr[0], short: arr[1], match: arr[2], sessions: arr[3], light: arr[4] }; }

  var PRESETS = {
    light: weights(nums('--wz-preset-light')),
    standard: weights(nums('--wz-preset-standard')),
    generous: weights(nums('--wz-preset-generous')),
  };
  var DEBOUNCE = Number(rootCss.getPropertyValue('--wz-recompute-debounce')) || 90;
  var ROLL_MS = ms('--wz-roll-ms', 440);

  var FILL_HINT = {
    light: 'The smallest trailer that still keeps the promise. Nothing spare.',
    standard: 'A couple of backups for the sizes most people sail.',
    generous: 'Every backup that fits, for the sizes people swap between.',
  };

  /* ---------------------------------------------------------------- state */

  var CAMMED = {};
  SAILS.forEach(function (s) { CAMMED[s.m2] = !!s.cams; });

  var state = {
    sailM2: nums('--wz-start-sails'),
    minRigs: Number(rootCss.getPropertyValue('--wz-start-minrigs')) || 5,
    preset: (rootCss.getPropertyValue('--wz-start-preset').trim() || 'standard'),
    mustRig: [],   // arrays of m² numbers the kit sec has said must all rig
  };
  var pick = [];   // m² values ticked into the tester; transient, never re-solves
  var last = { model: null, counts: null, result: null };
  var shown = {};  // last-painted headline values, so the roll knows where to start

  /* --------------------------------------------------------------- helpers */

  var ic = function (n) { return icon(n); };
  var m2s = function (v) { return v.toFixed(1); };
  var cam = function (v) { return CAMMED[v] ? '<span class="cam">◆</span>' : ''; };
  var comboLabel = function (list) {
    return list.slice().sort(function (a, b) { return a - b; })
      .map(function (v) { return m2s(v) + cam(v); }).join(' + ');
  };
  var keyOf = function (list) {
    return list.slice().sort(function (a, b) { return a - b; }).join(',');
  };
  var sameGroup = function (a, b) { return keyOf(a) === keyOf(b); };

  function idxsFor(list) {
    if (!last.model) return [];
    return list.map(function (v) {
      return last.model.sails.findIndex(function (s) { return Math.abs(s.m2 - v) < 0.01; });
    }).filter(function (i) { return i >= 0; }).sort(function (a, b) { return a - b; });
  }

  // "one more 430 RDM mast" / "an SDM extension" / "a 150-200 boom"
  function friendly(c) {
    if (!c) return null;
    var p = c.rep;
    if (c.kind === 'mast') return p.len + ' ' + p.diam + ' mast';
    if (c.kind === 'ext') return (p.diam ? p.diam + ' ' : '') + 'extension';
    return p.min + '-' + p.max + ' boom';
  }

  /* ---------------------------------------------------------------- solve */

  function solve() {
    var sizes = state.sailM2.slice().sort(function (a, b) { return a - b; });
    var sails = sailsBySize(sizes);
    var model = buildModel(sails, KIT.slice(), []);
    var idOf = {};
    sails.forEach(function (s, i) { idOf[s.m2] = i; });

    // drop from the forced sessions any size no longer on the trip
    state.mustRig = state.mustRig
      .map(function (g) { return g.filter(function (v) { return sizes.indexOf(v) !== -1; }); })
      .filter(function (g) { return g.length >= 2; });
    pick = pick.filter(function (v) { return sizes.indexOf(v) !== -1; });

    var mustRig = state.mustRig.map(function (g) {
      return g.map(function (v) { return idOf[v]; });
    });

    var result = chooseTrailer(model, {
      minRigs: Math.min(state.minRigs, sizes.length),
      weights: PRESETS[state.preset],
      mustRig: mustRig,
    });
    last = { model: model, counts: result.counts, result: result };
    return result;
  }

  /* ------------------------------------------------------------- skeleton */

  function mount() {
    mountEl.innerHTML =
      '<div class="wz" data-wz>' +

        '<div class="wz-strip" data-dim>' +
          '<div class="wz-stat"><span class="k">Pieces</span><b data-fig="pieces">0</b></div>' +
          '<div class="wz-stat"><span class="k">Spares</span><b data-fig="spares">0</b></div>' +
          '<div class="wz-stat"><span class="k">Brand match</span>' +
            '<b><span data-fig="match">0</span><i>%</i></b></div>' +
        '</div>' +

        '<div class="wz-hero" data-hero>' +
          '<div class="wz-heronum">' +
            '<button class="wz-step" data-nudge="-1" aria-label="Fewer rigs">−</button>' +
            '<span class="fig" data-fig="rigs">0</span>' +
            '<button class="wz-step" data-nudge="1" aria-label="More rigs">+</button>' +
          '</div>' +
          '<span class="wz-herocap">rigs at once</span>' +
        '</div>' +

        '<div class="wz-fill">' +
          '<div class="grouplab">How full to pack</div>' +
          '<div class="wz-seg" data-seg>' +
            '<button data-preset="light">Light</button>' +
            '<button data-preset="standard">Standard</button>' +
            '<button data-preset="generous">Generous</button>' +
          '</div>' +
          '<p class="wz-fillhint" data-fillhint></p>' +
        '</div>' +

        '<div class="wz-combos" data-dim>' +
          '<div class="wz-dead" data-dead hidden></div>' +
          '<div class="wz-bands">' +
            '<div class="wz-band req" data-band="req" hidden>' +
              '<div class="grouplab">Requested</div><ul class="wz-rows" data-rows="req"></ul></div>' +
            '<div class="wz-band bad" data-band="bad" hidden>' +
              '<div class="grouplab">Currently incompatible</div><ul class="wz-rows" data-rows="bad"></ul></div>' +
          '</div>' +
          '<div class="wz-test">' +
            '<div class="grouplab">Test a combination</div>' +
            '<p class="wz-lead">Tick sails to see whether they can all be rigged at the same time.</p>' +
            '<div class="wz-srows" data-sizes></div>' +
            '<div class="wz-verdict" data-verdict hidden></div>' +
          '</div>' +
        '</div>' +

      '</div>';
  }

  var $ = function (sel) { return mountEl.querySelector(sel); };

  /* ------------------------------------------------------------- painting */

  var rollGen = {};
  function roll(name, to, fmt) {
    fmt = fmt || String;
    var el = $('[data-fig="' + name + '"]');
    if (!el || !isFinite(to)) return;
    var gen = (rollGen[name] || 0) + 1;   // supersede any roll still in flight
    rollGen[name] = gen;
    var from = (name in shown) ? shown[name] : to;
    shown[name] = to;
    if (REDUCE || from === to) { el.textContent = fmt(to); return; }
    var t0 = performance.now();
    (function frame(now) {
      if (rollGen[name] !== gen) return;
      var k = Math.max(0, Math.min(1, (now - t0) / ROLL_MS));
      if (k < 1) {
        var e = 1 - Math.pow(1 - k, 3);
        el.textContent = fmt(Math.round(from + (to - from) * e));
        requestAnimationFrame(frame);
      } else {
        el.textContent = fmt(to);
      }
    })(t0);
  }

  function wireControls() {
    var target = Math.min(state.minRigs, state.sailM2.length);
    $('[data-seg]').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.preset === state.preset);
    });
    var down = mountEl.querySelector('[data-nudge="-1"]');
    var up = mountEl.querySelector('[data-nudge="1"]');
    down.disabled = target <= 1;
    up.disabled = target >= state.sailM2.length;
    $('[data-fillhint]').textContent = FILL_HINT[state.preset];
  }

  function paint(result) {
    wireControls();

    var target = Math.min(state.minRigs, state.sailM2.length);
    var kept = result.rigs >= target;

    roll('pieces', result.pieces);
    var spare = result.slack.mast + result.slack.ext + result.slack.boom;
    roll('spares', spare);
    roll('match', Math.round(result.match * 100));
    roll('rigs', target);

    // the hero tint is the only readout of whether the target was met
    $('[data-hero]').classList.toggle('short', !kept);

    var reqGroups = state.mustRig.slice();
    var badGroups = unriggableGroups(last.model, last.counts, {
      maxSize: target, limit: 8,
    }).map(function (g) { return g.map(function (i) { return last.model.sails[i].m2; }); })
      .filter(function (g) { return !reqGroups.some(function (r) { return sameGroup(r, g); }); });

    // dead-end sails (nothing in the club rigs them). Empty on the fixture rack.
    var dead = $('[data-dead]');
    if (result.impossible.length) {
      var ds = result.impossible.map(function (i) { return m2s(last.model.sails[i].m2); });
      dead.innerHTML = ic('warning') + '<span>The <b>' + ds.join(', ') + '</b>m² ' +
        (ds.length === 1 ? 'sail rigs' : 'sails rig') + ' with nothing the club owns. Take ' +
        (ds.length === 1 ? 'it' : 'them') + ' and borrow on the day, or leave ' +
        (ds.length === 1 ? 'it' : 'them') + ' behind.</span>';
      dead.hidden = false;
    } else {
      dead.hidden = true;
    }

    syncRows($('[data-rows="req"]'), reqGroups.map(function (g, i) {
      var cg = checkGroup(last.model, last.counts, idxsFor(g));
      var st = cg.riggable ? ''
        : '<span class="st warn">' + ic('warning') +
          (cg.need ? 'needs a ' + friendly(cg.need) : 'short more than one piece') + '</span>';
      return {
        key: keyOf(g),
        html: '<span class="combo">' + comboLabel(g) + '</span>' + st +
          '<button class="x" data-unmust="' + i + '" aria-label="Stop packing for this">' + ic('close') + '</button>',
      };
    }));

    syncRows($('[data-rows="bad"]'), badGroups.map(function (g) {
      return {
        key: keyOf(g),
        html: '<span class="combo">' + comboLabel(g) + '</span>' +
          '<button class="wz-pack" data-pack="' + keyOf(g) + '">Pack</button>',
      };
    }));

    renderSizes();
    paintTester();
  }

  /* --------------------------------------------------- the tester (no solve) */

  // The list is built only when the trip's sails change; rebuilding it on every
  // tap would restart the colour transition and drop the tapped node. Keyed to
  // the sails themselves, so two sails of one size stay two rows.
  var sizesKey = '';
  function renderSizes() {
    var sails = (last.model && last.model.sails) || [];
    var key = sails.map(function (s) { return s.id; }).join(',');
    if (key === sizesKey) return;
    sizesKey = key;
    $('[data-sizes]').innerHTML = sails.map(function (s) {
      var v = s.m2;
      var on = pick.indexOf(v) !== -1;
      var name = (s.mfr ? s.mfr + ' ' : '') + String(s.model || '').replace(/\s*[0-9.]+\s*$/, '');
      return '<button class="wz-srow' + (on ? ' sel' : '') + '" data-size="' + v + '">' +
        '<span class="box">' + ic('tick') + '</span>' +
        '<span class="sz">' + m2s(v) + '</span>' +
        '<span class="nm">' + name + cam(v) + '</span>' +
        '</button>';
    }).join('');
  }

  function paintTester() {
    var verdict = pick.length >= 2 && last.model
      ? checkGroup(last.model, last.counts, idxsFor(pick)) : null;
    var missing = {};
    if (verdict && !verdict.riggable) {
      verdict.missing.forEach(function (i) { missing[last.model.sails[i].m2] = true; });
    }

    mountEl.querySelectorAll('[data-size]').forEach(function (b) {
      var v = Number(b.getAttribute('data-size'));
      var on = pick.indexOf(v) !== -1;
      b.classList.toggle('sel', on);
      b.classList.toggle('ok', on && !!verdict && (verdict.riggable || !missing[v]));
      b.classList.toggle('warn', on && !!verdict && !verdict.riggable && !!missing[v]);
    });

    var box = $('[data-verdict]');
    if (!verdict) { box.hidden = true; box.innerHTML = ''; return; }

    var labels = comboLabel(pick);
    if (verdict.riggable) {
      var kit = verdict.sheet.map(function (r) { return r.mast.len + ' ' + r.mast.diam; }).join(' · ');
      box.className = 'wz-verdict ok';
      box.innerHTML = '<div class="vh">' + ic('tick') +
        '<span>' + labels + ' all stand up at once.</span></div>' +
        '<div class="vkit">' + kit + '</div>';
    } else {
      var miss = verdict.missing.map(function (i) { return m2s(last.model.sails[i].m2); }).join(', ');
      var fix = verdict.need
        ? ': one more <b>' + friendly(verdict.need) + '</b> would fit ' +
          (verdict.missing.length === 1 ? 'it' : 'them') + '.'
        : ': more than one piece short.';
      box.className = 'wz-verdict bad';
      box.innerHTML = '<div class="vh">' + ic('warning') +
        '<span>' + verdict.sheet.length + ' of ' + idxsFor(pick).length + ' stand up. ' +
        miss + 'm² left without a rig' + fix + '</span></div>' +
        '<button class="vpack" data-pack="' + keyOf(pick) + '">Repack so this mix works</button>';
    }
    box.hidden = false;
  }

  /* ------------------------------------------------------ row transitions */

  function syncRows(ul, items) {
    var band = ul.closest('[data-band]');
    var have = {};
    Array.prototype.forEach.call(ul.children, function (li) {
      if (!li.classList.contains('leave')) have[li.dataset.key] = li;
    });
    var want = {};
    items.forEach(function (it) { want[it.key] = it; });

    Object.keys(have).forEach(function (k) {
      if (want[k]) return;
      var li = have[k];
      if (REDUCE) { li.remove(); return; }
      li.classList.add('leave');
      var done = function () { if (li.parentNode) li.remove(); if (band && !liveCount(ul)) band.hidden = true; };
      li.addEventListener('transitionend', function (e) { if (e.propertyName === 'max-height') done(); });
      setTimeout(done, 520);
    });

    items.forEach(function (it) {
      var li = have[it.key];
      if (li) { li.innerHTML = it.html; return; }
      li = document.createElement('li');
      li.className = REDUCE ? 'wz-crow' : 'wz-crow enter';
      li.dataset.key = it.key;
      li.innerHTML = it.html;
      ul.appendChild(li);
      if (!REDUCE) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { li.classList.remove('enter'); });
        });
      }
    });

    // order the surviving rows to match `items`
    items.forEach(function (it) {
      var li = ul.querySelector('li[data-key="' + it.key + '"]');
      if (li) ul.appendChild(li);
    });

    if (band && (items.length || liveCount(ul))) band.hidden = false;
    else if (band && !liveCount(ul)) band.hidden = true;
  }

  function liveCount(ul) {
    var n = 0;
    Array.prototype.forEach.call(ul.children, function (li) {
      if (!li.classList.contains('leave')) n++;
    });
    return n;
  }

  /* --------------------------------------------------------- the run loop */

  var solveTimer = null;

  function schedule() {
    wireControls();
    var wz = $('[data-wz]');
    wz.classList.add('recomputing');
    if (solveTimer) clearTimeout(solveTimer);
    solveTimer = setTimeout(function () {
      var result = solve();
      requestAnimationFrame(function () {
        wz.classList.remove('recomputing');
        paint(result);
      });
    }, REDUCE ? 0 : DEBOUNCE);
  }

  /* --------------------------------------------------------------- events */

  var toastTimer = null;
  function toast(msg) {
    var old = screenEl.querySelector('.toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    screenEl.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, 2200);
  }

  mountEl.addEventListener('click', function (e) {
    var el = e.target.closest('[data-nudge],[data-preset],[data-size],[data-pack],[data-unmust],[data-start]');
    if (!el) return;

    if (el.hasAttribute('data-nudge')) {
      var d = Number(el.getAttribute('data-nudge'));
      var lim = state.sailM2.length;
      var next = Math.max(1, Math.min(lim, Math.min(state.minRigs, lim) + d));
      if (next === Math.min(state.minRigs, lim)) return;
      state.minRigs = next;
      pick = [];
      schedule();

    } else if (el.hasAttribute('data-preset')) {
      if (el.getAttribute('data-preset') === state.preset) return;
      state.preset = el.getAttribute('data-preset');
      schedule();

    } else if (el.hasAttribute('data-size')) {
      var v = Number(el.getAttribute('data-size'));
      var i = pick.indexOf(v);
      if (i === -1) pick.push(v); else pick.splice(i, 1);
      paintTester();

    } else if (el.hasAttribute('data-pack')) {
      var g = el.getAttribute('data-pack').split(',').map(Number).filter(function (x) { return !isNaN(x); });
      if (g.length >= 2 && !state.mustRig.some(function (r) { return sameGroup(r, g); })) {
        state.mustRig.push(g.slice().sort(function (a, b) { return a - b; }));
      }
      pick = [];
      schedule();

    } else if (el.hasAttribute('data-unmust')) {
      state.mustRig.splice(Number(el.getAttribute('data-unmust')), 1);
      schedule();

    } else if (el.hasAttribute('data-start')) {
      toast('This is where the trip moves on to Packing.');
    }
  });

  document.querySelector('.backbtn').addEventListener('click', function () {
    toast('Back to the trip.');
  });

  /* ----------------------------------------------------------------- boot */

  mount();
  paint(solve());
}());
