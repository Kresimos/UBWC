"""Account page — log in, register, change password, log out.

Members register with just a username + password (hashed via auth.py). One
admin account (bootstrapped in app.py) can archive items and clear faults.
"""
import streamlit as st

import auth
import nav


def render() -> None:
    st.subheader("🔐 Account")
    user = auth.current_user()
    if user:
        _account(user)
    else:
        _auth_forms()


def _account(user: dict) -> None:
    role = "Admin" if user.get("is_admin") else "Member"
    st.success(f"Logged in as **{user['username']}** · {role}")
    if user.get("is_admin"):
        st.caption("As an admin you can archive/restore items and clear faults.")

    if st.button("Log out"):
        auth.logout()
        nav.go("home")

    with st.expander("Change password"):
        with st.form("change_pw", clear_on_submit=True):
            p1 = st.text_input("New password", type="password")
            p2 = st.text_input("Confirm new password", type="password")
            if st.form_submit_button("Update password"):
                if not p1:
                    st.error("Enter a new password.")
                elif p1 != p2:
                    st.error("Passwords don't match.")
                else:
                    auth.change_password(user["id"], p1)
                    st.success("Password updated.")


def _auth_forms() -> None:
    if auth.default_admin_active():
        st.warning(
            "The default admin account is active (**admin** / **admin**). Log in "
            "and change its password, or set an `[admin]` block in "
            "`.streamlit/secrets.toml`.",
            icon="⚠️",
        )

    tab_login, tab_register = st.tabs(["Log in", "Register"])

    with tab_login:
        with st.form("login"):
            username = st.text_input("Username")
            password = st.text_input("Password", type="password")
            if st.form_submit_button("Log in", type="primary"):
                found = auth.authenticate(username, password)
                if found:
                    auth.login(found)
                    nav.go("home")
                else:
                    st.error("Incorrect username or password.")

    with tab_register:
        st.caption("Members register with a username and password. Admin accounts "
                   "are set up separately.")
        with st.form("register"):
            username = st.text_input("Choose a username", key="reg_username")
            p1 = st.text_input("Choose a password", type="password", key="reg_pw1")
            p2 = st.text_input("Confirm password", type="password", key="reg_pw2")
            if st.form_submit_button("Create account"):
                if not username.strip() or not p1:
                    st.error("Username and password are both required.")
                elif p1 != p2:
                    st.error("Passwords don't match.")
                elif auth.get_user(username):
                    st.error("That username is already taken.")
                else:
                    auth.create_user(username, p1, is_admin=False)
                    auth.login(auth.get_user(username))
                    nav.go("home")
