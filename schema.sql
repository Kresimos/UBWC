-- UBWC Kit App — SQLite schema (ground truth for the kit inventory).
-- Rebuildable: migrate.py drops and recreates everything from this file.
-- Design notes live in CLAUDE.md; UX in misc/layout.txt.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- items: unified inventory. One row per physical piece of kit.
-- Size/spec columns are nullable and used per component_type, mirroring the
-- columns of each sheet in data/Kit Inventory.xlsx. Per-type views below
-- present the exact "same format as the sheet" layout.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_boards;
DROP VIEW IF EXISTS v_sails_wings;
DROP VIEW IF EXISTS v_booms;
DROP VIEW IF EXISTS v_masts;
DROP VIEW IF EXISTS v_misc;
DROP TABLE IF EXISTS ratings;
DROP TABLE IF EXISTS setups;
DROP TABLE IF EXISTS faults;
DROP TABLE IF EXISTS items;
DROP TABLE IF EXISTS users;

CREATE TABLE items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    component_type  TEXT NOT NULL
                    CHECK (component_type IN
                        ('board','sail','wing','boom','mast','fin','foil','misc')),
    manufacturer    TEXT,
    model           TEXT,
    type            TEXT,        -- sheet "Type" (e.g. Freewave, Wave, Slalom)
    condition       TEXT,
    location        TEXT,
    image_path      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),

    -- boards
    size_l              REAL,    -- volume in litres

    -- sails / wings
    size_m2             REAL,    -- sail/wing area
    -- sail rig spec (what the sail requires — see CLAUDE.md "Rig sizing")
    req_mast_length_cm  REAL,    -- sail luff length: mast length_cm + extension must equal this
    req_extension_cm    REAL,
    req_boom_cm         REAL,    -- recommended boom length; must sit inside a boom's min/max
    cams                INTEGER,  -- boolean 0/1: cambered sail?

    -- masts
    length_cm           REAL,    -- mast length

    -- booms (adjustable outhaul range)
    min_size_cm         REAL,
    max_size_cm         REAL,

    -- misc catch-all
    size_generic        TEXT,

    -- forward-looking: fins / foils (hard box-fit constraint, see CLAUDE.md)
    box_type            TEXT,    -- US Box | Powerbox | Tuttle | Deep Tuttle
    fin_length_cm       REAL,

    -- archival: broken / retired kit is archived (hidden from the active
    -- inventory) rather than deleted, so its history and faults are kept.
    archived            INTEGER NOT NULL DEFAULT 0,
    archived_at         TEXT,
    archived_reason     TEXT
);

-- ---------------------------------------------------------------------------
-- faults: multiple faults per item, reportable and clearable.
-- The sheet's single "Faults" text column is migrated in as seed rows.
-- `approved` supports the future admin approval flow.
-- ---------------------------------------------------------------------------
CREATE TABLE faults (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id      INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    description  TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','cleared')),
    reported_by  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    cleared_by   TEXT,
    cleared_at   TEXT,
    approved     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_faults_item ON faults(item_id);

-- ---------------------------------------------------------------------------
-- Forward-looking tables — created now (cheap, avoids a later migration),
-- no UI yet. See the long-term goals in the plan / CLAUDE.md.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    username       TEXT UNIQUE NOT NULL,
    display_name   TEXT,
    is_admin       INTEGER NOT NULL DEFAULT 0,
    password_hash  TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- "favourite setups": a saved rig + board combination.
CREATE TABLE setups (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT,
    board_id      INTEGER REFERENCES items(id) ON DELETE SET NULL,
    sail_id       INTEGER REFERENCES items(id) ON DELETE SET NULL,
    mast_id       INTEGER REFERENCES items(id) ON DELETE SET NULL,
    extension_id  INTEGER REFERENCES items(id) ON DELETE SET NULL,
    boom_id       INTEGER REFERENCES items(id) ON DELETE SET NULL,
    fin_id        INTEGER REFERENCES items(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ratings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
    item_id       INTEGER REFERENCES items(id) ON DELETE CASCADE,
    setup_id      INTEGER REFERENCES setups(id) ON DELETE CASCADE,
    stars         INTEGER CHECK (stars BETWEEN 1 AND 5),
    comment       TEXT,
    wind_strength TEXT,   -- knot band the review was made in
    rider_ability TEXT,   -- beginner | intermediate | advanced
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One (editable) rating per member per item.
CREATE UNIQUE INDEX idx_ratings_user_item ON ratings(user_id, item_id);

-- ---------------------------------------------------------------------------
-- Per-type views: reproduce each sheet's exact column layout for display/export.
-- ---------------------------------------------------------------------------
CREATE VIEW v_boards AS
    SELECT id, manufacturer AS "Manufacturer", model AS "Model", type AS "Type",
           size_l AS "Size (L)", condition AS "Condition", location AS "Location"
    FROM items WHERE component_type = 'board';

CREATE VIEW v_sails_wings AS
    SELECT id, manufacturer AS "Manufacturer", model AS "Model", type AS "Type",
           size_m2 AS "Size (m^2)", condition AS "Condition", location AS "Location",
           req_mast_length_cm AS "Mast Length", req_extension_cm AS "Extension",
           req_boom_cm AS "Boom", cams AS "Cams"
    FROM items WHERE component_type IN ('sail','wing');

CREATE VIEW v_booms AS
    SELECT id, manufacturer AS "Manufacturer", model AS "Model", type AS "Type",
           min_size_cm AS "Min size", max_size_cm AS "Max size",
           condition AS "Condition", location AS "Location"
    FROM items WHERE component_type = 'boom';

CREATE VIEW v_masts AS
    SELECT id, manufacturer AS "Manufacturer", model AS "Model", type AS "Type",
           length_cm AS "Size", condition AS "Condition", location AS "Location"
    FROM items WHERE component_type = 'mast';

CREATE VIEW v_misc AS
    SELECT id, manufacturer AS "Manufacturer", model AS "Model", type AS "Type",
           size_generic AS "Size", condition AS "Condition", location AS "Location"
    FROM items WHERE component_type = 'misc';
