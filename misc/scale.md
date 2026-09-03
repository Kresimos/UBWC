# How this holds up: traffic, a bigger database, and photos

Measured on 2026-09-03 rather than guessed, because "will it be fast enough"
answered by opinion is worth nothing. Everything below was run against the
example database the app is built against (148 items, roughly the size of the
club's actual fleet) and against a synthetic copy inflated to fourteen times
that, on one process, the way it will run on Railway.

The short version: **at club size this is not close to a problem**, the thing
that grows is the catalogue, and the only decision that could genuinely
overwhelm the app is photos.

## Where the app is today

148 items, 22 faults, 17 accounts, 382 ratings, 21 trips: a 296 KB database.
That is example data rather than a real count, but it is the right order of
magnitude for a club fleet, which is what makes it worth measuring against.

| Request | Time | On the wire |
|---|---|---|
| `/api/items` (the whole catalogue) | 10 ms | 78 KB, **6.9 KB gzipped** |
| `/api/rig/kit` | 7 ms | |
| `/api/trips` | 2 ms | |
| `/api/me` | 1 ms | |

Five members opening the app at the same instant: 50 ms each, about 90
requests a second. The club is fifty-odd people who mostly do not open a kit
app simultaneously, so there is roughly two orders of magnitude of headroom.

gzip was added for this deploy and does the heavy lifting on the number that
actually matters to a member, which is not milliseconds on a server in London
but kilobytes over a phone signal at a lake: **78 KB to 6.9 KB, eleven times
smaller**. The front end's own JavaScript and CSS compress about four to one on
top of that.

## Where it stops being comfortable

The same measurements against 2,072 items, 200 members, 41,782 ratings and
3,018 logged sessions, a 4.8 MB database:

| Request | Time | On the wire |
|---|---|---|
| `/api/items` | 138 ms | 1.09 MB, **59 KB gzipped** |
| `/api/rig/kit` | 98 ms | |

Twenty members hitting the catalogue at once at that size: about **10 seconds
each**. That is the honest failure point, and it is worth understanding why,
because it is not the database being slow.

`/api/items` deliberately returns **the entire catalogue in one call** so that
every filter and sort in the browser is instant, and no toggle costs a
round-trip. That is the right trade at 148 items and the wrong one at several
thousand: the cost of a request is proportional to the size of the inventory,
it is nearly all Python and JSON rather than SQL, and one process runs one
piece of Python at a time. So concurrent requests queue.

**None of this is worth fixing now.** The club's kit is not going to multiply
by fourteen; a windsurfing club owns the boards it owns. The number to keep an
eye on is items, not members and not years of ratings, and the honest trigger
is: if the catalogue ever passes roughly **a thousand items**, or a load
noticeably lags, the fix is known and contained.

### The fix, when it is needed

Every member gets a nearly identical answer from `/api/items`. Only two small
parts differ: which items *they* rated, and which are *their* favourites. So
the expensive shared part (all items, all fault flags, all tallies, who is
away) can be built once, cached, and reused until something writes.

The trap is staleness: a member marking a mast broken and still seeing it
green is far worse than a slow page, since the whole point of the app is that
the kit list is true. So the cache must be keyed on something that changes on
every write, not on a timer. That is a contained change to one endpoint, and
it is not the sort of thing to do the night before a launch.

### What was already fixed

Two things found while measuring, both in this deploy:

- **"Which of these did I rate?" scanned every rating in the club's history.**
  The query ranked all 41,782 ratings and then threw away all but one member's.
  Filtering before the ranking instead of after gives byte-identical answers
  (checked against the old query for all 200 members) and takes **44 ms to
  0.2 ms**, a factor of 199. At today's size it saves under a millisecond; the
  point is that it removes the term that grew with the club's whole history
  rather than with its kit.
- **A tested index that did not help was not added.** A covering index on
  `ratings(item_id, user_id, created_at, id)` made no difference to the tally
  query (SQLite still sorts into a temporary b-tree), so it is not in the
  schema. Noted here so nobody re-derives it hopefully.

## Two people at once

SQLite allows one writer at a time. That is fine; what is not fine is the
default journal mode, where that writer also blocks every **reader**. On a
laptop with one user this never shows. On a shared server it means one member
saving a rating can stall everyone else's page load, and under sustained
concurrency reads eventually fail outright with `database is locked`.

The app now opens every connection in **WAL** mode with a five second busy
timeout, so readers pass straight through a write and only writers ever wait.
Eight readers and three writers hammering the same database for four seconds:

| Journal mode | Reads | Writes | Failures |
|---|---|---|---|
| the old default | 2,280 | 1,260 | **17** `database is locked` |
| WAL | 2,141 | 1,964 | **0** |

(The old-mode run used a short lock timeout to surface the failure in seconds.
With the default five second timeout the same contention appears as members
waiting rather than errors, until the wait exceeds the timeout and it becomes
errors again. WAL removes the waiting.)

WAL is a property of the database file, so it persists once set, and it needs
the database to be on a real local disk. Railway's volume is one; a network
filesystem would not be, which is one more reason the disk is not negotiable.

## Photos

Photo upload is **built** now (kit items, trips, faults and fixes, profile
pictures, spot photos), along the three rules below. What is left is watching
the number: photos are the one feature that can fill the volume and take the
database down with it. The analysis that follows is why it was built this way,
and where the ceiling is.

**A Hobby volume is 5 GB.** That is the whole budget, shared with the database.

An iPhone photo is 2 to 5 MB. Stored as they come off the phone:

- one photo per item is roughly **600 MB** for today's fleet, which fits;
- every fault report carrying a photo of the ding, over a few years, does not.
  A few thousand photos is the ceiling, and it arrives quietly.

Three rules, in order of how much they matter — all three are in `server.py`
now (`_store_photo`, `PHOTOS_DIR`, `MAX_UPLOAD_BYTES`):

1. **Resize on upload, and never store the original.** The app draws a 390 px
   column. A 400 KB image at 1600 px wide is more than it can ever display,
   and it is **ten times smaller** than what the phone sends. This single
   decision moves the ceiling from around a thousand photos to twenty-odd
   thousand. Done twice over: the browser downscales to ~1920 px before it
   uploads (a phone on lake wifi), and the server re-decodes and resizes to
   1600 px as the authority. It needs Pillow, the first non-trivial dependency
   this app takes on.
2. **Files on the volume, not blobs in SQLite.** `<UBWC_DB dir>/photos/` (so
   `/data/photos/` on Railway), with `image_path` holding the name. Blobs
   would work, but every one of them would then be inside every backup and
   every `manage.py backup`, turning a 300 KB file you can email into a
   gigabyte you cannot, and the backup is the thing that makes this whole
   hosting choice reversible.
3. **Cap the upload size at the server** (15 MB), and check the file really is
   an image (Pillow decodes it, not just its content-type), because the disk
   is finite and shared with the database. A full volume is not a failed
   upload; it is a database that cannot write.

Serving them is the easy half, and done: a `StaticFiles` mount over `/photos`
with a one-year immutable cache header (the name is a random token, the bytes
never change). Images are already compressed, so gzip correctly skips them,
and a phone re-opening the app fetches each photo once.

`manage.py reset` sweeps photo files no surviving row points at, so the
one-time move to the real inventory does not leave the volume full of orphans.

The moment photos exist, the backup story changes too: `kit.db` alone stops
being the whole of the club's data. Either back up the photo directory
alongside it, or accept in writing that photos are the losable half.

## What will not be the problem

Worth saying, so effort goes to the right place:

- **The database size itself.** SQLite is comfortable into the gigabytes;
  4.8 MB of synthetic data was never the bottleneck in any measurement here.
- **Members and years of history.** 200 accounts and 3,000 logged sessions
  changed nothing measurable. The catalogue is the only endpoint that grows
  with the club, and it grows with kit.
- **The rig wizard and the trailer solver**, which run in the browser on the
  member's own phone and cost the server nothing.
- **Open-Meteo.** Wind lookups are cached per site and window, have a six
  second timeout, and a forecast that cannot be had is never an error.
