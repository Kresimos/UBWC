"""Session-state routing helpers shared by app.py and the views.

Kept separate from app.py to avoid a circular import (views import nav; app
imports both).
"""
import streamlit as st

DEFAULTS = {
    "route": "home",       # home | component | item | faults | add | login | profile
    "command": None,       # search command driving the component page (e.g. "boards")
    "item_id": None,       # item being viewed / faulted
    "user": None,          # logged-in user dict (None = anonymous) — future auth
}


def init_state() -> None:
    for key, value in DEFAULTS.items():
        st.session_state.setdefault(key, value)


def go(route: str, **kwargs) -> None:
    """Navigate to a route, updating any provided state, then rerun."""
    st.session_state["route"] = route
    for key, value in kwargs.items():
        st.session_state[key] = value
    st.rerun()


def current() -> str:
    return st.session_state.get("route", "home")
