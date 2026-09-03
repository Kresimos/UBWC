"""The photo-upload path's check:  python test_uploads.py

Photos are the one feature that can fill the volume and take the database down
with it, so this asserts the rules misc/scale.md set:

  * every upload is **re-decoded and resized** — a big image lands on disk
    small, and a file that is not an image is refused;
  * a profile photo **round-trips** and reaches `member_avatars()`, which is
    how it shows next to a member's name everywhere;
  * a spot's note and photo are **committee-only** and keyed by (site, name),
    the pair `items.spot` already points at.

It runs against a throwaway copy of the real database and a throwaway photo
directory, and deletes both afterwards.
"""
import asyncio
import io
import shutil
import tempfile
from pathlib import Path

from PIL import Image

import db


class _Request:
    def __init__(self, token=""):
        self.cookies = {"ubwc_session": token}
        self.headers = {}
        self.client = None


def _png_bytes(w=4000, h=3000, colour=(30, 120, 200)) -> bytes:
    """A deliberately oversized PNG, the way a phone's camera roll would be."""
    buf = io.BytesIO()
    Image.new("RGB", (w, h), colour).save(buf, "PNG")
    return buf.getvalue()


def main() -> None:
    scratch = Path(tempfile.gettempdir()) / "ubwc_test_uploads.db"
    photos = Path(tempfile.mkdtemp(prefix="ubwc_test_photos_"))
    scratch.unlink(missing_ok=True)
    shutil.copy(db.DB_PATH, scratch)
    db.DB_PATH = scratch
    import migrate
    migrate.DB_PATH = scratch
    try:
        run(photos)
    finally:
        scratch.unlink(missing_ok=True)
        shutil.rmtree(photos, ignore_errors=True)


def run(photos: Path) -> None:
    import server

    server.PHOTOS_DIR = photos
    db.ensure_db()

    # ------------------------------------------------------------- resizing
    path = server._store_photo(_png_bytes())
    assert path.startswith("/photos/") and path.endswith(".jpg"), path
    on_disk = photos / path.split("/")[-1]
    assert on_disk.exists(), "the resized file was not written"
    with Image.open(on_disk) as saved:
        assert saved.format == "JPEG"
        assert max(saved.size) <= server.PHOTO_MAX_EDGE, saved.size
    assert on_disk.stat().st_size < 500_000, on_disk.stat().st_size

    # A text file is not an image.
    try:
        server._store_photo(b"this is not an image, it is a sentence")
        raise AssertionError("a non-image was accepted")
    except server.HTTPException as error:
        assert error.status_code == 422, error.status_code

    # Too big to be a browser-downscaled upload.
    try:
        server._store_photo(b"\x89PNG\r\n\x1a\n" + b"0" * server.MAX_UPLOAD_BYTES)
        raise AssertionError("an oversized upload was accepted")
    except server.HTTPException as error:
        assert error.status_code == 413, error.status_code

    # The endpoint itself needs an account.
    from starlette.datastructures import Headers, UploadFile

    upload = UploadFile(io.BytesIO(_png_bytes(800, 600)),
                        filename="x.png", headers=Headers({"content-type": "image/png"}))
    try:
        asyncio.run(server.upload_photo(_Request(), upload))
        raise AssertionError("an anonymous upload was accepted")
    except server.HTTPException as error:
        assert error.status_code == 401, error.status_code

    member = db.create_user("test_photo_member", "cheddarwind", "Photo Member")
    who = _Request(db.start_session(member["id"], "test"))
    upload = UploadFile(io.BytesIO(_png_bytes(800, 600)),
                        filename="x.png", headers=Headers({"content-type": "image/png"}))
    result = asyncio.run(server.upload_photo(who, upload))
    assert result["image_path"].startswith("/photos/"), result

    # ------------------------------------------------------------- avatars
    server.change_avatar(who, {"image_path": result["image_path"]})
    assert db.get_user(member["id"])["image_path"] == result["image_path"]
    assert db.member_avatars().get("Photo Member") == result["image_path"]
    server.change_avatar(who, {"image_path": None})
    assert db.get_user(member["id"])["image_path"] is None
    assert "Photo Member" not in db.member_avatars()

    # ------------------------------------------------------------- spots
    try:
        server.edit_spot(who, {"site": "Cheddar", "name": "Mast tubes",
                               "description": "Second bay in"})
        raise AssertionError("a non-committee member edited a spot")
    except server.HTTPException as error:
        assert error.status_code == 403, error.status_code

    db.set_admin(member["id"], True)
    boss = _Request(db.start_session(member["id"], "test"))
    out = server.edit_spot(boss, {"site": "Cheddar", "name": "Mast tubes",
                                  "description": "Second bay in from the door",
                                  "image_path": "/photos/tubes.jpg"})
    tubes = next(s for s in out["spots"]
                 if s["site"] == "Cheddar" and s["name"] == "Mast tubes")
    assert tubes["description"] == "Second bay in from the door"
    assert tubes["image_path"] == "/photos/tubes.jpg"
    # Upsert: same (site, name) overwrites rather than duplicates.
    out = server.edit_spot(boss, {"site": "Cheddar", "name": "Mast tubes",
                                  "description": "Moved to the far wall",
                                  "image_path": None})
    matches = [s for s in out["spots"]
               if s["site"] == "Cheddar" and s["name"] == "Mast tubes"]
    assert len(matches) == 1 and matches[0]["image_path"] is None, matches

    try:
        server.edit_spot(boss, {"site": "  ", "name": "Nowhere"})
        raise AssertionError("a spot with no site was written")
    except server.HTTPException as error:
        assert error.status_code == 400, error.status_code

    print("test_uploads: ok")


if __name__ == "__main__":
    main()
