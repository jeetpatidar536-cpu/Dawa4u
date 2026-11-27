"""stock-svc — who gets the last strip.

The video's "Redis mutex": every hold runs as one Lua script inside Redis, so checking the stock and taking it
happen in a single step that nothing can squeeze between. Two people paying for the last strip at the same
millisecond: one gets it, the other is sent to the next pharmacy.

Redis keys
  st:{ph}        hash  sku → strips free to sell (shelf minus strips held for orders)
  held:{ph}      hash  sku → strips held for orders not yet delivered
  hold:{order}   hash  ph, items (json), exp (0 = paid, keep until delivered or cancelled)
  holds:exp      zset  order → when an unpaid hold lets go
"""
from __future__ import annotations

import asyncio
import json
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel, Field

from .bus import make_bus
from .common import log, rdb, settings

HOLD = """
-- KEYS: st:{ph}, held:{ph}, hold:{order}, holds:exp
-- ARGV: ph, order, exp, items_json, sku1, qty1, sku2, qty2, ...
if redis.call('EXISTS', KEYS[3]) == 1 then
  return {'exists', redis.call('HGET', KEYS[3], 'ph')}
end
if redis.call('EXISTS', KEYS[1]) == 0 then
  return {'unknown', ARGV[1]}
end
for i = 5, #ARGV, 2 do
  local have = tonumber(redis.call('HGET', KEYS[1], ARGV[i]) or '0')
  if have < tonumber(ARGV[i + 1]) then
    return {'short', ARGV[i]}
  end
end
for i = 5, #ARGV, 2 do
  redis.call('HINCRBY', KEYS[1], ARGV[i], -tonumber(ARGV[i + 1]))
  redis.call('HINCRBY', KEYS[2], ARGV[i], tonumber(ARGV[i + 1]))
end
redis.call('HSET', KEYS[3], 'ph', ARGV[1], 'items', ARGV[4], 'exp', ARGV[3])
if tonumber(ARGV[3]) > 0 then
  redis.call('ZADD', KEYS[4], ARGV[3], ARGV[2])
end
return {'ok', ARGV[1]}
"""

# mode 'release' puts the strips back on sale (cancelled / unpaid); 'consume' means they left with the rider.
FINISH = """
-- KEYS: hold:{order}, holds:exp ; ARGV: order, mode
local ph = redis.call('HGET', KEYS[1], 'ph')
if not ph then return 0 end
local items = cjson.decode(redis.call('HGET', KEYS[1], 'items'))
for sku, q in pairs(items) do
  redis.call('HINCRBY', 'held:' .. ph, sku, -q)
  if ARGV[2] == 'release' then
    redis.call('HINCRBY', 'st:' .. ph, sku, q)
  end
end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
"""

# A new stock count from the pharmacy (file or software): free = shelf − strips held for orders still open.
SNAPSHOT = """
-- KEYS: st:{ph}, held:{ph} ; ARGV: sku1, shelf1, sku2, shelf2, ...
redis.call('DEL', KEYS[1])
for i = 1, #ARGV, 2 do
  local held = tonumber(redis.call('HGET', KEYS[2], ARGV[i]) or '0')
  local free = tonumber(ARGV[i + 1]) - held
  if free < 0 then free = 0 end
  redis.call('HSET', KEYS[1], ARGV[i], free)
end
if #ARGV == 0 then redis.call('HSET', KEYS[1], '_', 0) end
return 1
"""


class HoldIn(BaseModel):
    order: str
    pharmacies: list[int] = Field(..., description="best first, as WordPress ranked them")
    items: dict[str, int]
    paid: bool = False


class OrderIn(BaseModel):
    order: str


class SnapshotIn(BaseModel):
    pharmacy: int
    items: dict[str, int]


