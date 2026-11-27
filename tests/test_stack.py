"""End-to-end test of the services: real Redis, Redis Streams as the bus (Kafka in production),
all four services running as separate processes, talking through the gateway like WordPress does.

Run:  pytest -q tests/test_stack.py
"""
import asyncio
import hashlib
import hmac
import json
import os
import random
import signal
import subprocess
import sys
import time

import httpx
import pytest

ROOT = os.path.join(os.path.dirname(__file__), "..", "services")
SECRET = "test-secret-not-for-production"
RPORT = 6391
PORTS = {"gateway": 8710, "stock": 8711, "eta": 8712, "forecast": 8713}
GW = f"http://127.0.0.1:{PORTS['gateway']}"
BUS = os.environ.get("TEST_BUS", "redis")  # CI also runs this with a real Kafka broker: TEST_BUS=kafka
SLOW = 3 if BUS == "kafka" else 1  # consumer groups take a few seconds to join


def signed(body: bytes = b""):
    ts = str(int(time.time()))
    sig = "sha256=" + hmac.new(SECRET.encode(), ts.encode() + b"." + body, hashlib.sha256).hexdigest()
    return {"x-dawa4u-time": ts, "x-dawa4u-signature": sig, "content-type": "application/json"}


def token(scope, ident, ttl=600):
    exp = str(int(time.time()) + ttl)
    mac = hmac.new(SECRET.encode(), f"{scope}.{ident}.{exp}".encode(), hashlib.sha256).hexdigest()
    return f"{scope}.{ident}.{exp}.{mac}"


@pytest.fixture(scope="module")
def stack(tmp_path_factory):
    data = tmp_path_factory.mktemp("data")
    procs = [subprocess.Popen(["redis-server", "--port", str(RPORT), "--save", "", "--appendonly", "no"], stdout=subprocess.DEVNULL)]
    time.sleep(0.5)
    env = {
        **os.environ,
        "D4U_SECRET": SECRET, "REDIS_URL": f"redis://127.0.0.1:{RPORT}/0", "BUS": BUS, "WEATHER": "off",
        "KAFKA_BROKERS": os.environ.get("KAFKA_BROKERS", "localhost:9092"),
        "HOLD_TTL_S": "4", "DATA_DIR": str(data), "ALLOWED_ORIGIN": "https://dawa4u.in",
        "STOCK_URL": f"http://127.0.0.1:{PORTS['stock']}", "ETA_URL": f"http://127.0.0.1:{PORTS['eta']}",
        "FORECAST_URL": f"http://127.0.0.1:{PORTS['forecast']}", "PYTHONPATH": ROOT,
    }
    for name, port in PORTS.items():
        procs.append(subprocess.Popen([sys.executable, "-m", "uvicorn", f"dawa4u_svc.{name}:app", "--port", str(port), "--log-level", "warning"], env=env, cwd=ROOT))
    for _ in range(120):
        try:
            if httpx.get(f"{GW}/health", timeout=1).json().get("forecast"):
                break
        except Exception:
            pass
        time.sleep(0.5)
    yield
    for p in procs:
        p.send_signal(signal.SIGTERM)
    for p in procs:
        p.wait(timeout=10)


def post(path, obj):
    b = json.dumps(obj).encode()
    return httpx.post(GW + path, content=b, headers=signed(b), timeout=5)


def get(path, **params):
    return httpx.get(GW + path, params=params, headers=signed(), timeout=5)


def event(topic, ev, key=""):
    r = post("/v1/events", {"topic": topic, "key": key, "event": ev})
    assert r.status_code == 200, r.text


def order_ev(oid, status, **o):
    return {"event": "order." + status, "order": {"id": oid, "status": status, **o}}


def wait_for(fn, timeout=8):
    end = time.time() + timeout * SLOW
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(0.2)
    return fn()


def test_auth(stack):
    assert httpx.post(GW + "/v1/events", json={"topic": "orders", "event": {}}).status_code == 401
    bad = signed(b"{}")
    bad["x-dawa4u-signature"] = "sha256=00"
    assert httpx.post(GW + "/v1/events", content=b"{}", headers=bad).status_code == 401
    assert httpx.get(GW + "/v1/track/5", params={"t": token("track", "6")}).status_code == 401
    assert httpx.post(GW + "/v1/rider/location", json={"t": token("rider", "9", ttl=-5), "lat": 22.7, "lng": 75.8}).status_code == 401


