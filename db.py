"""Data-access layer for the UBWC kit app.

Thin sqlite3 wrappers over kit.db plus the component metadata (which fields
each component type uses, and their human labels) that the API and the
add-item form are driven by. No ORM.

Everything the app reads goes through here, so the HTTP layer (server.py) only
shapes JSON and the browser never learns SQL. The windsurfing rules themselves
live in validation.py; the normalisation the rig wizard needs is in rigkit.py.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional, Union

import migrate  # for DB_PATH and rebuild()

DB_PATH = migrate.DB_PATH
# The directory the database lives in, which is also where uploaded photos go
# (migrate.DATA_DIR): one disk, one mount, one backup covers the club's data.
# Re-exported here so server.py and manage.py reach it through db, not migrate.
DATA_DIR = migrate.DATA_DIR

# Terminal search commands -> the component_type(s) they list. Sails + Wings are
# grouped together to mirror the sheet.
COMMANDS = {
    "boards": ["board"],
    "sails": ["sail", "wing"],
    "wings": ["wing"],
    "booms": ["boom"],
    "masts": ["mast"],
    "extensions": ["ext"],
    "fins": ["fin"],
    "foils": ["foil"],
    "misc": ["misc"],
}

# Field metadata: item column -> how to label and render it.
FIELD_META = {
    "manufacturer":       {"label": "Manufacturer", "kind": "text"},
    "model":              {"label": "Model", "kind": "text"},
    "type":               {"label": "Type", "kind": "text"},
    "size_l":             {"label": "Size (L)", "kind": "number"},
    "size_m2":            {"label": "Size (m²)", "kind": "number"},
    "luff_cm":            {"label": "Luff (cm)", "kind": "number"},
    "top_extension_max_cm": {"label": "Adjustable top (cm)", "kind": "number", "optional": True},
    "req_boom_cm":        {"label": "Boom (cm)", "kind": "number"},
    "cams":               {"label": "Cams", "kind": "bool"},
    "length_cm":          {"label": "Length (cm)", "kind": "number"},
    "min_size_cm":        {"label": "Min size (cm)", "kind": "number"},
    "max_size_cm":        {"label": "Max size (cm)", "kind": "number"},
    "ext_min_cm":         {"label": "Shortest setting (cm)", "kind": "number"},
    "ext_max_cm":         {"label": "Longest setting (cm)", "kind": "number"},
    "diameter":           {"label": "Diameter", "kind": "select",
                           "choices": ["RDM", "SDM"], "optional": True},
    "size_generic":       {"label": "Size", "kind": "text"},
    "box_type":           {"label": "Box type", "kind": "select",
                           "choices": ["US Box", "Powerbox", "Tuttle", "Deep Tuttle"]},
    "fin_length_cm":      {"label": "Fin length (cm)", "kind": "number"},
    "condition":          {"label": "Condition", "kind": "select",
                           "choices": ["New", "Very Good", "Good", "Fair", "Poor"]},
    "location":           {"label": "Site", "kind": "text"},
    "spot":               {"label": "Spot", "kind": "text", "optional": True},
    "notes":              {"label": "Notes", "kind": "text", "optional": True},
}

# Comment kinds: value -> label for the item page's comment stream. No emoji
# anywhere in app-facing copy (misc/spec.md "Platform and global layout").
COMMENT_KINDS = {
    "usage":  {"label": "Usage log"},
    "review": {"label": "Review"},
    "damage": {"label": "Damage note"},
    "note":   {"label": "Note"},
}

# Ordered fields per component type (drives the add-item form and spec table).
# `notes` is appended to every type as an optional free-text catch-all.
COMPONENT_FIELDS = {
    "board": ["manufacturer", "model", "type", "size_l", "box_type",
              "condition", "location", "spot", "notes"],
    "sail":  ["manufacturer", "model", "type", "size_m2", "luff_cm",
              "top_extension_max_cm", "req_boom_cm", "cams", "diameter",
              "condition", "location", "spot", "notes"],
    "wing":  ["manufacturer", "model", "type", "size_m2",
              "condition", "location", "spot", "notes"],
    "boom":  ["manufacturer", "model", "type", "min_size_cm", "max_size_cm",
              "condition", "location", "spot", "notes"],
    "mast":  ["manufacturer", "model", "type", "length_cm", "diameter",
              "condition", "location", "spot", "notes"],
    "ext":   ["manufacturer", "model", "ext_min_cm", "ext_max_cm", "diameter",
              "condition", "location", "spot", "notes"],
    "fin":   ["manufacturer", "model", "type", "box_type", "fin_length_cm",
              "condition", "location", "spot", "notes"],
    "foil":  ["manufacturer", "model", "type", "box_type",
              "condition", "location", "spot", "notes"],
    "misc":  ["manufacturer", "model", "type", "size_generic",
              "condition", "location", "spot", "notes"],
}

# Human labels for component types (for headings, add-item picker, etc.).
COMPONENT_LABELS = {
    "board": "Board", "sail": "Sail", "wing": "Wing", "boom": "Boom",
    "mast": "Mast", "ext": "Extension", "fin": "Fin", "foil": "Foil",
    "misc": "Misc",
}

# The order the catalogue's type chips appear in.
CATALOGUE_TYPES = ["board", "sail", "mast", "ext", "boom", "fin", "foil",
                   "wing", "misc"]

# Sites the club uses. Committee maintains this list; new ones can be added
# inline while moving kit, which is why it is a table rather than a constant.
DEFAULT_SITES = ["Cheddar", "Richmond Building", "SU Store"]

# The forecast pin for the sites the club already knows. wind.py reads these
# (via `site_coords`) so a trip to a named site, and the logbook's auto-wind,
# both get a forecast without anybody geocoding anything. A site the club adds
# later has no coordinates until somebody sets them, and simply gets no strip.
DEFAULT_SITE_COORDS = {
    "Cheddar": (51.2807, -2.7900),           # Cheddar Reservoir
    "Richmond Building": (51.4585, -2.6047),  # Bristol SU, Clifton
    "SU Store": (51.4585, -2.6047),
}

# Where each kind of kit lives at each site, and the sentence shown when a
# member taps the spot. Used to seed `spots` and to backfill `items.spot` for a
# database built before the two-level location existed.
DEFAULT_SPOTS = {
    "Cheddar": {
        "board": ("container", "In the container, nose inward on the bottom rack."),
        "sail":  ("wooden rack", "Second bay in from the door. Sails stand upright, ordered by size."),
        "wing":  ("wooden rack", "Second bay in from the door, wings rolled on the top shelf."),
        "mast":  ("mast tubes", "Tubes along the back wall. RDM on the left, SDM on the right."),
        "boom":  ("boom rack", "Upper rail by the door. Booms wound fully in before they go back."),
        "fin":   ("blue crate", "Blue crate under the bench, fins in their sleeves."),
        "foil":  ("blue crate", "Blue crate under the bench, foil parts in the lidded box."),
        "ext":   ("blue crate", "Blue crate under the bench, extensions wound shut."),
        "uj":    ("blue crate", "Blue crate under the bench, bases in the top tray."),
        "misc":  ("kit shelves", "Shelving behind the door: harnesses, wetsuits and spares."),
    },
    "Richmond Building": {
        "board": ("board racks", "Ground-floor store, boards on the wall racks."),
        "sail":  ("sail shelf", "Long shelf above the boards."),
        "wing":  ("sail shelf", "Long shelf above the boards."),
        "mast":  ("mast pipes", "Pipes bolted along the left-hand wall."),
        "boom":  ("boom rail", "Rail beside the door."),
        "fin":   ("parts drawer", "Steel drawer unit, top drawer."),
        "foil":  ("parts drawer", "Steel drawer unit, bottom drawer."),
        "ext":   ("parts drawer", "Steel drawer unit, middle drawer."),
        "uj":    ("parts drawer", "Steel drawer unit, middle drawer."),
        "misc":  ("kit cupboard", "Cupboard at the back of the store."),
    },
    "SU Store": {
        "board": ("top shelf", "Top shelf of the cage, strapped."),
        "sail":  ("sail bin", "Canvas bin at the end of the cage."),
        "wing":  ("sail bin", "Canvas bin at the end of the cage."),
        "mast":  ("corner tubes", "Tubes in the far corner of the cage."),
        "boom":  ("boom shelf", "Middle shelf of the cage."),
        "fin":   ("parts box", "Lidded box on the middle shelf."),
        "foil":  ("parts box", "Lidded box on the middle shelf."),
        "ext":   ("parts box", "Lidded box on the middle shelf."),
        "uj":    ("parts box", "Lidded box on the middle shelf."),
        "misc":  ("store shelves", "Lower shelves of the cage."),
    },
}

# Misc rows that behave as their own rig component. The spreadsheet has no
# column for these, so the rig steps read them off the misc `type` — see
# rigkit.py, which is the only place that mapping is applied. Extensions used to
# be here too; they are a component type of their own now (`ext`), so only the
# mast base is left.
MISC_RIG_TYPES = {"Universal joint": "uj"}


# --------------------------------------------------------------------------- #
# Connection / lifecycle
# --------------------------------------------------------------------------- #
# How long a blocked writer waits for the lock before giving up. Club-sized
# writes are sub-millisecond, so anything near this is a bug, not congestion.
BUSY_TIMEOUT_S = 5.0


@contextmanager
def connect():
    """Yield a connection and close it on exit.

    sqlite3.Connection's own `with` support only commits/rolls back a
    transaction, it never closes the connection, so every `with connect()
    as conn:` call site was leaking a file descriptor. Writers already call
    conn.commit() explicitly, so closing here (instead of relying on the
    driver's implicit commit-on-exit) changes nothing about transaction
    behaviour.
    """
    conn = sqlite3.connect(DB_PATH, timeout=BUSY_TIMEOUT_S)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # One writer at a time is a SQLite fact, but with the default rollback
    # journal that writer also blocks every reader, so on a shared server two
    # members hitting the app at once can see "database is locked" where one
    # of them was only reading. WAL lets readers carry on straight through a
    # write, and the busy timeout makes a *writer* that collides wait its turn
    # instead of failing. Set per connection because both are cheap; the
    # journal mode itself is a property of the file and persists once set.
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    try:
        yield conn
    finally:
        conn.close()


class DatabaseMissing(RuntimeError):
    """The database is not where UBWC_DB says it is, and must not be invented."""


def adopt_restore() -> Optional[str]:
    """Take a database that has been dropped onto the disk, and make it the one.

    This is how a database gets *onto* a host: the club's real inventory lives
    on somebody's laptop, and a host's disk is not somewhere you can just copy
    a file to while the app is using it. Overwriting a live SQLite file is a
    genuine way to corrupt it, because the write-ahead log sitting next to it
    belongs to the file that was there a moment ago.

    So the upload goes to a name the running app never opens (UBWC_RESTORE,
    conventionally /data/incoming.db) and this runs at startup, before the
    first connection: check the file really is a database, move the current one
    aside rather than deleting it, drop the stale -wal/-shm, and rename the new
    one into place. Rename is atomic on one disk, so there is no moment where
    the app could see half a database.

    Consumes the file, so a restart does not restore twice and the variable is
    safe to leave set. That makes it the standing answer to "how do we put a
    backup back", which is the question that matters at 8am on a trip day.
    """
    incoming = os.environ.get("UBWC_RESTORE")
    if not incoming:
        return None
    source = Path(incoming)
    if not source.exists():
        return None

    # Refuse anything that is not a healthy database with kit in it, so a
    # half-finished upload can never replace the club's inventory.
    try:
        probe = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
        try:
            if probe.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise sqlite3.DatabaseError("integrity check failed")
            items = probe.execute("SELECT count(*) FROM items").fetchone()[0]
        finally:
            probe.close()
    except Exception as error:
        raise DatabaseMissing(
            f"{source} is not a usable kit database ({error}).\n"
            "  Nothing was changed. Upload it again, or take a fresh copy with\n"
            "  `python manage.py backup`, which verifies what it writes."
        )

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    kept = None
    if DB_PATH.exists():
        kept = DB_PATH.with_name(f"{DB_PATH.name}.replaced-{stamp}")
        DB_PATH.replace(kept)
    for leftover in (f"{DB_PATH}-wal", f"{DB_PATH}-shm"):
        Path(leftover).unlink(missing_ok=True)
    source.replace(DB_PATH)
    for leftover in (f"{source}-wal", f"{source}-shm"):
        Path(leftover).unlink(missing_ok=True)

    note = f"restored {DB_PATH} from {source} ({items} items)"
    if kept:
        note += f"; the previous database is kept at {kept.name}"
    return note


def ensure_db() -> None:
    """Make kit.db exist and match the current schema.

    Builds from the ground-truth sheet on a cold start, then brings an older
    database forward in place. The migration is additive (new columns and
    tables only) so a database with real inventory, ratings and comments in it
    survives a schema change without being rebuilt from the sheet.

    Seeding from the spreadsheet is a laptop convenience and a server hazard.
    On a host (UBWC_DB set) an absent database nearly always means the disk did
    not mount, and rebuilding from the sheet there would bring the app back up
    looking healthy and fully stocked while having thrown away every rating,
    fault, session and trip the club had entered. So on a host it refuses,
    unless UBWC_SEED=1 says this is the deliberate first boot.
    """
    restored = adopt_restore()
    if restored:
        print(f"UBWC: {restored}", flush=True)
    if not DB_PATH.exists():
        hosted = bool(os.environ.get("UBWC_DB"))
        # The mount is made before the container starts, so on a host the
        # directory existing is the test of whether the disk is really there.
        # Checked first: with it missing, even a deliberate seed would write
        # the inventory to a directory that vanishes on the next deploy.
        if hosted and not DB_PATH.parent.is_dir():
            raise DatabaseMissing(
                f"{DB_PATH.parent} does not exist, so UBWC_DB points nowhere real.\n"
                "  The disk is not mounted, or it is mounted somewhere else.\n"
                "  Make the volume's mount path and UBWC_DB agree, then redeploy."
            )
        if hosted and not os.environ.get("UBWC_SEED"):
            raise DatabaseMissing(
                f"No database at {DB_PATH}, and this is a host, so it will not be\n"
                "  invented. If this is the very first deploy, set UBWC_SEED=1 once\n"
                "  to build it from data/Kit Inventory.xlsx, then remove that\n"
                "  variable. If it is not, the club's data is on a disk this app is\n"
                "  not looking at, and seeding now would bury it under the sheet."
            )
        migrate.rebuild()
    with connect() as conn:
        _migrate_in_place(conn)
        conn.commit()


def _columns(conn: sqlite3.Connection, table: str) -> set:
    return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}


def _tables(conn: sqlite3.Connection) -> set:
    return {r["name"] for r in
            conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def _migrate_in_place(conn: sqlite3.Connection) -> None:
    """Apply the additive parts of schema.sql to an existing database."""
    tables = _tables(conn)

    if "spot" not in _columns(conn, "items"):
        conn.execute("ALTER TABLE items ADD COLUMN spot TEXT")

    item_cols = _columns(conn, "items")
    if "archived" not in item_cols:
        conn.execute("ALTER TABLE items ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
        conn.execute("ALTER TABLE items ADD COLUMN archived_at TEXT")
        conn.execute("ALTER TABLE items ADD COLUMN archived_reason TEXT")

    if "sites" not in tables:
        conn.execute("""
            CREATE TABLE sites (
                id   INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                sort INTEGER NOT NULL DEFAULT 0,
                lat  REAL,
                lon  REAL
            )""")
    elif "lat" not in _columns(conn, "sites"):
        # The forecast pin. A site with no coordinates simply gets no strip.
        conn.execute("ALTER TABLE sites ADD COLUMN lat REAL")
        conn.execute("ALTER TABLE sites ADD COLUMN lon REAL")
    if "spots" not in tables:
        conn.execute("""
            CREATE TABLE spots (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                site        TEXT NOT NULL,
                name        TEXT NOT NULL,
                description TEXT,
                image_path  TEXT,
                UNIQUE (site, name)
            )""")
    elif "image_path" not in _columns(conn, "spots"):
        # A photo of the rack, so a newcomer can put kit back where it lives.
        conn.execute("ALTER TABLE spots ADD COLUMN image_path TEXT")

    # image_path arrived on faults, fault events and comments with the schema
    # that first shipped them, so a database built from schema.sql already has
    # it. A database older than that never got an in-place ALTER for it; add one
    # now so a photo write cannot hit a missing column on an old host.
    for table in ("faults", "fault_events", "comments"):
        if table in tables and "image_path" not in _columns(conn, table):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN image_path TEXT")

    # `setups` was a placeholder for saved favourites; it is now the active-rig
    # record. It is only ever dropped when it still has the old shape.
    if "setups" in tables and "status" not in _columns(conn, "setups"):
        conn.execute("DROP TABLE setups")
        tables.discard("setups")
    if "setups" not in tables:
        conn.execute("""
            CREATE TABLE setups (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                status      TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','derigged','logged','binned')),
                site        TEXT,
                trip_id     INTEGER REFERENCES trips(id) ON DELETE SET NULL,
                rigged_at   TEXT NOT NULL DEFAULT (datetime('now')),
                derigged_at TEXT,
                created_at  TEXT NOT NULL DEFAULT (datetime('now'))
            )""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_setups_user ON setups(user_id, status)")
    elif "trip_id" not in _columns(conn, "setups"):
        # A rig built while a trip was the chosen location remembers the trip, so
        # the logbook can pull wind for the trip's pin even after a de-rig.
        conn.execute("ALTER TABLE setups ADD COLUMN trip_id INTEGER "
                     "REFERENCES trips(id) ON DELETE SET NULL")
    if "setup_items" not in tables:
        conn.execute("""
            CREATE TABLE setup_items (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                setup_id INTEGER NOT NULL REFERENCES setups(id) ON DELETE CASCADE,
                role     TEXT NOT NULL
                         CHECK (role IN ('sail','mast','ext','boom','board','fin','uj')),
                item_id  INTEGER REFERENCES items(id) ON DELETE SET NULL,
                custom   TEXT,
                settings TEXT,
                UNIQUE (setup_id, role)
            )""")
    if "trips" not in tables:
        conn.execute(_TRIPS_DDL.format(name="trips"))
        conn.execute("CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status, id)")
    if "trip_items" not in tables:
        conn.execute("""
            CREATE TABLE trip_items (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                trip_id  INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                item_id  INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                role     TEXT,
                source   TEXT NOT NULL DEFAULT 'derived'
                         CHECK (source IN ('chosen','derived')),
                packed   INTEGER NOT NULL DEFAULT 0,
                returned INTEGER NOT NULL DEFAULT 0,
                declined INTEGER NOT NULL DEFAULT 0,
                note     TEXT,
                UNIQUE (trip_id, item_id)
            )""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_trip_items_trip "
                     "ON trip_items(trip_id)")
    else:
        # The packing tick and the decline are both later than the first
        # trip_items, and both are plain additive columns.
        ti_cols = _columns(conn, "trip_items")
        if "packed" not in ti_cols:
            conn.execute("ALTER TABLE trip_items ADD COLUMN packed "
                         "INTEGER NOT NULL DEFAULT 0")
        if "declined" not in ti_cols:
            conn.execute("ALTER TABLE trip_items ADD COLUMN declined "
                         "INTEGER NOT NULL DEFAULT 0")
    if "trips" in tables:
        trip_cols = _columns(conn, "trips")
        for column in ("notes", "image_path", "packed_at"):
            if column not in trip_cols:
                conn.execute(f"ALTER TABLE trips ADD COLUMN {column} TEXT")
        if "lat" not in trip_cols:
            # The forecast pin, usually the destination geocoded when the trip
            # was set up. Without it the trip page draws no wind strip.
            conn.execute("ALTER TABLE trips ADD COLUMN lat REAL")
            conn.execute("ALTER TABLE trips ADD COLUMN lon REAL")
        _migrate_trip_stages(conn)
    if "trip_votes" not in tables:
        conn.execute("""
            CREATE TABLE trip_votes (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                trip_id    INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE (trip_id, item_id, user_id)
            )""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_trip_votes_trip "
                     "ON trip_votes(trip_id)")
    if "sessions" not in tables:
        conn.execute("""
            CREATE TABLE sessions (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                setup_id     INTEGER REFERENCES setups(id) ON DELETE SET NULL,
                site         TEXT,
                started_at   TEXT,
                ended_at     TEXT,
                wind_kn      REAL,
                wind_gust_kn REAL,
                wind_dir     TEXT,
                wind_source  TEXT,
                stars        INTEGER CHECK (stars BETWEEN 1 AND 5),
                note         TEXT,
                created_at   TEXT NOT NULL DEFAULT (datetime('now'))
            )""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, created_at)")
    if "session_items" not in tables:
        conn.execute("""
            CREATE TABLE session_items (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                role       TEXT,
                item_id    INTEGER REFERENCES items(id) ON DELETE SET NULL,
                label      TEXT,
                vote       INTEGER CHECK (vote IN (-1, 1)),
                comment    TEXT
            )""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_session_items_session "
                     "ON session_items(session_id)")

    _migrate_accounts(conn, tables)
    _migrate_extensions(conn)
    _seed_locations(conn)


# The `items` table as schema.sql defines it. Kept here because widening a CHECK
# constraint (component_type gaining 'ext') is the one migration SQLite cannot
# do with ALTER TABLE — the table has to be rebuilt from a fresh definition.
_ITEMS_DDL = """
    CREATE TABLE {name} (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        component_type  TEXT NOT NULL
                        CHECK (component_type IN
                            ('board','sail','wing','boom','mast','ext','fin','foil','misc')),
        manufacturer    TEXT,
        model           TEXT,
        type            TEXT,
        condition       TEXT,
        location        TEXT,
        spot            TEXT,
        image_path      TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        size_l               REAL,
        size_m2              REAL,
        luff_cm              REAL,
        top_extension_max_cm REAL DEFAULT 0,
        req_boom_cm          REAL,
        cams                 INTEGER,
        length_cm            REAL,
        min_size_cm          REAL,
        max_size_cm          REAL,
        ext_min_cm           REAL,
        ext_max_cm           REAL,
        diameter             TEXT CHECK (diameter IS NULL OR diameter IN ('RDM','SDM')),
        size_generic         TEXT,
        box_type             TEXT,
        fin_length_cm        REAL,
        notes                TEXT,
        archived         INTEGER NOT NULL DEFAULT 0,
        archived_at      TEXT,
        archived_reason  TEXT
    )
"""

# The "RDM." / "SDM." prefix the seed data and the old add-item form used to put
# at the front of `notes`, back when diameter had no column. Moved into
# `items.diameter` and removed from the note, so it is stated once.
_DIAMETER_PREFIX_RE = re.compile(r"^\s*(RDM|SDM)\b[\s.,:;–-]*", re.IGNORECASE)


def _migrate_extensions(conn: sqlite3.Connection) -> None:
    """Give diameter its own column and extensions their own component type.

    Both used to be conventions rather than data: an extension was a `misc` row
    whose `type` cell read "Extension" and whose travel was text in
    `size_generic` ("0-30cm"), and RDM/SDM was the first word of `notes`. This
    reads both out of the free text once, writes them to real columns, and
    leaves the notes carrying only what a person actually wrote.
    """
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'items'"
    ).fetchone()
    if row and "'ext'" not in (row["sql"] or ""):
        _rebuild_items(conn)
    _rebuild_views(conn)

    cols = _columns(conn, "items")
    for name, decl in (("ext_min_cm", "REAL"), ("ext_max_cm", "REAL"),
                       ("diameter", "TEXT")):
        if name not in cols:
            conn.execute(f"ALTER TABLE items ADD COLUMN {name} {decl}")

    # Misc "Extension" rows become `ext` rows, their travel parsed out of the
    # generic size. `type` goes: the component type says what it is now.
    for item in conn.execute(
        "SELECT id, size_generic FROM items "
        "WHERE component_type = 'misc' AND lower(trim(type)) = 'extension'"
    ).fetchall():
        lo, hi = _parse_travel(item["size_generic"])
        conn.execute(
            "UPDATE items SET component_type = 'ext', type = NULL, "
            "size_generic = NULL, ext_min_cm = ?, ext_max_cm = ? WHERE id = ?",
            (lo if lo is not None else 0, hi, item["id"]),
        )

    # Diameter out of the front of the notes, for the three types it applies to.
    for item in conn.execute(
        "SELECT id, notes FROM items WHERE diameter IS NULL AND notes IS NOT NULL "
        "AND component_type IN ('mast', 'ext', 'sail')"
    ).fetchall():
        match = _DIAMETER_PREFIX_RE.match(item["notes"])
        if not match:
            continue
        conn.execute(
            "UPDATE items SET diameter = ?, notes = ? WHERE id = ?",
            (match.group(1).upper(), item["notes"][match.end():].strip() or None,
             item["id"]),
        )


