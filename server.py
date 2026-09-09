"""HTTP layer for the UBWC kit app.

A small JSON API over db.py plus the static front end in web/. Everything the
browser needs is here; nothing in here knows any windsurfing (that lives in
validation.py and rigkit.py) or any HTML (that lives in web/).

Run it with:  python server.py        (or: uvicorn server:app --reload)
"""
import io
import os
import secrets
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps
from PIL.Image import DecompressionBombError, UnidentifiedImageError

import db
import rigkit
import suggest
import validation
import wind

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"

# Uploaded photos live next to the database, on the same disk, so one volume
# and one backup cover the club's data (misc/scale.md, "Photos"). The name in
# each image_path column is relative to here and served from /photos.
PHOTOS_DIR = db.DATA_DIR / "photos"
PHOTOS_DIR.mkdir(parents=True, exist_ok=True)

# What the browser sends after its own downscale is a few hundred KB; anything
# far above that is a client that skipped it or a wrong file, and the disk is
# finite and shared with the database.
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
# The app never draws a photo wider than its ~390 px column at 2x, so a stored
# edge longer than this is bytes that can never be shown. Resizing down here is
# what moves the volume's ceiling from ~1,000 photos to ~20,000.
PHOTO_MAX_EDGE = 1600
PHOTO_QUALITY = 82

# The cookie carries a session token; the account behind it is looked up on
# every request (db.session_user), so signing out here signs out for real and a
# committee member is committee because their account says so; there is no
# shared PIN and nothing about the member is carried in the cookie itself.
COOKIE = "ubwc_session"

# Cookies are only marked Secure when the app is actually served over HTTPS.
# run.sh serves plain HTTP on the club wifi, where a Secure cookie would simply
# never come back and nobody could stay signed in.
SECURE_COOKIES = bool(os.environ.get("UBWC_HTTPS"))

