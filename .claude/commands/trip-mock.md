---
description: Retune the Trips drawing board mockup and republish it
---

Retune the Trips drawing board. The user wants: **$ARGUMENTS**

This is a small, self-contained job. Do NOT explore the codebase, do NOT read
`web/js/ui/itemTile.js`, `web/js/screens/catalogue.js`, `db.py` or `server.py`,
and do NOT spawn subagents. Everything you need is below.

## What to do

1. Read `misc/trips-mockup/src/design.css`. It is ~35 lines of CSS custom
   properties and it is almost certainly the only file you need to change.
   The knobs are named for what they move: `--voter-size`, `--voter-overlap`,
   `--voter-cap`, `--voter-ring`, `--voter-font`, `--voter-fade`,
   `--tick-size`, `--tick-inset`, `--faultdot-size`, `--faultdot-inset`,
   `--cluster-gap`, `--out-bg`, `--out-ink`.

2. Make the change. Keep the comments accurate if a value's meaning shifts.

3. Rebuild:

   ```sh
   ./misc/trips-mockup/build.sh
   ```

4. Check it. `./misc/trips-mockup/inspect.sh 7 8 /tmp/check.png` screenshots
   frames 7 and 8 (the packing checklists, where most decorations appear) with
   headless Chrome, then read the PNG. Frames 2 and 3 are the requesting views,
   where the voter tags are densest. Actually look at the result before saying
   it is done.

5. Republish to the SAME artifact, passing the URL explicitly:

   - file: `misc/trips-mockup/trips-mockup.html`
   - url: the one recorded in `misc/trips-mockup/README.md`

   Read the artifact first (`action: "read"` with that url), as a publish to an
   artifact this conversation has not read is refused. Publishing without `url`
   creates a *second* artifact and breaks the link the club has — never do that.

## If the request is not a knob

If it needs new markup or a new rule rather than a number:

- `misc/trips-mockup/src/new-tile.css` holds the proposed CSS (it is written
  to be pasted into `web/css/tokens.css` unchanged, so keep it paste-ready).
- `misc/trips-mockup/src/body-app.js` holds the `itemTile()` port and the
  fourteen screen definitions.
- `misc/trips-mockup/src/canvas.css` is the page around the handsets only.

Never paste app CSS into `src/` — `build.sh` splices `web/css/tokens.css` and
`web/css/screens.css` in verbatim so the mockup tracks the app automatically.

Then report, in two or three sentences, what changed and the artifact link.
