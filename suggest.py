"""What size to open the rig wizard on, for this member, in this wind.

The Build screen used to start on a fixed number (5.5 m², 120 L) that was right
for nobody in particular. A member who has logged sessions has already
answered the question better than any formula can: they have told the app what
they rigged, in what wind, and whether it worked. This module turns that into
the number the wheel starts on, but only once there is something of theirs to
turn. The club runs from complete beginners to people who have sailed for
decades, so a population "average" is not a sensible guess at a specific
member we know nothing about yet; it would just be confidently wrong in a
different way for almost everyone. A member with no logbook is suggested a
flat, middling default (5.5 m², 140 L) and nothing cleverer than that, and the
moment they have logged even one relevant session, the suggestion is built
from theirs alone.

**Sail.** For one rider, the sail that planes in a given wind is close to
inversely proportional to the wind speed: halve the wind, roughly double the
sail. So each session gives one number,

    K = sail area (m²) x wind (kn),

which is that rider's own "power constant", since it folds their weight, board and
ambition into a single figure, which is exactly the part a formula cannot know
in advance.

The "wind (kn)" a session is sized against is not its mean, but `_effective_wind()`
leaning toward its gust: being overpowered in a gust is the outcome a rider
actually sizes to avoid, since a lull just costs a few quiet seconds, so the
number that governs the size picked is closer to the gust than the average. The
same blend is used both to fit K from a session's history and to divide by
"now"'s wind for a live suggestion, so the two sides of the division mean the
same thing.

The member's own K is a weighted mean of their sessions', weighted by:

  - **verdict**: the session's own star rating, since it says how the whole
    day's rig worked, size included. A thumb on a piece of kit is a different
    question (would you reach for this one again) and does not speak to
    whether it was the right size for the day, so it plays no part here;
  - **recency**: this year's sailing counts for more than last year's, with a
    half-life of about a season.

No blending toward a club figure happens after that: the first logged session
that has a sail and a wind reading is already a better guess at this member
than any population number could be.

**Board.** Volume is chosen from rider weight and skill, not from the wind
(CLAUDE.md, "Board sizing"), so it is not fitted to a curve the way the sail
is. But weight and skill barely move session to session for one rider, so they
are already free in that rider's own history without modelling either: what
does move is which board of theirs suits the day, and that tracks conditions
closely (a big sail, light-wind day wants more float than a small, powered
one). So the weighted median leans on sessions sailed in wind like today's:
each past board's weight is scaled by how close its session's wind was to
today's, halving every BOARD_WIND_HALFWIDTH kn of difference. With no wind to
compare against, that scaling is neutral and the median is the rider's plain
history. The result is then nudged one step up in light wind and down in
strong (no club shrinkage here either, once there is a board logged at all).

Everything here is a suggestion the member immediately overrides by moving the
wheel. A missing wind reading is never an error, it just leaves the tilt out;
an empty logbook is not an error either, it is exactly the flat default above.
"""
from datetime import datetime, timezone

import db

# 5.5 m² at 18 kn: not used to steer a suggestion (see the module docstring),
# only kept as the reference line the profile chart draws a member's own curve
# against ("more/less sail than the club average").
CLUB_K = 100.0

# The flat starting point for a member with no logbook yet: the middle of the
# club's own kit range, not a fitted number. From a member's first relevant
# session on, this is never blended in: their own history stands alone.
DEFAULT_SAIL_M2 = 5.5
DEFAULT_BOARD_L = 140.0

# How fast a session stops speaking for the member's current sailing. Eight
# months, so last winter still counts and the season before it barely does.
HALF_LIFE_DAYS = 240.0

# How far the wind a session is sized against leans toward its gust rather than
# its mean. 0 would ignore gusts entirely; 1 would size for the gust outright.
# A rider aims short of the gust, not at it, hence the middle ground.
GUST_WEIGHT = 0.6

# A board-wind difference this big roughly halves how much a past session says
# about today's board. A rider's board choice tracks the day's power more than
# an old session sailed in very different wind does.
BOARD_WIND_HALFWIDTH = 6.0

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


def _verdict(stars) -> float:
    """How much a session's kit choice is worth as evidence it was the right
    size, from the session's own star rating alone (see the module docstring
    for why a piece's own thumb rating is not part of this)."""
    return {1: 0.35, 2: 0.6, 3: 1.0, 4: 1.3, 5: 1.6}.get(stars, 1.0)


def _effective_wind(speed, gust):
    """The wind a rider actually sizes against: closer to the gust than the
    mean, for the reason in the module docstring. `gust` under `speed` (a bad
    reading, not a lull) is treated as no gust at all."""
    if speed is None:
        return None
    if not gust or gust <= speed:
        return speed
    return speed + GUST_WEIGHT * (gust - speed)


