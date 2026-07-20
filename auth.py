"""Authentication: user accounts, password hashing, and session helpers.

Passwords are **hashed** one-way with salted PBKDF2-HMAC-SHA256 (stdlib only) —
never stored or recoverable in plaintext. This is deliberately not reversible
"encryption": you verify a login by re-hashing the attempt and comparing, so a
leak of the database never exposes anyone's password.

Roles: every account has an `is_admin` flag. Only admins may archive/restore
items and clear faults (enforced in the views via `is_admin()`).
"""
import hashlib
import secrets
from typing import Optional

import streamlit as st

import db

_ALGO = "pbkdf2_sha256"
_ITERATIONS = 200_000
_SALT_BYTES = 16


# --------------------------------------------------------------------------- #
# Password hashing
# --------------------------------------------------------------------------- #
def hash_password(password: str) -> str:
    """Return a self-describing hash: 'pbkdf2_sha256$<iters>$<salt>$<hash>'."""
    salt = secrets.token_hex(_SALT_BYTES)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                             bytes.fromhex(salt), _ITERATIONS)
    return f"{_ALGO}${_ITERATIONS}${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time check of a password attempt against a stored hash."""
    try:
        algo, iters, salt, hexhash = stored.split("$")
        if algo != _ALGO:
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                                 bytes.fromhex(salt), int(iters))
        return secrets.compare_digest(dk.hex(), hexhash)
    except (ValueError, AttributeError):
        return False


# --------------------------------------------------------------------------- #
# User records
# --------------------------------------------------------------------------- #
def _norm(username: str) -> str:
    return (username or "").strip().lower()


def get_user(username: str) -> Optional[dict]:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?",
                           (_norm(username),)).fetchone()
    return dict(row) if row else None


def create_user(username: str, password: str, is_admin: bool = False,
                display_name: Optional[str] = None) -> int:
    username = _norm(username)
    with db.connect() as conn:
        cur = conn.execute(
            "INSERT INTO users (username, display_name, is_admin, password_hash) "
            "VALUES (?, ?, ?, ?)",
            (username, display_name or username, 1 if is_admin else 0,
             hash_password(password)),
        )
        conn.commit()
        return cur.lastrowid


def change_password(user_id: int, new_password: str) -> None:
    with db.connect() as conn:
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?",
                     (hash_password(new_password), user_id))
        conn.commit()


def authenticate(username: str, password: str) -> Optional[dict]:
    user = get_user(username)
    if user and verify_password(password, user.get("password_hash") or ""):
        return user
    return None


# --------------------------------------------------------------------------- #
# Member management (admin only — callers must check is_admin())
# --------------------------------------------------------------------------- #
def list_users() -> list:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id, username, display_name, is_admin, created_at "
            "FROM users ORDER BY is_admin DESC, username"
        ).fetchall()
    return [dict(r) for r in rows]


def count_admins() -> int:
    with db.connect() as conn:
        return conn.execute("SELECT COUNT(*) FROM users WHERE is_admin = 1").fetchone()[0]


def set_admin(user_id: int, is_admin: bool) -> None:
    with db.connect() as conn:
        conn.execute("UPDATE users SET is_admin = ? WHERE id = ?",
                     (1 if is_admin else 0, user_id))
        conn.commit()


def delete_user(user_id: int) -> None:
    with db.connect() as conn:
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()


# --------------------------------------------------------------------------- #
# Admin bootstrap
# --------------------------------------------------------------------------- #
def _admin_from_secrets() -> tuple:
    """Admin credentials from .streamlit/secrets.toml [admin], else a default."""
    try:
        cfg = st.secrets["admin"]
        return cfg["username"], cfg["password"]
    except Exception:
        return "admin", "admin"


def ensure_admin() -> None:
    """Create a bootstrap admin if no admin account exists yet."""
    with db.connect() as conn:
        count = conn.execute("SELECT COUNT(*) FROM users WHERE is_admin = 1").fetchone()[0]
    if count:
        return
    username, password = _admin_from_secrets()
    # A member may have already registered this username; promote instead.
    existing = get_user(username)
    if existing:
        with db.connect() as conn:
            conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (existing["id"],))
            conn.commit()
    else:
        create_user(username, password, is_admin=True, display_name="Admin")


def default_admin_active() -> bool:
    """True if the built-in 'admin'/'admin' account is still usable (unconfigured)."""
    user = get_user("admin")
    return bool(user and user["is_admin"]
                and verify_password("admin", user.get("password_hash") or ""))


# --------------------------------------------------------------------------- #
# Session
# --------------------------------------------------------------------------- #
def login(user: dict) -> None:
    st.session_state["user"] = {
        "id": user["id"],
        "username": user["username"],
        "display_name": user.get("display_name"),
        "is_admin": bool(user["is_admin"]),
    }


def logout() -> None:
    st.session_state["user"] = None


def current_user() -> Optional[dict]:
    return st.session_state.get("user")


def is_admin() -> bool:
    user = current_user()
    return bool(user and user.get("is_admin"))
