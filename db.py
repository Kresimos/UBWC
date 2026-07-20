"""Data-access layer for the UBWC kit app.

Thin sqlite3 wrappers over kit.db plus the component metadata (which fields
each component type uses, and their human labels) that the Streamlit views and
the add-item form are driven by. No ORM.
"""
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
    "req_mast_length_cm": {"label": "Mast Length (cm)", "kind": "number"},
    "req_extension_cm":   {"label": "Extension (cm)", "kind": "number"},
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
    "location":           {"label": "Location", "kind": "text"},
}

# Ordered fields per component type (drives the add-item form and spec table).
COMPONENT_FIELDS = {
    "board": ["manufacturer", "model", "type", "size_l", "condition", "location"],
    "sail":  ["manufacturer", "model", "type", "size_m2", "req_mast_length_cm",
              "req_extension_cm", "req_boom_cm", "cams", "condition", "location"],
    "wing":  ["manufacturer", "model", "type", "size_m2", "condition", "location"],
    "boom":  ["manufacturer", "model", "type", "min_size_cm", "max_size_cm",
              "condition", "location"],
    "mast":  ["manufacturer", "model", "type", "length_cm", "condition", "location"],
    "fin":   ["manufacturer", "model", "type", "box_type", "fin_length_cm",
              "condition", "location"],
    "foil":  ["manufacturer", "model", "type", "box_type", "condition", "location"],
    "misc":  ["manufacturer", "model", "type", "size_generic", "condition", "location"],
}

# Human labels for component types (for headings, add-item picker, etc.).
COMPONENT_LABELS = {
    "board": "Board", "sail": "Sail", "wing": "Wing", "boom": "Boom",
    "mast": "Mast", "fin": "Fin", "foil": "Foil", "misc": "Misc",
}

# Ratings: wind-strength bands (knots) and the comment word cap.
WIND_STRENGTH_OPTIONS = ["0–10 kn", "10–15 kn", "15–20 kn", "20–25 kn", "25+ kn"]
RATING_WORD_LIMIT = 30

# Saved setups: which item slots a setup has, as (column, component_type) pairs.
# The setups table also has extension_id, left unused (extensions aren't items).
SETUP_SLOTS = [
    ("board_id", "board"),
    ("sail_id", "sail"),
    ("mast_id", "mast"),
    ("boom_id", "boom"),
    ("fin_id", "fin"),
]


# --------------------------------------------------------------------------- #
# Connection / lifecycle
# --------------------------------------------------------------------------- #
def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# Columns added after the initial release — applied to an existing kit.db via
# ALTER TABLE so app-added data is never lost. Fresh builds get them straight
# from schema.sql.
_ITEM_COLUMN_MIGRATIONS = {
    "archived": "INTEGER NOT NULL DEFAULT 0",
    "archived_at": "TEXT",
    "archived_reason": "TEXT",
}
_RATING_COLUMN_MIGRATIONS = {
    "wind_strength": "TEXT",
    "rider_ability": "TEXT",
}


def _ensure_schema(conn: sqlite3.Connection) -> None:
    """Idempotently add any columns/indexes missing from an older kit.db."""
    for table, migrations in (("items", _ITEM_COLUMN_MIGRATIONS),
                              ("ratings", _RATING_COLUMN_MIGRATIONS)):
        existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        for col, decl in migrations.items():
            if col not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_user_item "
                 "ON ratings(user_id, item_id)")
    conn.commit()


def ensure_db() -> None:
    """Build kit.db from the xlsx on first run, then bring the schema up to date."""
    if not DB_PATH.exists():
        migrate.rebuild()
    with connect() as conn:
        _ensure_schema(conn)


def rebuild_from_xlsx() -> dict:
    """Re-import the ground-truth sheet, replacing the database."""
    return migrate.rebuild()


# --------------------------------------------------------------------------- #
# Items
# --------------------------------------------------------------------------- #
def _as_type_list(component_types: Union[str, Iterable[str]]) -> list:
    if isinstance(component_types, str):
        return [component_types]
    return list(component_types)


def get_items(component_types: Union[str, Iterable[str]],
              include_archived: bool = False) -> list:
    types = _as_type_list(component_types)
    placeholders = ", ".join("?" for _ in types)
    sql = f"SELECT * FROM items WHERE component_type IN ({placeholders})"
    if not include_archived:
        sql += " AND archived = 0"
    sql += " ORDER BY manufacturer, model, id"
    with connect() as conn:
        rows = conn.execute(sql, types).fetchall()
    return [dict(r) for r in rows]