# run.sh sets UBWC_DEV. Mobile Safari caches ES modules and stylesheets hard
# enough that a phone will happily show yesterday's build after an edit, which
# reads as "the change didn't work" rather than "the file is stale". While
# testing, tell it to keep nothing; in production the cache headers below do
# the same job without throwing away every file on every load.
DEV = bool(os.environ.get("UBWC_DEV"))


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Open the database before the first request, and say where it is.

    Printed rather than silent because on a host this line is the proof that
    the disk mounted: a path under /data is the club's inventory, a path under
    a home directory is a container-local file that dies with the next deploy.
    """
    db.ensure_db()
    print(f"UBWC: database at {db.DB_PATH}", flush=True)
    _bootstrap_admin()
    yield


app = FastAPI(title="UBWC Kit", docs_url=None, redoc_url=None, lifespan=_lifespan)

# The front end is ~800 KB of uncompressed JavaScript, CSS and JSON, and a
# member on the lake is on a phone on mobile data. gzip takes the text roughly
# a quarter of the size for a few milliseconds of CPU. Below 1 KB the header
# overhead is worth more than the saving, and PNGs are already compressed
# (Starlette skips anything already content-encoded).
app.add_middleware(GZipMiddleware, minimum_size=1000)


def _bootstrap_admin() -> None:
    """Make the first committee account from the environment, once.

    manage.py is the way to do this on a laptop, but on a host there may be no
    shell to run it in, and an app nobody can administer is not deployed. So
    UBWC_ADMIN_USER + UBWC_ADMIN_PASSWORD create that account at boot, or
    promote it if the name is already taken. Idempotent, and it never touches
    an existing account's password: once you can sign in, delete both variables.
    """
    username = (os.environ.get("UBWC_ADMIN_USER") or "").strip()
    password = os.environ.get("UBWC_ADMIN_PASSWORD") or ""
    if not username:
        return
    try:
        existing = db.get_user_by_username(username)
        if existing:
            if not existing["is_admin"]:
                db.set_admin(existing["id"], True)
                print(f"UBWC: promoted {username} to committee", flush=True)
            return
        if not password:
            print("UBWC: UBWC_ADMIN_USER set without UBWC_ADMIN_PASSWORD; "
                  "no account made", flush=True)
            return
        db.create_user(username, password, username, is_admin=True)
        print(f"UBWC: made committee account {username}. Remove "
              "UBWC_ADMIN_PASSWORD now.", flush=True)
    except Exception as error:          # never let this stop the app booting
        print(f"UBWC: could not bootstrap the committee account: {error}",
              flush=True)


# How long a browser may reuse a file before asking again. The front end has no
# build step, so filenames never change and "cache forever" would strand a
# member on an old app after a deploy. no-cache is not "do not cache": the file
# is kept and revalidated, so an unchanged file costs one small 304 rather than
# a re-download, and a deployed change is picked up on the next load. The
# manifest and icons under /assets do have stable content, so they get a real
# expiry.
CODE_CACHE = "no-cache"
ASSET_CACHE = "public, max-age=604800"      # a week
# A photo's name is a random token and its bytes never change, so a browser
# that has one never needs to ask again.
PHOTO_CACHE = "public, max-age=31536000, immutable"


@app.middleware("http")
async def _cache_headers(request: Request, call_next):
    response = await call_next(request)
    if DEV:
        response.headers["Cache-Control"] = "no-store, must-revalidate"
        return response
    path = request.url.path
    if path.startswith("/assets/"):
        response.headers.setdefault("Cache-Control", ASSET_CACHE)
    elif path.startswith("/photos/"):
        response.headers.setdefault("Cache-Control", PHOTO_CACHE)
    elif path.startswith(("/js/", "/css/")):
        response.headers.setdefault("Cache-Control", CODE_CACHE)
    elif path.startswith("/api/"):
        # Member-specific and always live. Safari has been known to serve a
        # cached GET to a signed-in member from before they signed in.
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.get("/api/health")
def health():
    """Is the app up and is its database the real one?

    The host polls this after a deploy; a member never sees it. It reports the
    database path so a bad mount is visible without a shell, and counts one row
    so that "up" means "can read the inventory", not merely "answered a socket".
    """
    try:
        with db.connect() as conn:
            items = conn.execute("SELECT count(*) AS n FROM items").fetchone()["n"]
    except Exception as error:
        raise HTTPException(503, f"Database unavailable: {error}")
    return {"ok": True, "items": items, "db": str(db.DB_PATH)}


# --------------------------------------------------------------------------- #
# Identity: a session cookie, looked up against the accounts table
#
# One request costs one small indexed lookup, and in exchange a sign-in can be
# ended from the server (a lost phone, a password change), which a self-contained
# signed cookie can never be.
# --------------------------------------------------------------------------- #
def identity(request: Request) -> dict:
    """{user, committee} for this request. Browsing needs neither."""
    user = db.session_user(request.cookies.get(COOKIE, ""))
    return {"user": user, "committee": bool(user and user["is_admin"])}


def _sign_in(response: Response, user: dict, request: Request) -> dict:
    token = db.start_session(user["id"], request.headers.get("user-agent", ""))
    response.set_cookie(COOKIE, token, max_age=60 * 60 * 24 * db.SESSION_DAYS,
                        httponly=True, samesite="lax", secure=SECURE_COOKIES,
                        path="/")
    return {"user": user, "committee": bool(user["is_admin"])}


def _sign_out(response: Response, request: Request) -> dict:
    db.end_session(request.cookies.get(COOKIE, ""))
    response.delete_cookie(COOKIE, path="/")
    return {"user": None, "committee": False}


def require_user(request: Request) -> dict:
    who = identity(request)
    if not who["user"]:
        raise HTTPException(401, "Sign in first.")
    return who["user"]


def require_committee(request: Request) -> dict:
    who = identity(request)
    if not who["user"]:
        raise HTTPException(401, "Sign in first.")
    if not who["committee"]:
        raise HTTPException(403, "This one is committee only.")
    return who["user"]


# --------------------------------------------------------------------------- #
# API: photo uploads
#
# One endpoint for every photo in the app (a piece of kit, a trip, a fault, a
# profile, a spot). It stores the file and hands back the path; attaching that
# path to something is the job of the ordinary create/edit call that follows,
# which is where the per-feature permissions live. The browser downscales
# before it uploads; this is the authority that still checks.
# --------------------------------------------------------------------------- #
def _store_photo(raw: bytes) -> str:
    """Verify raw bytes really are an image, resize down, save as JPEG.

    Returns the public path (/photos/<name>.jpg). The original is never kept:
    what lands on disk is at most PHOTO_MAX_EDGE on its long side, which is
    already more than the app can display.
    """
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "That photo is too big. Try one straight from "
                                 "the camera roll rather than a full-res export.")
    try:
        probe = Image.open(io.BytesIO(raw))
        probe.verify()                       # structural check; consumes probe
        image = Image.open(io.BytesIO(raw))  # reopen to actually use it
        image = ImageOps.exif_transpose(image)   # honour the phone's rotation
        image = image.convert("RGB")
        image.thumbnail((PHOTO_MAX_EDGE, PHOTO_MAX_EDGE))
    except (UnidentifiedImageError, DecompressionBombError, OSError, ValueError):
        raise HTTPException(422, "That file is not an image the app can read.")

    name = f"{secrets.token_hex(16)}.jpg"
    image.save(PHOTOS_DIR / name, "JPEG", quality=PHOTO_QUALITY, optimize=True)
    return f"/photos/{name}"


@app.post("/api/uploads")
async def upload_photo(request: Request, file: UploadFile = File(...)):
    """Take one image, store a resized copy, return {image_path}."""
    require_user(request)
    raw = await file.read()
    if not raw:
        raise HTTPException(422, "That upload was empty.")
    return {"image_path": _store_photo(raw)}


# --------------------------------------------------------------------------- #
# Sign-in throttle
#
# A four-word password and an open sign-up page means somebody will eventually
# point a script at /api/login. This is not a fortress: it is enough to make
# guessing slower than giving up, held in memory because a club server that
# restarts has bigger problems than a reset counter.
# --------------------------------------------------------------------------- #
_ATTEMPTS: dict = {}
ATTEMPT_LIMIT = 8
ATTEMPT_WINDOW_S = 15 * 60

# Sign-up is open by design, but on a public address "open" also means a script
# can make ten thousand accounts overnight. A dozen an hour from one address is
# far more than a fresher's week ever needs and far less than that is worth.
SIGNUP_LIMIT = 12
SIGNUP_WINDOW_S = 60 * 60

# The dict is keyed by (address, username), so a script working through a
# username list would otherwise grow it forever. Everything older than the
# window is dead weight, so sweep it when the dict gets big rather than on
# every request.
_ATTEMPTS_MAX_KEYS = 5000


def _client(request: Request) -> str:
    return request.client.host if request.client else "?"


def _sweep(now: float) -> None:
    if len(_ATTEMPTS) < _ATTEMPTS_MAX_KEYS:
        return
    oldest = max(ATTEMPT_WINDOW_S, SIGNUP_WINDOW_S)
    for key, tries in list(_ATTEMPTS.items()):
        if not tries or now - tries[-1] > oldest:
            _ATTEMPTS.pop(key, None)


def _limit(key: tuple, now: float, limit: int, window_s: int, message: str) -> None:
    """Record one try against `key` and refuse once there are too many."""
    tries = [t for t in _ATTEMPTS.get(key, []) if now - t < window_s]
    if len(tries) >= limit:
        wait = round((window_s - (now - tries[0])) / 60) or 1
        _ATTEMPTS[key] = tries
        raise HTTPException(429, message.format(wait=wait))
    tries.append(now)
    _ATTEMPTS[key] = tries


def _throttle(request: Request, username: str) -> None:
    now = time.time()
    _sweep(now)
    _limit((_client(request), db.normalise_username(username)), now,
           ATTEMPT_LIMIT, ATTEMPT_WINDOW_S,
           "Too many tries. Wait {wait} minutes, or ask the committee to "
           "reset your password.")


def _throttle_clear(request: Request, username: str) -> None:
    _ATTEMPTS.pop((_client(request), db.normalise_username(username)), None)


def _throttle_signup(request: Request) -> None:
    now = time.time()
    _sweep(now)
    _limit((_client(request), "\x00signup"), now, SIGNUP_LIMIT, SIGNUP_WINDOW_S,
           "That is a lot of new accounts from one place. Wait {wait} minutes, "
           "or ask a committee member.")


# --------------------------------------------------------------------------- #
# Shaping: one place that decides what an item looks like as JSON
# --------------------------------------------------------------------------- #
def item_card(item: dict, rating: dict = None, faults: list = None,
              favourite: bool = False, away: Optional[str] = None) -> dict:
    """The shape the catalogue's grid and list rows are drawn from."""
    return {
        "favourite": bool(favourite),
        # The trip this piece is packed for, if any. Its location does not
        # change while it is away — a trip never moves kit — so this is the
        # only thing that can say the rack is currently empty.
        "away": away,
        "id": item["id"],
        "component_type": item["component_type"],
        "manufacturer": item.get("manufacturer"),
        "model": item.get("model"),
        # Types that carry no `type` cell of their own (an extension is just an
        # extension) fall back to what the component type is called, so the
        # catalogue row and the item page still say what the thing is.
        "type": item.get("type") or db.COMPONENT_LABELS.get(item["component_type"]),
        # The raw `type` cell, null when there isn't one: the catalogue's filter
        # panel groups by it ("Freewave", "Wave"...) and a fallen-back label
        # ("Extension") is not a real subtype to offer.
        "raw_type": item.get("type"),
        "condition": item.get("condition"),
        "site": item.get("location"),
        "spot": item.get("spot"),
        "image_path": item.get("image_path"),
        "size_label": db.size_label(item),
        "size_value": _size_value(item),
        "size_unit": _size_unit(item),
        # For the filter panel's per-type sections and its sorts. diameter/box
        # are already columns; created_at drives the default "newest first".
        "diameter": item.get("diameter"),
        "box_type": item.get("box_type"),
        "created_at": item.get("created_at"),
        "rating": rating or {"up": 0, "down": 0, "n": 0, "stars": None, "mine": None},
        # description travels too now: the catalogue tile's fault chip opens a
        # pop-up with what is actually wrong, the same as the Build picker's.
        "faults": [{"id": f["id"], "title": f["title"], "severity": f["severity"],
                    "description": f.get("description")}
                   for f in (faults or [])],
        "rig_kind": rigkit.rig_kind(item),
        "cams": bool(item.get("cams")),
        "archived": bool(item.get("archived")),
        "archived_at": item.get("archived_at"),
        "archived_reason": item.get("archived_reason"),
    }


