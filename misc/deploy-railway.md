# Putting the kit app on Railway

The steps, in order, to take this from a laptop to an address members can use.
Written 2026-09-03, against a repo that has been prepared for it: everything
below is dashboard clicks and four terminal commands, because the code changes
a host needs were made first (see "What was changed for this" at the bottom).

Read [hosting.md](hosting.md) for *why* Railway. This document assumes that is
settled.

**Budget 30 minutes.** The slowest part is waiting for two builds.

## Before you start

- A **Railway account** (railway.com), signed in with GitHub. The Hobby plan is
  $5/month and includes $5 of usage, which this app fits inside. A new account
  gets a $5 trial credit with no card, so you can do everything here and decide
  about paying at the end.
- **The repo pushed to GitHub.** Railway deploys a branch, and it will default
  to `main`, so merge this work first:

  ```sh
  git checkout main && git merge deploy-railway && git push
  ```

- **Ten minutes when nobody is using the app.** Redeploying a service that has
  a disk attached takes it down briefly, by design: Railway will not run two
  copies against one disk. Not a trip morning.

## Part A: get it running (dashboard)

1. **New Project** → **Deploy from GitHub repo** → `bm7273/UBWC`. Authorise
   Railway for the repo if it asks; it is private, so it will.

   It starts building immediately and will fail or crash-loop until step 3.
   That is expected and it is not a mistake you have made.

2. **Add the disk.** In the service: **Settings** → **Volumes** → **Add
   volume**, mount path exactly:

   ```
   /data
   ```

   This is where the club's inventory will live. Everything else about the
   container is thrown away and rebuilt on every deploy; only this survives. Hobby allows up to
   5 GB, which is far more than a database needs (see [scale.md](scale.md) for
   when that stops being true, which is photos).

3. **Add the variables.** **Variables** → **Raw editor**, and paste this whole
   block. Change the two marked lines, and nothing else:

   ```
   UBWC_DB=/data/kit.db
   UBWC_RESTORE=/data/incoming.db
   UBWC_HTTPS=1
   PORT=8080
   UBWC_SEED=1
   UBWC_ADMIN_USER=johnny
   UBWC_ADMIN_PASSWORD=change-this-to-something-long
   ```

   - `UBWC_ADMIN_USER` — your username. If it already exists in the database,
     it is made committee and its password is left alone. If it does not, it
     is created with the password below.
   - `UBWC_ADMIN_PASSWORD` — a real passphrase, four or five words. You delete
     this variable in step 6, so it does not need to be memorable, but it will
     sit in the Railway dashboard until you do.

   What the others are for is at the bottom of this document.

4. **Deploy**, and watch **Logs**. You are waiting for:

   ```
   UBWC: database at /data/kit.db
   UBWC: made committee account johnny. Remove UBWC_ADMIN_PASSWORD now.
   ```

   `/data/kit.db` is the line that matters. Any other path means the disk did
   not mount and nothing you do afterwards will survive a deploy.

5. **Get the address.** **Settings** → **Networking** → **Generate Domain**.
   You get something like `ubwc-production.up.railway.app`. Open it. The app
   loads, with **6 items** in it: that is the stub spreadsheet in the repo, not
   the club's kit. Part B fixes that.

   Sign in as the account from step 3 to check it works.

6. **Delete `UBWC_SEED` and `UBWC_ADMIN_PASSWORD`** from Variables now.

   `UBWC_SEED` exists so that a missing database is a loud crash instead of a
   silent rebuild from the sheet. Leaving it set means that the day the disk
   fails to mount, the app comes back up looking healthy and stocked with six
   items while everything actually entered is gone, and nobody notices until
   somebody asks where the kit went. That costs nothing today, when the data is
   made up. It costs the club its inventory the week after somebody has spent
   an afternoon counting boards into it, and by then nobody will remember this
   variable is set. Turn it off now, while it is a two-second change.

   Leave `UBWC_ADMIN_USER`: it is harmless, and it means you can never be
   locked out of committee.

## Part B: put the example database on it

The database in the repo is a 6-row stub, which is not enough kit for the app
to be worth looking at. **The example database the app has been built and
tested against (148 items, 22 faults, 21 trips, ratings and logbooks) exists in
one place: this Mac**, at `~/Library/Application Support/UBWC/kit.db`. It is not
in git and never has been.

