"""HTTP layer for the UBWC kit app.

A small JSON API over db.py plus the static front end in web/. Everything the
browser needs is here; nothing in here knows any windsurfing (that lives in
validation.py and rigkit.py) or any HTML (that lives in web/).

Run it with:  python server.py        (or: uvicorn server:app --reload)
"""
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import db
import rigkit
import suggest
import validation
import wind

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"

# The cookie carries a session token; the account behind it is looked up on
# every request (db.session_user), so signing out here signs out for real and a
# committee member is committee because their account says so; there is no
# shared PIN and nothing about the member is carried in the cookie itself.
COOKIE = "ubwc_session"

# Cookies are only marked Secure when the app is actually served over HTTPS.
# run.sh serves plain HTTP on the club wifi, where a Secure cookie would simply
# never come back and nobody could stay signed in.
SECURE_COOKIES = bool(os.environ.get("UBWC_HTTPS"))

app = FastAPI(title="UBWC Kit", docs_url=None, redoc_url=None)

# run.sh sets UBWC_DEV. Mobile Safari caches ES modules and stylesheets hard
# enough that a phone will happily show yesterday's build after an edit, which
# reads as "the change didn't work" rather than "the file is stale". While
# testing, tell it to keep nothing; in production the ?v= query strings on the
# stylesheets do the versioning instead.
DEV = bool(os.environ.get("UBWC_DEV"))


@app.middleware("http")
async def _no_cache_in_dev(request: Request, call_next):
    response = await call_next(request)
    if DEV:
        response.headers["Cache-Control"] = "no-store, must-revalidate"
    return response


@app.on_event("startup")
def _startup() -> None:
    db.ensure_db()


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


def _throttle(request: Request, username: str) -> None:
    key = (request.client.host if request.client else "?", db.normalise_username(username))
    now = time.time()
    tries = [t for t in _ATTEMPTS.get(key, []) if now - t < ATTEMPT_WINDOW_S]
    if len(tries) >= ATTEMPT_LIMIT:
        wait = round((ATTEMPT_WINDOW_S - (now - tries[0])) / 60) or 1
        _ATTEMPTS[key] = tries
        raise HTTPException(429, f"Too many tries. Wait {wait} minutes, or ask "
                                 "the committee to reset your password.")
    tries.append(now)
    _ATTEMPTS[key] = tries


def _throttle_clear(request: Request, username: str) -> None:
    _ATTEMPTS.pop((request.client.host if request.client else "?",
                   db.normalise_username(username)), None)