def _size_value(item: dict):
    ctype = item["component_type"]
    for key in (("sail", "size_m2"), ("wing", "size_m2"), ("board", "size_l"),
                ("mast", "length_cm"), ("fin", "fin_length_cm")):
        if ctype == key[0]:
            return item.get(key[1])
    if ctype == "boom" and item.get("min_size_cm") is not None:
        return f"{item['min_size_cm']:g}-{item['max_size_cm']:g}"
    if ctype == "ext":
        lo, hi = db.extension_travel(item)
        if hi is not None:
            return f"{lo:g}-{hi:g}"
    return None


def _size_unit(item: dict) -> str:
    return {"sail": "m²", "wing": "m²", "board": "L", "mast": "cm",
            "fin": "cm", "boom": "cm", "ext": "cm"}.get(item["component_type"], "")


# --------------------------------------------------------------------------- #
# API: bootstrap and identity
# --------------------------------------------------------------------------- #
@app.get("/api/bootstrap")
def bootstrap(request: Request):
    """Everything the shell needs before it can draw anything."""
    who = identity(request)
    counts = {}
    for item in db.all_items():
        counts[item["component_type"]] = counts.get(item["component_type"], 0) + 1
    return {
        "user": who["user"],
        "committee": who["committee"],
        "sites": db.get_sites(),
        # The trips a member can pick as their location: packing or out. A trip
        # is a place kit can be, so it sits in the same toggle as the sites.
        "trips": [{"id": t["id"], "name": t["name"],
                   "destination": t["destination"], "lat": t["lat"],
                   "lon": t["lon"], "status": t["status"],
                   "starts_on": t["starts_on"], "ends_on": t["ends_on"],
                   "n_items": t["n_items"]}
                  for t in db.get_trips()
                  if t["status"] in db.TRIP_AWAY_STAGES],
        "spots": db.get_spots(),
        # display_name -> profile photo, for every place a member's name shows.
        "avatars": db.member_avatars(),
        "types": [{"key": key, "label": db.COMPONENT_LABELS[key],
                   "count": counts.get(key, 0)} for key in db.CATALOGUE_TYPES],
        "conditions": db.FIELD_META["condition"]["choices"],
        "role_labels": db.ROLE_LABELS,
        # The add/edit form is generated from these: for each type, the ordered
        # fields and, for each field, how to label and render it. The form knows
        # no windsurfing itself — it just draws what db.py says a type is made of.
        "forms": {ctype: [_field_meta(ctype, field) for field in fields]
                  for ctype, fields in db.COMPONENT_FIELDS.items()},
        "required": validation.REQUIRED_FIELDS,
        "type_labels": db.COMPONENT_LABELS,
    }


def _field_meta(ctype: str, field: str) -> dict:
    meta = db.FIELD_META[field]
    return {
        "name": field,
        "label": db.field_label(ctype, field),
        "kind": meta["kind"],
        "optional": meta.get("optional", False),
        "choices": db.field_choices(ctype, field),
    }


@app.post("/api/signup")
def signup(request: Request, response: Response, payload: dict = Body(...)):
    """Join the club app. Open sign-up: anyone with the link can make an account.

    A new account is never committee: that is handed out by an existing
    committee member, or from the server with manage.py.
    """
    _throttle_signup(request)
    try:
        user = db.create_user(payload.get("username") or "",
                              payload.get("password") or "",
                              payload.get("display_name") or "")
    except db.AccountError as error:
        raise HTTPException(422, str(error))
    return _sign_in(response, user, request)


@app.post("/api/login")
def login(request: Request, response: Response, payload: dict = Body(...)):
    username = payload.get("username") or ""
    _throttle(request, username)
    user = db.authenticate(username, payload.get("password") or "")
    if not user:
        # Deliberately one message for both halves: telling somebody the
        # username exists is telling them which one to keep guessing at.
        raise HTTPException(401, "That username and password do not match.")
    _throttle_clear(request, username)
    return _sign_in(response, user, request)


@app.post("/api/logout")
def logout(request: Request, response: Response):
    return _sign_out(response, request)


@app.get("/api/me")
def me(request: Request):
    """Who am I, and how much of my own data is here."""
    who = identity(request)
    if not who["user"]:
        return {"user": None, "committee": False}
    user = who["user"]
    return {
        "user": user,
        "committee": who["committee"],
        "stats": db.member_stats(user["id"]),
        "devices": db.session_count(user["id"]),
    }


@app.post("/api/account/password")
def change_password(request: Request, response: Response, payload: dict = Body(...)):
    """Change my own password. Signs my other devices out, which is the point."""
    user = require_user(request)
    if not db.check_current_password(user["id"], payload.get("current") or ""):
        raise HTTPException(403, "That is not your current password.")
    try:
        db.set_password(user["id"], payload.get("password") or "")
    except db.AccountError as error:
        raise HTTPException(422, str(error))
    db.end_all_sessions(user["id"])
    return _sign_in(response, user, request)


@app.post("/api/account/name")
def change_display_name(request: Request, payload: dict = Body(...)):
    user = require_user(request)
    try:
        updated = db.set_display_name(user["id"], payload.get("display_name") or "")
    except db.AccountError as error:
        raise HTTPException(422, str(error))
    return {"user": updated, "committee": bool(updated["is_admin"])}


