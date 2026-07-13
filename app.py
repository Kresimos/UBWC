"""UBWC Kit App — Streamlit entry point.

Single-entry app with session-state routing (nav.py) so the persistent chrome
from misc/layout.txt — logo, terminal search bar, sidebar nav, and the green
Add-item button — renders on every screen. Screens live in views/.
"""
from pathlib import Path

import streamlit as st
from streamlit_searchbox import st_searchbox

import db
import nav
from views import (add_item, component_list, faults, home, item, login, profile)

ROOT = Path(__file__).resolve().parent

st.set_page_config(page_title="UBWC Kit", page_icon="🏄", layout="wide")

db.ensure_db()
nav.init_state()

VIEWS = {
    "home": home.render,
    "component": component_list.render,
    "item": item.render,
    "faults": faults.render,
    "add": add_item.render,
    "login": login.render,
    "profile": profile.render,
}


def _search_kit(term: str) -> list:
    """Autocomplete source for the search bar.

    Returns (label, value) options where value is an action string:
    'cmd:<command>' to list a component type, or 'item:<id>' to open an item.
    Matches both terminal commands (boards, sails, …) and item names.
    """
    term = (term or "").strip()
    low = term.lower()
    options = []

    for cmd in db.COMMANDS:
        if not term or cmd.startswith(low) or low in cmd:
            options.append((f"⌘  {cmd}  —  list all", f"cmd:{cmd}"))

    if term:
        for it in db.search_items(term):
            label = (f"{db.item_title(it)}  ·  "
                     f"{db.COMPONENT_LABELS.get(it['component_type'], it['component_type'])}  ·  "
                     f"{component_list._size_label(it)}")
            options.append((label, f"item:{it['id']}"))

    return options


def _dispatch_search(value) -> None:
    """Navigate based on a selected search option (fires once per selection)."""
    if not value:
        return
    if value.startswith("cmd:"):
        nav.go("component", command=value[4:])
    elif value.startswith("item:"):
        nav.go("item", item_id=int(value[5:]))


def _logo() -> None:
    logo = next((p for p in ROOT.glob("images/logo.*")), None)
    if logo:
        st.image(str(logo), use_container_width=True)
    else:
        st.markdown(
            "<h1 style='text-align:center; margin:0;'>🌊 UBWC</h1>"
            "<p style='text-align:center; color:#6b7280; margin-top:0;'>Kit Inventory</p>",
            unsafe_allow_html=True,
        )


def _header() -> None:
    left, center, right = st.columns([1, 3, 1])
    with left:
        # Green top-left Add-item button (layout.txt).
        if st.button("➕ Add item", type="primary", use_container_width=True):
            nav.go("add")
    with center:
        if st.button("UBWC", key="home_logo", use_container_width=True,
                     help="Home"):
            nav.go("home")
        _logo()
    with right:
        st.caption("☰ menu →")  # points at Streamlit's built-in sidebar toggle

    # Terminal-style search bar: live autocomplete over commands + item names.
    # Selecting an option navigates immediately (dispatched once via
    # submit_function -> _dispatch_search).
    st_searchbox(
        _search_kit,
        placeholder="Search… commands (boards, sails, masts, …) or an item name",
        key="kit_search",
        submit_function=lambda value: st.session_state.__setitem__("_search_nav", value),
        rerun_on_update=True,
        clear_on_submit=True,
    )
    pending = st.session_state.pop("_search_nav", None)
    if pending:
        _dispatch_search(pending)

    # Quick-command buttons (discoverability aid for the terminal commands).
    quick = ["boards", "sails", "booms", "masts", "fins", "foils", "misc"]
    qcols = st.columns(len(quick))
    for col, cmd in zip(qcols, quick):
        if col.button(cmd, key=f"quick_{cmd}", use_container_width=True):
            nav.go("component", command=cmd)


def _sidebar() -> None:
    with st.sidebar:
        st.markdown("### Components")
        for cmd in ["boards", "sails", "booms", "masts", "fins", "foils", "misc"]:
            if st.button(cmd.capitalize(), key=f"nav_{cmd}", use_container_width=True):
                nav.go("component", command=cmd)
        st.divider()
        if st.button("🏠 Home", use_container_width=True):
            nav.go("home")
        if st.button("➕ Add item", use_container_width=True):
            nav.go("add")
        st.divider()
        st.caption("Coming soon")
        if st.button("🔒 Admin login", use_container_width=True):
            nav.go("login")
        if st.button("👤 My profile", use_container_width=True):
            nav.go("profile")


def main() -> None:
    _sidebar()
    _header()
    st.divider()
    VIEWS.get(nav.current(), home.render)()


main()
