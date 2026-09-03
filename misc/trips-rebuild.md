# Trips, as built

The Trips tab was rebuilt from scratch on this branch. It was drawn first, as a
high-fidelity mockup spliced out of the app's own CSS (`misc/trips-mockup`,
which is still the place to retune the new tile decorations), and then written
into the app against that.

The domain rules live in [CLAUDE.md](../CLAUDE.md) under **Trips**. This file is
the map of where it all is, and the record of what was decided along the way.

## Where it is

| Piece | Where |
|---|---|
| Schema | `schema.sql`: `trips` (four stages, `notes`, `image_path`, `packed_at`, `lat`/`lon` forecast pin), `trip_items` (`packed`, `returned`, `declined`, `source`), `trip_votes` (a request, one row per member per piece), `sites` (`lat`/`lon`) |
| DB layer | `db.py`: `TRIP_STAGES`, `TRIP_AWAY_STAGES`, `create_trip`, `get_trip(s)`, `set_trip_items`, `add_trip_items`, `remove_trip_item`, `finalise_trip_kit`, `drop_trip_request`, `set_trip_packed`, `set_trip_stage`, `return_all`, `close_trip`, `trip_request_counts`, `trip_request_order`, `trip_requesters`, `set_trip_request`, `site_coords`, `set_site_coords`, **`away_item_ids()`**, `_migrate_trip_stages` |
| API | `server.py`: `GET /api/trips`, `/{id}`, `/{id}/forecast`, `/kit`, `/api/geocode`; `POST /api/trips`, `/{id}/items`, `/items/add`, `/items/remove`, `/finalise`, `/request/drop`, `/edit`, `/stage`, `/packed`, `/close`, `/request`. Reads open to all, writes committee, `/request` any member while the trip is `requesting`. |
| Forecast | `wind.py` `forecast(site, start, end, coords=)`: one entry per trip day, each the sailing hours 06–18, or None. `geocode(name)` turns a typed place into a pin for the form. Coordinates resolve trip pin → `sites` row → hardcoded fallback (`_coords`). |
| Screens | `web/js/screens/trips.js` (index), `trip.js` (one trip, four stages, Confirm the kit, the wizard), `tripform.js` (new and edit) |
| Shared UI | `web/js/ui/kitpicker.js` (the Catalogue's filter sheet doing a second job), `web/js/ui/itemTile.js` (six new options, all off by default) |
| Styling | `web/css/tokens.css` (the tile decorations and their knobs), `web/css/screens.css` (`[data-screen="trip"]`, plus the catalogue rules the trip screen is named alongside) |
| Rig assistant | `rigkit.py` `kit(..., exclude_away=True)` subtracts away kit; the picker passes `exclude_away=False` so it can grey out what is spoken for |
| Pack solver | `web/js/rig/engine.js` `packList(kit, chosen)`: greedy, most-constrained-first, `{assigned, short}` |
| Tests | `test_trips.py` (`python test_trips.py`), `web/js/rig/pack.test.mjs` (`node ...`) |

## The questions the drawing board settled

- **Is a trip a list, or does it move kit?** A list. Packing moves nothing:
  `items.location` stays the storage rack for the whole trip, so ending a trip
  is simply letting go of kit that never moved. The Catalogue's
  long-press stays what it was, a **move**, and its copy no longer claims
  otherwise.
- **Deriving rig kit**: client-side, at pack time, through `packList`, so there
  is one set of rig rules in the app rather than a second copy on the server.
- **Appending to a trip**: `POST /api/trips/{id}/items` still replaces (the
  wizard writes the whole list), and `/items/add` and `/items/remove` were added
  for the picker, so an open sheet cannot overwrite a list somebody else added to
  while it was open.
- **The ballot**: it is not a ballot over the whole inventory. A member opens the
  same kit picker the kit sec uses, searches, and asks for specific pieces. What
  comes back is a list of requests with names on them, not a wall of nought-vote
  tiles.
- **Nav**: Trips earns the fifth tab, between Log and Add.
- **Coming home**: not a stage. There was an `unpacking` stage with a checklist
  of its own for a day, and it earned nothing: the app moves no kit, so ticking
  thirty rows to say a trailer came back empty is a chore that stops the list
  being kept at all. It is one **End trip** button in the app bar instead, with
  a confirmation, and `return_all` hands the lot back.
- **The tile**: four new decorations, all options on the one shared
  `itemTile` and all off by default, so a tile drawn without a trip in sight is
  byte for byte the tile that shipped. See CLAUDE.md and the mockup's notes.
- **The forecast pin**: a trip was only getting a wind strip when its
  destination string happened to match one of three hardcoded sites. It now
  carries its own `lat`/`lon`, set in the form by a place search (Open-Meteo
  geocoding, no key, no map library — the app has no third-party JS and this
  keeps it that way), falling back to a `lat`/`lon` on the `sites` row. The
  strip spans every day of the trip, not just the first, stacked and
  weekday-labelled, direction dropped. The same coordinate resolution fixed the
  logbook's auto-wind, which had the identical three-site limit.

## Done since

- **Confirm the kit + the live wizard.** The swipe deck and the static wizard
  report are both gone. `renderConfirm` (`/trip/:id/confirm`) is a dense
  sails/boards list, requested pieces pre-ticked, no decline concept; a piece
  the kit sec drops loses its `trip_votes` (`db.finalise_trip_kit`,
  `db.drop_trip_request`). `renderWizard` re-runs the real trailer solver
  (`web/js/rig/pack.js`) on every touch with the motion ported from
  `misc/trip-wizard-mock`, and adds a fins/bases pass (`packBoardKit` in
  `web/js/rig/engine.js`). `trip_items.declined` is a dead column.

## Still to do

- **Photos.** `trips.image_path` is in the schema and the hero and the index row
  both draw one when it is set, but nothing uploads yet: the form's Add photo
  button is the same stub the add-kit form has.
