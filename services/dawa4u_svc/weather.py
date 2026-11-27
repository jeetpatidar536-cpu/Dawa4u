"""Is it raining? (The video's Weather Union idea; here the free Open-Meteo service, cached in Redis.)"""
from __future__ import annotations

import json

import httpx

from .common import log, rdb, settings

RAIN_CODES = set(range(51, 68)) | {80, 81, 82} | set(range(95, 100))


async def raining() -> bool:
    if not settings.weather:
        return False
    r = rdb()
    c = await r.get("wx:now")
    if c is not None:
        return c == "1"
    rain, ttl = False, 300
    try:
        async with httpx.AsyncClient(timeout=3) as h:
            res = await h.get(
                "https://api.open-meteo.com/v1/forecast",
                params={"latitude": settings.city_lat, "longitude": settings.city_lng, "current": "precipitation,weather_code"},
            )
        cur = res.json().get("current", {})
        rain = float(cur.get("precipitation") or 0) >= 0.3 or int(cur.get("weather_code") or 0) in RAIN_CODES
        ttl = 900
    except Exception as e:  # noqa: BLE001 — no weather is not a reason to fail an order
        log.info("weather unavailable: %s", e)
    await r.set("wx:now", "1" if rain else "0", ex=ttl)
    return rain


async def rain_days(days: int = 7) -> list[float]:
    """Rain (mm) for the next days — the forecast model uses it (rain → more fever and cold medicines)."""
    r = rdb()
    c = await r.get("wx:days")
    if c:
        return json.loads(c)
    out: list[float] = [0.0] * days
    if settings.weather:
        try:
            async with httpx.AsyncClient(timeout=4) as h:
                res = await h.get(
                    "https://api.open-meteo.com/v1/forecast",
                    params={"latitude": settings.city_lat, "longitude": settings.city_lng, "daily": "precipitation_sum", "forecast_days": days, "timezone": "Asia/Kolkata"},
                )
            out = [float(x or 0) for x in res.json()["daily"]["precipitation_sum"]][:days]
        except Exception as e:  # noqa: BLE001
            log.info("weather forecast unavailable: %s", e)
    await r.set("wx:days", json.dumps(out), ex=3 * 3600)
    return out
