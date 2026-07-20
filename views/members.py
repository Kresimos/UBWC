"""Manage members — admin-only page to promote/demote, reset passwords, and
remove accounts.

Guardrails prevent locking everyone out: you can't demote or delete the last
admin, and you can't delete your own account while logged in.
"""
import streamlit as st

import auth
import nav


def render() -> None:
    st.subheader("👥 Manage members")

    if not auth.is_admin():
        st.error("🔒 Admins only. Log in as an admin to manage members.")
        if st.button("Go to login"):
            nav.go("login")
        return

    me = auth.current_user()
    users = auth.list_users()
    admin_count = auth.count_admins()

    # Create a new member/admin directly.
    with st.expander("➕ Add a new account"):
        with st.form("add_member", clear_on_submit=True):
            username = st.text_input("Username")
            password = st.text_input("Password", type="password")
            make_admin = st.checkbox("Admin account")
            if st.form_submit_button("Create account"):
                if not username.strip() or not password:
                    st.error("Username and password are both required.")
                elif auth.get_user(username):
                    st.error("That username is already taken.")
                else:
                    auth.create_user(username, password, is_admin=make_admin)
                    st.success(f"Created {'admin' if make_admin else 'member'} "
                               f"'{username.strip().lower()}'.")
                    st.rerun()

    st.divider()
    st.caption(f"{len(users)} account(s) · {admin_count} admin(s)")

    for user in users:
        is_self = user["id"] == me["id"]
        is_admin_user = bool(user["is_admin"])
        last_admin = is_admin_user and admin_count <= 1

        with st.container(border=True):
            top = st.columns([3, 1, 1])
            role = "Admin" if is_admin_user else "Member"
            label = f"**{user['username']}**"
            if is_self:
                label += " *(you)*"
            top[0].markdown(f"{label} · {role}")
            top[0].caption(f"Joined {user.get('created_at') or '—'}")

            # Promote / demote.
            if is_admin_user:
                if top[1].button("Demote", key=f"demote_{user['id']}",
                                 disabled=last_admin, use_container_width=True,
                                 help="Can't demote the last admin" if last_admin else None):
                    auth.set_admin(user["id"], False)
                    st.rerun()
            else:
                if top[1].button("Make admin", key=f"promote_{user['id']}",
                                 use_container_width=True):
                    auth.set_admin(user["id"], True)
                    st.rerun()

            # Delete.
            delete_blocked = is_self or last_admin
            help_text = ("Can't delete your own account" if is_self else
                         "Can't delete the last admin" if last_admin else None)
            if top[2].button("Delete", key=f"delete_{user['id']}",
                             disabled=delete_blocked, use_container_width=True,
                             help=help_text):
                auth.delete_user(user["id"])
                st.rerun()

            # Reset password.
            with st.expander("Reset password"):
                with st.form(f"reset_{user['id']}", clear_on_submit=True):
                    new_pw = st.text_input("New password", type="password",
                                           key=f"pw_{user['id']}")
                    if st.form_submit_button("Set new password"):
                        if not new_pw:
                            st.error("Enter a password.")
                        else:
                            auth.change_password(user["id"], new_pw)
                            st.success(f"Password reset for '{user['username']}'.")
