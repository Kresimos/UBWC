"""Account admin from the machine running the server.

Committee is an account flag, not a shared PIN, so something has to be able to
make the first committee account, and to rescue the club when the last one
forgets their password. That is this, and it deliberately only works with a
shell on the server, which is a fair thing to require of the one action that
hands out control of the kit list.

    python manage.py list
    python manage.py signup rachel --admin       # new committee account
    python manage.py password johnny             # set or reset a password
    python manage.py promote rachel              # make somebody committee
    python manage.py demote rachel
    python manage.py signout johnny              # end their sessions everywhere

and the club's data itself:

    python manage.py backup kit-2026-09-03.db    # safe copy of a live database
    python manage.py where                       # which file is being used

Passwords are asked for on the terminal rather than taken as an argument, so
they do not end up in the shell history.
"""
import argparse
import getpass
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import db


def _ask_password(username: str) -> str:
    first = getpass.getpass(f"New password for {username}: ")
    if first != getpass.getpass("Again: "):
        sys.exit("Those did not match. Nothing was changed.")
    try:
        db.check_password(first)
    except db.AccountError as error:
        sys.exit(str(error))
    return first


def _find(username: str) -> dict:
    user = db.get_user_by_username(username)
    if not user:
        sys.exit(f"No account called {db.normalise_username(username)}. "
                 "Run `python manage.py list` to see the roster.")
    return user


def cmd_list(_args) -> None:
    rows = db.member_admin_list()
    if not rows:
        print("No accounts yet.")
        return
    width = max(len(r["username"]) for r in rows)
    print(f"{'username'.ljust(width)}  role       sign-in  sessions  ratings  name")
    for row in rows:
        print("  ".join([
            row["username"].ljust(width),
            ("committee" if row["is_admin"] else "member").ljust(9),
            ("yes" if row["has_password"] else "no").ljust(7),
            str(row["n_sessions"]).rjust(8),
            str(row["n_ratings"]).rjust(7),
            row["display_name"] or "",
        ]))


def cmd_signup(args) -> None:
    password = _ask_password(args.username)
    try:
        user = db.create_user(args.username, password, args.name or "", args.admin)
    except db.AccountError as error:
        sys.exit(str(error))
    role = "committee" if user["is_admin"] else "member"
    print(f"Created {user['username']} ({role}).")


def cmd_password(args) -> None:
    user = _find(args.username)
    db.set_password(user["id"], _ask_password(user["username"]))
    ended = db.end_all_sessions(user["id"])
    print(f"Password set for {user['username']}."
          + (f" Signed out {ended} device(s)." if ended else ""))


def cmd_promote(args) -> None:
    user = _find(args.username)
    db.set_admin(user["id"], True)
    print(f"{user['username']} is committee.")


def cmd_demote(args) -> None:
    user = _find(args.username)
    try:
        db.set_admin(user["id"], False)
    except db.AccountError as error:
        sys.exit(str(error))
    print(f"{user['username']} is an ordinary member.")


def cmd_signout(args) -> None:
    user = _find(args.username)
    print(f"Signed out {db.end_all_sessions(user['id'])} device(s) for {user['username']}.")


def cmd_where(_args) -> None:
    """Which database is this, and does it look like the club's or a stub?

    The first question to ask of a deploy that came up looking wrong: an app
    serving six items is not broken, it is pointed at the seed instead of at
    the club's real inventory.
    """
    print(f"database: {db.DB_PATH}")
    if not db.DB_PATH.exists():
        print("          (does not exist yet)")
        return
    size_kb = db.DB_PATH.stat().st_size / 1024
    with db.connect() as conn:
        counts = {t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
                  for t in ("items", "faults", "users", "sessions", "trips")}
    print(f"size:     {size_kb:.0f} KB")
    print("holds:    " + ", ".join(f"{n} {t}" for t, n in counts.items()))


def cmd_backup(args) -> None:
    """Copy the database out while the app is running.

    Not `cp`: a plain copy of a database being written to can catch it
    mid-write and produce a file that is silently a bit corrupt, which is the
    worst possible property in a backup. sqlite3's own backup API takes a
    consistent snapshot of a live database, and pulls in anything still
    sitting in the write-ahead log rather than leaving it behind in the -wal
    file a copy would miss.
    """
    if not db.DB_PATH.exists():
        sys.exit(f"No database at {db.DB_PATH}. Nothing to back up.")
    target = Path(args.path) if args.path else Path(
        f"kit-{datetime.now().strftime('%Y-%m-%d')}.db")
    if target.is_dir():
        target = target / f"kit-{datetime.now().strftime('%Y-%m-%d')}.db"
    target.parent.mkdir(parents=True, exist_ok=True)

    source = sqlite3.connect(db.DB_PATH)
    destination = sqlite3.connect(target)
    try:
        with destination:
            source.backup(destination)
    finally:
        destination.close()
        source.close()

    with sqlite3.connect(target) as check:
        items = check.execute("SELECT count(*) FROM items").fetchone()[0]
        ok = check.execute("PRAGMA integrity_check").fetchone()[0]
    check.close()
    size_kb = target.stat().st_size / 1024
    print(f"Wrote {target} ({size_kb:.0f} KB, {items} items, integrity: {ok}).")
    if ok != "ok":
        sys.exit("The copy did not verify. Do not treat it as a backup.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    subs = parser.add_subparsers(dest="command", required=True)

    subs.add_parser("list", help="every account, and what it has done").set_defaults(fn=cmd_list)
    subs.add_parser("where", help="which database file this is, and what is in it"
                    ).set_defaults(fn=cmd_where)

    backup = subs.add_parser("backup", help="safe copy of the database, live or not")
    backup.add_argument("path", nargs="?",
                        help="where to write it (default: kit-YYYY-MM-DD.db here)")
    backup.set_defaults(fn=cmd_backup)

    new = subs.add_parser("signup", help="create an account")
    new.add_argument("username")
    new.add_argument("--name", help="display name (defaults to the username)")
    new.add_argument("--admin", action="store_true", help="make it a committee account")
    new.set_defaults(fn=cmd_signup)

    for name, fn, help_text in (
        ("password", cmd_password, "set or reset an account's password"),
        ("promote", cmd_promote, "make an account committee"),
        ("demote", cmd_demote, "stand an account down from committee"),
        ("signout", cmd_signout, "end an account's sessions on every device"),
    ):
        sub = subs.add_parser(name, help=help_text)
        sub.add_argument("username")
        sub.set_defaults(fn=fn)

    args = parser.parse_args()
    db.ensure_db()
    args.fn(args)


if __name__ == "__main__":
    main()
