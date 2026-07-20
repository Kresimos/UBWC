"""Faults page — report a new fault and clear existing ones for an item.

Pre-filled with the item's make/model/size (taken from the item whose 'Report
a fault' button was clicked), per layout.txt.
"""
import streamlit as st

import auth
import db
import nav


def render() -> None:
    item_id = st.session_state.get("item_id")
    item = db.get_item(item_id) if item_id else None
    if not item:
        st.warning("No item selected.")
        if st.button("← Back to home"):
            nav.go("home")
        return

    st.subheader("Faults")
    st.caption(
        f"{db.item_title(item)} · "
        f"{db.COMPONENT_LABELS.get(item['component_type'], item['component_type'])} · "
        f"{item.get('location') or '—'}"
    )

    # Report a new fault.
    user = auth.current_user()
    with st.form("report_fault", clear_on_submit=True):
        description = st.text_area("Describe the new fault")
        reporter = st.text_input("Your name (optional)",
                                 value=user["username"] if user else "")
        submitted = st.form_submit_button("Submit fault", type="primary")
        if submitted:
            if description.strip():
                db.report_fault(item["id"], description.strip(), reporter.strip() or None)
                st.success("Fault reported.")
            else:
                st.error("Please enter a description.")

    st.divider()

    # Current open faults, each clearable.
    st.markdown("### Current faults")
    admin = auth.is_admin()
    if not admin:
        st.caption("🔒 Only an admin can clear faults.")
    open_faults = db.get_faults(item["id"], status="open")
    if not open_faults:
        st.success("No open faults.")
    else:
        for f in open_faults:
            cols = st.columns([5, 1])
            cols[0].markdown(
                f"**{f['description']}**  \n"
                f"<span style='color:#9ca3af; font-size:0.85em;'>reported by "
                f"{f['reported_by'] or 'unknown'} on {f['created_at']}</span>",
                unsafe_allow_html=True,
            )
            # Clearing is admin-only; members can report but not clear.
            if admin and cols[1].button("Clear", key=f"clear_{f['id']}"):
                db.clear_fault(f["id"], cleared_by=auth.current_user()["username"])
                st.rerun()

    st.divider()
    if st.button("← Back to item"):
        nav.go("item", item_id=item["id"])