@app.post("/api/account/photo")
def change_avatar(request: Request, payload: dict = Body(...)):
    """Set my profile photo (image_path from /api/uploads), or clear it with
    null. It then stands in for my initials everywhere my name is shown."""
    user = require_user(request)
    updated = db.set_avatar(user["id"], (payload.get("image_path") or "").strip() or None)
    return {"user": updated, "committee": bool(updated["is_admin"])}


# --------------------------------------------------------------------------- #
# API: committee member admin
#
# Committee is an account flag now, so somebody has to be able to hand it out.
# Only a committee member can, and the last one cannot stand themselves down
# (db.set_admin), otherwise the club locks itself out of its own kit list.
# --------------------------------------------------------------------------- #
@app.get("/api/members")
def members(request: Request):
    require_committee(request)
    return {"members": db.member_admin_list()}


@app.post("/api/members/{user_id}/admin")
def set_member_admin(user_id: int, request: Request, payload: dict = Body(...)):
    require_committee(request)
    if not db.get_user(user_id):
        raise HTTPException(404, "No such member.")
    try:
        return {"member": db.set_admin(user_id, bool(payload.get("is_admin")))}
    except db.AccountError as error:
        raise HTTPException(422, str(error))


@app.post("/api/members/{user_id}/password")
def reset_member_password(user_id: int, request: Request, payload: dict = Body(...)):
    """Committee sets a member's password: the answer to "I've forgotten mine",
    and what claims a seeded roster account so its history stays attached."""
    require_committee(request)
    if not db.get_user(user_id):
        raise HTTPException(404, "No such member.")
    try:
        db.set_password(user_id, payload.get("password") or "")
    except db.AccountError as error:
        raise HTTPException(422, str(error))
    db.end_all_sessions(user_id)
    return {"ok": True}


@app.get("/api/members/{user_id}/ratings")
def member_ratings(user_id: int, request: Request):
    """One member's rating history, which is what a spam claim is judged on."""
    require_committee(request)
    return {"member": db.get_user(user_id), "ratings": db.member_ratings(user_id)}


@app.post("/api/members/{user_id}/ratings/void")
def void_member_ratings(user_id: int, request: Request, payload: dict = Body({})):
    """Strike out (or put back) every rating a member has given.

    The undo for somebody spamming 👍/👎 to move the club's numbers. Nothing is
    deleted, so a wrong call here is reversible.
    """
    admin = require_committee(request)
    if not db.get_user(user_id):
        raise HTTPException(404, "No such member.")
    if (payload or {}).get("restore"):
        return {"restored": db.restore_member_ratings(user_id)}
    return {"voided": db.void_member_ratings(user_id, admin["id"])}


# --------------------------------------------------------------------------- #
# API: catalogue
# --------------------------------------------------------------------------- #
@app.get("/api/items")
def list_items(request: Request,
               type: Optional[str] = Query(None),
               site: Optional[str] = Query(None),
               q: Optional[str] = Query(None),
               archived: bool = Query(False)):
    """The catalogue for a site: everything there, shaped for the grid.

    The catalogue now loads a whole site in one call and does its own
    type/subtype/fault/sort work in the browser, so the panel's every toggle is
    instant. `type` and `q` are still honoured for older links and any other
    caller, but the app leaves them off. This endpoint returns out-of-action kit
    like any other row — the app hides it by default (Major-faults filter off)
    but the inventory itself is complete. Archived kit stays a committee-only
    view, off by default (`archived=true`).
    """
    who = identity(request)
    user_id = who["user"]["id"] if who["user"] else None
    if archived:
        require_committee(request)
    ratings = db.ratings_by_item(user_id)
    faults = db.open_faults_by_item()
    favourites = db.favourite_ids(user_id)
    away = db.away_item_ids()

    needle = (q or "").strip().lower()
    rows = []
    source = db.get_archived_items() if archived else db.all_items()
    for item in source:
        if type and type != "all" and item["component_type"] != type:
            continue
        if site and site != "all" and item.get("location") != site:
            continue
        if needle:
            haystack = " ".join(str(item.get(f) or "") for f in
                                ("manufacturer", "model", "type", "diameter",
                                 "location", "spot", "notes", "size_generic")).lower()
            if needle not in haystack:
                continue
        rows.append(item_card(item, ratings.get(item["id"]), faults.get(item["id"]),
                              item["id"] in favourites, away.get(item["id"])))

    def sort_key(card):
        blocked = any(f["severity"] == "out_of_action" for f in card["faults"])
        return (blocked, -(card["rating"]["stars"] or 0), card["manufacturer"] or "",
                card["model"] or "")

    rows.sort(key=sort_key)
    return {"items": rows, "count": len(rows)}


@app.get("/api/items/{item_id}")
def read_item(item_id: int, request: Request):
    who = identity(request)
    user_id = who["user"]["id"] if who["user"] else None
    item = db.get_item(item_id)
    if not item:
        raise HTTPException(404, "No such item.")

    history = db.fault_history(item_id)
    card = item_card(item, db.rating_for(item_id, user_id),
                     [f for f in history if f["status"] == "open"],
                     db.is_favourite(item_id, user_id),
                     db.away_item_ids().get(item_id))
    return {
        **card,
        "notes": item.get("notes"),
        "spec": [{"label": label, "value": value} for label, value in db.spec_rows(item)],
        "spot_description": db.spot_description(item.get("location"), item.get("spot")),
        "recommended": db.recommended_rig(item),
        "diameter": db.diameter_class(item),
        "fault_history": history,
        "comments": db.get_comments(item_id),
        # So a commenter's or fault-reporter's photo shows next to their name.
        "avatars": db.member_avatars(),
        "fields": db.COMPONENT_FIELDS[item["component_type"]],
        "raw": {k: item.get(k) for k in db.COMPONENT_FIELDS[item["component_type"]]},
    }


@app.post("/api/items")
def create_item(request: Request, payload: dict = Body(...)):
    """Add a piece of kit. Committee only for now (misc/spec.md future idea:
    open this back up for members adding their own personal kit)."""
    require_committee(request)
    record = dict(payload.get("item") or {})
    ctype = record.get("component_type")
    if ctype not in db.COMPONENT_FIELDS:
        raise HTTPException(400, "Pick what kind of kit this is.")

    problems = validation.check_item(record)
    if problems.errors:
        raise HTTPException(422, "; ".join(problems.errors))

    item_id = db.add_item(record)
    _write_faults(item_id, payload.get("faults") or [], request)
    return {"id": item_id, "warnings": problems.warnings}


