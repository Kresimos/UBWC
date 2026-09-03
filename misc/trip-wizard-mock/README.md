# Trip rigging wizard mockup

The kit sec's rigging wizard: the kit sec has picked the sails, and this screen
works out the masts, extensions and booms that go with them. It re-runs the
whole trailer search on every touch, so the screen is built around that: the
headline numbers count to their new value, the hero tint crossfades green/amber,
and the size-combination highlights reshuffle.

The mockup shows **two handsets in flow order**: **Confirm the kit** (the dense
picker where the kit sec tops up the sails and boards) and then the wizard
itself.

**Both are shipped** - `renderConfirm` and `renderWizard` in
`web/js/screens/trip.js`, styled from the `[data-screen="trip"]` block in
`web/css/screens.css`. The mockup stays as the sandbox for retuning the motion
and the pack presets.

**Artifact:** https://claude.ai/code/artifact/8b3b5185-57fd-45cc-89c0-01daef3642fd

Republish to *that URL* (pass it explicitly), never a new one, or the link the
club has stops updating.

## Why it is built rather than written

`build.mjs` splices in, byte for byte:

- `web/css/tokens.css` and `web/css/screens.css` from this branch, so every
  bar, chip and button in the handset is the shipped design, not a copy of it -
  the wizard and confirm component CSS included, now that it lives in
  screens.css;
- `web/js/icons.js`, module keywords stripped;
- `web/js/rig/pack.js` + `web/js/rig/pack.fixtures.mjs` at the `__SOLVER__`
  marker, so the page runs the *real* solver against the fixture rack. Nothing
  on the screen is a drawn number. (`$SOLVER_DIR` overrides where they are read
  from.)

Change the app CSS, or the solver, rebuild, and the mockup follows.

```sh
node misc/trip-wizard-mock/build.mjs      # writes trip-wizard-mock.html
node misc/trip-wizard-mock/serve.mjs      # preview on http://localhost:8778 (utf-8)
```

## Retuning

The motion / tint / preset knobs ship in `web/css/screens.css` (a `:root` block
in the `[data-screen="trip"]` section). `src/design.css` is spliced in after it
and overrides for the mockup only, so retune there, see it, then copy the
changed values across to screens.css. Everything tunable:

| Knob | What it moves |
|---|---|
| `--wz-roll-ms` / `--wz-roll-ease` | the count-up on Pieces / Spares / Brand match / the hero figure |
| `--wz-recompute-ms` / `--wz-recompute-dim` / `--wz-recompute-debounce` | the results' dip while the solver runs, and how long a held stepper waits before it fires |
| `--wz-tint-ms` | the hero green ⇄ amber crossfade |
| `--wz-row-ms` / `--wz-row-ease` | a combination highlight row entering or leaving |
| `--wz-chip-ms` | a test-combination row settling to green / amber |
| `--wz-band-pad` | a highlight row's vertical padding (its green / amber tint is the app's `--ok-tint` / `--warn-tint`) |
| `--wz-hero-fig` / `--wz-hero-pad` | the RIGS AT ONCE number and card |
| `--wz-preset-light` / `-standard` / `-generous` | the three "how full to pack" presets, five solver weights each: `spare short match sessions light` |
| `--wz-start-sails` / `--wz-start-minrigs` / `--wz-start-preset` | the opening scenario (mockup only) |
| `--cf-start-sails` / `--cf-start-boards` | which sizes start ticked on the Confirm screen (mockup only) |
| `--cf-row-pad` | how tight the Confirm screen's inventory rows sit |

Change a number, `node build.mjs`, republish. Or run `/trip-wizard-mock <what
you want>` in a fresh session.

## Files

```
build.mjs           concatenates everything into trip-wizard-mock.html
serve.mjs           ./serve.mjs, preview on :8778
src/head.html       <title>, canvas font link, opening <style>
src/wizard.css      SHIPPED - pointer to web/css/screens.css
src/confirm.css     SHIPPED - pointer to web/css/screens.css
src/design.css      THE KNOBS: retune here, copy across to screens.css
src/canvas.css      the themed wall around the one handset
src/body.html       masthead, the handset skeleton, the notes
src/app.js          the mockup controller: state, solve, the transitions
```

## Where this went

`renderConfirm` and `renderWizard` in `web/js/screens/trip.js`; the component
CSS in `web/css/screens.css` under `[data-screen="trip"]`. The real screens call
the solver through `/api/trips/kit` rather than the fixture rack, and add a
fins/bases pass (`packBoardKit` in `web/js/rig/engine.js`) the rig-only solver
does not cover. `src/app.js` stays the reference for the transitions.
