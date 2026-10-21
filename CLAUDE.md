# UBWC Kit App

This repo is the University of Bristol Windsurfing Club's kit inventory app: a
FastAPI JSON API over a SQLite database, with a dependency-free static front
end. **It is live** (members use it on their phones, on Railway) and **the repo
is public** (MIT, `Kresimos/UBWC`), so treat every commit as published and every
push to `main` as a deploy. The original UI/UX plan is in
[misc/layout.txt](misc/layout.txt); the product plan is [misc/spec.md](misc/spec.md).

**Where the kit data actually is** (read this before touching the database, and
do not infer it from the spreadsheet):

- **The repo holds no real kit data.** Real inventory goes in through the app's
  Add kit form (committee only), because that validates a rig as it is typed and
  an import never did.
- **[data/Kit Inventory.xlsx](data/Kit Inventory.xlsx) is a 6-row stub**, not
  ground truth. It was the Google Sheet the schema was designed from, and
  `migrate.py` still seeds from it, so a fresh seed produces an app holding six
  pieces of kit that looks entirely healthy.
- **A local database is example data.** ~148 items, with faults, ratings,
  trips and logbooks (`seed_example.py`), in the OS's per-user application data
  directory (or wherever `UBWC_DB` points). Right order of magnitude for a club
  fleet, useful to demo and measure against, but nothing in it is real.
- **The database on the host is the club's record.** Never overwrite, reset or
  restore it except by the documented routes below, and never from a local copy
  of the example data.

So "rebuild from the sheet" is never the fix for anything. `python manage.py
where` says which database is in use and what is in it.

## The repo is public

- Never commit a database or a backup (`*.db*` is ignored: they hold accounts
  and password hashes), a `.env`, a credential, a member's name or contact
  details, or the live URL's admin credentials. `UBWC_ADMIN_PASSWORD` and the
  rest live on the host, not here.
- Dev screenshots stay out (`/*.png` is ignored). A screenshot worth keeping goes
  in `docs/`, and only after checking it shows no member data.
- Seed and test data must be invented people and invented kit.
- Pushing to `main` redeploys the live app. Run the tests below first, and keep
  schema changes additive (the host's database already exists and is migrated in
  place by `db.py` at startup).

## Running it, and where it is hosted

`./run.sh` on a laptop; hosted on Railway, one process against one disk. The
runbook is [misc/deploy-railway.md](misc/deploy-railway.md), the platform
comparison is [misc/hosting.md](misc/hosting.md), and what it measures under
load, with a bigger inventory and with photos, is [misc/scale.md](misc/scale.md).

Six environment variables, documented in [README.md](README.md). Two of them
are safety interlocks and are worth understanding before changing anything near
startup:

- **`UBWC_SEED`** is the only thing that lets a missing database be rebuilt
  from the stub. Without it, a missing database on a host is a crash with an
  explanation, because the alternative is an app that comes back up looking
  healthy and stocked while the club's records are gone. Never suggest setting
  it as a fix for a startup error.
- **`UBWC_RESTORE`** adopts a database uploaded to a path the running app never
  opens, verifying it and keeping the one it replaces. That is how a backup
  goes back and how a database gets onto a host at all; copying over a live
  SQLite file next to its write-ahead log can corrupt it.

`python manage.py` also does `backup` (SQLite's own backup, safe on a live
database, verified) and `reset` (empty the kit and its whole history, keep
accounts, committee flags, sites and spots: the one-time move to the real
inventory).

Two constraints that follow from SQLite on one disk: **exactly one process,
never replicas** (Railway enforces this by refusing replicas alongside a
volume), and connections open in WAL mode so a member writing does not block
everyone else reading.

One thing to know before adding to the catalogue's hot path: `/api/items`
returns the **whole** catalogue in one call so the browser's filters are
instant, which is right at this size and gets proportionally more expensive as
the inventory grows. [misc/scale.md](misc/scale.md) has the numbers and the fix
if it ever matters.

Photo upload is built (kit, trips, faults and fixes, profiles, storage spots):
`/api/uploads` resizes with Pillow and writes into `photos/` **next to the
database**, served from `/photos`, so the one volume and one backup cover both.
The front end's piece is `web/js/ui/photofield.js`.

