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
DROP TABLE IF EXISTS session_items;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS setup_items;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS ratings;
DROP TABLE IF EXISTS setups;
DROP TABLE IF EXISTS fault_events;
DROP TABLE IF EXISTS faults;
DROP TABLE IF EXISTS spots;
DROP TABLE IF EXISTS sites;
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
    -- Two-level location (misc/spec.md "Locations and trips"): `location` is the
    -- SITE (a venue or store, and the value the catalogue filters on — a trip is
    -- just a site kit was moved to), `spot` is the place within it (wooden rack,
    -- mast tubes). A move overwrites both.
    location        TEXT,
    spot            TEXT,
    image_path      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),

    -- boards
    size_l              REAL,    -- volume in litres

    -- sails / wings
    size_m2             REAL,    -- sail/wing area
    -- sail rig spec (what the sail requires — see CLAUDE.md "Rig sizing")
    luff_cm             REAL,    -- sail luff length; any mast length_cm + extension totalling this fits
    top_extension_max_cm REAL DEFAULT 0,  -- adjustable head: how far a longer mast may protrude the top (0 = fixed luff)
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

    -- free-text catch-all for anything the typed columns don't cover. This is
    -- the "place for everything" for genuinely weird pieces (spares, oddities,
    -- extra spec printed on the kit) that don't warrant their own column.
    notes               TEXT,

    -- archival: broken / retired kit is archived (hidden from the catalogue
    -- and rig picker) rather than deleted, so its history and faults are kept.
    archived            INTEGER NOT NULL DEFAULT 0,
    archived_at         TEXT,
    archived_reason     TEXT
);

