# UBWC Kit App

The University of Bristol Windsurfing Club's kit inventory, rigging assistant
and session logbook. Mobile-first web app: a FastAPI JSON API over a SQLite
database, with a dependency-free static front end.

## Run it

```sh
./run.sh            # same wifi: prints a URL and a QR code for your phone
./run.sh --share    # public HTTPS link, works anywhere (needs cloudflared)
./run.sh --local    # loopback only, http://127.0.0.1:8000
```

The script builds `.venv`, installs the dependencies on first run, and starts
the server. This is a handset UI, so test it on a phone: see
[TESTING.md](TESTING.md), including how to test with someone remote and how to
demo it at the lake with no internet.

`kit.db` builds itself on first run (from the example seed if present, or from
`data/Kit Inventory.xlsx` via `migrate.py`).

Members sign up in the app with a username and a password. Committee is a flag
on the account, not a shared PIN, so the first committee account is made from
the machine running the server:

```sh
python manage.py signup <username> --admin   # the first committee account
python manage.py promote <username>          # hand committee to somebody else
python manage.py password <username>         # reset a forgotten one
python manage.py list                        # every account, and what it has done
```

Set `UBWC_HTTPS=1` when the app is served over HTTPS, so the session cookie is
marked Secure.

Nothing is hosted yet. The options, including AWS, are compared in
[misc/hosting.md](misc/hosting.md).

## Layout

| Path | What it is |
|---|---|
| `server.py` | FastAPI app: the JSON API and the static-file host |
| `db.py` | data-access layer over `kit.db` (no ORM) |
| `rigkit.py` | normalises inventory rows into the shape the rig wizard reasons about |
| `validation.py` | the windsurfing compatibility rules (see repo-root `CLAUDE.md`) |
| `suggest.py` | what sizes to open the rig wizard on, fitted to the member's own logbook |
| `manage.py` | account admin from the server: make committee, reset a password |
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