## Checks

There is no CI, so run what you touched before pushing (the Python ones need the
`.venv` that `run.sh` builds):

```
python test_trips.py            # trips never move kit; away/packing rules
python test_archive.py          # archive and delete of kit
python test_uploads.py          # photo upload and resize
node web/js/rig/engine.test.mjs        # discipline table, foil box rule, sportFor
node web/js/rig/pack.test.mjs          # trailer packer
node web/js/rig/pack.solver.test.mjs   # trailer solver
```

The UI is a handset UI: [TESTING.md](TESTING.md) covers testing on a real phone.

## Domain knowledge

The rest of this file documents the **windsurfing domain knowledge** needed to build any
feature that suggests, validates, or filters "does this kit go together"
(add-item validation, a rig builder, search/autocomplete ranking, etc). The
spreadsheet's columns exist *because* of these compatibility rules — read this
before changing the schema or writing matching logic.

## Component types and current schema

The spreadsheet (and future DB) has one table per component type:

| Sheet/Type | Key fields | Notes |
|---|---|---|
| Boards | `Size (L)` = volume in litres, `Type` (e.g. Freewave) | `box_type` = the fin box standard (see Fin and foil boxes) |
| Sails + Wings | `Size (m^2)`, `Luff`, `Adjustable Top`, `Boom`, `Cams`, `Diameter` | `Type` is `Sail` or `Wing` on the sheet (the DB splits wings into their own `wing` type, below); wings don't use Luff/Boom/Cams; `Diameter` only means anything on a cambered sail |
| Masts | `Size` = length in cm, `Diameter` = RDM or SDM | |
| Extensions | `Min size` / `Max size` = travel in cm, `Diameter` = RDM or SDM | `ext` component type in the DB (`ext_min_cm`, `ext_max_cm`); the sheet still files these under Misc with Type = "Extension", and the importer splits them out |
| Wings | `Size (m^2)`, `Type` | `wing` component type: wingfoil's "sail". No luff, boom or cams. Sizes, not rig-matched. |
| Booms | `Min size` / `Max size` = adjustable outhaul range in cm, `Diameter` = RDM or SDM | `diameter` is required when adding a boom (older booms hold NULL until edited); recorded only, not yet a rig-matching rule |
| Fins | `box_type`, `fin_length_cm` | `fin` component type. Box must match the board's (see Fin and foil boxes). |
| Foils | `box_type`, `foil_area_cm2` | `foil` component type. `foil_area_cm2` is the front wing area: optional and display-only, never a match rule. |
| Wetsuits | `Size` (`size_generic`), `Gender` (Mens/Womens/Unisex), `Thickness` (free text, e.g. "5/4mm") | `wetsuit` component type in the DB; no sheet of its own, no compatibility rules — it's not part of the rig or the board setup |
| Wetsuit Boots | `Size` (`size_generic`), `Thickness` (optional) | `boots` component type; shares wetsuits' size/thickness columns (no new ones) but no Gender — boots are sized, not gendered; same no-compatibility-rules note |
| Misc | `misc_item` (the headline text), generic Manufacturer/Model/Type/Size | catch-all (harnesses, mast bases/UJs, safety gear, etc.). `misc_item` is what the piece actually is; every other screen shows size where a misc item has no headline. |

All sheets share `Manufacturer`, `Model`, `Condition`, `Location`, `Faults` —
this is the common "item" shape referenced in the Item/Faults pages in
[misc/layout.txt](misc/layout.txt). Every type's ordered field list is
`db.COMPONENT_FIELDS`; field labels, choices and per-type label overrides are
`db.FIELD_META` / `db.FIELD_LABEL_OVERRIDES`, and `validation.py` holds the
required-field and cross-field rules. Adding a field means touching those, the
schema (`schema.sql` plus an additive migration in `db.py`) and `web/js/screens/form.js`.

## The two independent kit groups

A full windsurfing setup is really **two separable systems** that both have to
be individually self-consistent, but don't constrain each other by size:

1. **The rig**: Sail + Mast + Extension + Boom (+ base/UJ, which is a count on a trip, not a rule)
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