@app.put("/api/items/{item_id}")
def edit_item(item_id: int, request: Request, payload: dict = Body(...)):
    """Edit opens the same form as Add, so it takes the same body."""
    require_user(request)
    if not db.get_item(item_id):
        raise HTTPException(404, "No such item.")
    record = dict(payload.get("item") or {})
    problems = validation.check_item({**record, "component_type":
                                      db.get_item(item_id)["component_type"]})
    if problems.errors:
        raise HTTPException(422, "; ".join(problems.errors))
    db.update_item(item_id, record)
    _write_faults(item_id, payload.get("faults") or [], request)
    return {"id": item_id, "warnings": problems.warnings}


def _write_faults(item_id: int, faults: list, request: Request) -> None:
    """Faults typed on the add/edit form. Only new ones are inserted, so
    re-saving an item does not duplicate the flags it already carries."""
    who = identity(request)
    author = (who["user"] or {}).get("display_name")
    existing = {(f["title"] or "").strip().lower()
                for f in db.get_faults(item_id, status="open")}
    for fault in faults:
        title = (fault.get("title") or "").strip()
        description = (fault.get("description") or "").strip()
        if not title and not description:
            continue
        if title.lower() in existing:
            continue
        db.report_fault(item_id, title or description[:60], description or title,
                        fault.get("severity") or "usable", author,
                        fault.get("image_path"))


@app.delete("/api/items/{item_id}")
def remove_item(item_id: int, request: Request):
    require_committee(request)
    db.delete_item(item_id)
    return {"ok": True}


@app.post("/api/items/{item_id}/archive")
def archive_item(item_id: int, request: Request, payload: dict = Body({})):
    """Retire broken/retired kit without losing its history (see delete, above)."""
    require_committee(request)
    if not db.get_item(item_id):
        raise HTTPException(404, "No such item.")
    db.archive_item(item_id, (payload or {}).get("reason"))
    return {"ok": True}


@app.post("/api/items/{item_id}/unarchive")
def unarchive_item(item_id: int, request: Request):
    require_committee(request)
    if not db.get_item(item_id):
        raise HTTPException(404, "No such item.")
    db.unarchive_item(item_id)
    return {"ok": True}


@app.post("/api/items/move")
def move(request: Request, payload: dict = Body(...)):
    """Committee move / bulk-move. Packing a trip is this with many ids."""
    require_committee(request)
    site = (payload.get("site") or "").strip()
    if not site:
        raise HTTPException(400, "Pick a site to move to.")
    db.add_site(site)
    moved = db.move_items([int(i) for i in payload.get("item_ids") or []],
                          site, (payload.get("spot") or "").strip() or None)
    return {"moved": moved, "sites": db.get_sites()}


@app.post("/api/spots")
def edit_spot(request: Request, payload: dict = Body(...)):
    """Committee: set the note and photo for one spot (keyed by site + name).

    The only way either is written from the app. Returns the whole spot list so
    the browser can refresh what it shows in the spot popup straight away.
    """
    require_committee(request)
    try:
        db.upsert_spot(payload.get("site") or "", payload.get("name") or "",
                       payload.get("description"), payload.get("image_path"))
    except ValueError as error:
        raise HTTPException(400, str(error))
    return {"spots": db.get_spots()}


@app.post("/api/items/{item_id}/vote")
def vote(item_id: int, request: Request, vote: Optional[int] = Body(None, embed=True)):
    """Rate a piece of kit. Sending the same thumb again withdraws it.

    Rating something a second time after another session on it is expected and
    is kept as history; only the member's latest rating counts toward the stars
    (db._LIVE_VOTES).
    """
    user = require_user(request)
    return db.set_vote(item_id, user["id"], vote)


@app.post("/api/items/{item_id}/favourite")
def favourite(item_id: int, request: Request, on: bool = Body(True, embed=True)):
    """Bookmark a piece of kit, so the rig wizard flags it while you choose."""
    user = require_user(request)
    if not db.get_item(item_id):
        raise HTTPException(404, "No such item.")
    return {"favourite": db.set_favourite(item_id, user["id"], on)}


@app.post("/api/items/{item_id}/comments")
def comment(item_id: int, request: Request, payload: dict = Body(...)):
    user = require_user(request)
    body = (payload.get("body") or "").strip()
    if not body:
        raise HTTPException(400, "Write something first.")
    db.add_comment(item_id, body, payload.get("kind") or "note",
                   author=user["display_name"], user_id=user["id"])
    return {"comments": db.get_comments(item_id)}


@app.post("/api/items/{item_id}/faults")
def add_fault(item_id: int, request: Request, payload: dict = Body(...)):
    user = require_user(request)
    description = (payload.get("description") or "").strip()
    title = (payload.get("title") or "").strip()
    if not title:
        raise HTTPException(400, "Give the fault a short name.")
    db.report_fault(item_id, title, description or title,
                    payload.get("severity") or "usable", user["display_name"],
                    payload.get("image_path"))
    return {"fault_history": db.fault_history(item_id)}


@app.post("/api/faults/{fault_id}/fix")
def fix(fault_id: int, request: Request, payload: dict = Body(...)):
    """Any member can report a fix; it waits for committee sign-off to clear."""
    user = require_user(request)
    db.report_fix(fault_id, (payload.get("body") or "Repaired.").strip(),
                  user["display_name"], payload.get("image_path"))
    return {"ok": True}


@app.post("/api/faults/{fault_id}/clear")
def clear(fault_id: int, request: Request):
    user = require_committee(request)
    db.clear_fault(fault_id, user["display_name"])
    return {"ok": True}


# --------------------------------------------------------------------------- #
# API: the rig assistant
# --------------------------------------------------------------------------- #
@app.get("/api/rig/kit")
def rig_kit(request: Request, site: Optional[str] = Query(None),
            trip: Optional[int] = Query(None)):
    who = identity(request)
    user_id = who["user"]["id"] if who["user"] else None
    if trip:
        # The assistant pointed at one trip: its kit, from wherever it is stored,
        # away flag and all. An unknown trip yields an empty list rather than the
        # whole inventory.
        found = db.get_trip(trip)
        ids = ({row["item_id"] for row in found["items"] if not row["declined"]}
               if found else set())
        return {"kit": rigkit.kit(user_id=user_id, only_ids=ids)}
    return {"kit": rigkit.kit(site if site and site != "all" else None, user_id)}


@app.get("/api/rig/suggest")
def rig_suggest(request: Request, site: Optional[str] = Query(None)):
    """The sizes to open Build on: this member's own, in today's wind.

    A member with no logbook gets the club's usual sizes, which is where the
    wizard started before it could learn anything. See suggest.py for the maths.
    """
    who = identity(request)
    user_id = who["user"]["id"] if who["user"] else None
    here = site if site and site != "all" else None
    now = datetime.now(timezone.utc).isoformat(timespec="minutes")
    return suggest.for_member(user_id, wind.for_window(here, now) if here else None, here)


