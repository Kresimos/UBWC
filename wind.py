"""Wind lookup for the logbook and the trips forecast, via Open-Meteo.

Open-Meteo is the fit misc/spec.md expected: free, no key, and it covers inland
UK lake sites, which the marine forecasts do not.

Which hour matters is a product decision, not a detail: logging often happens
well after the sail, so the caller passes the **rig time and the de-rig time**
and gets the wind averaged over that window, never the wind at the moment the
form was filled in. The result is a suggestion the member can overwrite, so a
failed lookup is not an error — it returns None and the composer simply starts
empty with its source marked manual.

Coordinates come from the database, not this file: a trip carries its own pin
(usually its destination geocoded when it was set up), and a named site carries
one on its `sites` row. `_coords` resolves a name to a pin; `geocode` is what
the new-trip form calls to turn a typed place into one. `SITE_COORDS` below is
only a fallback for the three sites the club has always had, in case the
database predates the columns.
"""
import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Optional

API = "https://api.open-meteo.com/v1/forecast"
GEOCODE_API = "https://geocoding-api.open-meteo.com/v1/search"
TIMEOUT_S = 6

# A fallback only. The live pins live on the `sites` table (db.site_coords);
# these seed it (db.DEFAULT_SITE_COORDS) and stand in if the row has no lat/lon.
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

# The sailing day. A trip's forecast is drawn as a Windguru-style strip, one
# column an hour, and nobody is on the water at four in the morning: the hours
# outside this are dead columns that only make each live one narrower.
DAY_FROM_H, DAY_TO_H = 6, 18

# A trip's forecast never runs longer than this. A week is already more days
# than anybody plans a windsurfing trip around, and Open-Meteo's useful horizon
# is about a fortnight anyway.
FORECAST_MAX_DAYS = 7


def compass(degrees) -> str:
    if degrees is None:
        return ""
    return _COMPASS[int((float(degrees) % 360) / 22.5 + 0.5) % 16]


def _coords(site: Optional[str], override=None) -> Optional[tuple]:
    """Where a trip or a session actually is: an explicit pin wins, then the
    site's own row, then the hardcoded fallback."""
    if override:
        try:
            lat, lon = float(override[0]), float(override[1])
            return (lat, lon)
        except (TypeError, ValueError, IndexError):
            pass
    if not site:
        return None
    try:
        import db  # lazy: wind.py is imported by db-free tooling too
        found = db.site_coords(site)
        if found:
            return found
    except Exception:
        pass
    return SITE_COORDS.get(site)


def _parse(value) -> datetime:
    """Accept the ISO-ish strings SQLite hands back, as UTC."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip().replace("Z", "+00:00")
    if " " in text and "T" not in text:
        text = text.replace(" ", "T")
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _fetch(lat: float, lon: float, start: str, end: Optional[str] = None) -> dict:
    """Open-Meteo's hourly wind for a date or an inclusive date range, cached."""
    end = end or start
    key = (lat, lon, start, end)
    if key in _cache:
        return _cache[key]
    query = urllib.parse.urlencode({
        "latitude": lat,
        "longitude": lon,
        "hourly": "wind_speed_10m,wind_gusts_10m,wind_direction_10m",
        "wind_speed_unit": "kn",
        "start_date": start,
        "end_date": end,
        "timezone": "UTC",
    })
    with urllib.request.urlopen(f"{API}?{query}", timeout=TIMEOUT_S) as response:
        data = json.load(response)
    _cache[key] = data
    return data


def for_window(site: str, start, end=None, *, coords=None) -> Optional[dict]:
    """Mean wind, mean direction and peak gust over the session's window.

    Returns {kn, gust_kn, dir, source, at} or None when the site has no
    coordinates, the window is outside the archive, or the network is away.
    """
    here = _coords(site, coords)
    if not here or not start:
        return None
    try:
        begin = _parse(start)
        finish = _parse(end) if end else begin + timedelta(hours=2)
    except (ValueError, TypeError):
        return None
    if finish < begin:
        begin, finish = finish, begin

    try:
        data = _fetch(here[0], here[1], begin.date().isoformat())
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


def forecast(site: str, start: str, end: Optional[str] = None,
             *, coords=None) -> Optional[list]:
    """The trip's sailing days, hour by hour, one entry per day:

        [{"date": "2026-03-14", "rows": [{hour, kn, gust_kn, dir}, ...]}, ...]

    What the trip page's wind strip is drawn from. Open-Meteo answers about a
    fortnight ahead and a few days behind, so a day further out than that, a
    trip at a spot with no pin, or no network at the lake simply yields fewer
    days — or None — and the strip is drawn shorter or not at all. A forecast
    that cannot be had is not an error worth a message.
    """
    here = _coords(site, coords)
    if not here or not start:
        return None
    try:
        first = _parse(start).date()
        last = _parse(end).date() if end else first
    except (ValueError, TypeError):
        return None
    if last < first:
        first, last = last, first
    last = min(last, first + timedelta(days=FORECAST_MAX_DAYS - 1))

    try:
        data = _fetch(here[0], here[1], first.isoformat(), last.isoformat())
    except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError):
        return None

    hourly = data.get("hourly") or {}
    times = hourly.get("time") or []
    speeds = hourly.get("wind_speed_10m") or []
    gusts = hourly.get("wind_gusts_10m") or []
    dirs = hourly.get("wind_direction_10m") or []

    by_day: dict = {}
    for i, stamp in enumerate(times):
        try:
            at = _parse(stamp)
        except (ValueError, TypeError):
            continue
        if not DAY_FROM_H <= at.hour <= DAY_TO_H:
            continue
        speed = speeds[i] if i < len(speeds) else None
        if speed is None:
            continue
        gust = gusts[i] if i < len(gusts) else None
        by_day.setdefault(at.date().isoformat(), []).append({
            "hour": f"{at.hour:02d}",
            "kn": round(float(speed)),
            "gust_kn": round(float(gust)) if gust is not None else None,
            "dir": compass(dirs[i]) if i < len(dirs) else "",
        })

    days = [{"date": day, "rows": rows} for day, rows in sorted(by_day.items())
            if rows]
    return days or None


def geocode(name: str, limit: int = 6) -> list:
    """Turn a typed place into pins for the new-trip form's "Pin the spot" box.

    [{"name", "admin1", "country", "lat", "lon"}], best match first. Empty on
    anything at all going wrong — the form just shows no suggestions and the
    trip can still be saved without a pin.
    """
    name = (name or "").strip()
    if len(name) < 2:
        return []
    query = urllib.parse.urlencode({
        "name": name,
        "count": max(1, min(limit, 20)),
        "language": "en",
        "format": "json",
    })
    try:
        with urllib.request.urlopen(f"{GEOCODE_API}?{query}",
                                    timeout=TIMEOUT_S) as response:
            data = json.load(response)
    except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError):
        return []

    out = []
    for hit in (data.get("results") or []):
        try:
            out.append({
                "name": hit["name"],
                "admin1": hit.get("admin1") or "",
                "country": hit.get("country") or "",
                "lat": float(hit["latitude"]),
                "lon": float(hit["longitude"]),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return out
