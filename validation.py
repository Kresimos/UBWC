"""Windsurfing kit compatibility rules.

Encodes the domain logic documented in CLAUDE.md so it can be reused by the
add-item form, a future rig-builder, and search ranking. Hard rules return
errors; soft/performance guidance returns warnings — never block a cross-brand
or off-band choice, only flag it.
"""
from dataclasses import dataclass, field
from typing import Optional

# Tolerance for the mast + extension == sail luff length check (adjustable
# extensions give a few cm of play).
MAST_LENGTH_TOLERANCE_CM = 2

# Soft board-volume guidance (litres per kg of rider weight), by ability.
# See CLAUDE.md "Board sizing".
VOLUME_MULTIPLIER = {
    "beginner": (1.15, 1.4),
    "intermediate": (1.0, 1.2),
    "advanced": (0.85, 1.05),
}


@dataclass
class Result:
    """Outcome of a validation: ok unless there are errors; warnings never block."""
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def merge(self, other: "Result") -> "Result":
        self.errors.extend(other.errors)
        self.warnings.extend(other.warnings)
        return self


def validate_rig(sail: dict,
                 mast: Optional[dict] = None,
                 extension_cm: Optional[float] = None,
                 boom: Optional[dict] = None) -> Result:
    """Check a rig (sail + mast + extension + boom) fits together.

    The sail requires a luff length. It does not matter which mast + extension
    combination is used, only that they total the luff (a 490cm-luff sail takes
    460+30, 470+20, 490+0...). Sails with an adjustable head
    (`top_extension_max_cm` > 0) also accept a longer total, up to that much of
    the mast poking out the top.

    Hard rules (errors):
      * sail.luff_cm <= mast.length_cm + extension_cm
        <= sail.luff_cm + sail.top_extension_max_cm   (±tolerance)
      * boom.min_size_cm <= sail.req_boom_cm <= boom.max_size_cm
      * sail.diameter == mast.diameter, but only for a cambered sail
    Soft rules (warnings): implausible extension length; a diameter mismatch on
    a camless sail; mast brand != sail brand (flex/IMCS not guaranteed, matters
    most for cambered sails).
    """
    res = Result()
    req_luff = sail.get("luff_cm")
    top_max = sail.get("top_extension_max_cm") or 0
    req_boom = sail.get("req_boom_cm")

    # Mast + extension total vs the sail's luff (plus any adjustable-head room).
    if mast is not None:
        mast_len = mast.get("length_cm")
        if req_luff is None:
            res.warnings.append(
                "Sail has no luff length recorded — can't verify the mast fit."
            )
        elif mast_len is None:
            res.warnings.append("Mast has no length recorded — can't verify the mast fit.")
        else:
            # Default: assume just enough extension to reach the luff.
            ext = extension_cm if extension_cm is not None else max(req_luff - mast_len, 0)
            total = mast_len + (ext or 0)
            low = req_luff - MAST_LENGTH_TOLERANCE_CM
            high = req_luff + top_max + MAST_LENGTH_TOLERANCE_CM
            if total < low:
                res.errors.append(
                    f"Mast {mast_len:g}cm + extension {ext or 0:g}cm = {total:g}cm, "
                    f"short of the sail's {req_luff:g}cm luff (±{MAST_LENGTH_TOLERANCE_CM}cm) "
                    f"— use a longer mast or more extension."
                )
            elif total > high:
                over = total - req_luff
                if top_max:
                    res.errors.append(
                        f"Mast {mast_len:g}cm + extension {ext or 0:g}cm = {total:g}cm, "
                        f"{over:g}cm past the {req_luff:g}cm luff; this sail's adjustable "
                        f"head only allows {top_max:g}cm out the top."
                    )
                else:
                    res.errors.append(
                        f"Mast {mast_len:g}cm + extension {ext or 0:g}cm = {total:g}cm, "
                        f"longer than the sail's {req_luff:g}cm luff "
                        f"(±{MAST_LENGTH_TOLERANCE_CM}cm)."
                    )
            # Implausible extension length.
            if ext is not None and not (0 <= ext <= 50):
                res.warnings.append(
                    f"An extension of {ext:g}cm is unusual (typical range 0–50cm) — "
                    f"double-check the mast choice."
                )

        # Diameter: only a hard rule for a cambered sail, whose cams are moulded
        # to one class. A camless sail's luff sleeve takes either.
        sail_diam, mast_diam = sail.get("diameter"), mast.get("diameter")
        if sail_diam and mast_diam and sail_diam != mast_diam:
            if sail.get("cams"):
                res.errors.append(
                    f"This sail's cams are moulded to {sail_diam}, so they will not "
                    f"close around an {mast_diam} mast."
                )
            else:
                res.warnings.append(
                    f"Sail is specced {sail_diam}, mast is {mast_diam} — camless, so "
                    f"the luff sleeve still fits, but rotation may be less clean."
                )

        # Brand match (best practice, not a rule).
        if mast.get("manufacturer") and sail.get("manufacturer") and \
                mast["manufacturer"].strip().lower() != sail["manufacturer"].strip().lower():
            note = (f"Mast brand ({mast['manufacturer']}) differs from sail brand "
                    f"({sail['manufacturer']}) — it will fit but the flex/IMCS may not "
                    f"match the sail's design.")
            if sail.get("cams"):
                note += " This sail is cambered, so brand match matters more here."
            res.warnings.append(note)

    # Boom outhaul range vs required boom length.
    if boom is not None:
        lo, hi = boom.get("min_size_cm"), boom.get("max_size_cm")
        if req_boom is None:
            res.warnings.append(
                "Sail has no recommended boom length recorded — can't verify the boom fit."
            )
        elif lo is not None and hi is not None and not (lo <= req_boom <= hi):
            res.errors.append(
                f"Sail needs a {req_boom:g}cm boom, but this boom only adjusts "
                f"{lo:g}–{hi:g}cm."
            )

    return res


