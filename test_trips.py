"""The trips API's check:  python test_trips.py

What it is here to catch is the club losing track of kit, so it asserts the
three promises the Trips tab makes and nothing else:

  * a trip **moves nothing** — every item's site and spot is identical before
    and after a whole pack-and-return cycle;
  * packed kit is **not offered by the rig assistant** while it is away, but is
    still in the catalogue at its own location, flagged;
  * a piece **cannot be on two trips at once**, and everything comes back with
    one button.

It runs against a throwaway copy of the real database, seeded with enough kit
to pack, and deletes it afterwards. The pack solver itself is JavaScript and
has its own check in web/js/rig/pack.test.mjs.
"""
import shutil
import tempfile
from pathlib import Path

import db


class _Request:
    """Just enough of a FastAPI request for the endpoints: a session cookie."""

    def __init__(self, token=""):
        self.cookies = {"ubwc_session": token}
        self.headers = {}
        self.client = None


def main() -> None:
    scratch = Path(tempfile.gettempdir()) / "ubwc_test_trips.db"
    scratch.unlink(missing_ok=True)
    shutil.copy(db.DB_PATH, scratch)
    db.DB_PATH = scratch
    try:
        run()
    finally:
        scratch.unlink(missing_ok=True)


def run() -> None:
    import rigkit
    import server

    db.ensure_db()

    def add(**record):
        record.setdefault("condition", "Good")
        record.setdefault("location", "Cheddar")
        return db.add_item(record)

    sails = [add(component_type="sail", manufacturer="Severne", model=f"Gator {m2}",
                 type="Sail", size_m2=m2, luff_cm=luff, req_boom_cm=boom, cams=0)
             for m2, luff, boom in ((5.0, 430, 170), (6.5, 460, 190), (7.8, 490, 210))]
    boards = [add(component_type="board", manufacturer="Fanatic",
                  model=f"Freewave {v}", type="Freewave", size_l=v,
                  box_type="Powerbox") for v in (86, 111)]
    for length in (430, 460):
        add(component_type="mast", manufacturer="Duotone", model=f"Platinum {length}",
            length_cm=length, diameter="RDM")
    for i in range(3):
        add(component_type="ext", manufacturer="Duotone", model=f"RDM ext {i}",
            ext_min_cm=0, ext_max_cm=50, diameter="RDM")
        add(component_type="boom", manufacturer="Duotone", model=f"Silver {i}",
            min_size_cm=140, max_size_cm=220)
    for i in range(2):
        add(component_type="fin", manufacturer="MFC", model=f"Fin {i}",
            box_type="Powerbox", fin_length_cm=30)
        add(component_type="misc", manufacturer="Chinook", model=f"UJ {i}",
            type="Universal joint", size_generic="Standard")

    kit_sec = db.create_user("test_kitsec", "packthetrailer", "Kit Sec")
    db.set_admin(kit_sec["id"], True)
    admin = _Request(db.start_session(kit_sec["id"], "test"))

    before = {row["id"]: (row.get("location"), row.get("spot"))
              for row in db.all_items()}

    # ---------------------------------------------------------------- pack
    kit = server.trip_kit(admin)["kit"]
    assert {"sail", "board", "mast", "ext", "boom", "fin", "uj"} <= {p["kind"] for p in kit}
    assert not any(piece.get("away") for piece in kit), "nothing is away yet"

    # What the browser posts: what the kit sec chose, plus what packList worked
    # out from it. The solver has its own check; this stands in for its output.
    by_kind = {}
    for piece in kit:
        by_kind.setdefault(piece["kind"], []).append(piece)
    items = [{"item_id": sails[0], "role": "sail", "source": "chosen"},
             {"item_id": sails[1], "role": "sail", "source": "chosen"},
             {"item_id": boards[0], "role": "board", "source": "chosen"}]
    for role, count in (("mast", 2), ("ext", 2), ("boom", 2), ("fin", 1), ("uj", 1)):
        items += [{"item_id": piece["id"], "role": role, "source": "derived"}
                  for piece in by_kind[role][:count]]

    trip = server.create_trip(admin, {"name": "Nottingham",
                                      "destination": "Hoveringham",
                                      "items": items})["trip"]
    assert trip["status"] == "open"
    assert trip["n_items"] == len(items)
    packed = {row["item"]["id"] for row in trip["items"]}

    # --------------------------------------------------- away, but not moved
    assert not (packed & {p["id"] for p in rigkit.kit("Cheddar")}), \
        "packed kit is still being offered to rig"

    rows = server.list_items(admin, None, None, None, False)["items"]
    assert {row["id"] for row in rows if row["away"]} == packed
    assert all(row["site"] == "Cheddar" for row in rows if row["away"]), \
        "a trip must not change where kit is stored"

    try:
        server.create_trip(admin, {"name": "Cornwall",
                                   "items": [{"item_id": sails[0], "role": "sail",
                                              "source": "chosen"}]})
        raise AssertionError("the same sail was allowed on two trips")
    except server.HTTPException as error:
        assert "already packed" in str(error.detail), error.detail

    # -------------------------------------------------------------- come home
    first = trip["items"][0]["item"]["id"]
    trip = server.trip_returned(trip["id"], admin,
                                {"item_id": first, "on": True})["trip"]
    assert trip["n_returned"] == 1
    assert trip["status"] == "open", "one piece back is not the trip over"

    trip = server.close_trip(trip["id"], admin, {"all": True})["trip"]
    assert trip["status"] == "returned"
    assert trip["n_returned"] == trip["n_items"]
    assert trip["returned_at"]

    assert not db.away_item_ids()
    assert packed <= {p["id"] for p in rigkit.kit("Cheddar")}, \
        "checked-in kit should be rig-able again"

    after = {row["id"]: (row.get("location"), row.get("spot"))
             for row in db.all_items()}
    assert before == {k: v for k, v in after.items() if k in before}, \
        "an item moved during the trip"

    # ------------------------------------------------------- committee only
    member = db.create_user("test_member", "notcommittee", "Member")
    ordinary = _Request(db.start_session(member["id"], "test"))
    for call in (lambda: server.list_trips(ordinary),
                 lambda: server.trip_kit(ordinary)):
        try:
            call()
            raise AssertionError("trips are committee only")
        except server.HTTPException as error:
            assert error.status_code == 403, error.status_code

    print("test_trips: ok")


if __name__ == "__main__":
    main()