# --------------------------------------------------------------------------- #
# Shaping: one place that decides what an item looks like as JSON
# --------------------------------------------------------------------------- #
def item_card(item: dict, rating: dict = None, faults: list = None,
              favourite: bool = False) -> dict:
    """The shape the catalogue's grid and list rows are drawn from."""
    return {
        "favourite": bool(favourite),
        "id": item["id"],
        "component_type": item["component_type"],
        "manufacturer": item.get("manufacturer"),
        "model": item.get("model"),
        "type": item.get("type"),
        "condition": item.get("condition"),
        "site": item.get("location"),
        "spot": item.get("spot"),
        "image_path": item.get("image_path"),
        "size_label": db.size_label(item),
        "size_value": _size_value(item),
        "size_unit": _size_unit(item),
        "rating": rating or {"up": 0, "down": 0, "n": 0, "stars": None, "mine": None},
        "faults": [{"id": f["id"], "title": f["title"], "severity": f["severity"]}
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
    return None


def _size_unit(item: dict) -> str:
    return {"sail": "m²", "wing": "m²", "board": "L", "mast": "cm",
            "fin": "cm", "boom": "cm"}.get(item["component_type"], "")


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
        "spots": db.get_spots(),
        "types": [{"key": key, "label": db.COMPONENT_LABELS[key],
                   "count": counts.get(key, 0)} for key in db.CATALOGUE_TYPES],
        "conditions": db.FIELD_META["condition"]["choices"],
        "box_types": db.FIELD_META["box_type"]["choices"],
        "role_labels": db.ROLE_LABELS,
        # The add/edit form is generated from these: for each type, the ordered
        # fields and, for each field, how to label and render it. The form knows
        # no windsurfing itself — it just draws what db.py says a type is made of.
        "forms": {ctype: [_field_meta(field) for field in fields]
                  for ctype, fields in db.COMPONENT_FIELDS.items()},
        "required": validation.REQUIRED_FIELDS,
        "type_labels": db.COMPONENT_LABELS,
    }


def _field_meta(field: str) -> dict:
    meta = db.FIELD_META[field]
    return {
        "name": field,
        "label": meta["label"],
        "kind": meta["kind"],
        "optional": meta.get("optional", False),
        "choices": meta.get("choices"),
    }


@app.post("/api/signup")
def signup(request: Request, response: Response, payload: dict = Body(...)):
    """Join the club app. Open sign-up: anyone with the link can make an account.

    A new account is never committee: that is handed out by an existing
    committee member, or from the server with manage.py.
    """
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
    """The catalogue, filtered by type chip, site selector and search text.

    Out-of-action kit stays visible (this is the catalogue, not the rig picker)
    but sorts to the bottom, so what a member can actually use reads first.
    Archived kit is a committee-only view, off by default (`archived=true`).
    """
    who = identity(request)
    user_id = who["user"]["id"] if who["user"] else None
    if archived:
        require_committee(request)
    ratings = db.ratings_by_item(user_id)
    faults = db.open_faults_by_item()
    favourites = db.favourite_ids(user_id)

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
                                ("manufacturer", "model", "type", "location",
                                 "spot", "notes", "size_generic")).lower()
            if needle not in haystack:
                continue
        rows.append(item_card(item, ratings.get(item["id"]), faults.get(item["id"]),
                              item["id"] in favourites))

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
                     db.is_favourite(item_id, user_id))
    return {
        **card,
        "notes": item.get("notes"),
        "spec": [{"label": label, "value": value} for label, value in db.spec_rows(item)],
        "spot_description": db.spot_description(item.get("location"), item.get("spot")),
        "recommended": db.recommended_rig(item),
        "diameter": db.diameter_class(item),
        "fault_history": history,
        "comments": db.get_comments(item_id),
        "fields": db.COMPONENT_FIELDS[item["component_type"]],
        "raw": {k: item.get(k) for k in db.COMPONENT_FIELDS[item["component_type"]]},
    }


@app.post("/api/items")
def create_item(request: Request, payload: dict = Body(...)):
    """Add a piece of kit. Requires an account; any signed-in member can add."""
    require_user(request)
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
def rig_kit(request: Request, site: Optional[str] = Query(None)):
    who = identity(request)
    user_id = who["user"]["id"] if who["user"] else None
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
    return {**{k: v for k, v in setup.items() if k != "pieces"}, "pieces": pieces}


@app.post("/api/setup")
def write_setup(request: Request, payload: dict = Body(...)):
    """Confirm a rig. Replaces any setup still marked active for this member."""
    user = require_user(request)
    setup = db.save_setup(user["id"], payload.get("site"), payload.get("pieces") or [])
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
def read_wind(site: str = Query(...), start: str = Query(...),
              end: Optional[str] = Query(None)):
    """Wind over the rig-to-de-rig window. Null when it cannot be fetched."""
    return {"wind": wind.for_window(site, start, end)}


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

    # Loopback by default. Set UBWC_HOST=0.0.0.0 to reach the app from a phone
    # on the same network (including an offline iPhone hotspot).
    host = os.environ.get("UBWC_HOST", "127.0.0.1")
    port = int(os.environ.get("UBWC_PORT", "8000"))
    uvicorn.run("server:app", host=host, port=port, reload=False)
