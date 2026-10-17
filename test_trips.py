"""The trips API's check:  python test_trips.py

What it is here to catch is the club losing track of kit, so it asserts the
three promises the Trips tab makes and nothing else:

  * a trip **moves nothing** — every item's site and spot is identical before
    and after a whole pack-and-return cycle;
  * packed kit is **not offered by the rig assistant** while it is away, but is
    still in the catalogue at its own location, flagged;
  * a piece **cannot be on two trips at once**, and everything comes back with
    one button, because ending a trip is one act and not a second checklist;
  * a trip still **taking requests** holds nothing back — requested kit is still
    offered by the rig assistant — one member is one request per piece;
  * finalising the kit **keeps the requesters** of what went and **lets go of**
    the requests for what did not, so a dropped piece cannot come back as a
    pending row and the disc stacks still say who asked for what went.

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

    # The scratch copy is the club's real database, which may well have a trip
    # out right now. Everything below is one pack cycle from a clean slate, so
    # anything already away or being voted on is closed off in the copy first.
    for existing in db.get_trips():
        if existing["status"] not in ("done", "cancelled"):
            db.close_trip(existing["id"], "cancelled")

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
    packable = server.trip_kit(admin)
    kit, cards = packable["kit"], packable["cards"]
    assert {"sail", "board", "mast", "ext", "boom", "fin", "uj"} <= {p["kind"] for p in kit}
    assert not any(piece.get("away") for piece in kit), "nothing is away yet"
    # The picker draws the catalogue's tiles, so every piece needs its card.
    assert {piece["id"] for piece in kit} == set(cards), "a piece has no card to draw"
    assert all("size_value" in card and "image_path" in card for card in cards.values())
    # Build and Your rig draw their thumbnails from the piece, not the card.
    assert all(piece["img"] == cards[piece["id"]]["image_path"] for piece in kit)

    # What the browser posts: what the kit sec chose, plus what the wizard
    # (web/js/rig/pack.js) worked out from it. The solver has its own check;
    # this stands in for its output.
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
                                      "items": items,
                                      "requesting": False})["trip"]
    assert trip["status"] == "packing"
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
        server.create_trip(admin, {"name": "Cornwall", "requesting": False,
                                   "items": [{"item_id": sails[0], "role": "sail",
                                              "source": "chosen"}]})
        raise AssertionError("the same sail was allowed on two trips")
    except server.HTTPException as error:
        assert "already packed" in str(error.detail), error.detail

    # ------------------------------------------------------ the packing tick
    first = trip["items"][0]["item"]["id"]
    trip = server.trip_packed(trip["id"], admin,
                              {"item_id": first, "on": True})["trip"]
    assert trip["n_packed"] == 1
    assert trip["status"] == "packing", "one piece on is not the trailer loaded"

    trip = server.set_trip_stage(trip["id"], admin, {"status": "active"})["trip"]
    assert trip["status"] == "active" and trip["packed_at"]
    assert set(db.away_item_ids()) >= packed, "an active trip's kit is away"
    assert packed <= set(db.away_item_ids()), "kit is away right up to the end"

    # -------------------------------------------------------------- come home
    # One act, not a second checklist: no per-piece return tick exists at all.
    assert not hasattr(server, "trip_returned"), "the return checklist is gone"
    trip = server.close_trip(trip["id"], admin, {"all": True})["trip"]
    assert trip["status"] == "done"
    assert trip["n_returned"] == trip["n_items"]
    assert trip["returned_at"]

    assert not db.away_item_ids()
    assert packed <= {p["id"] for p in rigkit.kit("Cheddar")}, \
        "checked-in kit should be rig-able again"

    after = {row["id"]: (row.get("location"), row.get("spot"))
             for row in db.all_items()}
    assert before == {k: v for k, v in after.items() if k in before}, \
        "an item moved during the trip"

    # --------------------------------------------------- archive and delete
    live = server.create_trip(admin, {"name": "Scratch", "requesting": True,
                                      "items": []})["trip"]
    try:
        server.archive_trip(live["id"], admin)
        raise AssertionError("a trip still being asked about was archived")
    except server.HTTPException as error:
        assert error.status_code == 422, error.status_code
    server.delete_trip(live["id"], admin)

    archived = server.archive_trip(trip["id"], admin)["trip"]
    assert archived["archived_at"], "archiving did not stamp the trip"
    listed = {t["id"]: t for t in server.list_trips(admin)["trips"]}
    assert listed[trip["id"]]["archived_at"], "an archived trip drops out of the list"
    assert server.unarchive_trip(trip["id"], admin)["trip"]["archived_at"] is None

    doomed = server.create_trip(admin, {"name": "Doomed", "requesting": False,
                                        "items": [{"item_id": first}]})["trip"]
    assert first in db.away_item_ids(), "a packing trip holds its kit away"
    server.delete_trip(doomed["id"], admin)
    assert first not in db.away_item_ids(), "deleting a trip left its kit away"
    try:
        server.read_trip(doomed["id"], admin)
        raise AssertionError("a deleted trip is still readable")
    except server.HTTPException as error:
        assert error.status_code == 404, error.status_code

    # ------------------------------------------------------- who may do what
    member = db.create_user("test_member", "notcommittee", "Member")
    ordinary = _Request(db.start_session(member["id"], "test"))
    nobody = _Request()

    # Reading is open, the way the catalogue is.
    assert server.list_trips(nobody)["trips"], "the trip list is public"
    assert server.read_trip(trip["id"], nobody)["trip"], "a trip page is public"
    # Packing it is not.
    for call in (lambda: server.trip_kit(nobody),
                 lambda: server.write_trip_items(trip["id"], ordinary, {"items": []}),
                 lambda: server.set_trip_stage(trip["id"], ordinary,
                                               {"status": "active"}),
                 lambda: server.trip_packed(trip["id"], ordinary,
                                            {"item_id": first, "on": True}),
                 lambda: server.finalise_trip_kit(trip["id"], ordinary,
                                                  {"items": []}),
                 lambda: server.drop_trip_request(trip["id"], ordinary,
                                                  {"item_id": first}),
                 lambda: server.archive_trip(trip["id"], ordinary),
                 lambda: server.unarchive_trip(trip["id"], ordinary),
                 lambda: server.delete_trip(trip["id"], ordinary),
                 lambda: server.close_trip(trip["id"], ordinary, {"all": True})):
        try:
            call()
            raise AssertionError("a trip write was allowed without committee")
        except server.HTTPException as error:
            assert error.status_code in (401, 403), error.status_code

    # --------------------------------------------------------- the requests
    ballot = server.create_trip(admin, {"name": "Cornwall", "items": []})["trip"]
    assert ballot["status"] == "requesting", "a trip opens for requests by default"
    assert ballot["n_items"] == 0, "a trip is asked about before it has any kit"

    # Any member asks, and asking for a piece nobody has asked for is what
    # suggests it — there is no separate suggestion to make first.
    server.trip_request(ballot["id"], ordinary, {"item_id": boards[1]})
    result = server.trip_request(ballot["id"], admin, {"item_id": boards[1]})
    assert result["counts"][boards[1]] == 2, result["counts"]
    # The names travel, not just the tally: the voter tags are a stack of discs
    # that opens into who, and that is the whole job they do.
    assert set(result["who"][boards[1]]) == {"Member", "Kit Sec"}, result["who"]
    # Twice from the same member is still one request.
    server.trip_request(ballot["id"], ordinary, {"item_id": boards[1]})
    assert db.trip_request_counts(ballot["id"])[boards[1]] == 2, "counted twice"
    # And it can be taken back.
    server.trip_request(ballot["id"], admin, {"item_id": sails[2]})
    result = server.trip_request(ballot["id"], admin,
                                 {"item_id": sails[2], "on": False})
    assert sails[2] not in result["counts"], "a withdrawn request still counted"

    # A request is a wish, not a reservation: nothing is away, and the rig
    # picker still offers everything the club has asked for.
    assert not db.away_item_ids(), "a trip taking requests made kit unavailable"
    assert boards[1] in {p["id"] for p in rigkit.kit("Cheddar")}, \
        "requested kit was hidden from the rig picker"

    # The tally reaches whoever is looking, signed in or not.
    seen = server.read_trip(ballot["id"], nobody)["trip"]
    assert seen["requests"][boards[1]] == 2, seen["requests"]
    assert [row["item"]["id"] for row in seen["pending"]] == [boards[1]], seen["pending"]
    assert server.read_trip(ballot["id"], ordinary)["trip"]["my_requests"] == [boards[1]]

    # ------------------------------------------------------ confirming the kit
    server.trip_request(ballot["id"], ordinary, {"item_id": sails[2]})

    # The kit sec drops one requested piece off the wishlist before Confirm.
    # Every request for it goes at once, and it is not kept anywhere.
    ballot = server.drop_trip_request(ballot["id"], admin,
                                      {"item_id": sails[2]})["trip"]
    assert sails[2] not in ballot["requests"], "a dropped request was kept"
    assert [row["item"]["id"] for row in ballot["pending"]] == [boards[1]], \
        "a dropped piece is still pending"

    # Confirm's Continue: the chosen kit is fixed, and the requests for anything
    # not carried through are let go — but a kept piece keeps its requesters.
    server.trip_request(ballot["id"], ordinary, {"item_id": sails[1]})
    ballot = server.finalise_trip_kit(ballot["id"], admin, {"items": [
        {"item_id": boards[1], "role": "board", "source": "chosen"},
    ]})["trip"]
    assert ballot["n_items"] == 1, "the confirmed list is wrong"
    assert not ballot["pending"], "a request survived finalising"
    assert not ballot["declined"], "nothing is declined any more"
    assert ballot["requests"][boards[1]] == 2, "a kept piece lost its requesters"
    assert sails[1] not in ballot["requests"], "a request for dropped kit was kept"

    ballot = server.set_trip_stage(ballot["id"], admin, {"status": "packing"})["trip"]
    away = db.away_item_ids()
    assert boards[1] in away, "kit taken on a packing trip is not away"
    assert sails[1] not in away, "a piece left off was held back by the trip"

    try:
        server.trip_request(ballot["id"], ordinary, {"item_id": sails[2]})
        raise AssertionError("a request was accepted after the kit was confirmed")
    except server.HTTPException as error:
        assert error.status_code == 409, error.status_code

    _check_forecast(server, admin, items[:1])
    _check_location(server, admin)

    print("test_trips: ok")


def _check_location(server, admin) -> None:
    """A packing/active trip is a location you can pick: the toggle offers it,
    the rig assistant narrows to its kit (away flag and all, out-of-action
    still dropped), and a rig built on it remembers the trip so the logbook can
    pin the wind to a destination that has no site row."""
    import wind

    good = db.add_item({"component_type": "board", "manufacturer": "Tabou",
                        "model": "Rocket 115", "type": "Freeride", "size_l": 115,
                        "box_type": "Powerbox", "condition": "Good",
                        "location": "Cheddar"})
    broken = db.add_item({"component_type": "sail", "manufacturer": "Point-7",
                          "model": "AC-X 6.7", "type": "Sail", "size_m2": 6.7,
                          "luff_cm": 462, "req_boom_cm": 195, "cams": 0,
                          "condition": "Poor", "location": "Cheddar"})
    db.report_fault(broken, "Torn panel", "Full-height tear.", "out_of_action")

    trip = server.create_trip(admin, {
        "name": "Datchet", "destination": "Datchet Reservoir",
        "lat": 51.43, "lon": -0.58, "requesting": False,
        "items": [{"item_id": good, "role": "board", "source": "chosen"},
                  {"item_id": broken, "role": "sail", "source": "chosen"}],
    })["trip"]
    assert trip["status"] == "packing"

    boot = server.bootstrap(admin)
    assert trip["id"] in {t["id"] for t in boot["trips"]}, "a packing trip is not in the toggle"
    assert all(t["status"] in db.TRIP_AWAY_STAGES for t in boot["trips"])

    on_trip = {p["id"] for p in server.rig_kit(admin, site=None, trip=trip["id"])["kit"]}
    assert on_trip == {good}, on_trip  # the out-of-action sail is still dropped
    assert good not in {p["id"] for p in
                        server.rig_kit(admin, site="Cheddar", trip=None)["kit"]}, \
        "away trip kit leaked into the site's rig list"

    setup = server.write_setup(admin, {
        "site": "Datchet Reservoir", "trip_id": trip["id"],
        "pieces": [{"role": "board", "item_id": good}],
    })["setup"]
    assert setup["trip"] and setup["trip"]["id"] == trip["id"]
    assert (setup["trip"]["lat"], setup["trip"]["lon"]) == (51.43, -0.58)
    assert server.read_setup(admin)["setup"]["trip"]["id"] == trip["id"]

    saved_fetch, saved_cache = wind._fetch, dict(wind._cache)
    seen = {}

    def fake_fetch(lat, lon, start, end=None):
        seen["coords"] = (lat, lon)
        return {"hourly": {"time": [f"{start}T{h:02d}:00" for h in range(24)],
                           "wind_speed_10m": [14.0] * 24,
                           "wind_gusts_10m": [19.0] * 24,
                           "wind_direction_10m": [200.0] * 24}}

    wind._fetch, wind._cache = fake_fetch, {}
    try:
        out = server.read_wind(start="2026-05-01T10:00", site=None,
                               end="2026-05-01T12:00",
                               lat=51.43, lon=-0.58)["wind"]
        assert out and out["source"] == "auto", out
        assert seen["coords"] == (51.43, -0.58), seen
    finally:
        wind._fetch, wind._cache = saved_fetch, saved_cache

    server.close_trip(trip["id"], admin, {"all": True})
    db.close_setup(setup["id"], "binned")


def _check_forecast(server, admin, one_item) -> None:
    """The forecast pin round-trips, and the strip spans the trip's days, not
    just the first one. A forecast that cannot be had is still not an error."""
    import wind

    # A trip carries its own pin, set from the form, and it survives an edit.
    trip = server.create_trip(admin, {
        "name": "Weymouth", "destination": "Weymouth Bay",
        "lat": 50.61, "lon": -2.45,
        "starts_on": "2026-03-14", "ends_on": "2026-03-16",
        "items": list(one_item), "requesting": False,
    })["trip"]
    assert round(trip["lat"], 2) == 50.61 and round(trip["lon"], 2) == -2.45
    trip = server.edit_trip(trip["id"], admin, {"lat": 50.6, "lon": -2.5})["trip"]
    assert round(trip["lat"], 2) == 50.6, "the pin did not follow an edit"
    trip = server.edit_trip(trip["id"], admin, {"lat": None, "lon": None})["trip"]
    assert trip["lat"] is None, "the pin could not be cleared"
    server.edit_trip(trip["id"], admin, {"lat": 50.6, "lon": -2.5})

    # Stub the one network call. Three days of hourly wind, so the endpoint has
    # a range to slice into per-day strips.
    def fake_fetch(lat, lon, start, end=None):
        days = ["2026-03-14", "2026-03-15", "2026-03-16"]
        times, speed, gust, direction = [], [], [], []
        for day in days:
            for hour in range(24):
                times.append(f"{day}T{hour:02d}:00")
                speed.append(12.0 + hour % 5)
                gust.append(18.0 + hour % 5)
                direction.append(225.0)
        return {"hourly": {"time": times, "wind_speed_10m": speed,
                           "wind_gusts_10m": gust, "wind_direction_10m": direction}}

    saved_fetch, saved_cache = wind._fetch, dict(wind._cache)
    wind._fetch, wind._cache = fake_fetch, {}
    try:
        out = server.trip_forecast(trip["id"], admin)["forecast"]
        assert [d["date"] for d in out] == ["2026-03-14", "2026-03-15", "2026-03-16"], out
        assert all(d["rows"] for d in out), "a day came back with no hours"
        assert all(6 <= int(r["hour"]) <= 18 for d in out for r in d["rows"]), \
            "the strip is drawn outside the sailing day"
    finally:
        wind._fetch, wind._cache = saved_fetch, saved_cache

    # No pin, no site coordinates -> no strip, and that is not an error.
    bare = server.create_trip(admin, {"name": "Somewhere new",
                                      "destination": "Nowhere in particular",
                                      "starts_on": "2026-03-14",
                                      "items": []})["trip"]
    assert server.trip_forecast(bare["id"], admin)["forecast"] is None

    # The geocode endpoint hands the form a list of pins, shape and all.
    saved_geo = wind.geocode
    wind.geocode = lambda q, limit=6: [{"name": "Weymouth", "admin1": "England",
                                        "country": "United Kingdom",
                                        "lat": 50.61, "lon": -2.45}]
    try:
        hits = server.geocode("weymouth")["results"]
        assert hits and hits[0]["lat"] == 50.61 and "name" in hits[0]
    finally:
        wind.geocode = saved_geo


if __name__ == "__main__":
    main()
