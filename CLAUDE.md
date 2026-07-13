# UBWC Kit App

This repo is the University of Bristol Windsurfing Club's kit inventory app.
Ground truth for kit data currently lives in a Google Sheet (downloaded copy at
[data/Kit Inventory.xlsx](data/Kit Inventory.xlsx)), which is being migrated to
a SQLite database. The app's UI/UX plan is in [misc/layout.txt](misc/layout.txt).

This file documents the **windsurfing domain knowledge** needed to build any
feature that suggests, validates, or filters "does this kit go together"
(add-item validation, a rig builder, search/autocomplete ranking, etc). The
spreadsheet's columns exist *because* of these compatibility rules — read this
before changing the schema or writing matching logic.

## Component types and current schema

The spreadsheet (and future DB) has one table per component type:

| Sheet/Type | Key fields | Notes |
|---|---|---|
| Boards | `Size (L)` = volume in litres, `Type` (e.g. Freewave) | Board box for fin sold separately per model (not yet tracked as a column) |
| Sails + Wings | `Size (m^2)`, `Mast Length`, `Extension`, `Boom`, `Cams` | `Type` is `Sail` or `Wing`; wings don't use Mast/Extension/Boom/Cams |
| Masts | `Size` = length in cm | |
| Booms | `Min size` / `Max size` = adjustable outhaul range in cm | |
| Misc | generic Manufacturer/Model/Type/Size | catch-all (harnesses, mast base extensions, wetsuits, etc.) |

All sheets share `Manufacturer`, `Model`, `Condition`, `Location`, `Faults` —
this is the common "item" shape referenced in the Item/Faults pages in
[misc/layout.txt](misc/layout.txt). `Fins` and `Foils` are named in the search
bar spec but have no sheet yet — see "Not yet modelled" below.

## The two independent kit groups

A full windsurfing setup is really **two separable systems** that both have to
be individually self-consistent, but don't constrain each other by size:

1. **The rig**: Sail + Mast + Extension + Boom (+ base/UJ, not yet tracked)
2. **The board setup**: Board + Fin (+ Foil, if foiling)

A rider picks a rig for the wind strength/conditions and a board for their
weight/skill and the wind strength — the two are linked only loosely, via
wind range and rider ability, not via a hard measurement match. Don't build
a "this board requires this sail" hard constraint; build a "this range of
sails suits this board" soft one.

## Rig sizing: how Sail, Mast, Extension and Boom must fit

This is the strict, measurement-driven part. Every sail has three numbers
printed on it by the manufacturer, and the DB should treat them as the sail's
required-parts spec (already captured as columns on `Sails + Wings`, taken
from the Bic Techno 7.8 example row):

- **Mast Length** (`Sails + Wings.Mast Length`, cm) — the mast **size** the sail
  is designed around (i.e. which mast to grab off the rack), *not* the full luff.
- **Extension** (`Sails + Wings.Extension`, cm) — the extension setting used with
  that mast. The sail's actual **luff length = Mast Length + Extension**.
  - Example in the data: Bic Techno 7.8 → 460cm mast + 30cm extension = a
    490cm luff, paired with the Bic Techno mast (`Masts.Size = 460`).
  - **Validation rule**: `mast.Size + extension_used == (sail.Mast Length +
    sail.Extension)`, i.e. the mast + extension must add up to the sail's luff
    (±2cm tolerance for adjustable extensions). Using the recommended mast size
    means using the recommended extension; using a different mast size is
    allowed but flagged (extension makes up the difference, within its ~0–50cm
    physical range).
- **Boom** (`Sails + Wings.Boom`, cm) — the sail's recommended boom (outhaul)
  length. Must fall inside the chosen boom's adjustable range.
  - **Validation rule**: `boom.Min size <= sail.Boom <= boom.Max size`.
- **Cams** (`Sails + Wings.Cams`, boolean) — whether the sail is cambered.
  Cambered sails clamp cams around the mast and need more careful/careful
  rigging (cams must rotate past the boom head); this doesn't add a new size
  constraint but is worth surfacing as a "harder to rig, ask a committee
  member if new" flag in the UI, and it's *why* mast diameter/brand matching
  (below) matters more for cammed sails than for camless ones.