def get_archived_items() -> list:
    """All archived (broken / retired) items, most recently archived first."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM items WHERE archived = 1 "
            "ORDER BY archived_at DESC, manufacturer, model"
        ).fetchall()
    return [dict(r) for r in rows]


def get_item(item_id: int) -> Optional[dict]:
    with connect() as conn:
        row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    return dict(row) if row else None


def search_items(term: str, limit: int = 10, include_archived: bool = False) -> list:
    """Fuzzy-ish item lookup for the search bar: match manufacturer/model/type."""
    like = f"%{term.strip()}%"
    sql = ("SELECT * FROM items WHERE (manufacturer LIKE ? OR model LIKE ? "
           "OR type LIKE ?)")
    if not include_archived:
        sql += " AND archived = 0"
    sql += " ORDER BY manufacturer, model LIMIT ?"
    with connect() as conn:
        rows = conn.execute(sql, (like, like, like, limit)).fetchall()
    return [dict(r) for r in rows]


def add_item(record: dict) -> int:
    """Insert an item. `record` must include component_type; unknown keys are ignored."""
    allowed = {"component_type", "image_path", *FIELD_META.keys()}
    clean = {k: v for k, v in record.items() if k in allowed and v not in (None, "")}
    fields = list(clean.keys())
    placeholders = ", ".join("?" for _ in fields)
    with connect() as conn:
        cur = conn.execute(
            f"INSERT INTO items ({', '.join(fields)}) VALUES ({placeholders})",
            [clean[f] for f in fields],
        )
        conn.commit()
        return cur.lastrowid


def spec_rows(item: dict) -> list:
    """(label, value) pairs for an item's spec table, in component-type order."""
    fields = COMPONENT_FIELDS.get(item["component_type"], [])
    rows = []
    for f in fields:
        meta = FIELD_META[f]
        value = item.get(f)
        if meta["kind"] == "bool":
            value = "Yes" if value else "No"
        elif value is None:
            value = "—"
        rows.append((meta["label"], value))
    return rows


def item_title(item: dict) -> str:
    parts = [item.get("manufacturer") or "", item.get("model") or ""]
    return " ".join(p for p in parts if p).strip() or f"Item #{item['id']}"


def archive_item(item_id: int, reason: Optional[str] = None) -> None:
    """Retire a broken item: hide it from the active inventory, keep the record."""
    with connect() as conn:
        conn.execute(
            "UPDATE items SET archived = 1, archived_at = datetime('now'), "
            "archived_reason = ? WHERE id = ?",
            (reason, item_id),
        )
        conn.commit()


def unarchive_item(item_id: int) -> None:
    """Restore an archived item back into the active inventory."""
    with connect() as conn:
        conn.execute(
            "UPDATE items SET archived = 0, archived_at = NULL, "
            "archived_reason = NULL WHERE id = ?",
            (item_id,),
        )
        conn.commit()


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


def report_fault(item_id: int, description: str, reported_by: Optional[str] = None) -> int:
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO faults (item_id, description, reported_by) VALUES (?, ?, ?)",
            (item_id, description, reported_by),
        )
        conn.commit()
        return cur.lastrowid


def clear_fault(fault_id: int, cleared_by: Optional[str] = None) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE faults SET status = 'cleared', cleared_by = ?, "
            "cleared_at = datetime('now') WHERE id = ?",
            (cleared_by, fault_id),
        )
        conn.commit()


# --------------------------------------------------------------------------- #
# Ratings (one editable rating per member per item)
# --------------------------------------------------------------------------- #
def get_ratings(item_id: int) -> list:
    """All ratings for an item, newest first, each including the reviewer's username."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT r.*, u.username FROM ratings r JOIN users u ON u.id = r.user_id "
            "WHERE r.item_id = ? ORDER BY r.created_at DESC, r.id DESC",
            (item_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_rating_summary(item_id: int) -> tuple:
    """(average, count) for an item; average is None when there are no ratings."""
    with connect() as conn:
        row = conn.execute(
            "SELECT AVG(stars), COUNT(*) FROM ratings WHERE item_id = ?", (item_id,)
        ).fetchone()
    return (row[0], row[1])


def get_user_rating(item_id: int, user_id: int) -> Optional[dict]:
    """A member's own rating of an item (for prefilling / editing), or None."""
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM ratings WHERE item_id = ? AND user_id = ?",
            (item_id, user_id),
        ).fetchone()
    return dict(row) if row else None


def upsert_rating(item_id: int, user_id: int, stars: int, comment: str,
                  wind_strength: Optional[str] = None,
                  rider_ability: Optional[str] = None) -> None:
    """Insert or replace a member's rating (one per member per item)."""
    with connect() as conn:
        conn.execute(
            "INSERT INTO ratings (item_id, user_id, stars, comment, "
            "wind_strength, rider_ability) VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(user_id, item_id) DO UPDATE SET "
            "stars = excluded.stars, comment = excluded.comment, "
            "wind_strength = excluded.wind_strength, "
            "rider_ability = excluded.rider_ability, "
            "created_at = datetime('now')",
            (item_id, user_id, stars, comment, wind_strength, rider_ability),
        )
        conn.commit()


def delete_rating(rating_id: int) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM ratings WHERE id = ?", (rating_id,))
        conn.commit()


# --------------------------------------------------------------------------- #
# Saved setups (a member's favourite board + rig combinations)
# --------------------------------------------------------------------------- #
def get_setups(user_id: int) -> list:
    """A member's saved setups, newest first."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM setups WHERE user_id = ? ORDER BY created_at DESC, id DESC",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def create_setup(user_id: int, name: str, board_id: Optional[int] = None,
                 sail_id: Optional[int] = None, mast_id: Optional[int] = None,
                 boom_id: Optional[int] = None, fin_id: Optional[int] = None) -> int:
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO setups (user_id, name, board_id, sail_id, mast_id, "
            "boom_id, fin_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, name, board_id, sail_id, mast_id, boom_id, fin_id),
        )
        conn.commit()
        return cur.lastrowid


def delete_setup(setup_id: int) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM setups WHERE id = ?", (setup_id,))
        conn.commit()
