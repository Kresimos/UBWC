"""The check behind the fault-email hook: both fault-entry paths (the item-page
report endpoint and the add/edit form's fault fields) must queue exactly one
email per NEW fault, re-saving an existing fault must queue nothing, and an
unconfigured mailer must be a silent no-op. Run: python test_faults.py
"""
import sqlite3
import tempfile
from pathlib import Path

import db
import mailer
import server

# ---- a throwaway database, so the real kit.db is untouched ----------------
_tmp = tempfile.TemporaryDirectory()
db.DB_PATH = Path(_tmp.name) / "test.db"
conn = sqlite3.connect(db.DB_PATH)
conn.executescript((Path(__file__).parent / "schema.sql").read_text(encoding="utf-8"))
conn.execute("INSERT INTO items (component_type, manufacturer, model) "
             "VALUES ('board', 'Fanatic', 'Freewave 86')")
ITEM_ID = conn.execute("SELECT id FROM items").fetchone()[0]
conn.commit()
conn.close()


class StubBackground:
    """Stands in for FastAPI BackgroundTasks: records instead of scheduling."""
    def __init__(self):
        self.tasks = []

    def add_task(self, func, *args, **kwargs):
        self.tasks.append((func, args))


class StubRequest:
    """Enough of a Request for identity(): no cookie, so an anonymous author."""
    cookies = {}


def mails_of(background):
    return [t for t in background.tasks if t[0] is mailer.fault_reported]


# ---- path 1: the item-page report endpoint ---------------------------------
background = StubBackground()
server._report_fault(ITEM_ID, "Cracked nose", "Ding by the mast track.",
                     "usable", "Test Member", None, background)
assert len(mails_of(background)) == 1, "endpoint path must queue one mail"
func, args = mails_of(background)[0]
assert args == (ITEM_ID, "Cracked nose", "Ding by the mast track.",
                "usable", "Test Member")
assert len(db.get_faults(ITEM_ID, status="open")) == 1

# ---- path 2: the add/edit form ---------------------------------------------
background = StubBackground()
server._write_faults(ITEM_ID, [{"title": "Snapped strap", "description": "Rear footstrap."}],
                     StubRequest(), background)
assert len(mails_of(background)) == 1, "form path must queue one mail"
assert len(db.get_faults(ITEM_ID, status="open")) == 2

# ---- re-saving the same fault queues nothing --------------------------------
background = StubBackground()
server._write_faults(ITEM_ID, [{"title": "Snapped strap", "description": "Rear footstrap."}],
                     StubRequest(), background)
assert mails_of(background) == [], "an already-open title must not re-mail"
assert len(db.get_faults(ITEM_ID, status="open")) == 2, "and must not re-insert"

# ---- unconfigured mailer is a silent no-op ----------------------------------
import os
for var in ("UBWC_SMTP_HOST", "UBWC_SMTP_USER", "UBWC_SMTP_PASS"):
    os.environ.pop(var, None)
mailer.fault_reported(ITEM_ID, "Cracked nose", "Ding.", "usable", "Test Member")

print("ok")
