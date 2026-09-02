# Trip rigging wizard mockup

The kit sec's rigging wizard: the kit sec has picked the sails, and this screen
works out the masts, extensions and booms that go with them. It re-runs the
whole trailer search on every touch, so the screen is built around that: the
headline numbers count to their new value, the hero tint crossfades green/amber,
and the size-combination highlights reshuffle.

**Artifact:** https://claude.ai/code/artifact/8b3b5185-57fd-45cc-89c0-01daef3642fd

Republish to *that URL* (pass it explicitly), never a new one, or the link the
club has stops updating.

## Why it is built rather than written

`build.mjs` splices in, byte for byte:

- `web/css/tokens.css` and `web/css/screens.css` from this branch, so every
  bar, chip and button in the handset is the shipped design, not a copy of it;
- `web/js/icons.js`, module keywords stripped;
- `pack.mjs` + `pack.fixtures.mjs` from the **`trip-packer-solver` worktree**
  (`.claude/worktrees/trip-packer-solver/web/js/rig/`, or `$SOLVER_DIR`) at the
  `__SOLVER__` marker, so the page runs the *real* solver against the fixture
  rack. Nothing on the screen is a drawn number.

Change the app CSS, or the solver, rebuild, and the mockup follows.

```sh
node misc/trip-wizard-mock/build.mjs      # writes trip-wizard-mock.html
node misc/trip-wizard-mock/serve.mjs      # preview on http://localhost:8778 (utf-8)
```

If the solver worktree is gone: check it out again, or
`SOLVER_DIR=/path/to/web/js/rig node misc/trip-wizard-mock/build.mjs`.

## Retuning

Everything tunable is in **`src/design.css`**, nothing but custom properties:

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
| `--wz-start-sails` / `--wz-start-minrigs` / `--wz-start-preset` | the opening scenario |

Change a number, `node build.mjs`, republish. Or run `/trip-wizard-mock <what
you want>` in a fresh session.

## Files

```
build.mjs           concatenates everything into trip-wizard-mock.html
serve.mjs           ./serve.mjs, preview on :8778
src/head.html       <title>, canvas font link, opening <style>
src/wizard.css      THE PROPOSAL: component CSS, written to drop into
                    web/css/screens.css in place of the current wizard block
src/design.css      THE KNOBS: the only file most retunes touch
src/canvas.css      the themed wall around the one handset
src/body.html       masthead, the handset skeleton, the notes
src/app.js          the controller: state, solve, the transitions
```

## Where this goes

It replaces the static report at `renderWizard()` in
`web/js/screens/trip.js`. `src/wizard.css` is paste-ready for
`web/css/screens.css`; `src/app.js` is the reference for the real screen, which
will call the solver through the app's data layer rather than the fixture rack.
