# Trips — rebuild notes

**Status (this branch, `trips`):** Ben's `features/trip-packing` is merged, then the
whole front end is reverted to a blank slate. The backend is kept as the thing the
rebuild designs against — not as settled. Next step is a drawing board (artifact) to
work out the flow and screens before any UI is written.

Ben's original UI, if you want to look: `origin/features/trip-packing`
(`web/js/screens/trips.js`, and the CSS blocks that commit added to `screens.css`).

## The idea worth keeping

A trip is a **named list, not a place**. Packing moves nothing: `items.location`
stays the storage rack for the whole trip, so unpacking is just closing the trip.
"Away" is *derived* — it means "on an `open` trip" — and that's what hides a piece
from the rig assistant and flags it in the catalogue.

A trip is decided in two acts, tracked by `trips.status`:

- **`voting`** — named and dated, no kit yet. Every packable piece the club owns is
  on the ballot at nought votes; voting for one *is* suggesting it. Nothing is
  reserved — voted-for kit still rigs this week.
- **`open`** — the kit sec has packed it. That save closes voting (packing *is* the
  decision). The tally stays on the page: what the club asked for, beside what went.
- then **`returned`** / **`cancelled`**.

The kit the trip is *for* is chosen (boards/sails/wings/foils); the rig kit it
implies (a mast/ext/boom per sail, a fin/base per board) is derived by `packList`,
reusing the rig wizard's own rules, and reports shortfalls rather than sharing.

## What's kept (untouched, on this branch)

| Area | Where | Notes |
|---|---|---|
| Schema | `schema.sql` | `trips`, `trip_items` (`role`, `source` = chosen/derived, `returned`), `trip_votes` (UNIQUE trip+item+user; un-vote deletes) |
| DB layer | `db.py` | `create_trip`, `get_trip(s)`, `set_trip_items`, `update_trip`, `set_trip_returned`, `return_all`, `close_trip`, `trip_vote_counts`, `trip_votes_by_user`, `set_trip_vote`, **`away_item_ids()`**, `TripError`, `TRIP_ROLE_ORDER`, `_widen_trip_status` migration |
| API | `server.py` | `GET /api/trips`, `GET /api/trips/{id}`, `GET /api/trips/kit`, `POST /api/trips`, `/items`, `/edit`, `/returned`, `/close`, `/vote`. Reads open to all; writes committee; `/vote` any member while `voting`. `item_card` carries `away`. |
| Rig assistant | `rigkit.py` | `kit(..., exclude_away=True)` subtracts away kit; trip packer passes `exclude_away=False` |
| Pack solver | `web/js/rig/engine.js` `packList(kit, chosen)` | greedy, most-constrained-first; `{assigned, short}` |
| Tests | `test_trips.py` (`python test_trips.py`), `web/js/rig/pack.test.mjs` (`node ...`) | both pass |
| API client | `web/js/api.js` | `api.trips/trip/tripKit/createTrip/setTripItems/editTrip/tripReturned/closeTrip/tripVote` |
| Form infra | `web/js/ui/overlay.js` | `formSheet` gained `type: 'checkbox'` support — generic, kept. Drop it if the rebuild doesn't want it. |

## What was reverted to e053f81 (the catalogue-redesign state)

- `web/js/screens/trips.js` — **deleted**
- `itemTile.js` / `catalogue.js` / `tokens.css` — tile back to no trip extras
  (no tick/away/chip/info/sub, no `cardTileOpts`); catalogue long-press back to
  **moving kit** (`api.moveItems`), not adding to a trip
- `chrome.js` / `main.js` — Trips tab and `/trips*` routes removed
- `screens.css` — `.chiprail` / `.rowlist` / `[data-screen="trip"]` blocks removed
- `item.js` — the "packed for <trip>" warn row removed
- `index.html` — cache-buster back to `v=19`

## Open questions for the drawing board

- **Is a trip a list, or does it move kit?** Ben says list. The catalogue's
  long-press currently *moves*. Decide whether trip-packing reuses that gesture,
  and whether packing ever touches `location`.
- **Deriving rig kit** — client-side (`packList`) at pack time, or server-side?
- **Append to a trip** — `POST /api/trips/{id}/items` *replaces* the whole list.
  If members expect "add these 3 to the Cheddar trip" without opening a picker,
  that wants a real append endpoint.
- **Voting UX** — the whole inventory as a ballot is a lot of tiles. Filtered how?
- **Nav** — does Trips earn a 5th bottom-tab slot, or live somewhere else?
- **Tile** — if trip screens show kit, what does that tile need that the
  catalogue's doesn't (a tick, an "away" flag, a vote count)?