-- ---------------------------------------------------------------------------
-- faults: multiple faults per item, reportable and clearable. Each fault is a
-- distinct issue with a short `title` (the flag label shown around the app) and
-- a `description` (the diagnosis + what it needs). `severity` drives behaviour:
--   * 'usable'         -> amber flag; item stays in the catalogue and rig picker
--   * 'out_of_action'  -> red flag; hidden from the rig picker until cleared,
--                         shown in the catalogue but sorted to the bottom.
-- The sheet's single "Faults" text column is migrated in as seed rows (severity
-- defaults to 'usable'; committee escalates on review). `approved` supports the
-- future admin approval flow. The report -> fix -> clear timeline (the lookup-able
-- fault & fix history) lives in `fault_events` below; this row is current state.
-- ---------------------------------------------------------------------------
CREATE TABLE faults (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id      INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    title        TEXT,           -- short name / flag label
    description  TEXT NOT NULL,  -- the diagnosis and what it needs
    severity     TEXT NOT NULL DEFAULT 'usable'
                 CHECK (severity IN ('usable','out_of_action')),
    image_path   TEXT,           -- optional photo of the fault (diagnosis aid,
                                 -- shown on the item page, not the rig picker)
    status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','cleared')),
    reported_by  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    cleared_by   TEXT,
    cleared_at   TEXT,
    approved     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_faults_item ON faults(item_id);

-- ---------------------------------------------------------------------------
-- sites / spots: the managed location list (misc/spec.md "Locations and trips").
-- `sites` is the venue list committee maintains — it is what the catalogue's
-- location filter and the rig assistant's "kit at this site" rule read. Because
-- a trip is not a separate object, a trip destination is simply a site row.
-- `spots` names the places inside a site and carries the sentence the app shows
-- when a member taps a spot ("second bay in from the door"), so a newcomer can
-- find kit and put it back without asking.
-- ---------------------------------------------------------------------------
CREATE TABLE sites (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT UNIQUE NOT NULL,
    sort      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE spots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    site         TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    UNIQUE (site, name)
);

-- ---------------------------------------------------------------------------
-- fault_events: the timeline behind a fault — how it was reported, any fix a
-- member reports, and committee clearing/reopening. This is the "fault history
-- and fix history you can look up" on the item page. The faults row holds the
-- CURRENT state (status/severity/cleared_*); this is the append-only log.
--   * 'reported'     -> initial report (mirrors the faults row's creation)
--   * 'fix_reported' -> a member says they've repaired it. Does NOT clear the
--                       fault on its own (clearing is committee-only); it flags
--                       the fault as awaiting committee sign-off.
--   * 'cleared'      -> committee closed it (also sets faults.status='cleared')
--   * 'reopened'     -> it came back / the fix didn't hold
--   * 'note'         -> any other diagnosis/progress note
-- image_path lets a fix carry a photo of the repair, same as a report.
-- ---------------------------------------------------------------------------
CREATE TABLE fault_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fault_id    INTEGER NOT NULL REFERENCES faults(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL
                CHECK (kind IN ('reported','fix_reported','cleared','reopened','note')),
    body        TEXT,
    image_path  TEXT,
    author      TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_fault_events_fault ON fault_events(fault_id, created_at);

-- ---------------------------------------------------------------------------
-- comments: the timestamped log of everything people say about a piece of kit.
-- This is deliberately broad so there's "a place for everything":
--   * kind = 'usage'  : "took this out at Cheddar, planing nicely"
--   * kind = 'damage' : "small ding on the top-left of the deck" (non-blocking,
--                        unlike a `fault`, which is a tracked defect to clear)
--   * kind = 'review' : a star rating + write-up of how the kit performs
--   * kind = 'note'   : anything else (setup tips, "cams need easing", etc.)
-- Every comment is timestamped (created_at). `used_on` optionally records the
-- day the kit was actually used, which can differ from when the note was typed.
-- `author` is free text until the users table is wired up (then link user_id).
-- Photos attach via image_path (e.g. a picture of the ding).
-- Supersedes the per-item use of `ratings`; `ratings` is kept for future
-- setup-level (whole-rig) ratings, which comments don't cover.
-- ---------------------------------------------------------------------------
CREATE TABLE comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL DEFAULT 'note'
                CHECK (kind IN ('note','usage','damage','review')),
    body        TEXT NOT NULL,
    stars       INTEGER CHECK (stars BETWEEN 1 AND 5),   -- optional rating
    author      TEXT,                                    -- free text for now
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    used_on     TEXT,                                    -- date kit was used (optional)
    image_path  TEXT,                                    -- optional photo (e.g. the ding)
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_comments_item ON comments(item_id, created_at);

-- ---------------------------------------------------------------------------
-- users: the club roster. Login is a name-pick, no password — the pick is for
-- attribution, and the shared committee PIN is the real gate on committee-only
-- actions (misc/spec.md "Access and roles"). `is_admin` marks committee members.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    username       TEXT UNIQUE NOT NULL,
    display_name   TEXT,
    is_admin       INTEGER NOT NULL DEFAULT 0,
    password_hash  TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- setups: what a member built in the rig wizard and is currently out on.
-- This is deliberately PERSONAL state, not a club-wide "this kit is taken"
-- flag (misc/spec.md "Availability and faults" rejects live checkout). One
-- 'active' setup per member at a time; de-rigging moves it to 'derigged', where
-- it waits as the Log tab's un-logged prompt until it is logged or binned.
-- Location is never changed by rigging — de-rig is guidance only.
-- ---------------------------------------------------------------------------
CREATE TABLE setups (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','derigged','logged','binned')),
    site          TEXT,
    rigged_at     TEXT NOT NULL DEFAULT (datetime('now')),
    derigged_at   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_setups_user ON setups(user_id, status);

-- One row per piece in a setup. `role` is the wizard's seven steps. `item_id`
-- is NULL for a "something else" piece the member entered by hand for this rig
-- only (kept in `custom` as JSON, never added to the inventory). `settings`
-- carries what the pick settles — the extension length, the boom length — so
-- the rigging steps and de-rig checklist can restate the exact numbers.
CREATE TABLE setup_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    setup_id   INTEGER NOT NULL REFERENCES setups(id) ON DELETE CASCADE,
    role       TEXT NOT NULL
               CHECK (role IN ('sail','mast','ext','boom','board','fin','uj')),
    item_id    INTEGER REFERENCES items(id) ON DELETE SET NULL,
    custom     TEXT,
    settings   TEXT,
    UNIQUE (setup_id, role)
);

-- ---------------------------------------------------------------------------
-- sessions: the logbook. Saving is always a deliberate act, so a row here means
-- the member chose to keep the sail. Club-visible: everyone sees everyone's.
-- `stars` is the one 1-5 star pick in the app — author-only, one per session,
-- decorative in the feed (per-item rating stays binary, in `ratings`).
-- Wind is fetched for the rig -> de-rig window, not for when the form was
-- filled in, and stays editable (`wind_source` records which it is).
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    setup_id      INTEGER REFERENCES setups(id) ON DELETE SET NULL,
    site          TEXT,
    started_at    TEXT,
    ended_at      TEXT,
    wind_kn       REAL,
    wind_gust_kn  REAL,
    wind_dir      TEXT,
    wind_source   TEXT,       -- 'auto' (weather API) or 'manual' (edited)
    stars         INTEGER CHECK (stars BETWEEN 1 AND 5),
    note          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_user ON sessions(user_id, created_at);

-- The kit a session used, plus the optional quick 👍/👎 and small per-item
-- comment taken in the same pass. The vote is mirrored into `ratings` (one
-- standing vote per member per item) and the comment into `comments`.
CREATE TABLE session_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role        TEXT,
    item_id     INTEGER REFERENCES items(id) ON DELETE SET NULL,
    label       TEXT,       -- name kept for a hand-entered piece
    vote        INTEGER CHECK (vote IN (-1, 1)),
    comment     TEXT
);

CREATE INDEX idx_session_items_session ON session_items(session_id);

-- ---------------------------------------------------------------------------
-- ratings: one 👍/👎 vote per member per item. Kit rating is deliberately
-- BINARY to keep it thoughtless; the catalogue/rig views turn the tally into a
-- 1-5 star display: star = 1 + 4 x fraction-👍 (all 👍 -> 5★, all 👎 -> 1★). The
-- floor is 1★, not 0★ — even disliked kit reads as one star, never a blank zero.
-- Guards against a binary-average being misleading in a small club:
--   * UNIQUE(user_id, item_id) -> one STANDING vote per member, updatable.
--     Re-voting after a later session replaces the old vote (update `vote` +
--     `updated_at`), so a heavy user of one board can't stack its score.
--   * Callers should ALWAYS show the vote COUNT alongside the stars — that is
--     the pinch of salt, so there is no minimum-vote threshold. An item with
--     zero votes is the only special case: show "Not yet rated".
-- `session_id` is provenance only: the log it came from, or NULL when rated
-- straight from the catalogue (a harness, wetsuit, base a session won't prompt).
-- Whole-SESSION 1-5 star ratings are NOT here — those are author-only, one per
-- session, and belong on the future logbook/session record.
-- ---------------------------------------------------------------------------
CREATE TABLE ratings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    vote        INTEGER NOT NULL CHECK (vote IN (-1, 1)),  -- 👎 = -1, 👍 = 1
    session_id  INTEGER,   -- the log it came from; NULL if rated from the catalogue
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, item_id)
);

CREATE INDEX idx_ratings_item ON ratings(item_id);

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
           luff_cm AS "Luff", top_extension_max_cm AS "Adjustable Top",
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
