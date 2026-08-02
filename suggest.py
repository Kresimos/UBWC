"""What size to open the rig wizard on, for this member, in this wind.

The Build screen has always started on a fixed number (5.5 m², 120 L) that was
right for nobody in particular. A member who has logged sessions has already
answered the question better than any default can: they have told the app what
they rigged, in what wind, and whether it worked. This module turns that into
the number the wheel starts on.

**Sail.** For one rider, the sail that planes in a given wind is close to
inversely proportional to the wind speed: halve the wind, roughly double the
sail. So each session gives one number,

    K = sail area (m²) x wind (kn),

which is that rider's own "power constant", since it folds their weight, board and
ambition into a single figure, which is exactly the part a formula cannot know
in advance. A club-average K of 100 is 5.5 m² at 18 kn, 7 m² at 14 kn, 4.5 m²
at 22 kn: the sizes a Cheddar Wednesday actually rigs.

The member's own K is a weighted mean of their sessions', weighted by:

  - **verdict**: a session they gave the sail a 👍 is the strongest evidence of
    a right-sized rig, a 👎 the weakest, with the session's own star rating
    nudging it either way;
  - **recency**: this year's sailing counts for more than last year's, with a
    half-life of about a season.

That mean is then **shrunk toward the club average**, which is the honest way to
treat two sessions' worth of evidence: PRIOR_SESSIONS acts as a couple of
imaginary club-average sessions, so one lucky day cannot swing the suggestion,
and a member with a season of logs is suggested their own number rather than
the club's.

**Board.** Volume is chosen from rider weight and skill, not from the wind
(CLAUDE.md, "Board sizing"), so it is not fitted to a curve; it is the member's
own weighted median volume, nudged one step up in light wind and down in strong,
and shrunk toward the club default the same way.

Everything here is a suggestion the member immediately overrides by moving the
wheel, so a missing wind reading or an empty logbook is not an error: it just
means the club default, which is where the app started.
"""
from datetime import datetime, timezone

import db

# 5.5 m² at 18 kn. The club's own average, and what a member with no logbook
# is suggested.
CLUB_K = 100.0
CLUB_BOARD_L = 120.0

# How many club-average sessions the prior is worth. Two: a member's third
# logged session is where their own sailing starts to outweigh the default.
PRIOR_SESSIONS = 2.0

# How fast a session stops speaking for the member's current sailing. Eight
# months, so last winter still counts and the season before it barely does.
HALF_LIFE_DAYS = 240.0

# The wheels' own limits (web/js/rig/engine.js TARGETS), so a suggestion can
# never open the wizard on a number it cannot show.
SAIL_RANGE = (1.5, 12.5)
BOARD_RANGE = (50.0, 260.0)

# A wind reading this side of useless means the sail curve would divide by
# nearly nothing and suggest a storm sail or a spinnaker.
WIND_RANGE = (5.0, 45.0)


def _parse(value):
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    if " " in text and "T" not in text:
        text = text.replace(" ", "T")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _recency(at) -> float:
    when = _parse(at)
    if not when:
        return 0.5
    days = max((datetime.now(timezone.utc) - when).days, 0)
    return 0.5 ** (days / HALF_LIFE_DAYS)


def _verdict(vote, stars) -> float:
    """How much a session's kit choice is worth as evidence it was the right size.

    A thumb on the piece itself is the direct answer; the session's stars are
    the weaker, whole-day one, and only tilt what the thumb already said.
    """
    weight = {1: 1.6, -1: 0.35}.get(vote, 1.0)
    if stars:
        weight *= 0.7 + 0.15 * float(stars)   # 1★ -> 0.85, 3★ -> 1.15, 5★ -> 1.45
    return weight


def _clamp(value, bounds):
    return max(bounds[0], min(bounds[1], value))


def _weighted_median(pairs):
    """Median of (value, weight), which is what a volume wants rather than a mean:
    one 40 L kids' board in the history must not drag a suggestion down."""
    if not pairs:
        return None
    ordered = sorted(pairs, key=lambda p: p[0])
    total = sum(weight for _, weight in ordered)
    seen = 0.0
    for value, weight in ordered:
        seen += weight
        if seen >= total / 2:
            return value
    return ordered[-1][0]


def _usable_wind(wind) -> float:
    """The wind figure the suggestion is computed at, or None if there isn't one."""
    if not wind:
        return None
    speed = wind.get("kn")
    if speed is None:
        return None
    try:
        speed = float(speed)
    except (TypeError, ValueError):
        return None
    return _clamp(speed, WIND_RANGE) if speed > 0 else None


def stock_range(component: str, column: str, site=None) -> tuple:
    """The smallest and biggest of something the club actually owns.

    The curve is only a curve: in a near calm it happily asks for 12 m², and in
    a gale for 2, neither of which is in the container. A suggestion is only
    useful if it is a size somebody can walk over and pick up, so both wheels
    are held inside what is on the rack (at this site, if a site is chosen).
    Returns (None, None) when there is nothing of that kind here.
    """
    sizes = [item[column] for item in db.all_items()
             if item.get("component_type") == component
             and item.get(column) is not None
             and (not site or item.get("location") == site)]
    if not sizes and site:
        return stock_range(component, column)
    return (min(sizes), max(sizes)) if sizes else (None, None)