Mast **diameter class** also matters even though it isn't a spreadsheet column
yet: masts and matching sail luff sleeves are either **SDM** (Standard
Diameter Mast) or **RDM** (Reduced Diameter Mast, more common on modern
freeride/freewave sails up to ~7-8m²). A sail can only use a mast of its
designed diameter class — this is a harder constraint than brand, and if/when
it's added to the schema it should be validated exactly (`sail.diameter_class
== mast.diameter_class`), not just warned about.

## Board sizing: volume vs. sail size and rider

Board `Size (L)` (volume in litres) is chosen from **rider weight, skill, and
the wind/sail range they sail in** — not matched to one specific sail. Rough
club-level rule of thumb to encode as guidance/warnings (not hard filters):

- Volume needed ≈ rider weight (kg) × 1.0–1.4, lower multiplier for
  planing-focused/advanced sailors, higher for beginners/light wind.
- Smaller boards (< ~100L, e.g. the Fanatic Freewave 86 in the data) suit
  lighter/more advanced riders and smaller, powered-up sails in stronger wind.
- Larger boards (> ~100L, e.g. the Starboard Freesex 111) suit heavier or
  less experienced riders, or light-wind/bigger-sail days.
- `Type` (Freewave, Freeride, Slalom, Wave, Formula, Foil...) should narrow
  the suggested sail size range further — e.g. Freewave boards pair well with
  Freewave/Freeride sails of a similar size bracket, wave boards with wave
  sails, formula/foil boards with much larger sails at low wind speeds.

Treat this as a **suggestion/sanity-check band**, surfaced e.g. as "this
board is usually paired with sails in the X–Ym² range" — never a hard
validation error, since rider preference and conditions vary.

## Fin and foil boxes (not yet modelled)

Boards accept fins/foils via a **box standard** (US Box, Powerbox, Tuttle,
Deep Tuttle for foils) that is a hard compatibility constraint distinct from
size — a fin/foil is either physically compatible with a board's box or it
isn't. When `Fins`/`Foils` sheets are added:

- Add a `Box Type` column to `Boards`, `Fins`, and `Foils`.
- Validation rule: `fin.Box Type == board.Box Type` (exact match, no
  tolerance — unlike the rig's cm-based checks).
- Fin/foil **size** (fin: cm length; foil: front wing area, mast/fuselage
  length) should be suggested from board volume + sail size + wind range,
  the same "soft band" treatment as board-to-sail sizing above, since it's
  about performance not physical fit.

## Brand matching: where it's required vs. just best practice

Be precise about which brand-matching rules are hard constraints vs.
performance recommendations — don't let the app reject a valid cross-brand
setup:

- **Not a hard constraint (rig)**: mast/extension/boom diameter classes
  (RDM/SDM) and universal joint fittings are industry-standardized, so a
  Bic mast physically fits a Neil Pryde sail of the same diameter class and
  luff length. Cross-brand rigs are common and fine.
- **Best practice, not a rule**: matching mast **brand** (and specifically
  its flex/IMCS rating) to the sail's brand-recommended IMCS spec gets the
  sail's designed flex curve and rotation; an off-brand mast with a
  different IMCS at the same length can still fit but will rig/perform
  worse, especially for cammed sails (see Cams above). Surface this as a
  "recommended" nudge — e.g. rank same-brand mast/sail pairings higher in
  search/autocomplete results, or show a "brand-matched" badge — but never
  block a cross-brand pick.
- **No brand constraint (board/fin/foil side)**: board, fin, and foil brand
  don't need to match each other or the rig; only the box-type physical fit
  (above) is a hard rule.

## Practical implications for the app

- **Add Item validation** (green-button flow in [misc/layout.txt](misc/layout.txt)):
  enforce the hard numeric rules above (mast+extension == sail's Mast Length;
  sail's Boom within boom's Min/Max range) at input time so bad data can't
  enter the DB, since this is the club's ground truth going forward.
- **Search/autocomplete ranking**: when a user has selected a sail, rank
  masts/extensions/booms that satisfy the exact-fit rules first, then
  same-brand items, then everything else.
- **Item page "known faults"**: faults are per physical item, not per
  model — keep them keyed to the individual row (Manufacturer+Model+Size+
  Location), matching the existing `Faults` column and the Faults page spec.
