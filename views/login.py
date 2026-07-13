"""Admin login — STUB.

Long-term goal: an admin login so committee members can approve / clear faults
(see faults.approved in schema.sql) and manage the inventory. Not implemented
yet — this page documents where it will live.
"""
import streamlit as st

import nav


def render() -> None:
    st.subheader("🔒 Admin login")
    st.info(
        "Coming soon. This will authenticate committee members against the "
        "`users` table (is_admin) so they can approve and clear reported faults, "
        "and manage inventory. For now the app is open and unauthenticated."
    )
    with st.form("login_stub"):
        st.text_input("Username", disabled=True)
        st.text_input("Password", type="password", disabled=True)
        st.form_submit_button("Log in", disabled=True)
    if st.button("← Back to home"):
        nav.go("home")
