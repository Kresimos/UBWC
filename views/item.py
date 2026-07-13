"""Item page — image, spec table, known faults, and a report-fault button."""
import streamlit as st

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

    st.subheader(db.item_title(item))
    st.caption(db.COMPONENT_LABELS.get(item["component_type"], item["component_type"]))

    if item.get("archived"):
        reason = item.get("archived_reason") or "no reason given"
        st.error(f"🗄 **Archived** on {item.get('archived_at') or '—'} — {reason}. "
                 "Hidden from the active inventory.")

    left, right = st.columns([1, 2])

    with left:
        if item.get("image_path"):
            st.image(item["image_path"], use_container_width=True)
        else:
            st.markdown(
                "<div style='height:180px; display:flex; align-items:center; "
                "justify-content:center; background:#f1f5f9; border-radius:8px; "
                "color:#94a3b8; font-size:4rem;'>🏄</div>",
                unsafe_allow_html=True,
            )

    with right:
        # Spec table: specification names as the left-hand column.
        specs = db.spec_rows(item)
        table_rows = "".join(
            f"<tr><td style='padding:4px 12px 4px 0; color:#6b7280; white-space:nowrap;'>"
            f"{label}</td><td style='padding:4px 0; font-weight:600;'>{value}</td></tr>"
            for label, value in specs
        )
        st.markdown(f"<table>{table_rows}</table>", unsafe_allow_html=True)

    st.divider()

    # Known faults.
    st.markdown("### Known faults")
    open_faults = db.get_faults(item["id"], status="open")
    if not open_faults:
        st.success("No open faults reported.")
    else:
        for f in open_faults:
            st.markdown(
                f"- **{f['description']}**  "
                f"<span style='color:#9ca3af;'>· reported by {f['reported_by'] or 'unknown'} "
                f"on {f['created_at']}</span>",
                unsafe_allow_html=True,
            )

    if st.button("⚠ Report a fault", type="primary"):
        nav.go("faults", item_id=item["id"])

    st.divider()

    # --- Archive / restore ---
    if item.get("archived"):
        st.markdown("### Restore")
        st.caption("Bring this item back into the active inventory.")
        if st.button("♻ Restore to inventory"):
            db.unarchive_item(item["id"])
            st.rerun()
    else:
        with st.expander("🗄 Archive this item (broken / retired)"):
            st.caption("Archiving hides the item from the active inventory but keeps "
                       "its record and fault history. Use it for kit that's broken "
                       "beyond use or retired.")
            reason = st.text_input("Reason (optional)", key=f"archive_reason_{item['id']}",
                                   placeholder="e.g. snapped mast, beyond repair")
            if st.button("Archive item"):
                db.archive_item(item["id"], reason.strip() or None)
                st.success("Item archived.")
                st.rerun()

    # --- Rating widget (stub for the future rating system) ---
    with st.expander("Rate this item (coming soon)"):
        st.caption("TODO: ratings — requires the login/profile system. "
                   "See the `ratings` table in schema.sql.")
        st.feedback("stars", disabled=True)