def test_last_strip_race(stack):
    # pharmacy 13 has 1 strip, pharmacy 16 has 3 — four strips in the city
    event("stock", {"event": "stock.snapshot", "pharmacy": 13, "items": {"d4u-p9": 1}})
    event("stock", {"event": "stock.snapshot", "pharmacy": 16, "items": {"d4u-p9": 3}})
    assert wait_for(lambda: get("/v1/stock/16").json()["free"].get("d4u-p9") == 3)

    async def one(i):
        b = json.dumps({"order": f"race{i}", "pharmacies": [13, 16], "items": {"d4u-p9": 1}, "paid": True}).encode()
        async with httpx.AsyncClient() as h:
            return (await h.post(GW + "/v1/stock/hold", content=b, headers=signed(b))).json()

    async def all_at_once():
        return await asyncio.gather(*(one(i) for i in range(10)))

    res = asyncio.run(all_at_once())
    held = [r for r in res if r["held"]]
    assert len(held) == 4, res  # exactly the four strips, never more
    assert sorted(r["pharmacy"] for r in held) == [13, 16, 16, 16]
    assert all(r["pharmacy"] is None for r in res if not r["held"])
    assert get("/v1/stock/13").json()["free"]["d4u-p9"] == 0
    assert get("/v1/stock/16").json()["held"]["d4u-p9"] == 3

    # a cancelled order gives its strip back; a delivered one doesn't
    gone = next(r for r in res if r["held"] and r["pharmacy"] == 16)
    oid = next(f"race{i}" for i, r in enumerate(res) if r is gone)
    event("orders", order_ev(oid, "cancelled"))
    assert wait_for(lambda: get("/v1/stock/16").json()["free"]["d4u-p9"] == 1)
    done = next(f"race{i}" for i, r in enumerate(res) if r["held"] and r["pharmacy"] == 13)
    event("orders", order_ev(done, "completed"))
    assert wait_for(lambda: "d4u-p9" not in get("/v1/stock/13").json()["held"])
    assert get("/v1/stock/13").json()["free"]["d4u-p9"] == 0

    # a new stock count keeps strips held for open orders out of what can be sold
    event("stock", {"event": "stock.snapshot", "pharmacy": 16, "items": {"d4u-p9": 5}})
    assert wait_for(lambda: get("/v1/stock/16").json()["free"]["d4u-p9"] == 3)  # 5 on the shelf − 2 still held


def test_unpaid_hold_lets_go(stack):
    event("stock", {"event": "stock.snapshot", "pharmacy": 20, "items": {"d4u-p1": 2}})
    assert wait_for(lambda: get("/v1/stock/20").json()["free"].get("d4u-p1") == 2)
    r = post("/v1/stock/hold", {"order": "unpaid1", "pharmacies": [20], "items": {"d4u-p1": 2}, "paid": False}).json()
    assert r["held"]
    assert get("/v1/stock/20").json()["free"]["d4u-p1"] == 0
    assert wait_for(lambda: get("/v1/stock/20").json()["free"]["d4u-p1"] == 2, timeout=25)  # TTL 4 s + reaper


def test_release_endpoint(stack):
    event("stock", {"event": "stock.snapshot", "pharmacy": 21, "items": {"d4u-p2": 1}})
    assert wait_for(lambda: get("/v1/stock/21").json()["free"].get("d4u-p2") == 1)
    assert post("/v1/stock/hold", {"order": "rel1", "pharmacies": [21], "items": {"d4u-p2": 1}, "paid": True}).json()["held"]
    assert post("/v1/stock/release", {"order": "rel1"}).json() == {"released": True}
    assert get("/v1/stock/21").json()["free"]["d4u-p2"] == 1


def test_unknown_stock_and_nobody_has_it(stack):
    r = post("/v1/stock/hold", {"order": "u1", "pharmacies": [77], "items": {"d4u-p5": 1}}).json()
    assert r == {"pharmacy": 77, "held": False, "reason": "stock unknown", "tried": []}
    r = post("/v1/stock/hold", {"order": "u2", "pharmacies": [13], "items": {"d4u-p9": 1}}).json()
    assert r["pharmacy"] is None and r["tried"][0]["short"] == "d4u-p9"