def suggest_board_band(weight_kg: float, skill: str = "intermediate") -> tuple:
    """Soft litre band a rider of this weight/skill is usually comfortable on.

    Returns (low_litres, high_litres). Guidance only — never a hard filter.
    """
    lo_mult, hi_mult = VOLUME_MULTIPLIER.get(skill, VOLUME_MULTIPLIER["intermediate"])
    return round(weight_kg * lo_mult), round(weight_kg * hi_mult)


def check_board_for_rider(board: dict, weight_kg: float, skill: str = "intermediate") -> Result:
    """Warn (never error) if a board's volume sits outside the rider's soft band."""
    res = Result()
    vol = board.get("size_l")
    if vol is None or not weight_kg:
        return res
    lo, hi = suggest_board_band(weight_kg, skill)
    if vol < lo:
        res.warnings.append(
            f"{vol:g}L is below the ~{lo}–{hi}L band suggested for a {weight_kg:g}kg "
            f"{skill} rider — expect it to feel tippy / sink in light wind."
        )
    elif vol > hi:
        res.warnings.append(
            f"{vol:g}L is above the ~{lo}–{hi}L band suggested for a {weight_kg:g}kg "
            f"{skill} rider — fine for light wind, less lively when powered up."
        )
    return res


def fin_fits_board(fin: dict, board: dict) -> Result:
    """Hard box-type match for fins/foils (see CLAUDE.md 'Fin and foil boxes')."""
    res = Result()
    fb, bb = fin.get("box_type"), board.get("box_type")
    if fb and bb and fb.strip().lower() != bb.strip().lower():
        res.errors.append(
            f"Fin box ({fb}) doesn't match the board's box ({bb}) — physically incompatible."
        )
    return res


# Fields the add/edit form will not save without, per component type. These are
# the numbers the rig rules above read: a sail with no luff cannot be matched to
# a mast, a fin with no box cannot be matched to a board. Everything else is
# optional, so a half-known piece can still be recorded rather than left out of
# the inventory entirely.
REQUIRED_FIELDS = {
    "board": ["manufacturer", "model", "size_l", "condition", "location"],
    "sail":  ["manufacturer", "model", "type", "size_m2", "luff_cm",
              "req_boom_cm", "condition", "location"],
    "wing":  ["manufacturer", "model", "size_m2", "condition", "location"],
    "boom":  ["manufacturer", "model", "min_size_cm", "max_size_cm",
              "condition", "location"],
    "mast":  ["manufacturer", "model", "length_cm", "condition", "location"],
    "ext":   ["manufacturer", "model", "ext_max_cm", "condition", "location"],
    "fin":   ["manufacturer", "model", "box_type", "fin_length_cm",
              "condition", "location"],
    "foil":  ["manufacturer", "model", "box_type", "condition", "location"],
    "misc":  ["manufacturer", "model", "type", "condition", "location"],
}

