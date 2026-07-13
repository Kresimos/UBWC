"""Component page — scrollable grid of items for a component command.

Shows manufacturer / model / size + image placeholder per layout.txt. Clicking
a card opens its item page. A 'jump to item' selectbox approximates the
arrow-key item cycling described in the layout (see the terminal-search note in
app.py for why true key events aren't available in Streamlit v1).
"""
import streamlit as st

import db
import nav

# Which size field to show on the card for each component type.
_CARD_SIZE = {
    "board": ("size_l", "L"),
    "sail": ("size_m2", "m²"),
    "wing": ("size_m2", "m²"),
    "mast": ("length_cm", "cm"),
    "fin": ("fin_length_cm", "cm"),
    "misc": ("size_generic", ""),
}


def _size_label(item: dict) -> str:
    ctype = item["component_type"]
    if ctype == "boom":
        lo, hi = item.get("min_size_cm"), item.get("max_size_cm")
        return f"{lo:g}–{hi:g}cm" if lo and hi else "—"
    field, unit = _CARD_SIZE.get(ctype, ("size_generic", ""))
    val = item.get(field)
    if val is None or val == "":
        return "—"
    return f"{val:g}{unit}" if isinstance(val, (int, float)) else str(val)


def render() -> None:
    command = st.session_state.get("command") or "boards"
    types = db.COMMANDS.get(command, ["board"])
    items = db.get_items(types)

    heading = command.capitalize()
    st.subheader(f"{heading}  ·  {len(items)} item{'s' if len(items) != 1 else ''}")

    if not items:
        st.info(f"No {heading.lower()} in the inventory yet. "
                "Use the ➕ Add item button to add one.")
        return

    # 'Arrow-key cycling' approximation: jump straight to an item.
    labels = {f"{db.item_title(it)} · {_size_label(it)}": it["id"] for it in items}
    choice = st.selectbox("Jump to item", ["—"] + list(labels.keys()), index=0)
    if choice != "—":
        nav.go("item", item_id=labels[choice])

    st.divider()

    # Scrollable grid of cards.
    cols_per_row = 3
    for start in range(0, len(items), cols_per_row):
        row = items[start:start + cols_per_row]
        cols = st.columns(cols_per_row)
        for col, item in zip(cols, row):
            with col:
                with st.container(border=True):
                    if item.get("image_path"):
                        st.image(item["image_path"], use_container_width=True)
                    else:
                        st.markdown(
                            "<div style='height:90px; display:flex; align-items:center; "
                            "justify-content:center; background:#f1f5f9; border-radius:6px; "
                            "color:#94a3b8; font-size:2rem;'>🏄</div>",
                            unsafe_allow_html=True,
                        )
                    st.markdown(f"**{db.item_title(item)}**")
                    st.caption(f"{_size_label(item)} · {item.get('location') or '—'}")
                    open_faults = db.get_faults(item["id"], status="open")
                    if open_faults:
                        st.markdown(
                            f"<span style='color:#dc2626;'>⚠ {len(open_faults)} fault"
                            f"{'s' if len(open_faults) != 1 else ''}</span>",
                            unsafe_allow_html=True,
                        )
                    if st.button("View", key=f"view_{item['id']}", use_container_width=True):
                        nav.go("item", item_id=item["id"])