_TRIPS_DDL = """
    CREATE TABLE {name} (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        destination TEXT,
        lat         REAL,
        lon         REAL,
        starts_on   TEXT,
        ends_on     TEXT,
        notes       TEXT,
        image_path  TEXT,
        status      TEXT NOT NULL DEFAULT 'requesting'
                    CHECK (status IN ('requesting','packing','active','done',
                                      'cancelled')),
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        packed_at   TEXT,
        returned_at TEXT
    )
"""


# What every status this table has ever held becomes. 'voting' was always the
# asking stage under another name and 'open' was always a trip that had been
# packed and gone; a database written before the stages existed has no way of
# telling packing from active, and 'active' is the safe read (its kit is away
# either way, and the kit sec can wind it back). 'unpacking' was a stage of its
# own for a while and is now the moment a trip ends rather than a place it
# sits, so a trip caught mid-unpack lands back on 'active' with its End trip
# button waiting.
_TRIP_STATUS_WAS = {"voting": "requesting", "open": "active", "returned": "done",
                    "unpacking": "active"}


def _migrate_trip_stages(conn: sqlite3.Connection) -> None:
    """Bring `trips.status` to the current stages, renaming anything older.

    Changing a CHECK is the one migration SQLite has no ALTER for, so the table
    is rebuilt. Ids are copied, so trip_items and trip_votes still point at the
    right trips. The rename runs inside the copy, because the new CHECK would
    reject the old vocabulary on the way in.

    The guard is the stored DDL itself rather than a version number: it has to
    match what _TRIPS_DDL says today, both in what it allows and in what it no
    longer does.
    """
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'trips'"
    ).fetchone()
    stored = (row["sql"] or "") if row else ""
    if not row or ("'requesting'" in stored and "'unpacking'" not in stored):
        return
    if conn.in_transaction:
        conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.execute("DROP TABLE IF EXISTS trips_new")
        conn.execute(_TRIPS_DDL.format(name="trips_new"))
        shared = _columns(conn, "trips_new") & _columns(conn, "trips")
        shared.discard("status")
        columns = ", ".join(sorted(shared))
        renamed = " ".join(f"WHEN '{old}' THEN '{now}'"
                           for old, now in _TRIP_STATUS_WAS.items())
        conn.execute(
            f"INSERT INTO trips_new ({columns}, status) "
            f"SELECT {columns}, CASE status {renamed} ELSE status END FROM trips")
        conn.execute("DROP TABLE trips")
        conn.execute("ALTER TABLE trips_new RENAME TO trips")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status, id)")
        conn.commit()
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def _rebuild_items(conn: sqlite3.Connection) -> None:
    """Recreate `items` with the current definition, keeping every row and id.

    The standard SQLite table-rebuild dance: foreign keys off (the child tables
    reference `items` by name, so they follow the rename), copy the columns the
    two definitions share, swap the tables over. Ids are copied, so faults,
    comments, ratings and setups all still point at the right piece of kit.
    """
    if conn.in_transaction:
        conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        # The per-type views select FROM items, and SQLite refuses to rename a
        # table out from under a view that names a table it cannot resolve.
        # They are pure presentation, so they go and are rebuilt afterwards.
        for view in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'view'"
        ).fetchall():
            conn.execute(f"DROP VIEW IF EXISTS {view['name']}")
        conn.execute("DROP TABLE IF EXISTS items_new")
        conn.execute(_ITEMS_DDL.format(name="items_new"))
        shared = [c for c in _columns(conn, "items_new") if c in _columns(conn, "items")]
        columns = ", ".join(shared)
        conn.execute(f"INSERT INTO items_new ({columns}) SELECT {columns} FROM items")
        conn.execute("DROP TABLE items")
        conn.execute("ALTER TABLE items_new RENAME TO items")
        conn.commit()
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def _rebuild_views(conn: sqlite3.Connection) -> None:
    """Redefine the per-type views from schema.sql, which is their only source.

    They are cheap to drop and recreate and carry no data, so an existing
    database picks up a changed column list (masts gaining Diameter, extensions
    gaining a view of their own) without being rebuilt from the sheet.
    """
    sql = migrate.SCHEMA_PATH.read_text(encoding="utf-8")
    for statement in re.findall(r"CREATE VIEW\s+(\w+)\s+AS.*?;", sql, re.S):
        conn.execute(f"DROP VIEW IF EXISTS {statement}")
    for statement in re.findall(r"CREATE VIEW\s+\w+\s+AS.*?;", sql, re.S):
        conn.execute(statement)


