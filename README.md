# UBWC Kit App

The University of Bristol Windsurfing Club's kit inventory, rigging assistant
and session logbook. Mobile-first web app: a FastAPI JSON API over a SQLite
database, with a dependency-free static front end.

## Run it

```sh
pip install -r requirements.txt
python server.py            # http://127.0.0.1:8000
```

`kit.db` builds itself on first run (from the example seed if present, or from
`data/Kit Inventory.xlsx` via `migrate.py`). The committee PIN defaults to
`1878`; override with the `UBWC_COMMITTEE_PIN` environment variable.

## Layout

| Path | What it is |
|---|---|
| `server.py` | FastAPI app: the JSON API and the static-file host |
| `db.py` | data-access layer over `kit.db` (no ORM) |
| `rigkit.py` | normalises inventory rows into the shape the rig wizard reasons about |
| `validation.py` | the windsurfing compatibility rules (see repo-root `CLAUDE.md`) |
| `wind.py` | Open-Meteo wind lookup for the logbook |
| `schema.sql` / `migrate.py` | database schema and the xlsx importer |
| `web/` | the front end: `index.html`, `css/`, `js/` (ES modules, no build step) |

The product plan is in [misc/spec.md](misc/spec.md); the domain rules any
matching logic must obey are in the repo-root [CLAUDE.md](CLAUDE.md).

## Front end

One page, a hash router, and one screen per tab (`web/js/screens/`). The rig
cascade's rules live in `web/js/rig/engine.js`, mirroring `validation.py` — the
same maths the server would use, run client-side so the wizard never round-trips
to filter a list.
