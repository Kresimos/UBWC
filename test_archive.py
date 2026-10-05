"""The archive / delete check:  python test_archive.py

Retiring kit has to do exactly what the item page's button promises:

  * **archive** hides a piece from the live inventory but keeps its faults,
    and records why; **unarchive** puts it back and forgets the reason;
  * **delete** takes the piece and everything hanging off it (faults,
    favourites) with it, and leaves other kit alone;
  * both are **committee only**: a member or a signed-out visitor is refused.

It runs against a throwaway copy of the database and deletes it afterwards.
"""
import shutil
import tempfile
from pathlib import Path

from fastapi import HTTPException

import db


class _Request:
    """Just enough of a FastAPI request for the endpoints: a session cookie."""

    def __init__(self, token=""):
        self.cookies = {"ubwc_session": token}
        self.headers = {}
        self.client = None


def main() -> None:
    scratch = Path(tempfile.gettempdir()) / "ubwc_test_archive.db"
    scratch.unlink(missing_ok=True)
    shutil.copy(db.DB_PATH, scratch)
    db.DB_PATH = scratch
    try:
        run()
    finally:
        scratch.unlink(missing_ok=True)


def refused(call, status):
    try:
        call()
    except HTTPException as error:
        assert error.status_code == status, f"wanted {status}, got {error.status_code}"
        return
    raise AssertionError(f"expected a {status}")


def run() -> None:
    import server

    db.ensure_db()

    def add(model):
        return db.add_item({"component_type": "sail", "manufacturer": "Severne",
                            "model": model, "type": "Sail", "size_m2": 6.5,
                            "luff_cm": 460, "req_boom_cm": 190, "cams": 0,
                            "condition": "Good", "location": "Cheddar"})

    def live(item_id):
        return item_id in {row["id"] for row in db.all_items()}

    keeper, retired, doomed = add("Keeper"), add("Retired"), add("Doomed")

    member = db.create_user("test_member", "justamember", "Member")
    boss = db.create_user("test_boss", "committeeboss", "Boss")
    db.set_admin(boss["id"], True)
    as_member = _Request(db.start_session(member["id"], "test"))
    as_boss = _Request(db.start_session(boss["id"], "test"))
    nobody = _Request()

    # ---------------------------------------------------- committee only
    for who, status in ((nobody, 401), (as_member, 403)):
        refused(lambda: server.archive_item(retired, who, {"reason": "x"}), status)
        refused(lambda: server.unarchive_item(retired, who), status)
        refused(lambda: server.remove_item(doomed, who), status)
        refused(lambda: server.list_items(who, None, None, None, True), status)
    assert live(retired) and live(doomed), "a refused call still changed something"

    # ------------------------------------------------- archive / unarchive
    db.report_fault(retired, "Snapped boom", "Cracked at the head", "out_of_action", "Boss")
    server.archive_item(retired, as_boss, {"reason": "Sold"})
    assert not live(retired), "archived kit is still in the live inventory"
    assert live(keeper)
    archived = server.list_items(as_boss, None, None, None, True)["items"]
    assert [row["id"] for row in archived] == [retired]
    assert archived[0]["archived_reason"] == "Sold"
    assert retired not in {row["id"] for row in
                           server.list_items(as_boss, None, None, None, False)["items"]}
    assert len(db.get_faults(retired)) == 1, "archiving lost the fault history"

    server.unarchive_item(retired, as_boss)
    assert live(retired), "restored kit is not back"
    restored = db.get_item(retired)
    assert not restored["archived"] and restored["archived_reason"] is None
    assert len(db.get_faults(retired)) == 1

    # ------------------------------------------------------------- delete
    db.report_fault(doomed, "Torn", "Along the leech", "usable", "Boss")
    db.set_favourite(doomed, member["id"], True)
    server.remove_item(doomed, as_boss)
    assert db.get_item(doomed) is None, "the piece survived its own deletion"
    assert not db.get_faults(doomed), "its faults outlived it"
    assert doomed not in db.favourite_ids(member["id"]), "its favourite outlived it"
    assert live(keeper) and live(retired), "delete took other kit with it"

    print("archive: ok")


if __name__ == "__main__":
    main()