This is made-up data, not the club's inventory, which has not been counted yet.
That makes this step low-risk and worth doing anyway: a live app with a
plausible fleet in it is one the committee can actually try, and it is what the
first real kit gets added alongside. Clearing it out for the real inventory is
"Later" below, and it is one command.

You need the Railway CLI for this one step:

```sh
brew install railway
railway login
cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/Projects/ubwc-kit-app
railway link                      # pick the project you just made

python manage.py backup /tmp/kit-upload.db
railway volume files upload /tmp/kit-upload.db /data/incoming.db
```

`manage.py backup` is not `cp`. It uses SQLite's own backup, which takes a
consistent snapshot even if something is writing, folds in anything still in
the write-ahead log, and verifies the result before telling you it worked. It
prints the item count: check it says 148, not 6.

If that upload command has moved (the CLI changes), `railway volume browse /`
opens the disk in a file browser in the terminal and can put the file there by
hand. The destination name is what matters: `incoming.db`, in `/data`.

The upload goes to `incoming.db`, a name the running app never opens. Then
**Deploy** again from the dashboard (or `railway up`), and the logs say:

```
UBWC: restored /data/kit.db from /data/incoming.db (148 items); the previous
database is kept at kit.db.replaced-20260903-031248
```

Reload the app: the full example fleet is there. `/api/health` in a browser
confirms it in one line.

This is also, permanently, **how you restore a backup**: upload it to
`/data/incoming.db` and redeploy. The app checks the file is a real, intact
database before it touches anything, keeps the one it is replacing, and
consumes the upload so a restart cannot restore twice. `UBWC_RESTORE` does
nothing at all when that file is not there, which is why it can just stay set.

## Part C: before you tell any member the address

1. **A backup that leaves Railway.** Not urgent while the data is made up, and
   the thing to have working *before* somebody spends an afternoon counting
   boards into it. The volume is one disk in one region with no replication, and
   Railway's own backups do not protect against the account going away or
   somebody deleting the project. Once a week is plenty:

   ```sh
   railway volume files download /data/kit.db ~/…/UBWC\ 2026\ 2027/kit-$(date +%F).db
   ```

   into the club Google Drive, so it is not on your personal machine either.
   With that file, moving to any other host is an afternoon, which is what
   makes this decision reversible.

   **Once photos are in use**, `kit.db` is no longer the whole of the club's
   data: the images live beside it in `/data/photos/`. Pull the directory in
   the same run, or accept in writing that photos are the losable half:

   ```sh
   railway volume files download /data/photos ~/…/UBWC\ 2026\ 2027/photos-$(date +%F)/
   ```

   `python manage.py where` prints the photo count and size, on the server or
   against a downloaded copy.

2. **Get the bill off your personal card.** A club app that outlives your
   committee should not be attached to your bank account. Railway supports
   changing the payment method on the account.

3. **Tell the next committee two sentences**: push to `main` and it redeploys;
   the inventory lives on the volume and is backed up to Drive. That is the
   whole handover, and it is why Railway was chosen over anything needing a
   Dockerfile.

## Later: switching to the club's real inventory

When the kit actually gets counted, the example data has to go, and the club
has to stay. That is one command:

```sh
railway ssh
python manage.py reset
```

It clears the inventory and everything that happened to it (items, faults and
their timelines, comments, ratings, favourites, saved rigs, the logbook, trips
and their requests) and keeps:

- **accounts** — usernames, passwords, display names, and who is committee.
  Nobody signs up twice, nobody is signed out, and you do not have to hand out
  committee again.
- **places** — the sites and the storage spots. Configuration rather than
  inventory, and it is what the Add kit form offers as locations, so keeping
  them is what makes entering the first real board quick.

It prints exactly what it will keep and what it will clear, with row counts,
and waits for you to type `clear`. It writes a backup next to itself first,
whatever you answer, and it refuses to finish if the delete left anything
pointing at a row that no longer exists. Afterwards the first item added is
item 1 rather than item 149.

