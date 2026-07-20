"""Item page — image, spec table, known faults, ratings, and a report-fault button."""
import streamlit as st

import auth
import db
import nav
import validation


def _stars(n) -> str:
    n = int(round(n or 0))
    return "★" * n + "☆" * (5 - n)


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

    # --- Ratings (just below faults) ---
    _ratings_section(item)

    st.divider()

    # --- Archive / restore (admin only) ---
    if not auth.is_admin():
        if item.get("archived"):
            st.caption("🔒 Only an admin can restore archived items.")
    elif item.get("archived"):
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


def _ratings_section(item: dict) -> None:
    st.markdown("### Ratings")

    avg, count = db.get_rating_summary(item["id"])
    if count:
        st.markdown(f"**{avg:.1f} ★**  ·  {count} rating{'s' if count != 1 else ''}")
    else:
        st.caption("No ratings yet.")

    user = auth.current_user()
    admin = auth.is_admin()

    # List of ratings, each showing the reviewer's username + wind/ability context.
    for r in db.get_ratings(item["id"]):
        cols = st.columns([6, 1])
        context = "  ·  ".join(
            x for x in [r.get("wind_strength"),
                        (r.get("rider_ability") or "").capitalize()] if x
        )
        meta = f"  <span style='color:#9ca3af;'>· {context}</span>" if context else ""
        cols[0].markdown(
            f"{_stars(r['stars'])}  **{r['username']}**{meta}<br>"
            f"<span>{r['comment'] or ''}</span>  "
            f"<span style='color:#c0c0c0; font-size:0.8em;'>{r['created_at']}</span>",
            unsafe_allow_html=True,
        )
        can_delete = (user and r["user_id"] == user["id"]) or admin
        if can_delete and cols[1].button("Delete", key=f"delrate_{r['id']}"):
            db.delete_rating(r["id"])
            st.rerun()

    # Your rating form (members only).
    if not user:
        st.caption("🔒 Log in to rate this item.")
        if st.button("Log in", key=f"ratelogin_{item['id']}"):
            nav.go("login")
        return

    existing = db.get_user_rating(item["id"], user["id"])
    st.markdown("**Edit your review**" if existing else "**Add your review**")
    with st.form(f"rating_form_{item['id']}", clear_on_submit=False):
        stars = st.selectbox(
            "Rating", [1, 2, 3, 4, 5],
            index=(existing["stars"] - 1) if existing else 4,
            format_func=lambda s: f"{s} ★",
        )
        wind = st.selectbox(
            "Wind strength", db.WIND_STRENGTH_OPTIONS,
            index=(db.WIND_STRENGTH_OPTIONS.index(existing["wind_strength"])
                   if existing and existing.get("wind_strength") in db.WIND_STRENGTH_OPTIONS
                   else None),
            placeholder="Choose…",
        )
        ability = st.selectbox(
            "Your ability", validation.ABILITY_LEVELS,
            index=(validation.ABILITY_LEVELS.index(existing["rider_ability"])
                   if existing and existing.get("rider_ability") in validation.ABILITY_LEVELS
                   else None),
            format_func=str.capitalize, placeholder="Choose…",
        )
        comment = st.text_input(
            f"Comment (max {db.RATING_WORD_LIMIT} words)",
            value=existing["comment"] if existing else "",
        )
        submitted = st.form_submit_button(
            "Update rating" if existing else "Add rating", type="primary")
        if submitted:
            words = len(comment.split())
            if wind is None or ability is None:
                st.error("Please choose a wind strength and your ability.")
            elif not comment.strip():
                st.error("Please add a short comment.")
            elif words > db.RATING_WORD_LIMIT:
                st.error(f"Comment is {words} words — keep it to "
                         f"{db.RATING_WORD_LIMIT} or fewer.")
            else:
                db.upsert_rating(item["id"], user["id"], stars, comment.strip(),
                                 wind, ability)
                st.success("Rating saved.")
                st.rerun()

    if existing and st.button("Remove my rating", key=f"removerate_{item['id']}"):
        db.delete_rating(existing["id"])
        st.rerun()
