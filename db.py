"""Data-access layer for the UBWC kit app.

Thin sqlite3 wrappers over kit.db plus the component metadata (which fields
each component type uses, and their human labels) that the API and the
add-item form are driven by. No ORM.

Everything the app reads goes through here, so the HTTP layer (server.py) only
shapes JSON and the browser never learns SQL. The windsurfing rules themselves
live in validation.py; the normalisation the rig wizard needs is in rigkit.py.
"""
import json
import re
import sqlite3
from typing import Iterable, Optional, Union

import migrate  # for DB_PATH and rebuild()

DB_PATH = migrate.DB_PATH

# Terminal search commands -> the component_type(s) they list. Sails + Wings are
# grouped together to mirror the sheet.
COMMANDS = {
    "boards": ["board"],
    "sails": ["sail", "wing"],
    "wings": ["wing"],
    "booms": ["boom"],
    "masts": ["mast"],
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
              "top_extension_max_cm", "req_boom_cm", "cams",
              "condition", "location", "spot", "notes"],
    "wing":  ["manufacturer", "model", "type", "size_m2",
              "condition", "location", "spot", "notes"],
    "boom":  ["manufacturer", "model", "type", "min_size_cm", "max_size_cm",
              "condition", "location", "spot", "notes"],
    "mast":  ["manufacturer", "model", "type", "length_cm",
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
    "mast": "Mast", "fin": "Fin", "foil": "Foil", "misc": "Misc",
}

# The order the catalogue's type chips appear in.
CATALOGUE_TYPES = ["board", "sail", "mast", "boom", "fin", "foil", "wing", "misc"]

# Sites the club uses. Committee maintains this list; new ones can be added
# inline while moving kit, which is why it is a table rather than a constant.
DEFAULT_SITES = ["Cheddar", "Richmond Building", "SU Store"]

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
# column for these yet, so the rig steps read them off the misc `type` — see
# rigkit.py, which is the only place that mapping is applied.
MISC_RIG_TYPES = {"Extension": "ext", "Universal joint": "uj"}


# --------------------------------------------------------------------------- #
# Connection / lifecycle
# --------------------------------------------------------------------------- #
def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def ensure_db() -> None:
    """Make kit.db exist and match the current schema.

    Builds from the ground-truth sheet on a cold start, then brings an older
    database forward in place. The migration is additive (new columns and
    tables only) so a database with real inventory, ratings and comments in it
    survives a schema change without being rebuilt from the sheet.
    """
    if not DB_PATH.exists():
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

    if "sites" not in tables:
        conn.execute("""
            CREATE TABLE sites (
                id   INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                sort INTEGER NOT NULL DEFAULT 0
            )""")
    if "spots" not in tables:
        conn.execute("""
            CREATE TABLE spots (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                site        TEXT NOT NULL,
                name        TEXT NOT NULL,
                description TEXT,
                UNIQUE (site, name)
            )""")

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
                rigged_at   TEXT NOT NULL DEFAULT (datetime('now')),
                derigged_at TEXT,
                created_at  TEXT NOT NULL DEFAULT (datetime('now'))
            )""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_setups_user ON setups(user_id, status)")
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

    _seed_locations(conn)


def _seed_locations(conn: sqlite3.Connection) -> None:
    """Fill sites/spots and give any item without a spot the default for its type.

    Only ever adds: an item that already records a spot, and a site somebody
    added by hand, are both left alone.
    """
    known = {r["location"] for r in
             conn.execute("SELECT DISTINCT location FROM items WHERE location IS NOT NULL")}
    for i, name in enumerate(DEFAULT_SITES + sorted(known - set(DEFAULT_SITES))):
        conn.execute("INSERT OR IGNORE INTO sites (name, sort) VALUES (?, ?)", (name, i))

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
        # An extension or a base is a misc row but lives with the small parts,
        # not on the wetsuit shelf, so the default follows what it is used as.
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
# These read information that has no column of its own yet, so every caller
# agrees on where it comes from rather than each re-parsing free text.
# --------------------------------------------------------------------------- #
_DIAMETER_RE = re.compile(r"^\s*(RDM|SDM)\b", re.IGNORECASE)
_RANGE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)")


def diameter_class(item: dict) -> Optional[str]:
    """A mast's or extension's RDM/SDM class, read from the front of its notes.

    Diameter is not a column yet (CLAUDE.md "Mast diameter class"), but it is a
    hard rule for cambered sails and for matching an extension to its mast, so
    the app has to know it. The seed data states it as the first word of the
    notes; anything else reads as unknown, which the rules treat as "don't
    block".
    """
    match = _DIAMETER_RE.match(item.get("notes") or "")
    return match.group(1).upper() if match else None


def extension_travel(item: dict) -> tuple:
    """(min_cm, max_cm) an extension travels, read from its generic size ("0-30cm").

    Extensions are misc rows, so their range is in `size_generic` rather than
    the boom columns. Returns (None, None) when it cannot be read.
    """
    match = _RANGE_RE.search(item.get("size_generic") or "")
    if not match:
        return (None, None)
    return (float(match.group(1)), float(match.group(2)))


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


