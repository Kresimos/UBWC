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

# Shared rider-ability vocabulary (reused by the ratings UI so reviews and the
# board-sizing logic speak the same language).
ABILITY_LEVELS = list(VOLUME_MULTIPLIER)


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

    The sail's required luff length is its recorded Mast Length + Extension
    (e.g. a 460 mast + 30 extension = 490cm luff). The chosen mast plus the
    extension used must add up to that same luff.

    Hard rules (errors):
      * mast.length_cm + extension_cm == (sail.req_mast_length_cm
        + sail.req_extension_cm)  (±tolerance)
      * boom.min_size_cm <= sail.req_boom_cm <= boom.max_size_cm
    Soft rules (warnings): using a non-recommended mast size; implausible
    extension length; mast brand != sail brand (flex/IMCS not guaranteed,
    matters most for cambered sails).
    """
    res = Result()
    rec_mast = sail.get("req_mast_length_cm")
    rec_ext = sail.get("req_extension_cm")
    req_luff = None if rec_mast is None else rec_mast + (rec_ext or 0)
    req_boom = sail.get("req_boom_cm")

    # Mast + extension vs required luff length.
    if mast is not None:
        mast_len = mast.get("length_cm")
        ext = extension_cm if extension_cm is not None else sail.get("req_extension_cm") or 0
        if req_luff is None:
            res.warnings.append(
                "Sail has no required mast length recorded — can't verify the mast fit."
            )
        elif mast_len is None:
            res.warnings.append("Mast has no length recorded — can't verify the mast fit.")
        else:
            total = mast_len + (ext or 0)
            if abs(total - req_luff) > MAST_LENGTH_TOLERANCE_CM:
                res.errors.append(
                    f"Mast {mast_len:g}cm + extension {ext or 0:g}cm = {total:g}cm, "
                    f"but the sail needs a {req_luff:g}cm luff "
                    f"({rec_mast:g}cm mast + {rec_ext or 0:g}cm extension, "
                    f"±{MAST_LENGTH_TOLERANCE_CM}cm)."
                )
            # Non-recommended mast size (fits via extension, but flag it).
            if rec_mast is not None and abs(mast_len - rec_mast) > MAST_LENGTH_TOLERANCE_CM:
                res.warnings.append(
                    f"Sail recommends a {rec_mast:g}cm mast; you're using {mast_len:g}cm "
                    f"and making up the difference with extension."
                )
            # Implausible extension length.
            if ext is not None and not (0 <= ext <= 50):
                res.warnings.append(
                    f"An extension of {ext:g}cm is unusual (typical range 0–50cm) — "
                    f"double-check the mast choice."
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


def rank_by_brand(reference: dict, candidates: list) -> list:
    """Stable-sort candidates so same-brand-as-`reference` items come first.

    A ranking nudge for search/autocomplete — does not remove anything.
    """
    ref_brand = (reference.get("manufacturer") or "").strip().lower()

    def key(item):
        return 0 if (item.get("manufacturer") or "").strip().lower() == ref_brand else 1

    return sorted(candidates, key=key)