@app.get("/api/setup")
def read_setup(request: Request):
    who = identity(request)
    if not who["user"]:
        return {"setup": None}
    setup = db.current_setup(who["user"]["id"])
    return {"setup": _expand_setup(setup)}


def _expand_setup(setup: Optional[dict]) -> Optional[dict]:
    """Join a stored setup back to live inventory rows.

    Reading the item fresh each time is deliberate: a fault reported after you
    rigged, or a rating somebody left, should show on your setup screen.
    """
    if not setup:
        return None
    ratings = db.ratings_by_item()
    faults = db.open_faults_by_item()
    notes = db.comments_by_item()
    trip = db.get_trip(setup["trip_id"]) if setup.get("trip_id") else None
    pieces = []
    for piece in setup["pieces"]:
        item = db.get_item(piece["item_id"]) if piece["item_id"] else None
        pieces.append({
            "role": piece["role"],
            "role_label": db.ROLE_LABELS.get(piece["role"], piece["role"]),
            "settings": piece["settings"],
            "custom": piece["custom"],
            "item": (item_card(item, ratings.get(item["id"]), faults.get(item["id"]))
                     if item else None),
            "spec": [{"label": label, "value": value}
                     for label, value in db.spec_rows(item)] if item else [],
            "spot_description": (db.spot_description(item.get("location"), item.get("spot"))
                                 if item else None),
            "notes": notes.get(item["id"], []) if item else [],
        })
    return {**{k: v for k, v in setup.items() if k != "pieces"},
            "pieces": pieces,
            "trip": ({"id": trip["id"], "name": trip["name"],
                      "destination": trip["destination"], "lat": trip["lat"],
                      "lon": trip["lon"]} if trip else None)}


@app.post("/api/setup")
def write_setup(request: Request, payload: dict = Body(...)):
    """Confirm a rig. Replaces any setup still marked active for this member."""
    user = require_user(request)
    trip_id = payload.get("trip_id")
    setup = db.save_setup(user["id"], payload.get("site"),
                          payload.get("pieces") or [],
                          int(trip_id) if trip_id else None)
    return {"setup": _expand_setup(setup)}


@app.post("/api/setup/{setup_id}/derig")
def derig(setup_id: int, request: Request):
    """Guidance only: nothing moves, the setup just stops being 'out now'."""
    require_user(request)
    return {"setup": _expand_setup(db.derig_setup(setup_id))}


@app.post("/api/setup/{setup_id}/bin")
def bin_setup(setup_id: int, request: Request):
    require_user(request)
    db.close_setup(setup_id, "binned")
    return {"setup": None}


# --------------------------------------------------------------------------- #
# API: trips
#
# Reading is open, the way the catalogue is: what the trailer is taking is the
# whole club's business, and a trip opens for members to ask for kit before it
# is packed. Writing is committee — packing the trailer is the kit sec's job
# and the list is the club's record of what left the building — with the one
# exception of a request, which is any member's to make.
#
# Nothing here writes items.location. A trip is a named list, not a place, so
# kit keeps saying where it is stored for the whole trip and ending a trip is
# simply letting go of it. What being on a trip does change is availability:
# db.away_item_ids is subtracted from the rig picker, and shown as a flag in
# the catalogue.
# --------------------------------------------------------------------------- #
@app.get("/api/trips/kit")
def trip_kit(request: Request):
    """Everything packable, from every site, including kit already on a trip.

    Not filtered to the member's site (a trailer is loaded from every store)
    and not filtered by availability, because seeing that the good 5.0 is
    already down for another weekend is the point — `piece.away` carries which
    trip, and the server refuses to double-book it.
    """
    # Any signed-in member: this is the request picker as well as the kit sec's,
    # and it says nothing the catalogue does not already show.
    require_user(request)
    kit = rigkit.kit(None, None, exclude_away=False)
    # Two shapes of the same kit: the rig pieces the pack maths reasons about,
    # and the catalogue's own cards to draw them as, so the picker is a wall of
    # product shots rather than a second, plainer list of the same inventory.
    ratings = db.ratings_by_item()
    faults = db.open_faults_by_item()
    away = db.away_item_ids()
    cards = {}
    for piece in kit:
        item = db.get_item(piece["id"])
        if item:
            cards[piece["id"]] = item_card(item, ratings.get(item["id"]),
                                           faults.get(item["id"]), False,
                                           away.get(item["id"]))
    return {"kit": kit, "cards": cards}


@app.get("/api/trips")
def list_trips(request: Request):
    return {"trips": db.get_trips()}


@app.post("/api/trips")
def create_trip(request: Request, payload: dict = Body(...)):
    user = require_committee(request)
    try:
        trip = db.create_trip(user["id"], payload.get("name") or "",
                              payload.get("items") or [],
                              payload.get("destination"),
                              payload.get("starts_on"), payload.get("ends_on"),
                              # Default on: letting the club ask first is the
                              # normal way a trip starts, and a kit sec who
                              # already knows what is going turns it off.
                              bool(payload.get("requesting", True)),
                              payload.get("notes"),
                              payload.get("image_path"),
                              payload.get("lat"), payload.get("lon"))
    except db.TripError as error:
        raise HTTPException(422, str(error))
    return {"trip": _expand_trip(trip, identity(request)["user"])}


@app.get("/api/trips/{trip_id}")
def read_trip(trip_id: int, request: Request):
    trip = db.get_trip(trip_id)
    if not trip:
        raise HTTPException(404, "No such trip.")
    return {"trip": _expand_trip(trip, identity(request)["user"])}


@app.get("/api/trips/{trip_id}/forecast")
def trip_forecast(trip_id: int, request: Request):
    """The trip's sailing days at its pin, hour by hour, one entry per day.

    Null (or a short list) whenever the whole span cannot be had — no pin on
    the trip and none on the site, dates beyond the forecast, no network at the
    lake — and the strip is drawn shorter or not at all. A trip is still a trip
    without a forecast.
    """
    trip = db.get_trip(trip_id)
    if not trip:
        raise HTTPException(404, "No such trip.")
    start = trip.get("starts_on")
    end = trip.get("ends_on")
    site = trip.get("destination")
    coords = ((trip.get("lat"), trip.get("lon"))
              if trip.get("lat") is not None and trip.get("lon") is not None
              else None)
    days = (wind.forecast(site, start, end, coords=coords)
            if start and (site or coords) else None)
    return {"forecast": days, "site": site, "start": start, "end": end}


@app.get("/api/geocode")
def geocode(q: str = Query("")):
    """Typed place -> pins, for the new-trip form's "Pin the spot" box. Public,
    like every other read; empty on anything going wrong."""
    return {"results": wind.geocode(q)}


