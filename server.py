"""HTTP layer for the UBWC kit app.

A small JSON API over db.py plus the static front end in web/. Everything the
browser needs is here; nothing in here knows any windsurfing (that lives in
validation.py and rigkit.py) or any HTML (that lives in web/).

Run it with:  python server.py        (or: uvicorn server:app --reload)
"""
import hashlib
import hmac
import json
import os
import secrets
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import db
import rigkit
import validation
import wind

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"

# The shared committee PIN gates the destructive/administrative actions. It is
# deliberately shared rather than per-user: the name-pick is for attribution,
# the PIN is the real gate (misc/spec.md "Access and roles").
COMMITTEE_PIN = os.environ.get("UBWC_COMMITTEE_PIN", "1878")

# Signing key for the identity cookie. Generated once and kept beside the
# database so a restart does not sign everyone out.
_KEY_FILE = ROOT / ".session_key"
if not _KEY_FILE.exists():
    _KEY_FILE.write_text(secrets.token_hex(32))
SECRET = _KEY_FILE.read_text().strip().encode()

COOKIE = "ubwc"

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
# Identity: a signed cookie holding the picked name and the committee flag
# --------------------------------------------------------------------------- #
def _sign(payload: str) -> str:
    digest = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{payload}.{digest}"


def _unsign(value: str) -> Optional[str]:
    payload, _, digest = (value or "").rpartition(".")
    if not payload or not hmac.compare_digest(
        digest, hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()[:32]
    ):
        return None
    return payload


def identity(request: Request) -> dict:
    """{user, committee} for this request. Browsing needs neither."""
    raw = _unsign(request.cookies.get(COOKIE, ""))
    if not raw:
        return {"user": None, "committee": False}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"user": None, "committee": False}
    user = db.get_user(data["user_id"]) if data.get("user_id") else None
    return {"user": user, "committee": bool(data.get("committee")) and user is not None}


def _set_identity(response: Response, user_id: Optional[int], committee: bool) -> None:
    if user_id is None:
        response.delete_cookie(COOKIE)
        return
    payload = json.dumps({"user_id": user_id, "committee": committee})
    response.set_cookie(COOKIE, _sign(payload), max_age=60 * 60 * 24 * 120,
                        httponly=True, samesite="lax")


def require_user(request: Request) -> dict:
    who = identity(request)
    if not who["user"]:
        raise HTTPException(401, "Pick your name first.")
    return who["user"]


def require_committee(request: Request) -> dict:
    who = identity(request)
    if not who["user"]:
        raise HTTPException(401, "Pick your name first.")
    if not who["committee"]:
        raise HTTPException(403, "This one needs the committee PIN.")
    return who["user"]


# --------------------------------------------------------------------------- #
# Shaping: one place that decides what an item looks like as JSON
# --------------------------------------------------------------------------- #
def item_card(item: dict, rating: dict = None, faults: list = None) -> dict:
    """The shape the catalogue's grid and list rows are drawn from."""
    return {
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
        "roster": db.get_users(),
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


@app.post("/api/login")
def login(response: Response, user_id: int = Body(..., embed=True)):
    user = db.get_user(user_id)
    if not user:
        raise HTTPException(404, "No such member on the roster.")
    _set_identity(response, user_id, committee=False)
    return {"user": user, "committee": False}


@app.post("/api/logout")
def logout(response: Response):
    _set_identity(response, None, False)
    return {"user": None, "committee": False}


@app.post("/api/committee")
def committee(request: Request, response: Response, pin: str = Body(..., embed=True)):
    """Unlock the committee actions for this member's session."""
    user = require_user(request)
    if not hmac.compare_digest(pin.strip(), COMMITTEE_PIN):
        raise HTTPException(403, "That PIN is not right.")
    _set_identity(response, user["id"], committee=True)
    return {"user": user, "committee": True}


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
        rows.append(item_card(item, ratings.get(item["id"]), faults.get(item["id"])))

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
                     [f for f in history if f["status"] == "open"])
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
    """Add a piece of kit. Requires a name-pick; anyone on the roster can add."""
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
    """One standing thumb per member per item; sending the same one again clears it."""
    user = require_user(request)
    return db.set_vote(item_id, user["id"], vote)


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