def _migrate_accounts(conn: sqlite3.Connection, tables: set) -> None:
    """Bring a name-pick database forward to real accounts.

    Three changes, all of which have to keep the existing rows: sign-in
    sessions gain a table, favourites gain a table, and `ratings` stops being
    one standing vote per member and becomes the append-only history described
    in schema.sql. The last one drops a UNIQUE constraint, which SQLite can
    only do by rebuilding the table, so the rows are copied across; every
    existing vote survives as that member's latest one.
    """
    user_cols = _columns(conn, "users")
    if "last_seen_at" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN last_seen_at TEXT")
    if "image_path" not in user_cols:
        # A profile photo. NULL means the member's initials stand in, which is
        # every account until it sets one.
        conn.execute("ALTER TABLE users ADD COLUMN image_path TEXT")

    if "auth_sessions" not in tables:
        conn.execute("""
            CREATE TABLE auth_sessions (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                token_hash   TEXT UNIQUE NOT NULL,
                user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                user_agent   TEXT,
                created_at   TEXT NOT NULL DEFAULT (datetime('now')),
                last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
                expires_at   TEXT NOT NULL
            )""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_auth_sessions_user "
                     "ON auth_sessions(user_id)")

    if "favourites" not in tables:
        conn.execute("""
            CREATE TABLE favourites (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE (user_id, item_id)
            )""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_favourites_item "
                     "ON favourites(item_id)")

    if "voided_at" not in _columns(conn, "ratings"):
        conn.execute("""
            CREATE TABLE ratings_new (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
                item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                vote        INTEGER NOT NULL CHECK (vote IN (-1, 1)),
                session_id  INTEGER,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
                voided_at   TEXT,
                voided_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
                void_reason TEXT CHECK (void_reason IN ('withdrawn', 'moderated'))
            )""")
        conn.execute(
            "INSERT INTO ratings_new (id, user_id, item_id, vote, session_id, "
            "created_at, updated_at) "
            "SELECT id, user_id, item_id, vote, session_id, created_at, updated_at "
            "FROM ratings")
        conn.execute("DROP TABLE ratings")
        conn.execute("ALTER TABLE ratings_new RENAME TO ratings")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ratings_item "
                     "ON ratings(item_id, voided_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ratings_user "
                     "ON ratings(user_id, created_at)")


def _seed_locations(conn: sqlite3.Connection) -> None:
    """Fill sites/spots and give any item without a spot the default for its type.

    Only ever adds: an item that already records a spot, and a site somebody
    added by hand, are both left alone.
    """
    known = {r["location"] for r in
             conn.execute("SELECT DISTINCT location FROM items WHERE location IS NOT NULL")}
    for i, name in enumerate(DEFAULT_SITES + sorted(known - set(DEFAULT_SITES))):
        conn.execute("INSERT OR IGNORE INTO sites (name, sort) VALUES (?, ?)", (name, i))

    # Give the known sites their forecast pin, but never overwrite a coordinate
    # somebody has already set by hand.
    for name, (lat, lon) in DEFAULT_SITE_COORDS.items():
        conn.execute("UPDATE sites SET lat = ?, lon = ? "
                     "WHERE name = ? AND lat IS NULL", (lat, lon, name))

    for site, by_type in DEFAULT_SPOTS.items():
        for spot, description in by_type.values():
            conn.execute(
                "INSERT OR IGNORE INTO spots (site, name, description) VALUES (?, ?, ?)",
                (site, spot, description),
            )

    for row in conn.execute(
        "SELECT id, component_type, type, location FROM items "
        "WHERE spot IS NULL OR spot = ''"
    ).fetchall():
        # A mast base is a misc row but lives with the small parts, not on the
        # wetsuit shelf, so the default follows what it is used as.
        key = row["component_type"]
        if key == "misc":
            key = MISC_RIG_TYPES.get((row["type"] or "").strip(), "misc")
        default = DEFAULT_SPOTS.get(row["location"], {}).get(key)
        if default:
            conn.execute("UPDATE items SET spot = ? WHERE id = ?", (default[0], row["id"]))


def rebuild_from_xlsx() -> dict:
    """Re-import the ground-truth sheet, replacing the database."""
    summary = migrate.rebuild()
    ensure_db()
    return summary


# --------------------------------------------------------------------------- #
# Derived item facts
#
# One place per fact, so every caller agrees on where it comes from. Diameter
# and extension travel now have columns of their own; the free-text fallbacks
# are only there for a row written before they did and never migrated.
# --------------------------------------------------------------------------- #
_DIAMETER_RE = re.compile(r"^\s*(RDM|SDM)\b", re.IGNORECASE)
_RANGE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)")


def diameter_class(item: dict) -> Optional[str]:
    """A mast's, extension's or cambered sail's RDM/SDM class.

    A hard rule twice over (CLAUDE.md "Mast diameter class"): an extension has
    to match its mast, and a cambered sail's cams have to match both. None means
    unknown, which the rules read as "don't block".
    """
    stated = (item.get("diameter") or "").strip().upper()
    if stated in ("RDM", "SDM"):
        return stated
    match = _DIAMETER_RE.match(item.get("notes") or "")
    return match.group(1).upper() if match else None


def _parse_travel(text: Optional[str]) -> tuple:
    """(min, max) out of a written range like "0-30cm". (None, None) if unreadable."""
    match = _RANGE_RE.search(text or "")
    if not match:
        return (None, None)
    return (float(match.group(1)), float(match.group(2)))


def extension_travel(item: dict) -> tuple:
    """(min_cm, max_cm) an extension travels. (None, None) when it is not known."""
    lo, hi = item.get("ext_min_cm"), item.get("ext_max_cm")
    if hi is not None:
        return (lo if lo is not None else 0.0, hi)
    return _parse_travel(item.get("size_generic"))


def item_title(item: dict) -> str:
    parts = [item.get("manufacturer") or "", item.get("model") or ""]
    return " ".join(p for p in parts if p).strip() or f"Item #{item['id']}"


def size_label(item: dict) -> str:
    """The headline size a sailor picks this kind of kit by."""
    ctype = item.get("component_type")
    if ctype in ("sail", "wing") and item.get("size_m2") is not None:
        return f"{item['size_m2']:g} m²"
    if ctype == "board" and item.get("size_l") is not None:
        return f"{item['size_l']:g} L"
    if ctype == "mast" and item.get("length_cm") is not None:
        return f"{item['length_cm']:g} cm"
    if ctype == "boom" and item.get("min_size_cm") is not None:
        return f"{item['min_size_cm']:g}-{item['max_size_cm']:g} cm"
    if ctype == "ext":
        lo, hi = extension_travel(item)
        if hi is not None:
            return f"{lo:g}-{hi:g} cm"
    if ctype == "fin" and item.get("fin_length_cm") is not None:
        return f"{item['fin_length_cm']:g} cm"
    return item.get("size_generic") or ""


# Standard mast lengths, used for the item page's worked "recommended mast +
# extension" example (CLAUDE.md: computed for display, never stored).
STANDARD_MASTS = [370, 400, 430, 460, 490, 520]


def recommended_rig(item: dict) -> Optional[dict]:
    """A worked mast + extension example for a sail, as a beginner aid.

    Picks the biggest standard mast that is not longer than the luff and lets
    the extension make up the rest. Any mast + extension totalling the luff is
    equally valid, so callers must label this a suggestion.
    """
    luff = item.get("luff_cm")
    if not luff:
        return None
    usable = [m for m in STANDARD_MASTS if m <= luff]
    if not usable:
        return None
    mast = max(usable)
    return {"mast_cm": mast, "extension_cm": round(luff - mast)}


# --------------------------------------------------------------------------- #
# Items
# --------------------------------------------------------------------------- #
def _as_type_list(component_types: Union[str, Iterable[str]]) -> list:
    if isinstance(component_types, str):
        return [component_types]
    return list(component_types)


