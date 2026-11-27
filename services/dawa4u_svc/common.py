"""Shared pieces for every dawa4u service: settings, Redis, request signing, logging."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
from typing import Any

import redis.asyncio as aioredis
from fastapi import HTTPException, Request

log = logging.getLogger("dawa4u")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(name)s %(levelname)s %(message)s")


class Settings:
    """Everything comes from environment variables (see .env.example)."""

    def __init__(self) -> None:
        self.secret = os.getenv("D4U_SECRET", "")  # shared with WordPress (WooCommerce → dawa4u partners → Services)
        self.redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        self.bus = os.getenv("BUS", "kafka")  # kafka in production; redis streams for local tests
        self.kafka = os.getenv("KAFKA_BROKERS", "localhost:9092")
        self.allowed_origin = os.getenv("ALLOWED_ORIGIN", "https://dawa4u.in")
        self.city_lat = float(os.getenv("CITY_LAT", "22.7196"))  # Indore
        self.city_lng = float(os.getenv("CITY_LNG", "75.8577"))
        self.target_min = int(os.getenv("TARGET_MIN", "30"))
        self.rain_buffer = int(os.getenv("RAIN_BUFFER_MIN", "10"))
        self.hold_ttl = int(os.getenv("HOLD_TTL_S", "1800"))  # unpaid orders let go of stock after 30 min
        self.stock_url = os.getenv("STOCK_URL", "http://stock:8000")
        self.eta_url = os.getenv("ETA_URL", "http://eta:8000")
        self.forecast_url = os.getenv("FORECAST_URL", "http://forecast:8000")
        self.data_dir = os.getenv("DATA_DIR", "/data")
        self.weather = os.getenv("WEATHER", "on") == "on"


settings = Settings()
_redis: aioredis.Redis | None = None


def rdb() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def sign(body: bytes, ts: str, secret: str | None = None) -> str:
    key = (secret if secret is not None else settings.secret).encode()
    return "sha256=" + hmac.new(key, ts.encode() + b"." + body, hashlib.sha256).hexdigest()


async def verify(request: Request) -> bytes:
    """Requests from the WordPress server carry X-Dawa4u-Time and X-Dawa4u-Signature (HMAC of time.body)."""
    if not settings.secret:
        raise HTTPException(503, "D4U_SECRET is not set on the server")
    body = await request.body()
    ts = request.headers.get("x-dawa4u-time", "")
    sig = request.headers.get("x-dawa4u-signature", "")
    if not ts.isdigit() or abs(time.time() - int(ts)) > 300:
        raise HTTPException(401, "stale or missing X-Dawa4u-Time")
    if not hmac.compare_digest(sig, sign(body, ts)):
        raise HTTPException(401, "bad signature")
    return body


def token_ok(token: str, scope: str) -> str | None:
    """Browser tokens made by WordPress: "<scope>.<id>.<expires>.<hmac>". Returns the id or None."""
    try:
        sc, ident, exp, mac = token.split(".")
    except ValueError:
        return None
    if sc != scope or not exp.isdigit() or int(exp) < time.time():
        return None
    want = hmac.new(settings.secret.encode(), f"{sc}.{ident}.{exp}".encode(), hashlib.sha256).hexdigest()
    return ident if settings.secret and hmac.compare_digest(want, mac) else None


def dumps(o: Any) -> str:
    return json.dumps(o, separators=(",", ":"), ensure_ascii=False)
