"""gateway — the one public door (api.dawa4u.in). Everything else stays on the private network.

From the WordPress server (signed with D4U_SECRET):
  POST /v1/events            order steps and stock counts → Kafka
  POST /v1/stock/hold        hold the medicines at the best pharmacy that has them all (atomic, in Redis)
  GET  /v1/eta               usual delivery time for a PIN / location
  GET  /v1/forecast          next week's demand for a pharmacy's PIN codes
From browsers (short-lived tokens WordPress hands out):
  POST /v1/rider/location    a rider's GPS ping while delivering → Kafka
  GET  /v1/track/{order}     live "Arriving in 6 min" / "Arriving soon" for the customer
"""
from __future__ import annotations

import json
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .bus import make_bus
from .common import rdb, settings, token_ok, verify

TOPICS = {"orders", "stock"}
bus = make_bus()
http: httpx.AsyncClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http
    await bus.start()
    http = httpx.AsyncClient(timeout=2.0)
    yield
    await http.aclose()
    await bus.stop()


app = FastAPI(title="dawa4u gateway", lifespan=lifespan, docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.allowed_origin.split(",")],
    allow_methods=["GET", "POST"],
    allow_headers=["content-type"],
    max_age=600,
)


async def _forward(method: str, url: str, **kw):
    try:
        res = await http.request(method, url, **kw)
    except httpx.HTTPError as e:
        raise HTTPException(503, f"service unavailable: {e.__class__.__name__}")
    if res.status_code >= 400:
        raise HTTPException(res.status_code, res.text[:300])
    return res.json()


@app.post("/v1/events")
async def events(request: Request):
    body = await verify(request)
    data = json.loads(body or b"{}")
    batch = data if isinstance(data, list) else [data]
    n = 0
    for ev in batch[:100]:
        topic = ev.get("topic")
        if topic not in TOPICS or not isinstance(ev.get("event"), dict):
            raise HTTPException(400, "each event needs topic (orders|stock) and event")
        payload = {**ev["event"], "received_at": time.time()}
        await bus.publish(topic, payload, key=str(ev.get("key") or ""))
        n += 1
    return {"published": n}


@app.post("/v1/stock/hold")
async def stock_hold(request: Request):
    body = await verify(request)
    return await _forward("POST", f"{settings.stock_url}/hold", content=body, headers={"content-type": "application/json"})


@app.post("/v1/stock/release")
async def stock_release(request: Request):
    body = await verify(request)
    return await _forward("POST", f"{settings.stock_url}/release", content=body, headers={"content-type": "application/json"})


@app.get("/v1/stock/{ph}")
async def stock_view(ph: int, request: Request):
    await verify(request)
    return await _forward("GET", f"{settings.stock_url}/stock/{ph}")


@app.get("/v1/eta")
async def eta(request: Request, pin: str | None = None, lat: float | None = None, lng: float | None = None):
    await verify(request)
    params = {k: v for k, v in {"pin": pin, "lat": lat, "lng": lng}.items() if v is not None}
    return await _forward("GET", f"{settings.eta_url}/eta", params=params)


@app.get("/v1/forecast")
async def forecast(request: Request, pins: str = ""):
    await verify(request)
    return await _forward("GET", f"{settings.forecast_url}/forecast", params={"pins": pins})


class Ping(BaseModel):
    t: str
    lat: float
    lng: float
    acc: float | None = None


@app.post("/v1/rider/location")
async def rider_location(p: Ping):
    rider = token_ok(p.t, "rider")
    if not rider:
        raise HTTPException(401, "token expired — reopen the rider dashboard")
    if not (-90 <= p.lat <= 90 and -180 <= p.lng <= 180) or (p.acc is not None and p.acc > 500):
        return {"ok": False, "reason": "inaccurate"}
    if not await rdb().set(f"rl:rider:{rider}", "1", nx=True, ex=4):  # at most one ping every 4 s
        return {"ok": True, "throttled": True}
    await bus.publish("rider.location", {"rider": rider, "lat": p.lat, "lng": p.lng, "acc": p.acc, "at": time.time()}, key=rider)
    return {"ok": True}


@app.get("/v1/track/{order}")
async def track(order: str, t: str = ""):
    if token_ok(t, "track") != order:
        raise HTTPException(401, "bad token")
    return await _forward("GET", f"{settings.eta_url}/track/{order}")


@app.get("/health")
async def health():
    await rdb().ping()
    out = {"ok": True, "bus": settings.bus}
    for name, url in (("stock", settings.stock_url), ("eta", settings.eta_url), ("forecast", settings.forecast_url)):
        try:
            out[name] = (await http.get(f"{url}/health", timeout=1.5)).status_code == 200
        except httpx.HTTPError:
            out[name] = False
    return out