def get_items(component_types: Union[str, Iterable[str]]) -> list:
    types = _as_type_list(component_types)
    placeholders = ", ".join("?" for _ in types)
    with connect() as conn:
        rows = conn.execute(
            f"SELECT * FROM items WHERE component_type IN ({placeholders}) "
            "ORDER BY manufacturer, model, id",
            types,
        ).fetchall()
    return [dict(r) for r in rows]


def get_item(item_id: int) -> Optional[dict]:
    with connect() as conn:
        row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    return dict(row) if row else None


def all_items(include_archived: bool = False) -> list:
    sql = "SELECT * FROM items"
    if not include_archived:
        sql += " WHERE archived = 0"
    sql += " ORDER BY id"
    with connect() as conn:
        rows = conn.execute(sql).fetchall()
    return [dict(r) for r in rows]


def get_archived_items() -> list:
    """Archived (broken / retired) items, most recently archived first."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM items WHERE archived = 1 "
            "ORDER BY archived_at DESC, manufacturer, model"
        ).fetchall()
    return [dict(r) for r in rows]


def search_items(term: str, limit: int = 10) -> list:
    """Fuzzy-ish item lookup for the search bar.

    Matches across manufacturer, model, type, diameter, location and the
    free-text notes field so odd pieces are findable by whatever the user
    remembers about them — "RDM" included, which is why diameter is searched
    now that it is a column rather than a word inside the notes.
    """
    like = f"%{term.strip()}%"
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM items WHERE manufacturer LIKE ? OR model LIKE ? "
            "OR type LIKE ? OR diameter LIKE ? OR location LIKE ? OR spot LIKE ? "
            "OR notes LIKE ? ORDER BY manufacturer, model LIMIT ?",
            (like, like, like, like, like, like, like, limit),
        ).fetchall()
    return [dict(r) for r in rows]


_WRITABLE = {"component_type", "image_path", *FIELD_META.keys()}


def add_item(record: dict) -> int:
    """Insert an item. `record` must include component_type; unknown keys are ignored."""
    clean = {k: v for k, v in record.items() if k in _WRITABLE and v not in (None, "")}
    fields = list(clean.keys())
    placeholders = ", ".join("?" for _ in fields)
    with connect() as conn:
        cur = conn.execute(
            f"INSERT INTO items ({', '.join(fields)}) VALUES ({placeholders})",
            [clean[f] for f in fields],
        )
        conn.commit()
        return cur.lastrowid


def update_item(item_id: int, record: dict) -> None:
    """Overwrite an item's fields. Anything present in `record` is written, so a
    field cleared in the edit form (which posts the whole item) is cleared here.
    """
    clean = {k: (v if v != "" else None) for k, v in record.items()
             if k in _WRITABLE and k != "component_type"}
    if not clean:
        return
    assignments = ", ".join(f"{k} = ?" for k in clean)
    with connect() as conn:
        conn.execute(f"UPDATE items SET {assignments} WHERE id = ?",
                     [*clean.values(), item_id])
        conn.commit()


def delete_item(item_id: int) -> None:
    """Committee-only. Faults, comments and ratings cascade with the row."""
    with connect() as conn:
        conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
        conn.commit()


def archive_item(item_id: int, reason: Optional[str] = None) -> None:
    """Committee-only. Retire a broken/retired item: hide it from the active
    catalogue and rig picker, keep its faults/comments/ratings history intact."""
    with connect() as conn:
        conn.execute(
            "UPDATE items SET archived = 1, archived_at = datetime('now'), "
            "archived_reason = ? WHERE id = ?",
            (reason, item_id),
        )
        conn.commit()


def unarchive_item(item_id: int) -> None:
    """Committee-only. Restore an archived item back into the active catalogue."""
    with connect() as conn:
        conn.execute(
            "UPDATE items SET archived = 0, archived_at = NULL, "
            "archived_reason = NULL WHERE id = ?",
            (item_id,),
        )
        conn.commit()


def move_items(item_ids: list, site: str, spot: Optional[str] = None) -> int:
    """Committee move / bulk-move. Overwrites location; there is no separate home."""
    if not item_ids:
        return 0
    placeholders = ", ".join("?" for _ in item_ids)
    with connect() as conn:
        cur = conn.execute(
            f"UPDATE items SET location = ?, spot = ? WHERE id IN ({placeholders})",
            [site, spot, *item_ids],
        )
        conn.execute("INSERT OR IGNORE INTO sites (name, sort) VALUES (?, 99)", (site,))
        conn.commit()
        return cur.rowcount


def spec_rows(item: dict) -> list:
    """(label, value) pairs for an item's spec table, in component-type order.

    Optional fields (e.g. notes) are omitted entirely when empty rather than
    shown as a dash, to keep the spec table tight.
    """
    fields = COMPONENT_FIELDS.get(item["component_type"], [])
    rows = []
    for f in fields:
        meta = FIELD_META[f]
        value = item.get(f)
        if meta["kind"] == "bool":
            value = "Cambered" if value else "Camless"
        elif value is None:
            if meta.get("optional"):
                continue
            value = "—"
        rows.append((meta["label"], value))
    return rows


# --------------------------------------------------------------------------- #
# Sites and spots
# --------------------------------------------------------------------------- #
def get_sites() -> list:
    with connect() as conn:
        rows = conn.execute(
            "SELECT s.name, s.lat, s.lon, "
            "  (SELECT COUNT(*) FROM items i WHERE i.location = s.name "
            "     AND i.archived = 0) AS n_items "
            "FROM sites s ORDER BY s.sort, s.name"
        ).fetchall()
    return [dict(r) for r in rows]


def site_coords(name: Optional[str]) -> Optional[tuple]:
    """The forecast pin for a named site, or None. What wind.py resolves a trip
    destination or a logbook site to before it asks Open-Meteo for a forecast."""
    if not name:
        return None
    with connect() as conn:
        row = conn.execute(
            "SELECT lat, lon FROM sites WHERE name = ? "
            "AND lat IS NOT NULL AND lon IS NOT NULL", (name.strip(),)
        ).fetchone()
    return (row["lat"], row["lon"]) if row else None


def set_site_coords(name: str, lat: Optional[float], lon: Optional[float]) -> None:
    """Committee action. Sets (or clears, with None) a site's forecast pin."""
    with connect() as conn:
        conn.execute("UPDATE sites SET lat = ?, lon = ? WHERE name = ?",
                     (lat, lon, (name or "").strip()))
        conn.commit()


def add_site(name: str) -> None:
    """Committee action. Adding inline while moving kit is what keeps the
    catalogue filter free of "Notts" vs "Nottingham" drift."""
    with connect() as conn:
        conn.execute("INSERT OR IGNORE INTO sites (name, sort) VALUES (?, 99)", (name.strip(),))
        conn.commit()


def get_spots(site: Optional[str] = None) -> list:
    query = "SELECT site, name, description, image_path FROM spots"
    params = []
    if site:
        query += " WHERE site = ?"
        params.append(site)
    query += " ORDER BY site, name"
    with connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def spot_description(site: Optional[str], spot: Optional[str]) -> Optional[str]:
    if not site or not spot:
        return None
    with connect() as conn:
        row = conn.execute(
            "SELECT description FROM spots WHERE site = ? AND name = ?", (site, spot)
        ).fetchone()
    return row["description"] if row else None


def upsert_spot(site: str, name: str, description: Optional[str],
                image_path: Optional[str]) -> None:
    """Committee action: write (or overwrite) the note and photo for one spot.

    Keyed by (site, name), the same pair `items.spot` points at by string. This
    is the only way a spot's description or photo is set from the app; before
    it, both were seed data only.
    """
    site = (site or "").strip()
    name = (name or "").strip()
    if not site or not name:
        raise ValueError("A spot needs both a site and a name.")
    with connect() as conn:
        conn.execute(
            "INSERT INTO spots (site, name, description, image_path) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT (site, name) DO UPDATE SET "
            "  description = excluded.description, "
            "  image_path = excluded.image_path",
            (site, name, (description or "").strip() or None, image_path or None),
        )
        conn.commit()


# --------------------------------------------------------------------------- #
# Users and accounts
#
# An account is username + password. The hash never leaves this module: every
# function here returns the PUBLIC shape of a member (id, username,
# display_name, is_admin, image_path), so no caller can leak a hash by
# forwarding a row.
# --------------------------------------------------------------------------- #
PUBLIC_USER = "id, username, display_name, is_admin, image_path"

# PBKDF2-HMAC-SHA256 from the standard library. No argon2/bcrypt dependency for
# a club app that has to install from a laptop by a lake; the round count is
# what does the work, and is stored per-hash so it can be raised later without
# invalidating anybody's password.
PBKDF2_ROUNDS = 260_000

USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,23}$")
# Deliberately only "not empty". This guards a club kit list, not anything
# worth stealing, and the members setting one up are standing in a car park in
# the cold; the length rule bought nothing and turned people away at sign-up.
MIN_PASSWORD = 1

# Sign-ins last a term. A member sets this up once at the start of the year and
# is not asked again at the water's edge with cold hands.
SESSION_DAYS = 120


class AccountError(ValueError):
    """A sign-up or password change the member has to fix. The message is shown
    to them verbatim, so it is written as a sentence."""


def normalise_username(username: str) -> str:
    return (username or "").strip().lower()


def check_username(username: str) -> str:
    """Return the storable username, or raise AccountError saying what is wrong."""
    name = normalise_username(username)
    if not name:
        raise AccountError("Pick a username.")
    if not USERNAME_RE.match(name):
        raise AccountError(
            "A username is 3 to 24 characters: letters, numbers, dots, dashes "
            "or underscores, starting with a letter or number."
        )
    return name


def check_password(password: str) -> str:
    if len(password or "") < MIN_PASSWORD:
        raise AccountError("Pick a password.")
    return password


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(),
                                 PBKDF2_ROUNDS).hex()
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${salt}${digest}"


def verify_password(stored: Optional[str], password: str) -> bool:
    """Constant-time check of a password against a stored hash."""
    if not stored or not password:
        return False
    try:
        algorithm, rounds, salt, digest = stored.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        got = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(),
                                  int(rounds)).hex()
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got, digest)


def get_users() -> list:
    with connect() as conn:
        rows = conn.execute(
            f"SELECT {PUBLIC_USER} FROM users ORDER BY display_name, username"
        ).fetchall()
    return [dict(r) for r in rows]


def get_user(user_id: int) -> Optional[dict]:
    with connect() as conn:
        row = conn.execute(
            f"SELECT {PUBLIC_USER} FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    return dict(row) if row else None


def get_user_by_username(username: str) -> Optional[dict]:
    with connect() as conn:
        row = conn.execute(
            f"SELECT {PUBLIC_USER} FROM users WHERE username = ?",
            (normalise_username(username),),
        ).fetchone()
    return dict(row) if row else None


def create_user(username: str, password: str, display_name: str = "",
                is_admin: bool = False) -> dict:
    """Sign somebody up. Raises AccountError for anything they can fix."""
    name = check_username(username)
    check_password(password)
    display = (display_name or "").strip() or name
    with connect() as conn:
        taken = conn.execute("SELECT id FROM users WHERE username = ?", (name,)).fetchone()
        if taken:
            raise AccountError("That username is taken. Try another one.")
        cur = conn.execute(
            "INSERT INTO users (username, display_name, is_admin, password_hash) "
            "VALUES (?, ?, ?, ?)",
            (name, display, 1 if is_admin else 0, hash_password(password)),
        )
        conn.commit()
        return dict(conn.execute(
            f"SELECT {PUBLIC_USER} FROM users WHERE id = ?", (cur.lastrowid,)
        ).fetchone())


def authenticate(username: str, password: str) -> Optional[dict]:
    """The member behind these credentials, or None. Never says which half failed."""
    with connect() as conn:
        row = conn.execute(
            f"SELECT {PUBLIC_USER}, password_hash FROM users WHERE username = ?",
            (normalise_username(username),),
        ).fetchone()
    if not row or not verify_password(row["password_hash"], password):
        return None
    user = dict(row)
    user.pop("password_hash", None)
    return user


def set_password(user_id: int, password: str) -> None:
    check_password(password)
    with connect() as conn:
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?",
                     (hash_password(password), user_id))
        conn.commit()


def check_current_password(user_id: int, password: str) -> bool:
    """Does this member's own password match? Used to gate a password change."""
    with connect() as conn:
        row = conn.execute("SELECT password_hash FROM users WHERE id = ?",
                           (user_id,)).fetchone()
    return bool(row) and verify_password(row["password_hash"], password)