Mast **diameter class** matters too, and has its own column, `items.diameter`
(`RDM` / `SDM` / NULL for unknown), on masts, extensions and sails: masts are
either **SDM** (Standard Diameter Mast) or **RDM** (Reduced Diameter Mast, more
common on modern freeride/freewave rigs up to ~7-8m²). Crucially, the diameter
constraint is only hard for **cambered sails**: a cambered sail's cams are
moulded to one diameter, so it needs a mast of that exact class (or the right
cam spacers), whereas a **camless sail has a luff sleeve that fits either RDM or
SDM** at the correct length. So diameter is a soft/ignorable factor for camless
sails and a hard constraint for cammed ones. Validate it conditionally: enforce
`sail.diameter == mast.diameter` **only when `cams` is true**; for camless sails
accept either diameter (length/luff and boom are what must match). Note the
**extension** must still match the mast's diameter (an RDM mast takes an RDM
extension, an SDM mast an SDM one) regardless of the sail, since the extension
bolts into the mast base. A NULL diameter means nobody has recorded it, and must
never block a pick — the rules skip the check rather than guess.

The "or the right cam spacers" case above is a **third storable value, `Either`,
on sails only** (`db.FIELD_CHOICE_OVERRIDES[("sail", "diameter")]`): a cammed
sail whose cams carry spacers for both classes genuinely fits either mast, which
is different from *nobody having recorded it* (NULL). A mast or extension is
still only ever `RDM`/`SDM`/NULL — it is one physical class, never "either" —
so this value is sail-specific by construction (`validation.py`'s CHECK-style
guard and the DB's own `CHECK` constraint both reject it elsewhere). The add
form only shows the Diameter field on a sail once **Cambered** is switched on
(defaulting to `SDM`), since it is meaningless otherwise. In matching logic,
`Either` is treated the same as NULL by `rigkit.diameter_class()` (both read as
"don't block on diameter"), which is the correct outcome for both — the
distinction only matters for what gets displayed and stored, not for the rig
assistant's behaviour.

## Three sports, three rig pipelines

UBWC does windsurfing, windsurf foiling (**windfoil**) and wing foiling
(**wingfoil**). The Rig tab has a picker for the pipeline
(`web/js/rig/engine.js`, `DISCIPLINES`; stored as `setups.discipline`, a label
rather than a CHECK-constrained fact). The full brief is
[docs/kit_options.md](docs/kit_options.md).

| Pipeline | Member picks | App derives | Board box |
|---|---|---|---|
| windsurf | sail + board | mast, ext, boom, fin | anything except the two foil boxes (an unrecorded box counts as windsurf) |
| windfoil | sail + board | mast, ext, boom, foil | `Deep Tuttle (foil ready)` |
| wingfoil | board + wing | foil only (no UJ, no mast) | `Double US Box (wingfoil)` |

- The rig maths (luff, adjustable top, boom, diameter) is **identical for
  windsurf and windfoil**; only the last slot differs (a fin or a foil).
- There is no foil-board component type: "is a foil board" is read from the two
  box strings (`FOIL_BOX_WINDFOIL`, `FOIL_BOX_WINGFOIL`) on a board or foil.
- An unrecorded box is **excluded** from the foil pipelines (the opposite of the
  usual NULL-never-blocks rule), because a board nobody set up as a foil board
  is not one. It is still allowed in windsurf.
- `sportFor` decides where a catalogue tile's **Rig** button goes: wings and
  wingfoil boards to wingfoil, windfoil boards to windfoil, everything else
  (including sails, which are ambiguous between windsurf and windfoil) to
  windsurf. It only preselects; it is the same as picking the kit by hand.
- Switching pipeline keeps only the picks still legal in the new one
  (`survivingPicks`). Trip packing derives one fin or foil per board by its box.

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

## Fin and foil boxes

Boards accept fins/foils via a **box standard** (US Box, Powerbox, Tuttle,
Slot Box, Deep Tuttle for foils) that is a hard compatibility constraint distinct from
size — a fin/foil is either physically compatible with a board's box or it
isn't. `items.box_type` carries this on `board`, `fin` and `foil` (choices in
`db.FIELD_META["box_type"]`: US Box, Powerbox, Tuttle, Deep Tuttle, Slot Box,
Deep Tuttle (foil ready), Double US Box (wingfoil); a board's field is labelled
"Fin box type"), and the catalogue filter panel groups them by it.

