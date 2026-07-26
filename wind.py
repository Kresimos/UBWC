"""Wind lookup for the logbook, via Open-Meteo.

Open-Meteo is the fit misc/spec.md expected: free, no key, and it covers inland
UK lake sites, which the marine forecasts do not.

Which hour matters is a product decision, not a detail: logging often happens
well after the sail, so the caller passes the **rig time and the de-rig time**
and gets the wind averaged over that window, never the wind at the moment the
form was filled in. The result is a suggestion the member can overwrite, so a
failed lookup is not an error — it returns None and the composer simply starts
empty with its source marked manual.
"""
import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

API = "https://api.open-meteo.com/v1/forecast"
TIMEOUT_S = 6

# Where each site actually is. A site the club adds later has no coordinates
# until somebody adds them here, and simply gets a manual wind entry.
SITE_COORDS = {
    "Cheddar": (51.2807, -2.7900),           # Cheddar Reservoir
    "Richmond Building": (51.4585, -2.6047),  # Bristol SU, Clifton
    "SU Store": (51.4585, -2.6047),
}

_COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]

# Open-Meteo answers the same hour identically all day, so one small in-process
# cache keeps repeated Log-tab visits off the network entirely.
_cache = {}


def compass(degrees) -> str:
    if degrees is None:
        return ""
    return _COMPASS[int((float(degrees) % 360) / 22.5 + 0.5) % 16]


def _parse(value) -> datetime:
    """Accept the ISO-ish strings SQLite hands back, as UTC."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip().replace("Z", "+00:00")
    if " " in text and "T" not in text:
        text = text.replace(" ", "T")
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _fetch(lat: float, lon: float, day: str) -> dict:
    if (lat, lon, day) in _cache:
        return _cache[(lat, lon, day)]
    query = urllib.parse.urlencode({
        "latitude": lat,
        "longitude": lon,
        "hourly": "wind_speed_10m,wind_gusts_10m,wind_direction_10m",
        "wind_speed_unit": "kn",
        "start_date": day,
        "end_date": day,
        "timezone": "UTC",
    })
    with urllib.request.urlopen(f"{API}?{query}", timeout=TIMEOUT_S) as response:
        data = json.load(response)
    _cache[(lat, lon, day)] = data
    return data


def for_window(site: str, start, end=None) -> dict:
    """Mean wind, mean direction and peak gust over the session's window.

    Returns {kn, gust_kn, dir, source, at} or None when the site has no
    coordinates, the window is outside the archive, or the network is away.
    """
    coords = SITE_COORDS.get(site)
    if not coords or not start:
        return None
    try:
        begin = _parse(start)
        finish = _parse(end) if end else begin + timedelta(hours=2)
    except (ValueError, TypeError):
        return None
    if finish < begin:
        begin, finish = finish, begin

    try:
        data = _fetch(coords[0], coords[1], begin.date().isoformat())
    except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError):
        return None

    hourly = data.get("hourly") or {}
    times = hourly.get("time") or []
    speeds, gusts, dirs = [], [], []
    for i, stamp in enumerate(times):
        when = _parse(stamp)
        # The hour a session starts counts even when it started mid-hour.
        if begin - timedelta(hours=1) <= when <= finish:
            for series, bucket in (("wind_speed_10m", speeds),
                                   ("wind_gusts_10m", gusts),
                                   ("wind_direction_10m", dirs)):
                value = (hourly.get(series) or [None] * len(times))[i]
                if value is not None:
                    bucket.append(float(value))
    if not speeds:
        return None

    return {
        "kn": round(sum(speeds) / len(speeds)),
        "gust_kn": round(max(gusts)) if gusts else None,
        "dir": compass(sum(dirs) / len(dirs)) if dirs else "",
        "source": "auto",
        "at": begin.isoformat(timespec="minutes"),
    }