def _proximity(row_wind, today) -> float:
    """How alike a past session's wind was to today's, on the same half-life
    shape as `_recency`. 1.0 (neutral) when either side is unknown, so the
    board median falls back to an unweighted read of the rider's history."""
    if row_wind is None or today is None:
        return 1.0
    return 0.5 ** (abs(row_wind - today) / BOARD_WIND_HALFWIDTH)


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
    if speed <= 0:
        return None
    return _clamp(_effective_wind(speed, _asfloat(wind.get("gust_kn"))), WIND_RANGE)


def _asfloat(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _row_wind(row):
    """A logged session's own effective wind, on the same gust-leaning terms as
    `_usable_wind`, so history is fitted on the same basis a live suggestion is
    divided by."""
    speed = _asfloat(row.get("wind_kn"))
    if not speed:
        return None
    return _effective_wind(speed, _asfloat(row.get("wind_gust_kn")))


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
        row_wind = _row_wind(row)
        if row.get("sail_m2") and row_wind:
            size = float(row["sail_m2"])
            sails.append((size * row_wind, weight * _verdict(row.get("stars")), size))
        if row.get("board_l"):
            boards.append((float(row["board_l"]),
                           weight * _verdict(row.get("stars")),
                           row_wind))

    return {
        "sail": _sail(sails, speed, _bounds(SAIL_RANGE, stock_range("sail", "size_m2", site))),
        "board": _board(boards, speed, _bounds(BOARD_RANGE, stock_range("board", "size_l", site))),
        "wind": wind or None,
        "sessions": len(history),
    }


def _sail(sails, speed, bounds=SAIL_RANGE) -> dict:
    """K from the rider's own sessions, divided by the wind. No history, no K:
    a flat default rather than a guess dressed up as a personal one."""
    if not sails:
        return {
            "value": round(_clamp(DEFAULT_SAIL_M2, bounds), 1),
            "k": None,
            "n": 0,
            "basis": "new",
            "why": _why_sail("new", 0, speed),
        }

    weight = sum(w for _, w, _ in sails)
    k = sum(k * w for k, w, _ in sails) / weight

    if speed:
        value = _clamp(k / speed, bounds)
        basis = "yours"
    else:
        # No wind to divide by: fall back on the size they actually rig most.
        value = _clamp(_weighted_median([(size, w) for _, w, size in sails]), bounds)
        basis = "yours-nowind"

    return {
        "value": round(value, 1),
        "k": round(k, 1),
        "n": len(sails),
        "basis": basis,
        "why": _why_sail(basis, len(sails), speed),
    }


def _board(boards, speed, bounds=BOARD_RANGE) -> dict:
    """Weighted median of the rider's own boards, leaning on sessions sailed in
    wind like today's. No history, no median: the same flat-default rule as
    the sail."""
    if not boards:
        return {
            "value": round(_clamp(DEFAULT_BOARD_L, bounds)),
            "n": 0,
            "basis": "new",
            "why": _why_board("new", 0, speed),
        }

    conditioned = [(size, w * _proximity(row_wind, speed)) for size, w, row_wind in boards]
    value = _weighted_median(conditioned)

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
        "basis": "yours",
        "why": _why_board("yours", len(boards), speed),
    }


def _why_sail(basis, n, speed) -> str:
    if basis == "new":
        return "A middling default, no logged sessions yet to learn from."
    sessions = f"{n} of your sessions" if n != 1 else "your one logged session"
    if basis == "yours":
        return f"From {sessions}, sized for about {round(speed)} kn with the gusts."
    return f"From {sessions}. No wind reading for this site."


def _why_board(basis, n, speed) -> str:
    if basis == "new":
        return "A middling default, no logged sessions yet to learn from."
    sessions = f"{n} of your sessions" if n != 1 else "your one logged session"
    if speed and (speed < 12 or speed > 25):
        tilt = "a little more float for the light wind" if speed < 12 else "a little less for the wind"
        return f"From {sessions}, with {tilt}."
    return f"From {sessions}."


def curve(user_id, wind=None, site=None) -> dict:
    """The member's sessions and their fitted sail curve, for the profile chart.

    The same numbers the suggestion is made of, laid out so a chart can draw
    them: one point per session (wind against sail size), the curve K/wind
    through them, and where today sits on it. K is fit against each session's
    gust-leaning `_row_wind()`, not its raw mean, so a point plots on that same
    axis (`wind_fit`): otherwise the curve would not actually pass through
    the data it was fit to. `wind` and `gust` are kept alongside as the plain
    recorded numbers, for the tooltip.
    """
    result = for_member(user_id, wind, site)
    points = []
    for row in db.rider_history(user_id) if user_id else []:
        if not row.get("sail_m2") or not row.get("wind_kn"):
            continue
        points.append({
            "wind": round(float(row["wind_kn"]), 1),
            "gust": round(float(row["wind_gust_kn"]), 1) if row.get("wind_gust_kn") else None,
            "wind_fit": round(_row_wind(row), 1),
            "sail": float(row["sail_m2"]),
            "board": float(row["board_l"]) if row.get("board_l") else None,
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