- **Built**: `fin.box_type == board.box_type` (exact match, no tolerance, unlike
  the rig's cm-based checks), in `validation.py` and `engine.js`; the rig
  assistant ranks fins and foils by it. A fin or board with no box recorded never
  blocks a pick (except in the foil pipelines, above).
- **Not built**: fin/foil **size** (fin: cm length; foil: front wing area,
  mast/fuselage length) suggested from board volume + sail size + wind range,
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
- **Trips** (Trips tab, open to everybody): a trip walks **four stages**, and the
  stage is the whole of what the tab needs to know about it, so the trips index
  groups by it rather than putting a chip on each row.
  `requesting -> packing -> active -> done`, plus `cancelled` for one called
  off. A trip **never changes `items.location`** (that column is the storage
  rack, always), so "away" is membership of a trip that is `packing` or
  `active` (`db.away_item_ids`, `db.TRIP_AWAY_STAGES`), which is what hides kit
  from the rig picker and flags it grey in the catalogue. Nothing is away while
  a trip is only being asked about, and nothing is away once it is done.
  - **A packing/active trip is a location you can pick** in the app-bar toggle
    (`store.trip`, `pickSite` in `web/js/ui/chrome.js`, bootstrap `trips`). It
    does not touch `store.site` (the home site you fall back to), but while it
    is selected the Catalogue and the rig assistant (Build + Your rig) work off
    that trip's kit alone — away flag ignored, `out_of_action` still hidden
    (`rigkit.kit(only_ids=)`, `GET /api/rig/kit?trip=`). A rig built on a trip
    stores `setups.trip_id`, so a de-rigged session auto-fills its wind from the
    trip pin (`wind.for_window(..., coords=)`, `/api/wind?lat=&lon=`) even
    though the destination has no `sites` row.
  - **requesting**: any signed-in member asks for the specific kit they want
    (`trip_votes`, one row per member per piece; asking for something nobody has
    asked for yet *is* suggesting it). A request **reserves nothing**. The names
    matter and not just the tally: they are drawn on the tile as a stack of
    fading discs that opens into who, because "who asked for the 124?" is a real
    question on the water.
  - **Confirm the kit** (`renderConfirm`, `/trip/:id/confirm`): the kit sec's
    way out of requests, reached from **Finalise kit**. A dense list of the
    whole club's sails and boards (plus wings/foils if one was asked for),
    requested pieces pre-ticked, tap to add or drop. There is **no decline** and
    no per-request deck: a piece the kit sec does not want is removed off the
    wishlist (committee long-press) or just left unticked here, and
    `db.finalise_trip_kit` lets go of its `trip_votes` so it cannot come back as
    pending. Kit that stays keeps its requesters (the disc stacks read them).
    Everything else asked for rides through silently: requested rig kit
    (mast/ext/boom/fin/uj) is **pinned** onto the trailer the wizard builds,
    requested odds and ends go straight to the packing list. Continue calls
    `/api/trips/{id}/finalise` and opens the wizard.
  - **the wizard** (`renderWizard`, `/trip/:id/wizard`): re-runs the real
    trailer solver (`web/js/rig/pack.js` - `buildModel` / `chooseTrailer`) on
    every touch against `/api/trips/kit`, with the count-up rolls, the green
    ⇄ amber hero crossfade and the two combination bands ported from
    `misc/trip-wizard-mock`. Two controls: **rigs at once** (the stepper and the
    headline in one) and **how full to pack** (light / standard / generous, over
    the solver's spare and per-piece weights). The board half - **one fin and
    one base per board**, plus a few spares by preset (`packBoardKit` in
    `web/js/rig/engine.js`, fins `0/1/2`, bases `0/1/3`) - is a straight count,
    since it has no combinatorics. **Start packing** saves the chosen kit
    (`source: chosen`), the solved trailer and the board kit (`source: derived`)
    and moves the trip to `packing`. `trip_items.declined` is a dead column now.
  - **packing**: the same list as a checklist, ticked per piece
    (`trip_items.packed`). The bar that moves the trip on only appears with the
    last tick.
  - **coming home is not a stage**. There is no unpacking checklist: the kit sec
    presses **End trip** in the app bar (next to the edit pencil, committee only,
    and only while a trip is `packing` or `active`), confirms, and `return_all`
    hands every piece back at once. A second list to work through earned nothing
    when the app never moved any of it: each piece goes back to the rack it never
    left. `trip_items.returned` is set for the whole list at that moment and is
    the record that it came home, not a tick anybody makes.
  - **the forecast**: the summary above the rule carries a Windguru-style wind
    strip, one stacked grid per day of the trip (up to 7 days, gust over mean,
    no direction), from `wind.forecast(site, start, end, coords=)` via
    `GET /api/trips/{id}/forecast`. Each day is headed "Today"/"Tomorrow"/
    "Yesterday", else its weekday within the week, else a date like "18th
    December" (`forecastDayName`); days Open-Meteo cannot reach get no column at
    all. The pin is a `lat`/`lon`
    on the trip, set in the form's **Pin the spot** search (Open-Meteo
    geocoding, `GET /api/geocode`); it falls back to the destination site's own
    `sites.lat`/`sites.lon`. No pin and no site coordinates means no strip, and
    a forecast that cannot be had (dates out of range, no network) is never an
    error. The logbook's auto-wind (`wind.for_window`) resolves coordinates the
    same way, so it is no longer limited to the three seeded sites.
  - **archive and delete**: a committee long-press on a Trips row offers Archive
    (done or cancelled trips only; sets `trips.archived_at`, folds the trip into a
    closed "Archived (N)" group at the bottom of the index, Restore brings it back)
    and Delete permanently (any stage; `trip_items`/`trip_votes` cascade, which
    frees any kit the trip was holding away).
  Reading trips is open to everyone; every write except a request is committee.
  The screens are `web/js/screens/trips.js` (index), `trip.js` (one trip, all
  four stages, plus Confirm the kit and the wizard) and `tripform.js` (new and
  edit); the kit picker they share is `web/js/ui/kitpicker.js`, which is the
  Catalogue's own filter sheet doing a second job. The Catalogue's filter and sort
  rules live in `web/js/ui/kitFilter.js` and are used three times, each with a
  **state of its own** (filtering the Catalogue never hides kit on a packing list):
  the Catalogue; the trip's kit list at every stage (search + filter button under
  the title, opening on all fault buckets and "Packing order", with "Showing N of M"
  while filtered - the `X of Y packed` count and Complete packing stay whole-trip);
  and the picker (behind a Filters button, faults limited to none/minor because
  out-of-action kit is never offered).
