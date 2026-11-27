"""S2 geometry (as in the video): the city is cut into cells, and delivery facts are learned per cell."""
from __future__ import annotations

import math

import s2sphere

CELL_LEVEL = 14  # about 0.3 km² per cell — a few streets; small enough to learn "this society has a slow lift"


def cell(lat: float, lng: float, level: int = CELL_LEVEL) -> str:
    return s2sphere.CellId.from_lat_lng(s2sphere.LatLng.from_degrees(lat, lng)).parent(level).to_token()


def parent(token: str, level: int) -> str:
    return s2sphere.CellId.from_token(token).parent(level).to_token()


def metres(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def valid(lat, lng) -> bool:
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError):
        return False
    return -90 <= lat <= 90 and -180 <= lng <= 180 and not (lat == 0 and lng == 0)