FIELD_NAMES = {
    "manufacturer": "manufacturer", "model": "model", "type": "type",
    "size_l": "volume in litres", "size_m2": "size in m²",
    "luff_cm": "luff length", "req_boom_cm": "boom length",
    "min_size_cm": "shortest boom length", "max_size_cm": "longest boom length",
    "ext_min_cm": "shortest setting", "ext_max_cm": "longest setting",
    "diameter": "diameter", "length_cm": "length",
    "fin_length_cm": "fin length", "box_type": "box type",
    "condition": "condition", "location": "site",
}

# Plausible ranges, used only to warn. A number outside these is far more often
# a typo (a 49 cm luff, a 4900 cm one) than a real piece of kit, but the club
# owns odd things, so this never blocks a save.
PLAUSIBLE = {
    "size_m2": (0.5, 15, "m²"),
    "size_l": (50, 260, "litres"),
    "luff_cm": (250, 620, "cm"),
    "req_boom_cm": (100, 300, "cm"),
    "length_cm": (300, 560, "cm"),
    "fin_length_cm": (8, 80, "cm"),
    "top_extension_max_cm": (0, 60, "cm"),
    "ext_min_cm": (0, 40, "cm"),
    "ext_max_cm": (10, 60, "cm"),
}


def check_item(record: dict) -> Result:
    """Validate one item as typed into the add or edit form.

    Errors block the save, because this database is the club's ground truth
    from now on and bad data is what the spreadsheet already suffers from.
    Warnings are shown and ignorable.
    """
    res = Result()
    ctype = record.get("component_type")
    if ctype not in REQUIRED_FIELDS:
        res.errors.append("Pick what kind of kit this is.")
        return res

    for field in REQUIRED_FIELDS[ctype]:
        value = record.get(field)
        if value is None or (isinstance(value, str) and not value.strip()):
            res.errors.append(f"Needs a {FIELD_NAMES.get(field, field)}.")

    for field, (low, high, unit) in PLAUSIBLE.items():
        value = record.get(field)
        if value in (None, ""):
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            res.errors.append(f"{FIELD_NAMES.get(field, field).capitalize()} "
                              f"has to be a number.")
            continue
        if not low <= number <= high:
            res.warnings.append(
                f"{FIELD_NAMES.get(field, field).capitalize()} of {number:g}{unit} is "
                f"outside the usual {low:g}-{high:g}{unit} — worth a double-check."
            )

    # A boom or an extension that adjusts backwards would silently match nothing
    # in the wizard.
    for low_field, high_field, noun in (("min_size_cm", "max_size_cm", "boom length"),
                                        ("ext_min_cm", "ext_max_cm", "setting")):
        lo, hi = record.get(low_field), record.get(high_field)
        if lo in (None, "") or hi in (None, ""):
            continue
        try:
            if float(lo) > float(hi):
                res.errors.append(f"The shortest {noun} has to be under the longest.")
        except (TypeError, ValueError):
            res.errors.append(f"The {noun}s have to be numbers.")

    # Diameter is a hard fit for an extension against its mast, and for a
    # cambered sail's cams against both, so an unstated one costs the rig
    # assistant a rule it would otherwise apply. It never blocks a save: a
    # member who does not know the class should still record the piece.
    diameter = (record.get("diameter") or "").strip().upper()
    if diameter and diameter not in ("RDM", "SDM"):
        res.errors.append("Diameter has to be RDM or SDM.")
    elif not diameter:
        if ctype == "ext":
            res.warnings.append(
                "No diameter recorded: without RDM or SDM the rig assistant "
                "cannot tell which masts this extension bolts into."
            )
        elif ctype == "mast":
            res.warnings.append(
                "No diameter recorded: without RDM or SDM this mast will not be "
                "matched to extensions, or ruled out for cambered sails."
            )
        elif ctype == "sail" and record.get("cams"):
            res.warnings.append(
                "Cambered sail: record the diameter its cams are moulded to, so "
                "the rig assistant only offers masts they actually fit."
            )

    return res


def rank_by_brand(reference: dict, candidates: list) -> list:
    """Stable-sort candidates so same-brand-as-`reference` items come first.

    A ranking nudge for search/autocomplete — does not remove anything.
    """
    ref_brand = (reference.get("manufacturer") or "").strip().lower()

    def key(item):
        return 0 if (item.get("manufacturer") or "").strip().lower() == ref_brand else 1

    return sorted(candidates, key=key)
