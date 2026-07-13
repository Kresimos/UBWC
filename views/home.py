"""Home page — logo + search only (blank for now, per layout.txt)."""
import streamlit as st

import db


def render() -> None:
    st.markdown(
        "<p style='text-align:center; color:#6b7280; margin-top:2rem;'>"
        "Type a component command in the search bar above "
        "(e.g. <code>boards</code>, <code>sails</code>, <code>masts</code>) "
        "or use the sidebar.</p>",
        unsafe_allow_html=True,
    )

    # A quick at-a-glance summary of the inventory.
    counts = {}
    for cmd, types in db.COMMANDS.items():
        if cmd in ("sails", "wings"):  # avoid double counting the grouped command
            continue
        counts[cmd] = len(db.get_items(types))

    cols = st.columns(len(counts))
    for col, (name, n) in zip(cols, counts.items()):
        col.metric(name.capitalize(), n)