def set_display_name(user_id: int, display_name: str) -> Optional[dict]:
    name = (display_name or "").strip()
    if not name:
        raise AccountError("A display name cannot be blank.")
    with connect() as conn:
        conn.execute("UPDATE users SET display_name = ? WHERE id = ?", (name, user_id))
        conn.commit()
    return get_user(user_id)


def set_avatar(user_id: int, image_path: Optional[str]) -> Optional[dict]:
    """Set the member's profile photo, or clear it with None."""
    with connect() as conn:
        conn.execute("UPDATE users SET image_path = ? WHERE id = ?",
                     (image_path or None, user_id))
        conn.commit()
    return get_user(user_id)


def member_avatars() -> dict:
    """`{display_name: image_path}` for the members who have set a photo.

    How a member's picture reaches every place their name is shown (a comment,
    a fault report) without threading a user id through each of those rows:
    the name is matched to the photo on render. Two members with the same
    display name would share an avatar; for a club roster that is rare and
    low-stakes.
    """
    with connect() as conn:
        rows = conn.execute(
            "SELECT display_name, username, image_path FROM users "
            "WHERE image_path IS NOT NULL"
        ).fetchall()
    out = {}
    for row in rows:
        for key in (row["display_name"], row["username"]):
            if key:
                out[key] = row["image_path"]
    return out


def set_admin(user_id: int, is_admin: bool) -> Optional[dict]:
    """Make somebody committee, or stand them down.

    Standing down the last admin would lock the club out of every committee
    action with no way back except manage.py, so it is refused here.
    """
    with connect() as conn:
        if not is_admin:
            others = conn.execute(
                "SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND id != ?",
                (user_id,)
            ).fetchone()["n"]
            if not others:
                raise AccountError("That is the only committee account left. "
                                   "Make somebody else committee first.")
        conn.execute("UPDATE users SET is_admin = ? WHERE id = ?",
                     (1 if is_admin else 0, user_id))
        conn.commit()
    return get_user(user_id)


def member_admin_list() -> list:
    """The roster as the committee's members screen shows it: who can sign in,
    who is committee, and how much each account has actually done."""
    with connect() as conn:
        rows = conn.execute(f"""
            SELECT {PUBLIC_USER},
                   users.created_at,
                   users.last_seen_at,
                   users.password_hash IS NOT NULL AS has_password,
                   (SELECT COUNT(*) FROM sessions s WHERE s.user_id = users.id)
                       AS n_sessions,
                   (SELECT COUNT(*) FROM ratings r
                     WHERE r.user_id = users.id AND r.voided_at IS NULL)
                       AS n_ratings
            FROM users ORDER BY users.is_admin DESC, display_name, username
        """).fetchall()
    return [dict(r) for r in rows]


# --------------------------------------------------------------------------- #
# Sign-in sessions
#
# The cookie holds a random token; the table holds only its SHA-256, so a leaked
# database is not a set of working sign-ins. Every request looks the token up,
# which is what makes a sign-in revocable: the old signed cookie could not be.
# --------------------------------------------------------------------------- #
def _token_hash(token: str) -> str:
    return hashlib.sha256((token or "").encode()).hexdigest()


def start_session(user_id: int, user_agent: str = "") -> str:
    """Sign this device in and return the token to put in the cookie."""
    token = secrets.token_urlsafe(32)
    with connect() as conn:
        conn.execute(
            "INSERT INTO auth_sessions (token_hash, user_id, user_agent, expires_at) "
            "VALUES (?, ?, ?, datetime('now', ?))",
            (_token_hash(token), user_id, (user_agent or "")[:200],
             f"+{SESSION_DAYS} days"),
        )
        conn.execute("DELETE FROM auth_sessions WHERE expires_at < datetime('now')")
        conn.commit()
    return token


def session_user(token: str) -> Optional[dict]:
    """The member this token signs in, or None. Renews the session as it goes."""
    if not token:
        return None
    digest = _token_hash(token)
    with connect() as conn:
        row = conn.execute(
            f"SELECT u.id, u.username, u.display_name, u.is_admin, u.image_path, "
            "a.id AS session_id "
            "FROM auth_sessions a JOIN users u ON u.id = a.user_id "
            "WHERE a.token_hash = ? AND a.expires_at > datetime('now')",
            (digest,),
        ).fetchone()
        if not row:
            return None
        # Sliding expiry: somebody who uses the app keeps their sign-in, and an
        # account that goes quiet for a term is signed out on its own.
        conn.execute(
            "UPDATE auth_sessions SET last_seen_at = datetime('now'), "
            "expires_at = datetime('now', ?) WHERE id = ?",
            (f"+{SESSION_DAYS} days", row["session_id"]),
        )
        conn.execute("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?",
                     (row["id"],))
        conn.commit()
    user = dict(row)
    user.pop("session_id", None)
    return user


def end_session(token: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?",
                     (_token_hash(token),))
        conn.commit()


def end_all_sessions(user_id: int) -> int:
    """Sign a member out everywhere. Used after a password change."""
    with connect() as conn:
        cur = conn.execute("DELETE FROM auth_sessions WHERE user_id = ?", (user_id,))
        conn.commit()
        return cur.rowcount


def session_count(user_id: int) -> int:
    with connect() as conn:
        return conn.execute(
            "SELECT COUNT(*) AS n FROM auth_sessions "
            "WHERE user_id = ? AND expires_at > datetime('now')", (user_id,)
        ).fetchone()["n"]


# --------------------------------------------------------------------------- #
# Faults
# --------------------------------------------------------------------------- #
def get_faults(item_id: int, status: Optional[str] = None) -> list:
    query = "SELECT * FROM faults WHERE item_id = ?"
    params = [item_id]
    if status:
        query += " AND status = ?"
        params.append(status)
    query += " ORDER BY created_at DESC, id DESC"
    with connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def open_faults_by_item() -> dict:
    """{item_id: [fault, ...]} for every open fault, for list and grid badges."""
    out = {}
    with connect() as conn:
        for row in conn.execute(
            "SELECT id, item_id, title, description, severity FROM faults "
            "WHERE status = 'open' ORDER BY severity DESC, id"
        ):
            out.setdefault(row["item_id"], []).append(dict(row))
    return out


def report_fault(item_id: int, title: str, description: str,
                 severity: str = "usable", reported_by: Optional[str] = None,
                 image_path: Optional[str] = None) -> int:
    """Any logged-in member can report. The report is also the first timeline event."""
    if severity not in ("usable", "out_of_action"):
        severity = "usable"
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO faults (item_id, title, description, severity, image_path, "
            "reported_by) VALUES (?, ?, ?, ?, ?, ?)",
            (item_id, title, description, severity, image_path, reported_by),
        )
        fault_id = cur.lastrowid
        conn.execute(
            "INSERT INTO fault_events (fault_id, kind, body, image_path, author) "
            "VALUES (?, 'reported', ?, ?, ?)",
            (fault_id, description, image_path, reported_by),
        )
        conn.commit()
        return fault_id


def report_fix(fault_id: int, body: str, author: Optional[str] = None,
               image_path: Optional[str] = None) -> int:
    """A member says they repaired it. This does NOT clear the fault — clearing
    is committee-only, so the fault stays open and reads as awaiting sign-off."""
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO fault_events (fault_id, kind, body, image_path, author) "
            "VALUES (?, 'fix_reported', ?, ?, ?)",
            (fault_id, body, image_path, author),
        )
        conn.commit()
        return cur.lastrowid


def clear_fault(fault_id: int, cleared_by: Optional[str] = None) -> None:
    """Committee-only, behind the shared PIN."""
    with connect() as conn:
        conn.execute(
            "UPDATE faults SET status = 'cleared', cleared_by = ?, "
            "cleared_at = datetime('now') WHERE id = ?",
            (cleared_by, fault_id),
        )
        conn.execute(
            "INSERT INTO fault_events (fault_id, kind, body, author) "
            "VALUES (?, 'cleared', 'Closed by committee.', ?)",
            (fault_id, cleared_by),
        )
        conn.commit()


def reopen_fault(fault_id: int, author: Optional[str] = None, body: str = "") -> None:
    with connect() as conn:
        conn.execute("UPDATE faults SET status = 'open', cleared_by = NULL, "
                     "cleared_at = NULL WHERE id = ?", (fault_id,))
        conn.execute(
            "INSERT INTO fault_events (fault_id, kind, body, author) "
            "VALUES (?, 'reopened', ?, ?)",
            (fault_id, body or "The fix did not hold.", author),
        )
        conn.commit()