def _bounds(wheel: tuple, stock: tuple) -> tuple:
    """The wheel's own limits, narrowed to what is in stock where we can."""
    low, high = wheel
    if stock[0] is not None:
        low = max(low, min(stock[0], high))
        high = min(high, max(stock[1], low))
    return (low, high)


def for_member(user_id, wind=None, site=None) -> dict:
    """The sail and board sizes to open Build on.

    `wind` is a wind.for_window() reading (or None) and `site` is where the
    member says they are, which decides what kit the suggestion may point at.
    Returns both suggestions with the working shown, because the wizard says
    *why* it opened where it did, because a number a member cannot account for
    is one they will not trust.
    """
    history = db.rider_history(user_id) if user_id else []
    speed = _usable_wind(wind)

    sails, boards = [], []
    for row in history:
        weight = _recency(row["at"])
        if row.get("sail_m2") and row.get("wind_kn"):
            k = float(row["sail_m2"]) * float(row["wind_kn"])
            sails.append((k, weight * _verdict(row.get("sail_vote"), row.get("stars"))))
        if row.get("board_l"):
            boards.append((float(row["board_l"]),
                           weight * _verdict(row.get("board_vote"), row.get("stars"))))

    return {
        "sail": _sail(sails, speed, _bounds(SAIL_RANGE, stock_range("sail", "size_m2", site))),
        "board": _board(boards, speed, _bounds(BOARD_RANGE, stock_range("board", "size_l", site))),
        "wind": wind or None,
        "sessions": len(history),
    }


def _sail(sails, speed, bounds=SAIL_RANGE) -> dict:
    """K, shrunk toward the club's, divided by the wind."""
    weight = sum(w for _, w in sails)
    k = (sum(k * w for k, w in sails) + CLUB_K * PRIOR_SESSIONS) / (weight + PRIOR_SESSIONS)

    if speed:
        value = _clamp(k / speed, bounds)
        basis = "yours" if sails else "club"
    else:
        # No wind to divide by: fall back on the size they actually rig most.
        median = _weighted_median([(k / CLUB_K * 5.5, w) for k, w in sails])
        value = _clamp(median if median else CLUB_K / 18.0, bounds)
        basis = "yours-nowind" if median else "club-nowind"

    return {
        "value": round(value, 1),
        "k": round(k, 1),
        "n": len(sails),
        "basis": basis,
        "why": _why_sail(basis, len(sails), speed, k),
    }


def _board(boards, speed, bounds=BOARD_RANGE) -> dict:
    weight = sum(w for _, w in boards)
    median = _weighted_median(boards)
    if median is None:
        value, basis = CLUB_BOARD_L, "club"
    else:
        # Shrink toward the club default on the same terms as the sail: a member
        # with one logged board is not yet a member with a usual board.
        value = (median * weight + CLUB_BOARD_L * PRIOR_SESSIONS) / (weight + PRIOR_SESSIONS)
        basis = "yours"

    # Volume is not a function of wind, but the day still tilts it: light wind
    # wants a little more float under you, a windy one a little less.
    if speed and speed < 12:
        value *= 1.05
    elif speed and speed > 25:
        value *= 0.95

    value = _clamp(round(value / 5) * 5, bounds)   # the wheel steps in 5 L
    return {
        "value": round(value),
        "n": len(boards),
        "basis": basis,
        "why": _why_board(basis, len(boards), speed),
    }


def _why_sail(basis, n, speed, k) -> str:
    sessions = f"{n} of your sessions" if n != 1 else "your one logged session"
    if basis == "yours":
        return f"From {sessions} and {round(speed)} kn now."
    if basis == "yours-nowind":
        return f"From {sessions}. No wind reading for this site."
    if basis == "club-nowind":
        return "The club's usual size. Log a session and this learns yours."
    return f"The club's usual size for {round(speed)} kn. Log a session and this learns yours."


def _why_board(basis, n, speed) -> str:
    if basis != "yours":
        return "The club's usual volume. Log a session and this learns yours."
    sessions = f"{n} of your sessions" if n != 1 else "your one logged session"
    if speed and (speed < 12 or speed > 25):
        tilt = "a little more float for the light wind" if speed < 12 else "a little less for the wind"
        return f"From {sessions}, with {tilt}."
    return f"From {sessions}."


def curve(user_id, wind=None, site=None) -> dict:
    """The member's sessions and their fitted sail curve, for the profile chart.

    The same numbers the suggestion is made of, laid out so a chart can draw
    them: one point per session (wind against sail size), the curve K/wind
    through them, and where today sits on it.
    """
    result = for_member(user_id, wind, site)
    points = []
    for row in db.rider_history(user_id) if user_id else []:
        if not row.get("sail_m2") or not row.get("wind_kn"):
            continue
        points.append({
            "wind": round(float(row["wind_kn"]), 1),
            "sail": float(row["sail_m2"]),
            "board": float(row["board_l"]) if row.get("board_l") else None,
            "vote": row.get("sail_vote"),
            "stars": row.get("stars"),
            "site": row.get("site"),
            "at": row.get("at"),
            "session_id": row.get("id"),
        })
    return {
        "points": points,
        "k": result["sail"]["k"],
        "club_k": CLUB_K,
        "suggestion": result,
    }