Then add kit through the app, which is the point: **Add kit** validates as it
goes (a mast and extension have to actually reach the sail's luff), so what
goes in is right from the first row, which a spreadsheet import never
guaranteed.

If you would rather not use a shell, do it the other way round: run
`python manage.py reset` against a copy here, then upload the result to
`/data/incoming.db` and redeploy. Same outcome, and it has the advantage that
you can look at the emptied database before it goes anywhere near the club.

## When something is wrong

| What you see | What it is |
|---|---|
| Logs: `/data does not exist, so UBWC_DB points nowhere real` | The volume is not attached, or its mount path is not `/data`. Fix it in Settings → Volumes. |
| Logs: `No database at /data/kit.db, and this is a host` | The disk mounted but is empty. Only correct on a first deploy: set `UBWC_SEED=1` for one deploy, then remove it. If this happens once real kit has been entered, **stop** and work out where the data went before doing anything. |
| App loads but has **6 items** | It is serving the stub from the spreadsheet. Do Part B. |
| `is not a usable kit database` | The upload was truncated or is not a database. Nothing was changed. Re-run `manage.py backup` and upload again. |
| Signed out of your phone after a deploy | Should not happen: sessions are rows in the database, so they survive. If it did, the disk is not persisting, which is the first row of this table. |
| Health check fails, deploy rolls back | Open Logs. The app refuses to start on a data problem rather than serving a wrong inventory, so the log line says which. |
| A member cannot sign in and you cannot reset it | `railway ssh`, then `python manage.py password <username>`. |

## The variables, and why each exists

| Variable | Value | Why |
|---|---|---|
| `UBWC_DB` | `/data/kit.db` | Puts the database on the disk that survives deploys. Without it the app writes inside the container, and every deploy silently starts a new inventory. |
| `UBWC_RESTORE` | `/data/incoming.db` | Where to look for a database to adopt at startup. Safe to leave set forever; does nothing unless the file is there. |
| `UBWC_HTTPS` | `1` | Marks the session cookie Secure, which is correct as soon as the app is served over HTTPS, and Railway always is. |
| `PORT` | `8080` | The port the app listens on. It also tells the app it is hosted, so it binds every interface and trusts the proxy's forwarded-for header, without which the sign-in throttle would count the entire club as one guesser. |
| `UBWC_ADMIN_USER` | your username | Makes that account committee at every boot. Insurance against being locked out of an app with no shell. |
| `UBWC_SEED` | `1`, **first deploy only** | Permission to build a database from the spreadsheet. Absent, a missing database is a crash instead of a silent, healthy-looking wipe. |
| `UBWC_ADMIN_PASSWORD` | **first deploy only** | Only used to *create* an account that does not exist. Never changes an existing account's password. Delete it once you can sign in. |

## What was changed for this

The repo needed real changes before any of the above would work, all of them on
the `deploy-railway` branch. They are latent bugs on any host, not Railway
quirks:

- **The database path is configurable** (`UBWC_DB`). It was a fixed
  per-user directory, which inside a container is thrown away on every deploy.
- **A missing database is refused, not invented.** `ensure_db()` used to
  rebuild from the spreadsheet whenever the file was absent. On a laptop that
  is a convenience; on a server it is the quiet destruction of the club's
  records, and it looks like success.
- **A database can be moved onto the disk safely** (`UBWC_RESTORE`), because
  overwriting a live SQLite file next to its write-ahead log is a real way to
  corrupt it.
- **The first committee account can be made without a shell**
  (`UBWC_ADMIN_USER`), since otherwise a fresh deploy is an app nobody can
  administer.
- **The port and interface follow the host** (`PORT`), and the proxy's
  forwarded-for header is trusted only when hosted.
- **WAL journalling and a busy timeout**, so one member writing does not make
  another member's read fail. See [scale.md](scale.md).
- **gzip**, which takes the catalogue from 78 KB to 6.9 KB on the wire.
- **Cache headers** that let a phone keep the app between visits without
  stranding it on an old version after a deploy.
- **Sign-up is rate limited**, because "anyone with the link" means something
  different once the link is public.
- **Dependencies are pinned** and the Python version fixed at 3.13, so the
  build is the same today and in eighteen months.
- `manage.py backup` and `manage.py where`, which are the two things you want
  when a deploy looks wrong, and `manage.py reset` for the day the real
  inventory replaces the example one.