async def hold(h: HoldIn) -> dict:
    r = rdb()
    items = {k: int(v) for k, v in h.items.items() if int(v) > 0}
    if not items:
        return {"pharmacy": h.pharmacies[0] if h.pharmacies else None, "held": False, "reason": "nothing to hold"}
    exp = 0 if h.paid else int(time.time()) + settings.hold_ttl
    flat: list[str] = []
    for k, v in items.items():
        flat += [k, str(v)]
    tried = []
    for ph in h.pharmacies:
        res = await r.eval(HOLD, 4, f"st:{ph}", f"held:{ph}", f"hold:{h.order}", "holds:exp", str(ph), h.order, str(exp), json.dumps(items), *flat)
        state, val = res[0], res[1]
        if state in ("ok", "exists"):
            return {"pharmacy": int(val), "held": True, "tried": tried}
        if state == "unknown":  # this pharmacy never sent stock: it may well have it
            return {"pharmacy": ph, "held": False, "reason": "stock unknown", "tried": tried}
        tried.append({"pharmacy": ph, "short": val})
    return {"pharmacy": None, "held": False, "reason": "no pharmacy has everything", "tried": tried}


async def finish(order: str, mode: str) -> bool:
    return bool(await rdb().eval(FINISH, 2, f"hold:{order}", "holds:exp", order, mode))


async def confirm(order: str) -> None:
    r = rdb()
    if await r.exists(f"hold:{order}"):
        await r.hset(f"hold:{order}", "exp", 0)
        await r.zrem("holds:exp", order)


async def snapshot(s: SnapshotIn) -> None:
    flat: list[str] = []
    for k, v in s.items.items():
        flat += [k, str(max(0, int(v)))]
    await rdb().eval(SNAPSHOT, 2, f"st:{s.pharmacy}", f"held:{s.pharmacy}", *flat)


async def reaper() -> None:
    """Unpaid orders let go of their strips after HOLD_TTL_S."""
    while True:
        try:
            due = await rdb().zrangebyscore("holds:exp", "-inf", int(time.time()))
            for order in due:
                if await finish(order, "release"):
                    log.info("unpaid hold released: order %s", order)
        except Exception as e:  # noqa: BLE001
            log.warning("reaper: %s", e)
        await asyncio.sleep(15)


async def on_event(topic: str, e: dict) -> None:
    """Order steps decide what happens to held strips; stock counts replace the shelf."""
    if topic == "stock" and e.get("event") == "stock.snapshot":
        await snapshot(SnapshotIn(pharmacy=int(e["pharmacy"]), items=e.get("items", {})))
    elif topic == "orders":
        o = e.get("order", {})
        oid, status = str(o.get("id", "")), o.get("status")
        if not oid:
            return
        if status in ("cancelled", "failed", "refunded") or e.get("event") == "order.passed":
            await finish(oid, "release")
        elif status in ("processing", "d4u-rx", "on-hold"):
            await confirm(oid)
        elif status == "completed":
            await finish(oid, "consume")


async def consumer() -> None:
    bus = make_bus()
    async for topic, e in bus.consume(["orders", "stock"], "stock-svc"):
        try:
            await on_event(topic, e)
        except Exception as ex:  # noqa: BLE001
            log.exception("stock event failed: %s", ex)


@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = [asyncio.create_task(reaper()), asyncio.create_task(consumer())]
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="dawa4u stock-svc", lifespan=lifespan)


@app.post("/hold")
async def hold_ep(h: HoldIn):
    return await hold(h)


@app.post("/release")
async def release_ep(o: OrderIn):
    return {"released": await finish(o.order, "release")}


@app.post("/confirm")
async def confirm_ep(o: OrderIn):
    await confirm(o.order)
    return {"ok": True}


@app.post("/snapshot")
async def snapshot_ep(s: SnapshotIn):
    await snapshot(s)
    return {"ok": True, "items": len(s.items)}


@app.get("/stock/{ph}")
async def stock_ep(ph: int):
    r = rdb()
    free = await r.hgetall(f"st:{ph}")
    held = await r.hgetall(f"held:{ph}")
    return {"pharmacy": ph, "free": {k: int(v) for k, v in free.items() if k != "_"}, "held": {k: int(v) for k, v in held.items() if int(v)}}


@app.get("/health")
async def health():
    await rdb().ping()
    return {"ok": True}