@app.post("/api/trips/{trip_id}/items")
def write_trip_items(trip_id: int, request: Request, payload: dict = Body(...)):
    """Replace a trip's kit. What the packing wizard saves once it has derived
    the rig kit the chosen boards and sails imply."""
    require_committee(request)
    if not db.get_trip(trip_id):
        raise HTTPException(404, "No such trip.")
    try:
        trip = db.set_trip_items(trip_id, payload.get("items") or [])
    except db.TripError as error:
        raise HTTPException(422, str(error))
    return {"trip": _expand_trip(trip, identity(request)["user"])}


@app.post("/api/trips/{trip_id}/items/add")
def add_trip_items(trip_id: int, request: Request, payload: dict = Body(...)):
    """Add kit to a trip without touching the rest of the list.

    The picker sheet adds a piece at a time, so it posts here rather than
    replacing the whole list from a browser that may be holding a stale copy.
    """
    require_committee(request)
    if not db.get_trip(trip_id):
        raise HTTPException(404, "No such trip.")
    try:
        trip = db.add_trip_items(trip_id, payload.get("items") or [])
    except db.TripError as error:
        raise HTTPException(422, str(error))
    return {"trip": _expand_trip(trip, identity(request)["user"])}


@app.post("/api/trips/{trip_id}/items/remove")
def remove_trip_item(trip_id: int, request: Request, payload: dict = Body(...)):
    """Take one piece back off. The long-press on a tile."""
    require_committee(request)
    if not db.get_trip(trip_id):
        raise HTTPException(404, "No such trip.")
    item_id = payload.get("item_id")
    if item_id is None:
        raise HTTPException(400, "Say which piece is coming off.")
    trip = db.remove_trip_item(trip_id, int(item_id))
    return {"trip": _expand_trip(trip, identity(request)["user"])}


@app.post("/api/trips/{trip_id}/finalise")
def finalise_trip_kit(trip_id: int, request: Request, payload: dict = Body(...)):
    """The Confirm screen's Continue: fix the trip's chosen kit and let go of
    the requests for anything the kit sec did not take through.

    Requests for kit that stayed on the list are kept — the disc stacks on the
    packing and active trip read them — so a piece the kit sec left off just
    stops being a pending row rather than being recorded as a "no".
    """
    require_committee(request)
    if not db.get_trip(trip_id):
        raise HTTPException(404, "No such trip.")
    try:
        trip = db.finalise_trip_kit(trip_id, payload.get("items") or [])
    except db.TripError as error:
        raise HTTPException(422, str(error))
    return {"trip": _expand_trip(trip, identity(request)["user"])}


@app.post("/api/trips/{trip_id}/request/drop")
def drop_trip_request(trip_id: int, request: Request, payload: dict = Body(...)):
    """The kit sec clearing one piece off the wishlist before Confirm: every
    member's request for it, at once. Not kept — the list is read once."""
    require_committee(request)
    if not db.get_trip(trip_id):
        raise HTTPException(404, "No such trip.")
    item_id = payload.get("item_id")
    if item_id is None:
        raise HTTPException(400, "Say which piece is coming off the list.")
    trip = db.drop_trip_request(trip_id, int(item_id))
    return {"trip": _expand_trip(trip, identity(request)["user"])}


@app.post("/api/trips/{trip_id}/edit")
def edit_trip(trip_id: int, request: Request, payload: dict = Body(...)):
    require_committee(request)
    if not db.get_trip(trip_id):
        raise HTTPException(404, "No such trip.")
    try:
        trip = db.update_trip(trip_id, payload or {})
    except db.TripError as error:
        raise HTTPException(422, str(error))
    return {"trip": _expand_trip(trip, identity(request)["user"])}


@app.post("/api/trips/{trip_id}/stage")
def set_trip_stage(trip_id: int, request: Request, payload: dict = Body(...)):
    """Move a trip on a stage, or back one. The kit sec holds the clipboard."""
    require_committee(request)
    if not db.get_trip(trip_id):
        raise HTTPException(404, "No such trip.")
    try:
        trip = db.set_trip_stage(trip_id, payload.get("status") or "")
    except db.TripError as error:
        raise HTTPException(422, str(error))
    return {"trip": _expand_trip(trip, identity(request)["user"])}


@app.post("/api/trips/{trip_id}/packed")
def trip_packed(trip_id: int, request: Request, payload: dict = Body(...)):
    """One piece ticked onto the trailer. Moves nothing: it never leaves its rack."""
    require_committee(request)
    if not db.get_trip(trip_id):
        raise HTTPException(404, "No such trip.")
    item_id = payload.get("item_id")
    if item_id is None:
        raise HTTPException(400, "Say which piece went on.")
    trip = db.set_trip_packed(trip_id, int(item_id), bool(payload.get("on", True)))
    return {"trip": _expand_trip(trip, identity(request)["user"])}


@app.post("/api/trips/{trip_id}/close")
def close_trip(trip_id: int, request: Request, payload: dict = Body({})):
    """End a trip. `all` is the usual way: everything comes home at once.

    There is no per-piece return tick, and deliberately so: coming home is one
    act. The kit sec presses End trip, confirms, and every piece on the list
    goes back to being available at the rack it never left.
    """
    require_committee(request)
    if not db.get_trip(trip_id):
        raise HTTPException(404, "No such trip.")
    payload = payload or {}
    try:
        if payload.get("all"):
            trip = db.return_all(trip_id)
        else:
            trip = db.close_trip(trip_id, payload.get("status") or "done")
    except db.TripError as error:
        raise HTTPException(422, str(error))
    return {"trip": _expand_trip(trip, identity(request)["user"])}


@app.post("/api/trips/{trip_id}/request")
def trip_request(trip_id: int, request: Request, payload: dict = Body(...)):
    """One member asking for one piece of kit, or taking the ask back.

    The only trip write an ordinary member can make, and only while the trip is
    still asking: once the kit sec has been through the deck the list is a
    record, not an open question.
    """
    user = require_user(request)
    trip = db.get_trip(trip_id)
    if not trip:
        raise HTTPException(404, "No such trip.")
    if trip["status"] != "requesting":
        raise HTTPException(409, "This trip has stopped taking requests.")
    item_id = payload.get("item_id")
    if item_id is None:
        raise HTTPException(400, "Say which piece you are asking for.")
    return db.set_trip_request(trip_id, int(item_id), user["id"],
                               bool(payload.get("on", True)))


