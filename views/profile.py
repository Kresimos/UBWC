"""My profile — save favourite setups (a board + rig combination).

Setups are private to the logged-in member. Building one shows a non-blocking
rig-compatibility note (reusing validation.validate_rig); it never blocks saving.
"""
import streamlit as st

import auth
import db
import nav
import validation
from views import component_list  # reuse _size_label for consistent item labels


def _label(item: dict) -> str:
    return f"{db.item_title(item)} · {component_list._size_label(item)}"


def _rig_result(sail, mast, boom):
    """validate_rig on a setup's rig parts, or None if there's no sail to check."""
    if not sail:
        return None
    return validation.validate_rig(
        sail, mast=mast, extension_cm=sail.get("req_extension_cm"), boom=boom)


def render() -> None:
    st.subheader("👤 My profile")

    user = auth.current_user()
    if not user:
        st.caption("🔒 Log in to view your profile.")
        if st.button("Log in"):
            nav.go("login")
        return

    role = "Admin" if user.get("is_admin") else "Member"
    st.caption(f"**{user['username']}** · {role}")

    _saved_setups(user)
    st.divider()
    _build_setup(user)


def _saved_setups(user: dict) -> None:
    st.markdown("### Saved setups")
    setups = db.get_setups(user["id"])
    if not setups:
        st.caption("No setups yet — build one below.")
        return

    for s in setups:
        with st.container(border=True):
            cols = st.columns([5, 1])

            items = {}
            lines = []
            for col_id, ctype in db.SETUP_SLOTS:
                if s.get(col_id):
                    it = db.get_item(s[col_id])
                    if it:
                        items[ctype] = it
                        lines.append(f"**{db.COMPONENT_LABELS[ctype]}:** {db.item_title(it)}")

            res = _rig_result(items.get("sail"), items.get("mast"), items.get("boom"))
            badge = ""
            if res is not None:
                badge = " ✅" if (res.ok and not res.warnings) else " ⚠"

            cols[0].markdown(f"**{s['name']}**{badge}")
            if lines:
                cols[0].markdown("  ·  ".join(lines))
            cols[0].caption(f"Saved {s.get('created_at') or '—'}")

            if cols[1].button("Delete", key=f"delsetup_{s['id']}",
                              use_container_width=True):
                db.delete_setup(s["id"])
                st.rerun()


def _build_setup(user: dict) -> None:
    st.markdown("### Build a setup")
    # Plain widgets (not st.form) so the compatibility note updates live as the
    # selections change.
    name = st.text_input("Setup name", key="new_setup_name",
                         placeholder="e.g. Strong wind blaster")

    selected = {}
    for col_id, ctype in db.SETUP_SLOTS:
        options = [None] + db.get_items(ctype)
        selected[ctype] = st.selectbox(
            db.COMPONENT_LABELS[ctype], options,
            format_func=lambda it: "— none —" if it is None else _label(it),
            key=f"new_setup_{col_id}",
        )

    # Live, non-blocking compatibility note.
    res = _rig_result(selected.get("sail"), selected.get("mast"), selected.get("boom"))
    if res is not None:
        for msg in res.errors + res.warnings:
            st.warning(msg)
        if res.ok and not res.warnings and (selected.get("mast") or selected.get("boom")):
            st.success("Rig fits together ✅")

    if st.button("Save setup", type="primary"):
        if not name.strip():
            st.error("Give your setup a name.")
        elif not any(selected.values()):
            st.error("Pick at least one item.")
        else:
            db.create_setup(
                user["id"], name.strip(),
                board_id=selected["board"]["id"] if selected["board"] else None,
                sail_id=selected["sail"]["id"] if selected["sail"] else None,
                mast_id=selected["mast"]["id"] if selected["mast"] else None,
                boom_id=selected["boom"]["id"] if selected["boom"] else None,
                fin_id=selected["fin"]["id"] if selected["fin"] else None,
            )
            st.success(f"Saved setup '{name.strip()}'.")
            st.rerun()
