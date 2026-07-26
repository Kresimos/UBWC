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
| Sails + Wings | `Size (m^2)`, `Luff`, `Adjustable Top`, `Boom`, `Cams` | `Type` is `Sail` or `Wing`; wings don't use Luff/Boom/Cams |
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

This is the strict, measurement-driven part. What a sail actually requires is a
**luff length** and a **boom length** (printed on it by the manufacturer),
stored as columns on `Sails + Wings`:

- **Luff** (`Sails + Wings.Luff`, cm) — the sail's luff length. It does **not**
  matter which mast + extension combination is used, only that they **total**
  the luff. Do not store or require a specific "recommended mast": any mast of
  the right diameter class (see diameter below) whose length plus a legal
  extension reaches the luff is fine.
  - Example: Bic Techno 7.8 → a 490cm luff. It rigs on 460+30, 470+20, 490+0,
    etc. equally.
  - **Validation rule**: `sail.Luff <= mast.Size + extension_used <= sail.Luff
    + sail.Adjustable Top` (±2cm tolerance for adjustable extensions), with the
    extension in its ~0–50cm physical range. A mast+extension total short of the
    luff can't tension the sail; one over it is only allowed by the adjustable
    top (below).
  - **Display-only "recommended mast + extension"** (item page, beginner aid):
    the DB stores *only* the luff, but the item page shows a worked example so a
    newcomer can rig from the sail's spec without the wizard. Compute it, don't
    store it: pick the **biggest standard mast ≤ luff** (standard sizes **370 /
    400 / 430 / 460 cm**), then **extension = luff − that mast**. E.g. 490 → 460
    + 30; 450 → 430 + 20; 460 → 460 + 0. Label it clearly as a suggestion since
    any mast+extension totalling the luff is equally valid.
- **Adjustable Top** (`Sails + Wings.Adjustable Top`, cm, default 0) — some sails
  have an adjustable head / open-topped luff that lets a **longer** mast poke out
  the top by an adjustable amount (effectively a negative extension). Default
  **0** means a fixed luff (mast tip fully in the sleeve, total must equal the
  luff). When it is greater than 0, the accepted total widens to `Luff` up to
  `Luff + Adjustable Top`, so one sail can take a range of mast sizes. Store the
  maximum the head can open to; the rig maths reads it as the upper bound above.
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
yet: masts are either **SDM** (Standard Diameter Mast) or **RDM** (Reduced
Diameter Mast, more common on modern freeride/freewave rigs up to ~7-8m²).
Crucially, the diameter constraint is only hard for **cambered sails**: a
cambered sail's cams are moulded to one diameter, so it needs a mast of that
exact class (or the right cam spacers), whereas a **camless sail has a luff
sleeve that fits either RDM or SDM** at the correct length. So diameter is a
soft/ignorable factor for camless sails and a hard constraint for cammed ones.
When it's added to the schema, validate it conditionally: enforce
`sail.diameter_class == mast.diameter_class` **only when `cams` is true**; for
camless sails accept either diameter (length/luff and boom are what must match).
Note the **extension** must still match the mast's diameter (an RDM mast takes
an RDM extension, an SDM mast an SDM one) regardless of the sail, since the
extension bolts into the mast base.

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
  enforce the hard numeric rules above (mast + extension totals the sail's Luff,
  within its Adjustable Top; sail's Boom within boom's Min/Max range) at input
  time so bad data can't enter the DB, since this is the club's ground truth
  going forward.
- **Search/autocomplete ranking**: when a user has selected a sail, rank
  masts/extensions/booms that satisfy the exact-fit rules first, then
  same-brand items, then everything else.
- **Item page "known faults"**: faults are per physical item, not per
  model — keep them keyed to the individual row (Manufacturer+Model+Size+
  Location), matching the `faults` table and the Faults page spec. Each fault
  has a **title** (flag label), a **description** (diagnosis + fix) and a
  **severity**: `usable` (amber flag, item stays in the catalogue and rig
  picker) or `out_of_action` (red flag, hidden from the rig picker, shown in
  the catalogue but **sorted to the bottom of lists by default**). A single
  item can carry several faults, each surfaced as its own flag.