def _expand_trip(trip: Optional[dict],
                 user: Optional[dict] = None) -> Optional[dict]:
    """Join a trip's stored item ids back to live inventory rows.

    Read fresh, like a setup is: a fault reported on the Friday of a trip
    should be on the list the kit sec checks against on the Sunday.
    """
    if not trip:
        return None
    ratings = db.ratings_by_item()
    faults = db.open_faults_by_item()
    # Who asked for what, drawn server-side. Carried on every trip, not just one
    # still asking, because the tags stay on the kit for the whole trip: on the
    # water "who wanted the 124?" is a real question and this is its answer.
    counts = db.trip_request_counts(trip["id"])
    who = db.trip_requesters(trip["id"])
    decided = {row["item_id"] for row in trip["items"]}

    def card(item_id):
        item = db.get_item(item_id)
        return item_card(item, ratings.get(item_id),
                         faults.get(item_id)) if item else None

    # The requests still waiting on an answer, newest first. That is the order
    # the requesting screen reads in and the order the deck deals in, because
    # they are the same list: what the club has just asked for.
    pending = []
    for item_id in db.trip_request_order(trip["id"]):
        n = counts.get(item_id, 0)
        if item_id in decided:
            continue
        shaped = card(item_id)
        if shaped:
            pending.append({"requests": n, "who": who.get(item_id, []),
                            "item": shaped})

    rows, declined = [], []
    for entry in trip["items"]:
        shaped = card(entry["item_id"])
        if not shaped:
            continue
        row = {
            "role": entry["role"],
            "role_label": db.ROLE_LABELS.get(entry["role"], entry["role"]),
            "source": entry["source"],
            "packed": bool(entry["packed"]),
            "returned": bool(entry["returned"]),
            "note": entry["note"],
            "requests": counts.get(entry["item_id"], 0),
            "who": who.get(entry["item_id"], []),
            "item": shaped,
        }
        (declined if entry["declined"] else rows).append(row)

    return {**{k: v for k, v in trip.items() if k != "items"},
            "items": rows, "declined": declined, "pending": pending,
            "requests": counts, "who": who,
            "my_requests": db.trip_requests_by_user(
                trip["id"], user["id"] if user else None)}


# --------------------------------------------------------------------------- #
# API: the logbook
# --------------------------------------------------------------------------- #
@app.get("/api/sessions")
def list_sessions(request: Request, scope: str = Query("club")):
    who = identity(request)
    mine = scope == "mine" and who["user"]
    return {"sessions": db.get_sessions(who["user"]["id"] if mine else None)}


@app.post("/api/sessions")
def create_session(request: Request, payload: dict = Body(...)):
    user = require_user(request)
    return {"session": db.log_session(user["id"], payload)}


@app.get("/api/wind")
def read_wind(start: str = Query(...), site: Optional[str] = Query(None),
              end: Optional[str] = Query(None),
              lat: Optional[float] = Query(None),
              lon: Optional[float] = Query(None)):
    """Wind over the rig-to-de-rig window. Null when it cannot be fetched.

    `lat`/`lon` is a trip's own pin: passed when the session was sailed on a
    trip, whose destination usually has no `sites` row to look coordinates up
    on. An explicit pin wins over the site (see `wind._coords`).
    """
    coords = (lat, lon) if lat is not None and lon is not None else None
    return {"wind": wind.for_window(site or "", start, end, coords=coords)}


# --------------------------------------------------------------------------- #
# API: the member's own record
# --------------------------------------------------------------------------- #
@app.get("/api/profile")
def profile(request: Request, site: Optional[str] = Query(None)):
    """Everything the app has learned about how this member sails.

    Deliberately not a second copy of the logbook: the Log tab already shows a
    member their sessions and rigs under "Mine". This is the shape of their
    sailing: the sizes they rig against the wind they rig them in, which is
    what the wizard's opening suggestion is drawn from, plus the kit they reach
    for most and what they have bookmarked.
    """
    user = require_user(request)
    here = site if site and site != "all" else None
    now = datetime.now(timezone.utc).isoformat(timespec="minutes")
    reading = wind.for_window(here, now) if here else None
    ratings = db.ratings_by_item(user["id"])
    return {
        "user": user,
        "stats": db.member_stats(user["id"]),
        "curve": suggest.curve(user["id"], reading, here),
        "kit": db.kit_usage(user["id"]),
        "favourites": [item_card(item, ratings.get(item["id"]), favourite=True)
                       for item in db.favourite_items(user["id"])],
    }


# --------------------------------------------------------------------------- #
# Static front end
# --------------------------------------------------------------------------- #
app.mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets")
app.mount("/css", StaticFiles(directory=WEB / "css"), name="css")
app.mount("/js", StaticFiles(directory=WEB / "js"), name="js")
# Uploaded photos, from the volume rather than the repo. Already-compressed, so
# gzip skips them; cached hard because each name is unique to its bytes.
app.mount("/photos", StaticFiles(directory=PHOTOS_DIR), name="photos")


@app.exception_handler(HTTPException)
def http_error(request: Request, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.get("/{path:path}")
def index(path: str):
    """One page; the tab bar and screen stack are client-side."""
    if path.startswith("api/"):
        raise HTTPException(404, "No such endpoint.")
    return FileResponse(WEB / "index.html")


if __name__ == "__main__":
    import uvicorn

    # A host (Railway, Fly, anything container-shaped) hands the app a port in
    # $PORT and expects it on every interface, because the process is talking
    # to that platform's proxy rather than to the internet directly. On a
    # laptop none of these is set, and the app stays on loopback until run.sh
    # asks for more with UBWC_HOST=0.0.0.0 (the phone-on-the-same-wifi mode).
    #
    # Not $PORT alone: a platform that sniffs the listening port instead of
    # setting one would leave the app bound to loopback and unreachable, which
    # looks exactly like a broken deploy. Any of these markers means hosted.
    hosted = any(os.environ.get(name) for name in
                 ("PORT", "UBWC_HOSTED", "RAILWAY_ENVIRONMENT",
                  "RAILWAY_PROJECT_ID", "FLY_APP_NAME"))
    host = os.environ.get("UBWC_HOST") or ("0.0.0.0" if hosted else "127.0.0.1")
    port = int(os.environ.get("UBWC_PORT") or os.environ.get("PORT") or "8000")

    # Behind that proxy every request arrives from one address, so the
    # sign-in throttle would count the whole club as a single guesser unless
    # uvicorn is told to believe the forwarded-for header. Only trust it when
    # hosted: on the club wifi anyone could set the header by hand and the
    # real socket address is the honest one.
    uvicorn.run("server:app", host=host, port=port, reload=False,
                proxy_headers=hosted,
                forwarded_allow_ips="*" if hosted else None,
                # One process. kit.db is a file on one disk and two workers
                # would be two apps fighting over it (and, on a platform that
                # gives each replica its own disk, two diverging inventories).
                workers=1)
