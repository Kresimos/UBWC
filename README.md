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
python manage.py where                       # which database this is, and what is in it
python manage.py backup [file]               # safe copy, even while the app runs
```

## Hosting

**[misc/deploy-railway.md](misc/deploy-railway.md) is the runbook**: what to
click, what to paste, and what each variable is for. [misc/hosting.md](misc/hosting.md)
is why Railway rather than Fly, AWS or a VPS, and [misc/scale.md](misc/scale.md)
is what the app actually measures under load, at a bigger inventory, and what
photos would cost.

The app reads six environment variables, all optional on a laptop:

| Variable | What it does |
|---|---|
| `UBWC_DB` | where `kit.db` lives. Set it on any host: it must be a path on a disk that survives a deploy. Unset, the database goes in the OS's per-user application data directory. |
| `UBWC_RESTORE` | a database file to adopt at startup, verified first, replacing the current one and keeping it. How a backup goes back. |
| `UBWC_SEED` | permission to build a database from the spreadsheet when there is none. Only ever set for a deliberate first boot: without it a missing database on a host is a crash rather than a silent, healthy-looking wipe. |
| `UBWC_HTTPS` | marks the session cookie Secure. Set it wherever the app is served over HTTPS. |
| `UBWC_ADMIN_USER` / `UBWC_ADMIN_PASSWORD` | make or promote a committee account at startup, for a host with no shell to run `manage.py` in. Never changes an existing account's password. |
| `PORT` | the port to listen on. Its presence also means "hosted": bind every interface, and trust the proxy's forwarded-for header. |

## Layout

| Path | What it is |
|---|---|
| `server.py` | FastAPI app: the JSON API and the static-file host |
| `db.py` | data-access layer over `kit.db` (no ORM) |
| `rigkit.py` | normalises inventory rows into the shape the rig wizard reasons about |
| `validation.py` | the windsurfing compatibility rules (see repo-root `CLAUDE.md`) |
| `suggest.py` | what sizes to open the rig wizard on, fitted to the member's own logbook |
| `manage.py` | account admin from the server: make committee, reset a password |
| `wind.py` | Open-Meteo wind lookup (logbook window + trips forecast) and place geocoding |
| `schema.sql` / `migrate.py` | database schema and the xlsx importer |
| `web/` | the front end: `index.html`, `css/`, `js/` (ES modules, no build step) |

The product plan is in [misc/spec.md](misc/spec.md); the domain rules any
matching logic must obey are in the repo-root [CLAUDE.md](CLAUDE.md).

## Front end

One page, a hash router, and one screen per tab (`web/js/screens/`). The rig
cascade's rules live in `web/js/rig/engine.js`, mirroring `validation.py` — the
same maths the server would use, run client-side so the wizard never round-trips
to filter a list.