def test_eta_learns_and_arriving_soon(stack):
    home = (22.7240, 75.8710)  # customer
    now = time.time()
    for i in range(8):  # eight past deliveries to this street: 20-27 min, 3 min at the door
        start = now - 86400 - i * 3600
        oid = f"hist{i}"
        event("orders", order_ev(oid, "d4u-out", pin="452001", lat=home[0], lng=home[1], rider="r9", ts={"processing": start, "out": start + 600}))
        assert wait_for(lambda: httpx.get(f"http://127.0.0.1:{PORTS['eta']}/track/{oid}").status_code == 200)
        event("orders", order_ev(oid, "completed", pin="452001", lat=home[0], lng=home[1], rider="r9", ts={"processing": start, "out": start + 600, "delivered": start + 1200 + i * 60}))
    e = wait_for(lambda: (lambda j: j if j["learned"] else None)(get("/v1/eta", pin="452001", lat=home[0], lng=home[1]).json()))
    assert e["learned"] and 20 <= e["minutes"] <= 27, e

    # live order: rider 1.2 km away → minutes; within 100 m → "Arriving soon"
    event("orders", order_ev("live1", "d4u-out", pin="452001", lat=home[0], lng=home[1], rider="r1", ts={"processing": now - 900, "out": now - 300}))
    t = token("track", "live1")
    assert wait_for(lambda: httpx.get(f"{GW}/v1/track/live1", params={"t": t}).status_code == 200)
    ok = httpx.post(f"{GW}/v1/rider/location", json={"t": token("rider", "r1"), "lat": home[0] + 0.011, "lng": home[1], "acc": 12}).json()
    assert ok["ok"]
    tr = wait_for(lambda: (lambda j: j if j.get("distance_m") else None)(httpx.get(f"{GW}/v1/track/live1", params={"t": t}).json()))
    assert tr["status"] == "d4u-out" and 1100 < tr["distance_m"] < 1350 and tr["minutes"] >= 4 and not tr["soon"], tr
    time.sleep(4.2)  # pings are limited to one every 4 s
    httpx.post(f"{GW}/v1/rider/location", json={"t": token("rider", "r1"), "lat": home[0] + 0.0004, "lng": home[1], "acc": 10})
    tr = wait_for(lambda: (lambda j: j if j["soon"] else None)(httpx.get(f"{GW}/v1/track/live1", params={"t": t}).json()))
    assert tr["soon"] and tr["minutes"] is None, tr


def test_forecast_gradient_boosting(stack):
    rnd = random.Random(3)
    now = time.time()
    n = 0
    for d in range(45, 0, -1):  # 45 days of orders in 452001 and 452002; ORS sells more on weekends
        day_ts = now - d * 86400
        wd = time.localtime(day_ts).tm_wday
        for k in range(rnd.randint(3, 6) + (4 if wd >= 5 else 0)):
            items = [{"sku": "d4u-p1", "qty": rnd.randint(1, 2)}]
            if wd >= 5 or rnd.random() < 0.3:
                items.append({"sku": "d4u-ors", "qty": 1})
            event("orders", order_ev(f"f{d}-{k}", "completed", pin=rnd.choice(["452001", "452002"]), created=day_ts, items=items))
            n += 1
    base = f"http://127.0.0.1:{PORTS['forecast']}"
    assert wait_for(lambda: httpx.get(f"{base}/forecast", params={"pins": "452001,452002"}).json()["medicines"].get("d4u-p1", {}).get("last28", 0) > 0, timeout=20)
    time.sleep(1.5)
    tr = httpx.post(f"{base}/train", timeout=60).json()
    assert tr["trained"], tr
    f = get("/v1/forecast", pins="452001,452002").json()
    assert f["model"] == "gradient boosting"
    p1 = f["medicines"]["d4u-p1"]
    weekly = p1["last28"] / 4
    assert 0.4 * weekly <= p1["next7"] <= 2.5 * weekly, p1
    assert f["medicines"]["d4u-ors"]["method"] == "gradient boosting"