def fault_events(fault_id: int) -> list:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM fault_events WHERE fault_id = ? ORDER BY created_at, id",
            (fault_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def fault_history(item_id: int) -> list:
    """Every fault on an item with its full timeline, newest fault first.

    This is the "fault and fix history you can look up" on the item page:
    cleared faults stay, because what has gone wrong before is the point.
    """
    out = []
    for fault in get_faults(item_id):
        fault = dict(fault)
        fault["events"] = fault_events(fault["id"])
        fault["awaiting_signoff"] = (
            fault["status"] == "open"
            and any(e["kind"] == "fix_reported" for e in fault["events"])
        )
        out.append(fault)
    return out


# --------------------------------------------------------------------------- #
# Ratings: one thumb per member per item, displayed as stars
# --------------------------------------------------------------------------- #
def _stars(up: int, down: int) -> Optional[float]:
    """1 + 4 x fraction-up, so all up is 5 and all down is 1, never a blank 0."""
    total = up + down
    if not total:
        return None
    return round(1 + 4 * up / total, 1)


# Each member's LATEST live rating, one row per member per item. Everything that
# turns ratings into a score reads this rather than `ratings` itself.
#
# `ratings` keeps every rating a member ever gave a piece of kit, because they
# are asked again after every session on it (schema.sql). Counting all of those
# would let one enthusiast's twelve sails on the same board decide its score, so
# the tally takes each member's most recent one and the rest stay as history:
# the evidence the committee needs to strike out a spammer, and the record the
# rig wizard learns a member's taste from.
#
# A rating with no member behind it (imported, or an account since deleted)
# cannot be grouped by member, so each such row stands on its own.
_LIVE_VOTES = """
    SELECT item_id, user_id, vote, created_at FROM (
        SELECT item_id, user_id, vote, created_at,
               ROW_NUMBER() OVER (
                   PARTITION BY item_id, COALESCE(user_id, -id)
                   ORDER BY created_at DESC, id DESC) AS rn
        FROM ratings WHERE voided_at IS NULL
    ) WHERE rn = 1
"""

# The same question asked about one member: "which of these did I rate?".
#
# Worth its own copy rather than filtering _LIVE_VOTES afterwards. Filtering
# after the window function means ranking every rating in the club's history
# and throwing all but one member's away, which is a full scan and a sort on
# every catalogue load; filtering before it uses idx_ratings_user and reads
# only that member's rows. The answer is identical because the partition is
# already per member (item_id, user_id), so no member's rows can affect the
# ranking inside another's partition. Measured at 200 members and 40k
# ratings: 44 ms before, 0.2 ms after, with byte-identical results for every
# member.
_LIVE_VOTES_MINE = """
    SELECT item_id, user_id, vote, created_at FROM (
        SELECT item_id, user_id, vote, created_at,
               ROW_NUMBER() OVER (
                   PARTITION BY item_id, COALESCE(user_id, -id)
                   ORDER BY created_at DESC, id DESC) AS rn
        FROM ratings WHERE voided_at IS NULL AND user_id = :user_id
    ) WHERE rn = 1
"""


def _tally(up: int, down: int, mine=None) -> dict:
    return {"up": up, "down": down, "n": up + down, "stars": _stars(up, down),
            "mine": mine}


def rating_for(item_id: int, user_id: Optional[int] = None) -> dict:
    with connect() as conn:
        row = conn.execute(
            f"SELECT SUM(vote = 1) AS up, SUM(vote = -1) AS down "
            f"FROM ({_LIVE_VOTES}) WHERE item_id = ?", (item_id,)
        ).fetchone()
        mine = None
        if user_id:
            got = conn.execute(
                f"SELECT vote FROM ({_LIVE_VOTES_MINE}) WHERE item_id = :item_id",
                {"user_id": user_id, "item_id": item_id},
            ).fetchone()
            mine = got["vote"] if got else None
    return _tally(row["up"] or 0, row["down"] or 0, mine)


def ratings_by_item(user_id: Optional[int] = None) -> dict:
    """Every item's tally at once, for the catalogue's cards."""
    out = {}
    with connect() as conn:
        for row in conn.execute(
            f"SELECT item_id, SUM(vote = 1) AS up, SUM(vote = -1) AS down "
            f"FROM ({_LIVE_VOTES}) GROUP BY item_id"
        ):
            out[row["item_id"]] = _tally(row["up"] or 0, row["down"] or 0)
        if user_id:
            for row in conn.execute(
                f"SELECT item_id, vote FROM ({_LIVE_VOTES_MINE})",
                {"user_id": user_id}
            ):
                if row["item_id"] in out:
                    out[row["item_id"]]["mine"] = row["vote"]
    return out


def set_vote(item_id: int, user_id: int, vote: Optional[int],
             session_id: Optional[int] = None) -> dict:
    """Record a member's rating of an item, or withdraw it.

    Rating the same piece again after another session is normal and does not
    overwrite anything: the new rating is appended and becomes the one that
    counts, while the old one stays as history. `vote` of None (or 0) withdraws
    the member's rating, which is also kept, marked withdrawn rather than deleted.
    """
    with connect() as conn:
        if vote in (None, 0):
            conn.execute(
                "UPDATE ratings SET voided_at = datetime('now'), voided_by = ?, "
                "void_reason = 'withdrawn' "
                "WHERE item_id = ? AND user_id = ? AND voided_at IS NULL",
                (user_id, item_id, user_id),
            )
        else:
            conn.execute(
                "INSERT INTO ratings (user_id, item_id, vote, session_id) "
                "VALUES (?, ?, ?, ?)",
                (user_id, item_id, 1 if vote > 0 else -1, session_id),
            )
        conn.commit()
    return rating_for(item_id, user_id)


def rating_history(item_id: int, limit: int = 50) -> list:
    """Every rating an item has had, newest first, with who and when."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT r.*, u.display_name AS user_name FROM ratings r "
            "LEFT JOIN users u ON u.id = r.user_id "
            "WHERE r.item_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT ?",
            (item_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def member_ratings(user_id: int, limit: int = 200) -> list:
    """One member's rating history, for their profile and for moderation."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT r.id, r.item_id, r.vote, r.created_at, r.voided_at, r.void_reason, "
            "       i.manufacturer, i.model, i.component_type "
            "FROM ratings r LEFT JOIN items i ON i.id = r.item_id "
            "WHERE r.user_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def void_member_ratings(user_id: int, by_user_id: int) -> int:
    """Strike out every live rating one member has given.

    The committee's answer to somebody spamming 👍/👎 to move the club's numbers.
    Nothing is deleted: the rows are marked, the tally stops counting them, and
    restore_member_ratings puts them back if it was the wrong call.
    """
    with connect() as conn:
        cur = conn.execute(
            "UPDATE ratings SET voided_at = datetime('now'), voided_by = ?, "
            "void_reason = 'moderated' WHERE user_id = ? AND voided_at IS NULL",
            (by_user_id, user_id),
        )
        conn.commit()
        return cur.rowcount


def restore_member_ratings(user_id: int) -> int:
    """Undo a moderation. A rating the member withdrew themselves stays withdrawn."""
    with connect() as conn:
        cur = conn.execute(
            "UPDATE ratings SET voided_at = NULL, voided_by = NULL, void_reason = NULL "
            "WHERE user_id = ? AND void_reason = 'moderated'",
            (user_id,),
        )
        conn.commit()
        return cur.rowcount


# --------------------------------------------------------------------------- #
# Favourites: kit a member has bookmarked
# --------------------------------------------------------------------------- #
def favourite_ids(user_id: Optional[int]) -> set:
    if not user_id:
        return set()
    with connect() as conn:
        return {r["item_id"] for r in conn.execute(
            "SELECT item_id FROM favourites WHERE user_id = ?", (user_id,))}


def is_favourite(item_id: int, user_id: Optional[int]) -> bool:
    if not user_id:
        return False
    with connect() as conn:
        return bool(conn.execute(
            "SELECT 1 FROM favourites WHERE user_id = ? AND item_id = ?",
            (user_id, item_id)).fetchone())


def set_favourite(item_id: int, user_id: int, on: bool) -> bool:
    with connect() as conn:
        if on:
            conn.execute(
                "INSERT OR IGNORE INTO favourites (user_id, item_id) VALUES (?, ?)",
                (user_id, item_id))
        else:
            conn.execute("DELETE FROM favourites WHERE user_id = ? AND item_id = ?",
                         (user_id, item_id))
        conn.commit()
    return bool(on)


def favourite_items(user_id: int) -> list:
    with connect() as conn:
        rows = conn.execute(
            "SELECT i.*, f.created_at AS favourited_at FROM favourites f "
            "JOIN items i ON i.id = f.item_id WHERE f.user_id = ? "
            "ORDER BY f.created_at DESC", (user_id,)
        ).fetchall()
    return [dict(r) for r in rows]


# --------------------------------------------------------------------------- #
# Comments (members' notes on a piece of kit)
# --------------------------------------------------------------------------- #
def get_comments(item_id: int, kind: Optional[str] = None) -> list:
    """All comments for an item, newest first. Optionally filter by kind."""
    query = ("SELECT c.*, u.display_name AS user_name FROM comments c "
             "LEFT JOIN users u ON u.id = c.user_id WHERE c.item_id = ?")
    params = [item_id]
    if kind:
        query += " AND c.kind = ?"
        params.append(kind)
    query += " ORDER BY c.created_at DESC, c.id DESC"
    with connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def add_comment(item_id: int, body: str, kind: str = "note",
                author: Optional[str] = None, stars: Optional[int] = None,
                used_on: Optional[str] = None, image_path: Optional[str] = None,
                user_id: Optional[int] = None) -> int:
    """Add a timestamped comment/usage-log/review/damage note to an item."""
    if kind not in COMMENT_KINDS:
        kind = "note"
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO comments (item_id, kind, body, stars, author, user_id, "
            "used_on, image_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (item_id, kind, body, stars, author, user_id, used_on, image_path),
        )
        conn.commit()
        return cur.lastrowid


def comments_by_item(limit_each: int = 2) -> dict:
    """The most recent note or two per item, for the rig setup screen's cards."""
    out = {}
    with connect() as conn:
        for row in conn.execute(
            "SELECT c.item_id, c.body, COALESCE(u.display_name, c.author) AS who "
            "FROM comments c LEFT JOIN users u ON u.id = c.user_id "
            "ORDER BY c.created_at DESC, c.id DESC"
        ):
            bucket = out.setdefault(row["item_id"], [])
            if len(bucket) < limit_each:
                bucket.append({"body": row["body"], "who": row["who"]})
    return out


def comment_summary(item_id: int) -> dict:
    """Count of comments and the average review rating for an item."""
    with connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS count, AVG(stars) AS avg_stars, "
            "COUNT(stars) AS n_reviews FROM comments WHERE item_id = ?",
            (item_id,),
        ).fetchone()
    return {
        "count": row["count"],
        "avg_stars": round(row["avg_stars"], 1) if row["avg_stars"] is not None else None,
        "n_reviews": row["n_reviews"],
    }


# --------------------------------------------------------------------------- #
# Setups: the rig a member is currently out on
# --------------------------------------------------------------------------- #
ROLE_LABELS = {"sail": "Sail", "mast": "Mast", "ext": "Extension", "boom": "Boom",
               "board": "Board", "fin": "Fin", "uj": "Base",
               # Only a trip packs these: a wing rigs on nothing and a foil is
               # chosen outright, so the rig wizard has no slot for either.
               "wing": "Wing", "foil": "Foil"}
ROLE_ORDER = ["sail", "mast", "ext", "boom", "board", "fin", "uj"]


def _setup_row(conn: sqlite3.Connection, setup_id: int) -> Optional[dict]:
    row = conn.execute("SELECT * FROM setups WHERE id = ?", (setup_id,)).fetchone()
    if not row:
        return None
    setup = dict(row)
    setup["pieces"] = []
    for piece in conn.execute(
        "SELECT * FROM setup_items WHERE setup_id = ?", (setup_id,)
    ):
        piece = dict(piece)
        piece["custom"] = json.loads(piece["custom"]) if piece["custom"] else None
        piece["settings"] = json.loads(piece["settings"]) if piece["settings"] else {}
        setup["pieces"].append(piece)
    setup["pieces"].sort(key=lambda p: ROLE_ORDER.index(p["role"])
                         if p["role"] in ROLE_ORDER else 99)
    return setup


def current_setup(user_id: int, statuses=("active", "derigged")) -> Optional[dict]:
    """The member's live setup: what they are out on, or de-rigged but unlogged."""
    placeholders = ", ".join("?" for _ in statuses)
    with connect() as conn:
        row = conn.execute(
            f"SELECT id FROM setups WHERE user_id = ? AND status IN ({placeholders}) "
            "ORDER BY id DESC LIMIT 1",
            [user_id, *statuses],
        ).fetchone()
        return _setup_row(conn, row["id"]) if row else None


def save_setup(user_id: int, site: Optional[str], pieces: list,
               trip_id: Optional[int] = None) -> dict:
    """Start a new active setup, replacing any earlier one for this member.

    One active setup at a time: the previous one is binned here, and the UI is
    what asks first whether it should be logged instead. `trip_id` is set when
    the rig was built with a club trip as the chosen location, so the logbook
    can pull wind for the trip's pin after a de-rig.
    """
    with connect() as conn:
        conn.execute(
            "UPDATE setups SET status = 'binned' WHERE user_id = ? AND status = 'active'",
            (user_id,),
        )
        cur = conn.execute(
            "INSERT INTO setups (user_id, status, site, trip_id) "
            "VALUES (?, 'active', ?, ?)",
            (user_id, site, trip_id),
        )
        setup_id = cur.lastrowid
        for piece in pieces:
            role = piece.get("role")
            if role not in ROLE_ORDER:
                continue
            conn.execute(
                "INSERT INTO setup_items (setup_id, role, item_id, custom, settings) "
                "VALUES (?, ?, ?, ?, ?)",
                (setup_id, role, piece.get("item_id"),
                 json.dumps(piece["custom"]) if piece.get("custom") else None,
                 json.dumps(piece.get("settings") or {})),
            )
        conn.commit()
        return _setup_row(conn, setup_id)


def derig_setup(setup_id: int) -> Optional[dict]:
    """Mark a setup put away. Changes no item locations — rigging never moved them."""
    with connect() as conn:
        conn.execute(
            "UPDATE setups SET status = 'derigged', derigged_at = datetime('now') "
            "WHERE id = ? AND status = 'active'", (setup_id,)
        )
        conn.commit()
        return _setup_row(conn, setup_id)


def close_setup(setup_id: int, status: str = "logged") -> None:
    with connect() as conn:
        conn.execute("UPDATE setups SET status = ? WHERE id = ?", (status, setup_id))
        conn.commit()


# --------------------------------------------------------------------------- #
# Trips: the kit packed for a trip away, and the list it is checked back against
#
# A trip never moves anything. `items.location` is where a piece is stored and
# stays that for the whole trip, so ending a trip is simply letting go of kit
# that never left its rack. "Away" is not a location, it is membership of a
# trip that is being loaded or is out, which is what `away_item_ids` answers.
# --------------------------------------------------------------------------- #
TRIP_ROLE_ORDER = ["sail", "mast", "ext", "boom", "board", "fin", "uj",
                   "wing", "foil"]

# The four stages a trip walks, plus the one it can be called off into. The
# order here is the order the Trips index groups them in, which is why it is a
# list and not a set: a trip being asked about is the one you are most likely to
# have opened the tab for, and a finished one the least.
TRIP_STAGES = ["requesting", "packing", "active", "done", "cancelled"]

# Kit is away for the middle two and only those. Not while a trip is being
# asked about (a request reserves nothing), and not once it is done.
TRIP_AWAY_STAGES = ("packing", "active")

_STAGE_SORT = {stage: i for i, stage in enumerate(TRIP_STAGES)}


class TripError(ValueError):
    """Something the kit sec has to resolve. Shown to them verbatim."""