- **Retiring kit** (committee, item page): **Archive** hides a piece from the
  live inventory and records why, keeping its faults; Restore puts it back.
  **Delete permanently** removes the piece and its faults and favourites. Prefer
  archive for anything broken or retired.
- **Members and locations** (committee, user menu): a member account can be
  deleted outright (for a test or fake account: it cascades their sessions,
  ratings, trip votes and favourites, and leaves their comments and trips with
  the author cleared). The **Locations** screen edits every site's map pin and
  the spots kit lives in, with photos; a site can only be deleted when empty.
- **Item page "known faults"**: faults are per physical item, not per
  model — keep them keyed to the individual row (Manufacturer+Model+Size+
  Location), matching the `faults` table and the Faults page spec. Each fault
  has a **title** (flag label), a **description** (diagnosis + fix) and a
  **severity**: `usable` (amber flag, "minor fault") or `out_of_action` (red
  flag, "major fault"). A single item can carry several faults, each surfaced
  as its own flag; a piece is bucketed by its **worst** open fault.
- **Fault visibility in the catalogue**: the filter panel's Faults section has
  three buckets — no faults / minor / major — and opens on **no faults +
  minor** (never persisted, so a member never returns to silently hidden
  broken kit). A red `out_of_action` piece is therefore hidden until "major"
  is ticked; when shown it still **sorts to the very bottom** of the list
  whatever the chosen sort. The rig picker still hides `out_of_action`
  outright. The `/api/items` endpoint returns everything regardless — the
  hiding is the browser's, so the inventory stays complete.

## Agent skills

### Issue tracker

Issues live in the `Kresimos/UBWC` GitHub Issues (the repo was `bm7273/UBWC`; that name redirects), driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, label strings unchanged (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
