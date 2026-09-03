---
description: Retune the trip rigging-wizard mockup and republish it
---

Retune the rigging-wizard mockup. The user wants: **$ARGUMENTS**

Small, self-contained job. Do NOT explore the codebase, do NOT read
`web/js/screens/trip.js`, `db.py` or `server.py`, and do NOT spawn subagents.
Everything you need is below.

## What to do

1. Read `misc/trip-wizard-mock/README.md` (the knob table) and
   `misc/trip-wizard-mock/src/design.css` (~55 lines, nothing but custom
   properties — animation timings, the two band tints, the three "how full to
   pack" weight presets, the opening scenario). That is almost certainly the
   only file to change.

2. Make the change. Keep the comments true if a value's meaning shifts.

3. Rebuild:

   ```sh
   node misc/trip-wizard-mock/build.mjs
   ```

   The solver is spliced from the `trip-packer-solver` worktree
   (`.claude/worktrees/trip-packer-solver/web/js/rig/`). If build.mjs can't find
   it, check that worktree out again or pass `SOLVER_DIR=...`.

4. Check it. `node misc/trip-wizard-mock/serve.mjs` serves it on
   http://localhost:8778, or screenshot headless:

   ```sh
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
     --disable-gpu --hide-scrollbars --window-size=460,1400 \
     --screenshot=/tmp/wz.png --virtual-time-budget=4000 \
     "file://$PWD/misc/trip-wizard-mock/trip-wizard-mock.html"
   ```

   Actually look at the result before saying it is done.

5. Republish to the SAME artifact, passing the URL from
   `misc/trip-wizard-mock/README.md` explicitly:

   - file: `misc/trip-wizard-mock/trip-wizard-mock.html`
   - url: the one in the README

   Read the artifact first (`action: "read"` with that url) — a publish to an
   artifact this conversation has not read is refused. Publishing without `url`
   creates a *second* artifact and breaks the club's link — never do that.

## If the request is not a knob

If it needs new markup or a new rule rather than a number:

- `src/wizard.css` is the component CSS, written to be pasted into
  `web/css/screens.css` under `[data-screen="trip"]` unchanged — keep it
  paste-ready.
- `src/app.js` is the controller (state, `solve()`, `paint()`, the transitions).
- `src/canvas.css` is the wall around the handset only; `src/body.html` is the
  page copy and the notes.

Never paste app CSS into `src/` — `build.mjs` splices `web/css/tokens.css` and
`web/css/screens.css` in verbatim so the mockup tracks the app automatically.

Then report, in two or three sentences, what changed and the artifact link.
