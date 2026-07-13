"""User profile / favourite setups — STUB.

Long-term goal: members log in and save favourite setups (a board + rig
combination) and rate kit. Backed by the `users`, `setups` and `ratings`
tables in schema.sql. Not implemented yet.
"""
import streamlit as st

import nav


def render() -> None:
    st.subheader("👤 My profile")
    st.info(
        "Coming soon. This will let members save **favourite setups** "
        "(board + sail + mast + extension + boom) to the `setups` table and "
        "rate kit via the `ratings` table. Requires the login system."
    )
    if st.button("← Back to home"):
        nav.go("home")