def all_items() -> list:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM items ORDER BY id").fetchall()
    return [dict(r) for r in rows]


def search_items(term: str, limit: int = 10) -> list:
    """Fuzzy-ish item lookup for the search bar.

    Matches across manufacturer, model, type, location and the free-text notes
    field so odd pieces are findable by whatever the user remembers about them.
    """
    like = f"%{term.strip()}%"
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM items WHERE manufacturer LIKE ? OR model LIKE ? "
            "OR type LIKE ? OR location LIKE ? OR spot LIKE ? OR notes LIKE ? "
            "ORDER BY manufacturer, model LIMIT ?",
            (like, like, like, like, like, like, limit),
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
            "SELECT s.name, "
            "  (SELECT COUNT(*) FROM items i WHERE i.location = s.name) AS n_items "
            "FROM sites s ORDER BY s.sort, s.name"
        ).fetchall()
    return [dict(r) for r in rows]


def add_site(name: str) -> None:
    """Committee action. Adding inline while moving kit is what keeps the
    catalogue filter free of "Notts" vs "Nottingham" drift."""
    with connect() as conn:
        conn.execute("INSERT OR IGNORE INTO sites (name, sort) VALUES (?, 99)", (name.strip(),))
        conn.commit()


def get_spots(site: Optional[str] = None) -> list:
    query = "SELECT site, name, description FROM spots"
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


# --------------------------------------------------------------------------- #
# Users (the roster behind the name-pick login)
# --------------------------------------------------------------------------- #
def get_users() -> list:
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, username, display_name, is_admin FROM users "
            "ORDER BY display_name, username"
        ).fetchall()
    return [dict(r) for r in rows]


def get_user(user_id: int) -> Optional[dict]:
    with connect() as conn:
        row = conn.execute(
            "SELECT id, username, display_name, is_admin FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    return dict(row) if row else None


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


def rating_for(item_id: int, user_id: Optional[int] = None) -> dict:
    with connect() as conn:
        row = conn.execute(
            "SELECT SUM(vote = 1) AS up, SUM(vote = -1) AS down FROM ratings "
            "WHERE item_id = ?", (item_id,)
        ).fetchone()
        mine = None
        if user_id:
            got = conn.execute(
                "SELECT vote FROM ratings WHERE item_id = ? AND user_id = ?",
                (item_id, user_id),
            ).fetchone()
            mine = got["vote"] if got else None
    up, down = (row["up"] or 0), (row["down"] or 0)
    return {"up": up, "down": down, "n": up + down, "stars": _stars(up, down), "mine": mine}


def ratings_by_item(user_id: Optional[int] = None) -> dict:
    """Every item's tally at once, for the catalogue's cards."""
    out = {}
    with connect() as conn:
        for row in conn.execute(
            "SELECT item_id, SUM(vote = 1) AS up, SUM(vote = -1) AS down "
            "FROM ratings GROUP BY item_id"
        ):
            up, down = (row["up"] or 0), (row["down"] or 0)
            out[row["item_id"]] = {"up": up, "down": down, "n": up + down,
                                   "stars": _stars(up, down), "mine": None}
        if user_id:
            for row in conn.execute(
                "SELECT item_id, vote FROM ratings WHERE user_id = ?", (user_id,)
            ):
                if row["item_id"] in out:
                    out[row["item_id"]]["mine"] = row["vote"]
    return out


def set_vote(item_id: int, user_id: int, vote: Optional[int],
             session_id: Optional[int] = None) -> dict:
    """Record (or clear) a member's standing vote on an item.

    One vote per member per item, updatable — voting again replaces the old one
    rather than stacking, so a heavy user of one board cannot inflate its score.
    `vote` of None (or 0) withdraws the vote.
    """
    with connect() as conn:
        if vote in (None, 0):
            conn.execute("DELETE FROM ratings WHERE item_id = ? AND user_id = ?",
                         (item_id, user_id))
        else:
            conn.execute(
                "INSERT INTO ratings (user_id, item_id, vote, session_id) "
                "VALUES (?, ?, ?, ?) "
                "ON CONFLICT (user_id, item_id) DO UPDATE SET "
                "vote = excluded.vote, session_id = excluded.session_id, "
                "updated_at = datetime('now')",
                (user_id, item_id, 1 if vote > 0 else -1, session_id),
            )
        conn.commit()
    return rating_for(item_id, user_id)


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
               "board": "Board", "fin": "Fin", "uj": "Base"}
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


def save_setup(user_id: int, site: Optional[str], pieces: list) -> dict:
    """Start a new active setup, replacing any earlier one for this member.

    One active setup at a time: the previous one is binned here, and the UI is
    what asks first whether it should be logged instead.
    """
    with connect() as conn:
        conn.execute(
            "UPDATE setups SET status = 'binned' WHERE user_id = ? AND status = 'active'",
            (user_id,),
        )
        cur = conn.execute(
            "INSERT INTO setups (user_id, status, site) VALUES (?, 'active', ?)",
            (user_id, site),
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
