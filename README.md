# UBWC Kit App

Kit inventory app for the University of Bristol Windsurfing Club. Members can
browse the club's boards, sails, masts, booms and other kit, report faults, and
(as admins) manage the inventory. Built with [Streamlit](https://streamlit.io)
on a SQLite database.

- **App UI/UX plan:** [misc/layout.txt](misc/layout.txt)
- **Windsurfing domain rules** (how kit fits together — used by the validation
  and rig-check features): [CLAUDE.md](CLAUDE.md)

---

## Quick start

From the project root (`UBWC/`):

```powershell
# 1. (first time) create + activate a virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2. install dependencies
pip install -r requirements.txt

# 3. build the database from the spreadsheet (first time only)
python migrate.py

# 4. run the app
streamlit run app.py
```

The app opens in your browser at http://localhost:8501.

### Windows: "running scripts is disabled on this system"

If `.\.venv\Scripts\Activate.ps1` fails with a `PSSecurityException`, PowerShell's
execution policy is blocking the activation script. Fix it once for your user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

`RemoteSigned` still blocks unsigned scripts downloaded from the internet, so
it's the standard, safe choice. Reverse it any time with `-ExecutionPolicy
Restricted`.

**Alternative (no policy change):** skip activation and call the venv's Python
directly:

```powershell
.\.venv\Scripts\python.exe -m streamlit run app.py
```

---

## The database is the ground truth

The kit data originally lived in a Google Sheet (downloaded copy at
[data/Kit Inventory.xlsx](data/Kit%20Inventory.xlsx)). `migrate.py` imports that
spreadsheet into **`kit.db`** (SQLite), which is now the live source of truth —
anything you add or change **in the app** is written straight to `kit.db`.

> ⚠️ **`migrate.py` rebuilds `kit.db` from scratch, wiping anything added through
> the app.** Treat it as a one-time seed. Only re-run it if you want to discard
> the current database and re-import the spreadsheet.

`kit.db` is intentionally **not** committed to git (see `.gitignore`) — it's a
build artifact and contains user password hashes. The spreadsheet stays the
versioned seed.

---

## Accounts, admins and members

The app has two roles:

| Role | Can do |
|---|---|
| **Member** | Browse kit, search, report faults, save nothing special |
| **Admin** | Everything a member can, **plus** archive/restore items, clear faults, and manage member accounts |

### First login

On first run the app creates a bootstrap admin account:

- **Username:** `admin`
- **Password:** `admin`

**Change this immediately.** Log in via the sidebar (**🔐 Log in / Register** →
*Log in*), open **🔐 Account → Change password**, and set a real password.

Prefer to set the admin credentials up front? Create
`.streamlit/secrets.toml` (already gitignored) before first run:

```toml
[admin]
username = "committee"
password = "a-strong-password"
```

The bootstrap admin is then created from those values instead of the default.

### Managing members (admins only)

Admins get a **👥 Manage members** button in the sidebar. From there you can:

- Add a new member or admin account
- Promote a member to admin / demote an admin to member
- Reset any account's password
- Delete accounts

Safety guards prevent locking everyone out: you can't demote or delete the
**last** admin, and you can't delete your own account while logged in. So once
you've made your own admin account, you're free to delete or demote the default
`admin` one.

Passwords are stored as salted **PBKDF2-HMAC-SHA256 hashes** — never in
plaintext, and not reversible.

---

## Using the app

- **Search bar** (top): type a component command (`boards`, `sails`, `masts`,
  `booms`, `fins`, `foils`, `misc`) or an item name — autocomplete suggestions
  navigate you straight there. The sidebar lists the same component pages.
- **Component pages:** a grid of every item of that type; click one to open its
  **item page** (specs, image, known faults).
- **Report a fault:** from any item page — open to everyone. **Clearing** faults
  is admin-only.
- **Add item** (➕, top-left): add a new piece of kit. Fields depend on the
  component type and are validated (e.g. a rig-compatibility check enforces the
  mast/extension/boom rules from [CLAUDE.md](CLAUDE.md)).
- **Archive** (🗄): retire broken/beyond-repair kit. Archived items are hidden
  from the active inventory and search but kept for the record, and can be
  restored. Archiving/restoring is admin-only.

---

## Project structure

| Path | Purpose |
|---|---|
| `app.py` | Streamlit entry point: page chrome, search bar, routing |
| `nav.py` | Session-state routing helpers |
| `db.py` | SQLite data-access layer + component field metadata |
| `auth.py` | Password hashing, accounts, sessions, admin bootstrap |
| `validation.py` | Windsurfing compatibility rules (rig fit, board sizing, brand) |
| `migrate.py` | Build `kit.db` from `data/Kit Inventory.xlsx` |
| `schema.sql` | Database schema (tables + per-type views) |
| `views/` | One module per screen (component list, item, faults, add, archive, login, members) |
| `data/` | The source spreadsheet |
| `CLAUDE.md` | Windsurfing domain knowledge (kit compatibility rules) |
| `misc/layout.txt` | Original UI/UX plan |

---

## Rebuilding / resetting the database

To wipe the current database and re-import the spreadsheet from scratch:

```powershell
python migrate.py
```

This deletes `kit.db` and rebuilds it, so **all app-added items, faults and user
accounts are lost**. Back up `kit.db` first if you want to keep them.