def _trip_row(conn: sqlite3.Connection, trip_id: int) -> Optional[dict]:
    row = conn.execute("SELECT * FROM trips WHERE id = ?", (trip_id,)).fetchone()
    if not row:
        return None
    trip = dict(row)
    trip["items"] = [dict(r) for r in conn.execute(
        "SELECT * FROM trip_items WHERE trip_id = ?", (trip_id,))]
    trip["items"].sort(key=lambda i: (TRIP_ROLE_ORDER.index(i["role"])
                                      if i["role"] in TRIP_ROLE_ORDER else 99,
                                      i["id"]))
    # Every count below is of kit the trip is actually taking. A declined row
    # is a record of an answer, not a piece on the trailer, so it is counted
    # separately and never in the totals a checklist is measured against.
    live = [i for i in trip["items"] if not i["declined"]]
    trip["n_items"] = len(live)
    trip["n_packed"] = sum(1 for i in live if i["packed"])
    trip["n_returned"] = sum(1 for i in live if i["returned"])
    trip["n_declined"] = sum(1 for i in trip["items"] if i["declined"])
    return trip


def get_trips(status: Optional[str] = None) -> list:
    """Every trip, in stage order: being asked about first, done last.

    Each carries how far through its checklist it is and how many requests it
    has taken, which is what the index rows read out under the name.
    """
    # Both tallies are subqueries rather than joins: joining trip_votes as well
    # would fan the item rows out by the number of requests and quietly break
    # the packed/returned counts the list is mostly here to show.
    query = ("SELECT t.*, u.display_name AS created_by_name, "
             "       (SELECT COUNT(*) FROM trip_items ti "
             "          WHERE ti.trip_id = t.id AND ti.declined = 0) AS n_items, "
             "       (SELECT COUNT(*) FROM trip_items ti "
             "          WHERE ti.trip_id = t.id AND ti.declined = 0 "
             "            AND ti.packed = 1) AS n_packed, "
             "       (SELECT COUNT(*) FROM trip_items ti "
             "          WHERE ti.trip_id = t.id AND ti.declined = 0 "
             "            AND ti.returned = 1) AS n_returned, "
             "       (SELECT COUNT(DISTINCT tv.item_id) FROM trip_votes tv "
             "          WHERE tv.trip_id = t.id) AS n_requests "
             "FROM trips t LEFT JOIN users u ON u.id = t.created_by ")
    params: list = []
    if status:
        query += "WHERE t.status = ? "
        params.append(status)
    query += "ORDER BY t.id DESC"
    with connect() as conn:
        trips = [dict(r) for r in conn.execute(query, params)]
    trips.sort(key=lambda t: (_STAGE_SORT.get(t["status"], 99), -t["id"]))
    return trips


def get_trip(trip_id: int) -> Optional[dict]:
    with connect() as conn:
        return _trip_row(conn, trip_id)


def _write_items(conn: sqlite3.Connection, trip_id: int, items: list) -> None:
    """Replace a trip's kit, keeping the ticks already made and the declines.

    Editing a packed list mid-trip is normal (something would not fit, somebody
    threw an extra board in), and a piece already ticked on or back should not
    un-tick itself because the list around it was re-saved. Declined rows are
    not part of the list at all — they are the record of an answer — so they are
    left where they are unless the piece is now being taken after all.
    """
    ticked = {r["item_id"]: (r["packed"], r["returned"]) for r in conn.execute(
        "SELECT item_id, packed, returned FROM trip_items "
        "WHERE trip_id = ? AND declined = 0", (trip_id,))}
    clashes = _away(conn, exclude_trip_id=trip_id)
    conn.execute("DELETE FROM trip_items WHERE trip_id = ? AND declined = 0",
                 (trip_id,))
    seen = set()
    for entry in items:
        item_id = entry.get("item_id")
        if item_id is None or item_id in seen:
            continue
        if item_id in clashes:
            raise TripError(f"{_item_title_by_id(conn, item_id)} is already packed "
                            f"for {clashes[item_id]}.")
        seen.add(item_id)
        role = entry.get("role")
        packed, returned = ticked.get(item_id, (0, 0))
        # Taking a piece that was turned down earlier is the kit sec changing
        # their mind, and the decline has to go or the UNIQUE below refuses it.
        conn.execute("DELETE FROM trip_items WHERE trip_id = ? AND item_id = ?",
                     (trip_id, item_id))
        conn.execute(
            "INSERT INTO trip_items (trip_id, item_id, role, source, packed, "
            "                        returned, note) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (trip_id, item_id, role if role in TRIP_ROLE_ORDER else None,
             "chosen" if entry.get("source") == "chosen" else "derived",
             packed, returned, entry.get("note")),
        )


def _item_title_by_id(conn: sqlite3.Connection, item_id: int) -> str:
    row = conn.execute("SELECT manufacturer, model FROM items WHERE id = ?",
                       (item_id,)).fetchone()
    return item_title(dict(row)) if row else f"Item {item_id}"


def _coord(value) -> Optional[float]:
    """A latitude or longitude as a float, or None for anything unparseable or
    out of range — the client sends a pin or it sends nothing."""
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    return num if -180.0 <= num <= 180.0 else None


def create_trip(user_id: int, name: str, items: list,
                destination: Optional[str] = None,
                starts_on: Optional[str] = None,
                ends_on: Optional[str] = None,
                requesting: bool = True,
                notes: Optional[str] = None,
                image_path: Optional[str] = None,
                lat: Optional[float] = None,
                lon: Optional[float] = None) -> Optional[dict]:
    """Start a trip, either open for requests or straight into packing.

    `requesting` is the kit sec's answer to "let members request kit first" on
    the new-trip form. Either way the trip can be created with kit already on
    it — the form has an Add kit button — which is the pieces the kit sec knows
    are going before anybody asks.
    """
    name = (name or "").strip()
    if not name:
        raise TripError("Give the trip a name.")
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO trips (name, destination, lat, lon, starts_on, ends_on, "
            "                   notes, image_path, created_by, status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (name, (destination or "").strip() or None,
             _coord(lat), _coord(lon), starts_on or None,
             ends_on or None, (notes or "").strip() or None, image_path or None,
             user_id, "requesting" if requesting else "packing"),
        )
        trip_id = cur.lastrowid
        _write_items(conn, trip_id, items or [])
        conn.commit()
        return _trip_row(conn, trip_id)


def set_trip_items(trip_id: int, items: list) -> Optional[dict]:
    """Save a trip's kit. What the picker and the packing wizard both write."""
    with connect() as conn:
        _write_items(conn, trip_id, items or [])
        conn.commit()
        return _trip_row(conn, trip_id)


def add_trip_items(trip_id: int, items: list) -> Optional[dict]:
    """Add to a trip's kit without disturbing the rest of it.

    The picker sheet adds a piece at a time, and a full replace from a browser
    holding a stale list is how a trip quietly loses the board somebody else
    added while the sheet was open.
    """
    with connect() as conn:
        clashes = _away(conn, exclude_trip_id=trip_id)
        for entry in items or []:
            item_id = entry.get("item_id")
            if item_id is None:
                continue
            if item_id in clashes:
                raise TripError(f"{_item_title_by_id(conn, item_id)} is already "
                                f"packed for {clashes[item_id]}.")
            role = entry.get("role")
            conn.execute("DELETE FROM trip_items WHERE trip_id = ? AND item_id = ?",
                         (trip_id, item_id))
            conn.execute(
                "INSERT INTO trip_items (trip_id, item_id, role, source) "
                "VALUES (?, ?, ?, ?)",
                (trip_id, item_id, role if role in TRIP_ROLE_ORDER else None,
                 "chosen" if entry.get("source") == "chosen" else "derived"))
        conn.commit()
        return _trip_row(conn, trip_id)


def remove_trip_item(trip_id: int, item_id: int) -> Optional[dict]:
    """Take one piece back off a trip. The long-press on a tile."""
    with connect() as conn:
        conn.execute("DELETE FROM trip_items WHERE trip_id = ? AND item_id = ?",
                     (trip_id, item_id))
        conn.commit()
        return _trip_row(conn, trip_id)


def finalise_trip_kit(trip_id: int, items: list) -> Optional[dict]:
    """The Confirm screen's Continue: settle the trip's chosen kit and let go
    of the requests for anything the kit sec did not carry through.

    The kit that stayed on the list keeps its requesters, because the disc
    stacks on the packed and active trip are read off `trip_votes`. A request
    for a piece that was dropped goes, so it cannot come back as a pending row.
    Nothing about the drop is recorded: the wishlist is read once and acted on.
    """
    with connect() as conn:
        _write_items(conn, trip_id, items or [])
        kept = {e.get("item_id") for e in (items or []) if e.get("item_id") is not None}
        asked = [r["item_id"] for r in conn.execute(
            "SELECT DISTINCT item_id FROM trip_votes WHERE trip_id = ?", (trip_id,))]
        for item_id in asked:
            if item_id not in kept:
                conn.execute("DELETE FROM trip_votes WHERE trip_id = ? AND item_id = ?",
                             (trip_id, item_id))
        conn.commit()
        return _trip_row(conn, trip_id)


def drop_trip_request(trip_id: int, item_id: int) -> Optional[dict]:
    """Clear one piece off a trip's wishlist: every member's request for it, in
    one go. The kit sec taking something off before the Confirm screen."""
    with connect() as conn:
        conn.execute("DELETE FROM trip_votes WHERE trip_id = ? AND item_id = ?",
                     (trip_id, item_id))
        conn.commit()
        return _trip_row(conn, trip_id)


def undecided_requests(trip_id: int) -> list:
    """The item ids asked for that the kit sec has not answered yet.

    What the approve deck has left to show. A piece the kit sec put on the trip
    from the form before anybody asked counts as already answered.
    """
    with connect() as conn:
        return [r["item_id"] for r in conn.execute(
            "SELECT DISTINCT tv.item_id FROM trip_votes tv "
            "WHERE tv.trip_id = ? AND tv.item_id NOT IN "
            "  (SELECT item_id FROM trip_items WHERE trip_id = ?) "
            "ORDER BY tv.item_id", (trip_id, trip_id))]


def update_trip(trip_id: int, fields: dict) -> Optional[dict]:
    """Rename a trip, change its dates or its blurb. Its kit is set_trip_items."""
    allowed = {k: v for k, v in fields.items()
               if k in ("name", "destination", "lat", "lon", "starts_on",
                        "ends_on", "notes", "image_path")}
    if allowed:
        if "name" in allowed and not (allowed["name"] or "").strip():
            raise TripError("Give the trip a name.")
        for key in ("lat", "lon"):
            if key in allowed:
                allowed[key] = _coord(allowed[key])
        sets = ", ".join(f"{k} = ?" for k in allowed)
        with connect() as conn:
            conn.execute(f"UPDATE trips SET {sets} WHERE id = ?",
                         [*allowed.values(), trip_id])
            conn.commit()
    return get_trip(trip_id)


def set_trip_packed(trip_id: int, item_id: int, on: bool = True) -> Optional[dict]:
    """Tick one piece onto the trailer. Changes no location: it never moves."""
    with connect() as conn:
        conn.execute(
            "UPDATE trip_items SET packed = ? WHERE trip_id = ? AND item_id = ?",
            (1 if on else 0, trip_id, item_id))
        conn.commit()
        return _trip_row(conn, trip_id)


def set_trip_stage(trip_id: int, status: str) -> Optional[dict]:
    """Move a trip on a stage, or back one, which is the same call.

    Deliberately not a state machine that refuses: the kit sec who tapped
    Complete packing a minute too early needs to be able to go back, and a
    forecast of every legitimate order a real trip happens in is a worse guess
    than the person holding the clipboard.
    """
    if status not in TRIP_STAGES:
        raise TripError("A trip is requesting, packing, active, done "
                        "or cancelled.")
    with connect() as conn:
        conn.execute("UPDATE trips SET status = ? WHERE id = ?", (status, trip_id))
        # The two stamps are set the first time the trip reaches the stage and
        # left alone after, so winding back and forward does not rewrite when
        # the trailer actually went out.
        if status == "active":
            conn.execute("UPDATE trips SET packed_at = COALESCE(packed_at, "
                         "datetime('now')) WHERE id = ?", (trip_id,))
        if status == "done":
            conn.execute("UPDATE trips SET returned_at = COALESCE(returned_at, "
                         "datetime('now')) WHERE id = ?", (trip_id,))
        conn.commit()
        return _trip_row(conn, trip_id)


