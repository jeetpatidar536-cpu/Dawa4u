"""eta-svc — how long until the medicines arrive.

Learns from every delivery, per S2 cell (a few streets) and per PIN code:
  total    minutes from "paid / prescription approved" to "delivered"
  ride     minutes from "picked up" to "delivered"
  handover minutes from "rider within 100 m" to "delivered" — parking, the gate, the lift, the stairs
While a rider is on the way it uses their live GPS. In the last 100 m it stops counting and says
"Arriving soon" (GPS jumps around near buildings; a countdown there only makes people anxious).
Rain adds a buffer.
"""
from __future__ import annotations

import asyncio
import statistics
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException

from .bus import make_bus
from .common import log, rdb, settings
from .geo import cell, metres, parent, valid
from .weather import raining

ARRIVE_M = 100        # "Arriving soon" radius
ROAD = 1.35           # roads are longer than a straight line
DEFAULT_KMH = 18.0    # two-wheeler in city traffic
DEFAULT_HANDOVER = 3  # minutes
SAMPLES = 5           # need this many deliveries before trusting a cell or PIN


async def _push(key: str, minutes: float) -> None:
    r = rdb()
    await r.lpush(key, round(minutes, 2))
    await r.ltrim(key, 0, 199)


async def _median(key: str) -> float | None:
    vals = [float(v) for v in await rdb().lrange(key, 0, 199)]
    return statistics.median(vals) if len(vals) >= SAMPLES else None


async def learned(kind: str, pin: str | None, lat, lng) -> float | None:
    """Most precise first: this cell, the bigger cell around it, the PIN code."""
    keys = []
    if valid(lat, lng):
        c = cell(float(lat), float(lng))
        keys += [f"eta:{kind}:c:{c}", f"eta:{kind}:c:{parent(c, 12)}"]
    if pin:
        keys.append(f"eta:{kind}:p:{pin}")
    for k in keys:
        m = await _median(k)
        if m is not None:
            return m
    return None


async def on_order(e: dict) -> None:
    o = e.get("order", {})
    oid = str(o.get("id", ""))
    if not oid:
        return
    r = rdb()
    t = f"track:{oid}"
    st = o.get("status")
    fields = {"status": st or "", "pin": o.get("pin") or ""}
    if valid(o.get("lat"), o.get("lng")):
        fields.update(lat=o["lat"], lng=o["lng"])
    ts = o.get("ts") or {}
    for k in ("processing", "ready", "out", "delivered"):
        if ts.get(k):
            fields[k] = ts[k]
    if o.get("rider"):
        fields["rider"] = o["rider"]
    await r.hset(t, mapping={k: str(v) for k, v in fields.items()})
    await r.expire(t, 3 * 86400)

    rider = str(o.get("rider") or "")
    if st == "d4u-out" and rider:
        await r.sadd(f"rider:orders:{rider}", oid)
    if st in ("completed", "cancelled", "refunded", "failed") and rider:
        await r.srem(f"rider:orders:{rider}", oid)

    if st == "completed" and ts.get("delivered"):
        if await r.set(f"eta:learned:{oid}", "1", nx=True, ex=30 * 86400):  # learn each delivery once
            await learn(oid, o, ts)


async def learn(oid: str, o: dict, ts: dict) -> None:
    done = float(ts["delivered"])
    start = float(ts.get("processing") or o.get("created") or 0)
    tr = await rdb().hgetall(f"track:{oid}")
    places = []
    if valid(o.get("lat"), o.get("lng")):
        c = cell(float(o["lat"]), float(o["lng"]))
        places += [f"c:{c}", f"c:{parent(c, 12)}"]
    if o.get("pin"):
        places.append(f"p:{o['pin']}")
    facts = {}
    if start and done > start:
        facts["total"] = (done - start) / 60
    if ts.get("out") and done > float(ts["out"]):
        facts["ride"] = (done - float(ts["out"])) / 60
    if tr.get("arrived") and done > float(tr["arrived"]):
        facts["handover"] = (done - float(tr["arrived"])) / 60
    for kind, m in facts.items():
        if 0 < m < 240:  # ignore orders delivered the next day
            for p in places:
                await _push(f"eta:{kind}:{p}", m)


