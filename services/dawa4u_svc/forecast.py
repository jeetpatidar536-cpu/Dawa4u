"""forecast-svc — what people near each pharmacy will order next week (the video's "prediction layer").

A gradient-boosting model (scikit-learn HistGradientBoostingRegressor, Poisson loss for counts) learns daily
demand per PIN code and medicine from: day of week, rain that day, yesterday, the same day last week,
the 7- and 28-day averages. Next week's rain comes from the weather forecast, so a rainy week ahead
raises fever and cold medicines before anyone orders them. With too little history it falls back to a
weighted average (last 7 days count more than the 3 weeks before).
"""
from __future__ import annotations

import asyncio
import datetime as dt
import os
import sqlite3
import time
from collections import defaultdict
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI

from .bus import make_bus
from .common import log, rdb, settings
from .weather import rain_days, raining

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
MIN_ROWS, MIN_DAYS = 100, 21  # below this the weighted average is as good
_model = {"m": None, "pins": {}, "skus": {}, "trained": 0, "rows": 0}


def db() -> sqlite3.Connection:
    os.makedirs(settings.data_dir, exist_ok=True)
    c = sqlite3.connect(os.path.join(settings.data_dir, "forecast.db"))
    c.execute("CREATE TABLE IF NOT EXISTS lines (day TEXT, pin TEXT, sku TEXT, qty INTEGER, oid TEXT, PRIMARY KEY (oid, sku))")
    c.execute("CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, rain INTEGER)")
    return c


def day_of(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts, IST).date().isoformat()


async def on_order(e: dict) -> None:
    o = e.get("order", {})
    if o.get("status") not in ("processing", "d4u-rx", "d4u-ready", "d4u-out", "completed"):
        return
    oid, pin = str(o.get("id", "")), str(o.get("pin") or "")
    if not oid or not pin or not o.get("items"):
        return
    day = day_of(float(o.get("created") or time.time()))
    rain = 1 if await raining() else 0
    c = db()
    with c:
        for it in o["items"]:
            c.execute("INSERT OR IGNORE INTO lines VALUES (?,?,?,?,?)", (day, pin, str(it["sku"]), int(it["qty"]), oid))
        if day == day_of(time.time()):
            c.execute("INSERT INTO days VALUES (?,?) ON CONFLICT(day) DO UPDATE SET rain = max(rain, excluded.rain)", (day, rain))
    c.close()


def _series(rows, days: list[str]):
    """{(pin, sku): np.array of daily qty over `days`}"""
    idx = {d: i for i, d in enumerate(days)}
    s = defaultdict(lambda: np.zeros(len(days)))
    for day, pin, sku, qty in rows:
        if day in idx:
            s[(pin, sku)][idx[day]] += qty
    return s


def _features(y: np.ndarray, i: int, dow: int, rain: int, pin_code: int, sku_code: int) -> list[float]:
    def mean(a, n):
        seg = a[max(0, i - n):i]
        return float(seg.mean()) if len(seg) else 0.0
    return [dow, rain, y[i - 1] if i >= 1 else 0.0, y[i - 7] if i >= 7 else 0.0, mean(y, 7), mean(y, 28), pin_code, sku_code]


