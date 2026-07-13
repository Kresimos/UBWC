"""Add-item page — insert a new item of any component type.

Fields shown depend on the component type; all are required (per layout.txt).
Includes a rig-compatibility checker that reuses validation.py so kit that
won't fit together is caught before it's relied on.
"""
import streamlit as st

import db
import nav
import validation


def _field_widget(field: str, meta: dict, key: str):
    label = meta["label"]
    kind = meta["kind"]
    if kind == "number":
        return st.number_input(label, value=None, step=1.0, key=key)
    if kind == "bool":
        return st.checkbox(label, key=key)
    if kind == "select":
        return st.selectbox(label, meta["choices"], index=None,
                            placeholder="Choose…", key=key)
    return st.text_input(label, key=key)


def render() -> None:
    st.subheader("➕ Add item")

    type_labels = {label: ctype for ctype, label in db.COMPONENT_LABELS.items()}
    chosen_label = st.selectbox("Component type", list(type_labels.keys()))
    ctype = type_labels[chosen_label]
    fields = db.COMPONENT_FIELDS[ctype]

    with st.form(f"add_{ctype}", clear_on_submit=False):
        values = {}
        cols = st.columns(2)
        for i, field in enumerate(fields):
            meta = db.FIELD_META[field]
            with cols[i % 2]:
                values[field] = _field_widget(field, meta, key=f"add_{ctype}_{field}")
        submitted = st.form_submit_button("Add item", type="primary")

    if submitted:
        # All fields required (bool checkbox always counts as filled).
        missing = [
            db.FIELD_META[f]["label"]
            for f in fields
            if db.FIELD_META[f]["kind"] != "bool"
            and (values[f] is None or str(values[f]).strip() == "")
        ]
        # Boom sanity: min < max.
        errors = []
        if ctype == "boom" and values.get("min_size_cm") is not None \
                and values.get("max_size_cm") is not None \
                and values["min_size_cm"] >= values["max_size_cm"]:
            errors.append("Min size must be less than max size.")

        if missing:
            st.error("Please fill in all fields: " + ", ".join(missing))
        elif errors:
            for e in errors:
                st.error(e)
        else:
            record = {"component_type": ctype, **values}
            if "cams" in record:
                record["cams"] = 1 if record["cams"] else 0
            new_id = db.add_item(record)
            st.success(f"Added {chosen_label}: {db.item_title(record)}.")
            nav.go("item", item_id=new_id)

    st.divider()
    _rig_check()


def _rig_check() -> None:
    """Reuses validation.validate_rig to flag rigs that won't fit together."""
    with st.expander("🔧 Rig compatibility check"):
        st.caption("Pick a sail and the mast/extension/boom you'd pair with it. "
                   "Rules come from CLAUDE.md.")
        sails = db.get_items(["sail"])
        masts = db.get_items(["mast"])
        booms = db.get_items(["boom"])
        if not sails:
            st.info("No sails in the inventory to check yet.")
            return

        sail = st.selectbox("Sail", sails,
                            format_func=lambda s: f"{db.item_title(s)} ({s.get('size_m2')}m²)")
        mast = st.selectbox("Mast", [None] + masts,
                            format_func=lambda m: "—" if m is None
                            else f"{db.item_title(m)} ({m.get('length_cm')}cm)")
        default_ext = sail.get("req_extension_cm") or 0.0
        extension = st.number_input("Extension (cm)", value=float(default_ext), step=1.0)
        boom = st.selectbox("Boom", [None] + booms,
                            format_func=lambda b: "—" if b is None
                            else f"{db.item_title(b)} ({b.get('min_size_cm')}–{b.get('max_size_cm')}cm)")

        if st.button("Check rig"):
            result = validation.validate_rig(sail, mast=mast, extension_cm=extension, boom=boom)
            for e in result.errors:
                st.error(e)
            for w in result.warnings:
                st.warning(w)
            if result.ok and not result.warnings:
                st.success("This rig fits together. ✅")
            elif result.ok:
                st.info("Fits, with the notes above.")