async def on_location(e: dict) -> None:
    rider = str(e.get("rider", ""))
    if not rider or not valid(e.get("lat"), e.get("lng")):
        return
    r = rdb()
    lat, lng, now = float(e["lat"]), float(e["lng"]), float(e.get("at") or time.time())
    prev = await r.hgetall(f"rider:{rider}")
    speed = None
    if prev.get("lat") and prev.get("at"):
        dt = now - float(prev["at"])
        if 5 < dt < 300:
            speed = metres(float(prev["lat"]), float(prev["lng"]), lat, lng) / dt * 3.6  # km/h
    await r.hset(f"rider:{rider}", mapping={"lat": lat, "lng": lng, "at": now, **({"kmh": round(speed, 1)} if speed and speed < 80 else {})})
    await r.expire(f"rider:{rider}", 6 * 3600)
    await r.geoadd("riders", (lng, lat, rider))
    for oid in await r.smembers(f"rider:orders:{rider}"):
        tr = await r.hgetall(f"track:{oid}")
        if tr.get("lat") and not tr.get("arrived") and metres(lat, lng, float(tr["lat"]), float(tr["lng"])) <= ARRIVE_M:
            await r.hset(f"track:{oid}", "arrived", now)  # the handover clock starts


async def estimate(pin: str | None, lat=None, lng=None) -> dict:
    total = await learned("total", pin, lat, lng)
    rain = await raining()
    minutes = (total if total is not None else settings.target_min) + (settings.rain_buffer if rain else 0)
    return {"minutes": int(round(minutes)), "raining": rain, "learned": total is not None}


async def track(oid: str) -> dict:
    r = rdb()
    tr = await r.hgetall(f"track:{oid}")
    if not tr:
        raise HTTPException(404, "unknown order")
    st = tr.get("status")
    rain = await raining()
    out = {"status": st, "raining": rain, "soon": False, "minutes": None}
    now = time.time()
    if st == "d4u-out":
        pos = await r.hgetall(f"rider:{tr.get('rider', '')}") if tr.get("rider") else {}
        fresh = pos.get("at") and now - float(pos["at"]) < 120
        if fresh and tr.get("lat"):
            d = metres(float(pos["lat"]), float(pos["lng"]), float(tr["lat"]), float(tr["lng"]))
            out["distance_m"] = int(d)
            out["rider"] = {"lat": float(pos["lat"]), "lng": float(pos["lng"]), "age_s": int(now - float(pos["at"]))}
            if d <= ARRIVE_M or tr.get("arrived"):
                out["soon"] = True
                return out
            kmh = float(pos.get("kmh") or DEFAULT_KMH)
            kmh = min(max(kmh, 8.0), 35.0)
            hand = await learned("handover", tr.get("pin"), tr.get("lat"), tr.get("lng"))
            mins = d * ROAD / (kmh * 1000 / 60) + (hand if hand is not None else DEFAULT_HANDOVER)
        else:
            ride = await learned("ride", tr.get("pin"), tr.get("lat"), tr.get("lng"))
            ride = (ride if ride is not None else 15) + (settings.rain_buffer / 2 if rain else 0)
            mins = ride - (now - float(tr.get("out") or now)) / 60
        if mins <= 3:
            out["soon"] = True
        else:
            out["minutes"] = int(round(mins))
        return out
    if st in ("processing", "d4u-ready"):
        est = await estimate(tr.get("pin"), tr.get("lat"), tr.get("lng"))
        start = float(tr.get("processing") or now)
        out["by"] = int(start + est["minutes"] * 60)
        out["minutes"] = max(0, int(round((out["by"] - now) / 60)))
    return out


async def consumer() -> None:
    bus = make_bus()
    async for topic, e in bus.consume(["orders", "rider.location"], "eta-svc"):
        try:
            await (on_order(e) if topic == "orders" else on_location(e))
        except Exception as ex:  # noqa: BLE001
            log.exception("eta event failed: %s", ex)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(consumer())
    yield
    task.cancel()


app = FastAPI(title="dawa4u eta-svc", lifespan=lifespan)


@app.get("/eta")
async def eta_ep(pin: str | None = None, lat: float | None = None, lng: float | None = None):
    return await estimate(pin, lat, lng)


@app.get("/track/{oid}")
async def track_ep(oid: str):
    return await track(oid)


@app.get("/health")
async def health():
    await rdb().ping()
    return {"ok": True}
