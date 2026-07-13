"""Archived items page — broken / retired kit, hidden from the active inventory.

Lists everything that's been archived, with the reason and date, and lets you
open an item or restore it straight from here.
"""
import streamlit as st

import db
import nav


def render() -> None:
    st.subheader("🗄 Archived items")
    st.caption("Broken or retired kit. Hidden from the component pages and search, "
               "kept here for the record.")

    items = db.get_archived_items()
    if not items:
        st.info("Nothing archived. Archive a broken item from its page "
                "(⚠ open its item page → 'Archive this item').")
        return

    for item in items:
        with st.container(border=True):
            cols = st.columns([4, 1, 1])
            with cols[0]:
                st.markdown(f"**{db.item_title(item)}**  ·  "
                            f"{db.COMPONENT_LABELS.get(item['component_type'], item['component_type'])}")
                st.caption(f"Archived {item.get('archived_at') or '—'} · "
                           f"{item.get('archived_reason') or 'no reason given'}")
            if cols[1].button("View", key=f"arch_view_{item['id']}", use_container_width=True):
                nav.go("item", item_id=item["id"])
            if cols[2].button("♻ Restore", key=f"arch_restore_{item['id']}",
                              use_container_width=True):
                db.unarchive_item(item["id"])
                st.rerun()
