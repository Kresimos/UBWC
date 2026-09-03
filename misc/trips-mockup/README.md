# Trips drawing board

The published mockup of the Trips tab: fourteen handset frames, the six-stage
lifecycle, the new tile decorations and the backend gaps they imply.

**Artifact:** https://claude.ai/code/artifact/2bb2a8b5-42a3-405d-9857-89cdabc4a55a

Republish to *that URL*, never a new one, or the link the club has stops updating.

## Why it is built rather than written

`build.sh` splices `web/css/tokens.css` and `web/css/screens.css` into the page
byte for byte, and strips the module keywords off `web/js/icons.js` so the real
icons come along. `src/body-app.js` carries a port of `itemTile()` from
`web/js/ui/itemTile.js`. So the parts of the tile that are not changing are the
shipped design itself, and the mockup cannot drift from the app. Never paste app
CSS into `src/` — change the app, rebuild, and the mockup follows.

## Retuning the design

Three ways, cheapest first.

1. **The tuner drawer on the page.** Open the artifact, expand *Design knobs*
   bottom-right, drag. Every frame retunes at once. *Copy CSS* gives you a block
   to paste over the `:root` in `src/design.css`. No model needed.
2. **Edit `src/design.css`.** It is nothing but custom properties. Change a
   number, run `./build.sh`, republish.
3. **`/trip-mock <what you want>`** in a fresh Claude Code session.

## The knobs

All in `src/design.css`:

| Knob | What it moves |
|---|---|
| `--voter-size` / `--voter-size-list` | Diameter of one requester disc, grid / list |
| `--voter-overlap` | How far each disc slides under the one before |
| `--voter-cap` | How many discs the pile shows at most (read by JS, not just CSS) |
| `--voter-ring` | The ring separating stacked discs |
| `--voter-font` | Size of the initial inside a disc |
| `--voter-fade` | Opacity of the last disc; the ones in front interpolate up to full |
| `--tick-size` / `--tick-inset` | The check disc on ticked kit, and its corner inset |
| `--faultdot-size` / `--faultdot-inset` | The fault bubble on a list thumb |
| `--cluster-gap` | Heart-to-fault gap in the top-left cluster |
| `--size-col-w` | Width of the size column, which is what lines the voter stacks up |
| `--group-gap` | Above a type heading inside one trip's kit (tight) |
| `--stage-gap` | Above a stage heading on the trips index (roomy) |
| `--out-bg` / `--out-ink` | The grey "out" chip |

Values in `src/design.css` are Johnny's tuning pass (2026-08-30), plus the
two list-rhythm gaps added after it.

## Files

```
build.sh            concatenates everything into trips-mockup.html
inspect.sh          ./inspect.sh 8 9 out.png — screenshot frames 8..9 alone
src/head.html       title, font link, opening <style>
src/design.css      THE KNOBS — the only file most changes need
src/new-tile.css    the proposal: written to be pasted into tokens.css as-is
src/canvas.css      the wall the handsets are pinned to (themed; frames are not)
src/body-top.html   page copy, the lifecycle diagram, the spec tables
src/body-app.js     the itemTile port, the fake kit, the fifteen screens
```

Frames are numbered from their position in `SCREENS`, so inserting one never
leaves a stale caption behind. Cross-references inside note text are written by
hand, though — grep for `frame 0` if you reorder them.

## Rebuilding and republishing

```sh
./build.sh
```

Then ask Claude to publish `misc/trips-mockup/trips-mockup.html` to the artifact
URL above (it needs the URL passed explicitly, or it will create a second one).
