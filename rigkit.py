"""Normalise inventory rows into the shape the rig wizard reasons about.

The wizard's seven steps are not the same list as the eight component types:
an extension and a mast base are `misc` rows today (the sheet has no column for
them), and a sail's diameter class lives at the front of its notes. Rather than
teach the browser those quirks, the server hands it one flat list of pieces
with the fields each rule needs, and the cascade in web/js/rig/engine.js works
only in those terms.

Two things are decided here, both from misc/spec.md and CLAUDE.md:

  * kit with an open **out-of-action** fault is left out entirely, because the
    rig picker must never point a member at kit that cannot be sailed;
  * kit with a **usable** fault stays in, carrying its flag, so the member is
    told about it and decides for themselves.
"""
import db

# Which wizard step a row belongs to. Sails and wings both rig, but a wing has
# no luff or boom, so it is not offered as a rig sail.
_COMPONENT_KINDS = {
    "sail": "sail",
    "mast": "mast",
    "boom": "boom",
    "board": "board",
    "fin": "fin",
}


def rig_kind(item: dict) -> str:
    """The wizard step this item can fill, or '' if it is not rig kit."""
    ctype = item.get("component_type")
    if ctype in _COMPONENT_KINDS:
        return _COMPONENT_KINDS[ctype]
    if ctype == "misc":
        return db.MISC_RIG_TYPES.get((item.get("type") or "").strip(), "")
    return ""


def _fault_flags(faults: list) -> list:
    """Title, severity and the diagnosis.

    The description travels with the flag because the Build picker lets a
    member tap the fault chip on a tile and read what is actually wrong before
    they choose the piece — asking them to open the item page to find out would
    mean leaving the picker and losing their place.
    """
    return [{"t": f.get("title") or (f.get("description") or "").split(".")[0],
             "s": f.get("severity", "usable"),
             "d": f.get("description") or ""} for f in faults]


def to_piece(item: dict, faults: list, rating: dict) -> dict:
    """One inventory row as the wizard sees it. Absent numbers stay None so the
    rules can tell "does not fit" apart from "we do not know"."""
    kind = rig_kind(item)
    piece = {
        "id": item["id"],
        "kind": kind,
        "mfr": item.get("manufacturer") or "",
        "model": item.get("model") or "",
        "type": item.get("type"),
        "cond": item.get("condition") or "Unknown",
        "site": item.get("location"),
        "spot": item.get("spot"),
        "faults": _fault_flags(faults),
        "rate": ({"avg": rating["stars"], "n": rating["n"]}
                 if rating and rating.get("n") else None),
    }

    if kind == "sail":
        piece.update({
            "m2": item.get("size_m2"),
            "luff": item.get("luff_cm"),
            "topExt": item.get("top_extension_max_cm") or 0,
            "boom": item.get("req_boom_cm"),
            "cams": 1 if item.get("cams") else 0,
            "diam": db.diameter_class(item),
        })
    elif kind == "mast":
        piece.update({"len": item.get("length_cm"), "diam": db.diameter_class(item)})
    elif kind == "ext":
        lo, hi = db.extension_travel(item)
        piece.update({"min": lo, "max": hi, "diam": db.diameter_class(item)})
    elif kind == "boom":
        piece.update({"min": item.get("min_size_cm"), "max": item.get("max_size_cm")})
    elif kind == "board":
        piece.update({"vol": item.get("size_l"), "box": item.get("box_type")})
    elif kind == "fin":
        piece.update({"len": item.get("fin_length_cm"), "box": item.get("box_type")})
    elif kind == "uj":
        piece.update({"fit": item.get("size_generic") or "Standard"})

    return piece


def kit(site: str = None, user_id: int = None) -> list:
    """Every usable piece of rig kit, optionally narrowed to one site.

    The site filter is what keeps the assistant from suggesting kit that is on
    a trip somewhere else; the wizard applies it again client-side so switching
    site never needs a round trip.
    """
    faults = db.open_faults_by_item()
    ratings = db.ratings_by_item(user_id)
    pieces = []
    for item in db.all_items():
        if not rig_kind(item):
            continue
        if site and item.get("location") != site:
            continue
        item_faults = faults.get(item["id"], [])
        if any(f["severity"] == "out_of_action" for f in item_faults):
            continue
        pieces.append(to_piece(item, item_faults, ratings.get(item["id"])))
    return pieces