def return_all(trip_id: int) -> Optional[dict]:
    """End a trip: everything goes back to being available, and it closes.

    The whole of coming home, in one act. There was briefly an unpacking stage
    with a checklist to work through, and it earned nothing: a trailer where
    nothing is missing is the usual case, tapping thirty rows to say so is the
    kind of chore that stops the list being kept at all, and the app never
    moved any of it in the first place. Nothing here writes `items.location` —
    every piece goes back to the rack it never left.
    """
    with connect() as conn:
        conn.execute("UPDATE trip_items SET returned = 1 WHERE trip_id = ?", (trip_id,))
        conn.execute("UPDATE trips SET status = 'done', "
                     "returned_at = COALESCE(returned_at, datetime('now')) "
                     "WHERE id = ?", (trip_id,))
        conn.commit()
        return _trip_row(conn, trip_id)


def close_trip(trip_id: int, status: str = "done") -> Optional[dict]:
    """Kept for the two endings: it came back, or it never went."""
    if status not in ("done", "cancelled"):
        raise TripError("A trip ends done or cancelled.")
    return set_trip_stage(trip_id, status)


def trip_request_counts(trip_id: int) -> dict:
    """{item_id: how many members asked for it} for one trip."""
    with connect() as conn:
        return {r["item_id"]: r["n"] for r in conn.execute(
            "SELECT item_id, COUNT(*) AS n FROM trip_votes WHERE trip_id = ? "
            "GROUP BY item_id", (trip_id,))}


def trip_request_order(trip_id: int) -> list:
    """The item ids asked for, newest request first.

    The requesting screen is a feed of what people have just asked for, so it
    reads newest first rather than most-asked-for first: a piece five members
    wanted a fortnight ago is settled in everybody's mind, and the one somebody
    added this morning is the news. A later request for a piece already on the
    list lifts it back to the top, which is the right answer too.
    """
    with connect() as conn:
        return [r["item_id"] for r in conn.execute(
            "SELECT item_id, MAX(id) AS latest FROM trip_votes WHERE trip_id = ? "
            "GROUP BY item_id ORDER BY latest DESC", (trip_id,))]


def trip_requesters(trip_id: int) -> dict:
    """{item_id: [display name, ...]}, oldest request first.

    Names, not just a count: the voter tags on a tile are a stack of discs that
    opens into who asked, and settling "whose board is this" on the beach is the
    whole job they do.
    """
    out: dict = {}
    with connect() as conn:
        for row in conn.execute(
                "SELECT tv.item_id, COALESCE(u.display_name, u.username) AS who "
                "FROM trip_votes tv JOIN users u ON u.id = tv.user_id "
                "WHERE tv.trip_id = ? ORDER BY tv.id", (trip_id,)):
            out.setdefault(row["item_id"], []).append(row["who"])
    return out


def trip_requests_by_user(trip_id: int, user_id: Optional[int]) -> list:
    """The item ids this member has asked for, so the screen can show them back."""
    if not user_id:
        return []
    with connect() as conn:
        return [r["item_id"] for r in conn.execute(
            "SELECT item_id FROM trip_votes WHERE trip_id = ? AND user_id = ?",
            (trip_id, user_id))]


def set_trip_request(trip_id: int, item_id: int, user_id: int,
                     on: bool = True) -> dict:
    """Cast or withdraw one member's request for one piece.

    Asking for something nobody has asked for yet IS suggesting it, so there is
    no separate suggestion to make first. The UNIQUE on (trip, item, member)
    does the only anti-stuffing this needs; withdrawing deletes the row rather
    than voiding it, because this list is read once and acted on.
    """
    with connect() as conn:
        if on:
            conn.execute(
                "INSERT OR IGNORE INTO trip_votes (trip_id, item_id, user_id) "
                "VALUES (?, ?, ?)", (trip_id, item_id, user_id))
        else:
            conn.execute(
                "DELETE FROM trip_votes WHERE trip_id = ? AND item_id = ? "
                "AND user_id = ?", (trip_id, item_id, user_id))
        conn.commit()
    return {"counts": trip_request_counts(trip_id),
            "who": trip_requesters(trip_id),
            "mine": trip_requests_by_user(trip_id, user_id)}


def away_item_ids(exclude_trip_id: Optional[int] = None) -> dict:
    """{item_id: trip name} for everything on a trip that is being loaded, out,
    or coming back.

    The one question the rest of the app asks about trips: the rig picker hides
    these (they are in a trailer, whatever their location says) and the
    catalogue flags them. `exclude_trip_id` is for the trip doing the asking,
    since its own kit is not a clash with itself.
    """
    with connect() as conn:
        return _away(conn, exclude_trip_id)


def _away(conn: sqlite3.Connection, exclude_trip_id: Optional[int] = None) -> dict:
    stages = ", ".join("?" for _ in TRIP_AWAY_STAGES)
    query = ("SELECT ti.item_id, t.name FROM trip_items ti "
             "JOIN trips t ON t.id = ti.trip_id "
             f"WHERE ti.declined = 0 AND t.status IN ({stages})")
    params: list = list(TRIP_AWAY_STAGES)
    if exclude_trip_id is not None:
        query += " AND t.id != ?"
        params.append(exclude_trip_id)
    return {r["item_id"]: r["name"] for r in conn.execute(query, params)}


# --------------------------------------------------------------------------- #
# Sessions: the logbook feed
# --------------------------------------------------------------------------- #
def get_sessions(user_id: Optional[int] = None, limit: int = 40) -> list:
    """The club feed, newest first, or one member's own history."""
    query = ("SELECT s.*, u.display_name AS user_name FROM sessions s "
             "JOIN users u ON u.id = s.user_id")
    params = []
    if user_id:
        query += " WHERE s.user_id = ?"
        params.append(user_id)
    query += " ORDER BY COALESCE(s.ended_at, s.created_at) DESC, s.id DESC LIMIT ?"
    params.append(limit)

    with connect() as conn:
        sessions = [dict(r) for r in conn.execute(query, params)]
        for session in sessions:
            session["pieces"] = [dict(r) for r in conn.execute(
                "SELECT si.*, i.manufacturer, i.model, i.component_type, i.size_m2, "
                "       i.size_l, i.length_cm, i.fin_length_cm "
                "FROM session_items si LEFT JOIN items i ON i.id = si.item_id "
                "WHERE si.session_id = ?", (session["id"],)
            )]
    return sessions


def log_session(user_id: int, data: dict) -> dict:
    """Save a session, and fan its per-item thumbs and notes out to the item.

    A thumb becomes that member's standing vote on the piece; a per-item note
    becomes a comment on it, so both show up on the item page rather than being
    buried in the log.
    """
    pieces = data.get("pieces") or []
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO sessions (user_id, setup_id, site, started_at, ended_at, "
            "wind_kn, wind_gust_kn, wind_dir, wind_source, stars, note) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, data.get("setup_id"), data.get("site"),
             data.get("started_at"), data.get("ended_at"),
             data.get("wind_kn"), data.get("wind_gust_kn"), data.get("wind_dir"),
             data.get("wind_source") or "auto", data.get("stars"), data.get("note")),
        )
        session_id = cur.lastrowid
        for piece in pieces:
            vote = piece.get("vote")
            conn.execute(
                "INSERT INTO session_items (session_id, role, item_id, label, vote, "
                "comment) VALUES (?, ?, ?, ?, ?, ?)",
                (session_id, piece.get("role"), piece.get("item_id"),
                 piece.get("label"), vote if vote in (1, -1) else None,
                 piece.get("comment")),
            )
        if data.get("setup_id"):
            conn.execute("UPDATE setups SET status = 'logged' WHERE id = ?",
                         (data["setup_id"],))
        conn.commit()

    author = (get_user(user_id) or {}).get("display_name")
    for piece in pieces:
        item_id = piece.get("item_id")
        if not item_id:
            continue
        if piece.get("vote") in (1, -1):
            set_vote(item_id, user_id, piece["vote"], session_id=session_id)
        note = (piece.get("comment") or "").strip()
        if note:
            add_comment(item_id, note, kind="usage", author=author,
                        user_id=user_id, used_on=data.get("ended_at"))

    return get_session(session_id)


def get_session(session_id: int) -> Optional[dict]:
    with connect() as conn:
        row = conn.execute(
            "SELECT s.*, u.display_name AS user_name FROM sessions s "
            "JOIN users u ON u.id = s.user_id WHERE s.id = ?", (session_id,)
        ).fetchone()
        if not row:
            return None
        session = dict(row)
        session["pieces"] = [dict(r) for r in conn.execute(
            "SELECT si.*, i.manufacturer, i.model, i.component_type "
            "FROM session_items si LEFT JOIN items i ON i.id = si.item_id "
            "WHERE si.session_id = ?", (session_id,)
        )]
    return session


# --------------------------------------------------------------------------- #
# A member's own history
#
# What one member has actually sailed, in the shape the rig wizard's opening
# suggestion and the profile screen both need: one row per logged session, with
# the wind, the sail and board sizes used, and what they thought of them.
# --------------------------------------------------------------------------- #
def rider_history(user_id: int, limit: int = 200) -> list:
    """One row per session: the conditions, the sizes used, and the verdicts.

    `sail_vote`/`board_vote` are the 👍/👎 given in the log itself, so a session
    carries its own verdict on the kit rather than the member's current standing
    one: the point is what worked on the day, in that wind.
    """
    with connect() as conn:
        rows = conn.execute("""
            SELECT s.id, s.site, s.wind_kn, s.wind_gust_kn, s.wind_dir, s.stars,
                   COALESCE(s.ended_at, s.created_at) AS at,
                   MAX(CASE WHEN i.component_type = 'sail'  THEN i.size_m2 END) AS sail_m2,
                   MAX(CASE WHEN i.component_type = 'board' THEN i.size_l  END) AS board_l,
                   MAX(CASE WHEN i.component_type = 'sail'  THEN si.vote   END) AS sail_vote,
                   MAX(CASE WHEN i.component_type = 'board' THEN si.vote   END) AS board_vote,
                   MAX(CASE WHEN i.component_type = 'sail'  THEN i.id      END) AS sail_id,
                   MAX(CASE WHEN i.component_type = 'board' THEN i.id      END) AS board_id
            FROM sessions s
            LEFT JOIN session_items si ON si.session_id = s.id
            LEFT JOIN items i ON i.id = si.item_id
            WHERE s.user_id = ?
            GROUP BY s.id
            ORDER BY at DESC, s.id DESC
            LIMIT ?
        """, (user_id, limit)).fetchall()
    return [dict(r) for r in rows]


def kit_usage(user_id: int, limit: int = 15) -> list:
    """The kit this member reaches for most, with their latest rating of it."""
    with connect() as conn:
        rows = conn.execute(f"""
            SELECT i.id, i.manufacturer, i.model, i.component_type, i.type,
                   i.size_m2, i.size_l, i.length_cm, i.fin_length_cm,
                   i.min_size_cm, i.max_size_cm, i.size_generic, i.condition,
                   COUNT(*) AS times,
                   MAX(COALESCE(s.ended_at, s.created_at)) AS last_used,
                   (SELECT vote FROM ({_LIVE_VOTES}) v
                     WHERE v.item_id = i.id AND v.user_id = ?) AS my_vote,
                   EXISTS (SELECT 1 FROM favourites f
                            WHERE f.item_id = i.id AND f.user_id = ?) AS favourite
            FROM session_items si
            JOIN sessions s ON s.id = si.session_id
            JOIN items i ON i.id = si.item_id
            WHERE s.user_id = ?
            GROUP BY i.id
            ORDER BY times DESC, last_used DESC
            LIMIT ?
        """, (user_id, user_id, user_id, limit)).fetchall()
    return [dict(r) for r in rows]


def member_stats(user_id: int) -> dict:
    """The handful of numbers a profile leads with."""
    with connect() as conn:
        row = conn.execute("""
            SELECT COUNT(*) AS n_sessions,
                   COUNT(DISTINCT site) AS n_sites,
                   MIN(COALESCE(ended_at, created_at)) AS first_at,
                   MAX(COALESCE(ended_at, created_at)) AS last_at,
                   AVG(stars) AS avg_stars,
                   AVG(wind_kn) AS avg_wind
            FROM sessions WHERE user_id = ?
        """, (user_id,)).fetchone()
        stats = dict(row)
        stats["n_ratings"] = conn.execute(
            "SELECT COUNT(*) AS n FROM ratings WHERE user_id = ? AND voided_at IS NULL",
            (user_id,)).fetchone()["n"]
        stats["n_favourites"] = conn.execute(
            "SELECT COUNT(*) AS n FROM favourites WHERE user_id = ?",
            (user_id,)).fetchone()["n"]
    return stats