def train() -> dict:
    from sklearn.ensemble import HistGradientBoostingRegressor

    c = db()
    rows = c.execute("SELECT day, pin, sku, qty FROM lines WHERE day >= ?", ((dt.date.today() - dt.timedelta(days=120)).isoformat(),)).fetchall()
    rain = dict(c.execute("SELECT day, rain FROM days").fetchall())
    c.close()
    if not rows:
        _model.update(m=None, rows=0, trained=time.time())
        return {"trained": False, "reason": "no orders yet"}
    first = min(r[0] for r in rows)
    start = dt.date.fromisoformat(first)
    days = [(start + dt.timedelta(days=k)).isoformat() for k in range((dt.date.today() - start).days + 1)]
    series = _series(rows, days)
    pins = {p: i for i, p in enumerate(sorted({k[0] for k in series}))}
    skus = {s: i for i, s in enumerate(sorted({k[1] for k in series}))}
    X, Y = [], []
    for (pin, sku), y in series.items():
        for i in range(7, len(days)):
            d = dt.date.fromisoformat(days[i])
            X.append(_features(y, i, d.weekday(), rain.get(days[i], 0), pins[pin], skus[sku]))
            Y.append(y[i])
    if len(Y) < MIN_ROWS or len(days) < MIN_DAYS:
        _model.update(m=None, rows=len(Y), trained=time.time())
        return {"trained": False, "reason": f"need {MIN_ROWS} rows and {MIN_DAYS} days, have {len(Y)} and {len(days)}"}
    cats = [0] + ([6] if len(pins) < 250 else []) + ([7] if len(skus) < 250 else [])  # categories must fit in 255 bins
    m = HistGradientBoostingRegressor(loss="poisson", max_iter=300, learning_rate=0.06, categorical_features=cats, random_state=7)
    m.fit(np.array(X), np.array(Y))
    _model.update(m=m, pins=pins, skus=skus, rows=len(Y), trained=time.time())
    log.info("forecast model trained on %d rows", len(Y))
    return {"trained": True, "rows": len(Y)}


async def predict(pins: list[str]) -> dict:
    c = db()
    since = (dt.date.today() - dt.timedelta(days=60)).isoformat()
    q = "SELECT day, pin, sku, qty FROM lines WHERE day >= ?" + (" AND pin IN (%s)" % ",".join("?" * len(pins)) if pins else "")
    rows = c.execute(q, (since, *pins)).fetchall()
    c.close()
    today = dt.date.today()
    days = [(today - dt.timedelta(days=60 - k)).isoformat() for k in range(61)]  # includes today
    series = _series(rows, days)
    rain_next = await rain_days(8)
    out: dict[str, dict] = {}
    m = _model["m"]
    for (pin, sku), y in series.items():
        last28 = float(y[-28:].sum())
        if last28 <= 0:
            continue
        last7 = float(y[-7:].sum())
        if m is not None and pin in _model["pins"] and sku in _model["skus"]:
            ext = list(y)
            total = 0.0
            for k in range(1, 8):
                d = today + dt.timedelta(days=k)
                arr = np.array(ext + [0.0])
                f = _features(arr, len(ext), d.weekday(), 1 if rain_next[min(k, len(rain_next) - 1)] >= 1 else 0, _model["pins"][pin], _model["skus"][sku])
                p = max(0.0, float(m.predict(np.array([f]))[0]))
                ext.append(p)
                total += p
            method = "gradient boosting"
        else:
            total = 7 * (0.6 * last7 / 7 + 0.4 * max(0.0, last28 - last7) / 21)
            method = "average"
        e = out.setdefault(sku, {"next7": 0.0, "last7": 0, "last28": 0, "method": method})
        e["next7"] += total
        e["last7"] += int(last7)
        e["last28"] += int(last28)
    for e in out.values():
        e["next7"] = int(np.ceil(e["next7"]))
    return out


async def consumer() -> None:
    bus = make_bus()
    async for topic, e in bus.consume(["orders"], "forecast-svc"):
        try:
            await on_order(e)
        except Exception as ex:  # noqa: BLE001
            log.exception("forecast event failed: %s", ex)


async def trainer() -> None:
    while True:
        try:
            await asyncio.to_thread(train)
        except Exception as ex:  # noqa: BLE001
            log.exception("training failed: %s", ex)
        await asyncio.sleep(6 * 3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = [asyncio.create_task(consumer()), asyncio.create_task(trainer())]
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="dawa4u forecast-svc", lifespan=lifespan)


@app.get("/forecast")
async def forecast_ep(pins: str = ""):
    p = [x for x in pins.split(",") if x.strip().isdigit()]
    return {"pins": p, "model": "gradient boosting" if _model["m"] is not None else "average", "trained_rows": _model["rows"], "medicines": await predict(p)}


@app.post("/train")
async def train_ep():
    return await asyncio.to_thread(train)


@app.get("/health")
async def health():
    await rdb().ping()
    return {"ok": True}
