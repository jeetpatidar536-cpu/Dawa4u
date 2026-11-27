"""The event stream ("central nervous system"): Apache Kafka in production, Redis Streams for local tests.

Topics:
  orders          every order step (placed, checked, packed, picked up, delivered, cancelled)
  stock           stock files and stock sent by pharmacy software
  rider.location  GPS pings from riders on the way
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import Any, AsyncIterator, Iterable

from .common import log, rdb, settings


class Bus:
    async def start(self) -> None: ...
    async def stop(self) -> None: ...
    async def publish(self, topic: str, event: dict[str, Any], key: str | None = None) -> None: ...
    def consume(self, topics: Iterable[str], group: str) -> AsyncIterator[tuple[str, dict[str, Any]]]: ...


class KafkaBus(Bus):
    def __init__(self) -> None:
        self.producer = None

    async def start(self) -> None:
        from aiokafka import AIOKafkaProducer

        self.producer = AIOKafkaProducer(
            bootstrap_servers=settings.kafka,
            value_serializer=lambda v: json.dumps(v, separators=(",", ":")).encode(),
            key_serializer=lambda k: k.encode() if k else None,
            acks="all",
            enable_idempotence=True,  # no duplicates if a send is retried
            linger_ms=5,
        )
        for attempt in range(30):  # Kafka may still be starting
            try:
                await self.producer.start()
                return
            except Exception as e:  # noqa: BLE001
                log.warning("kafka not ready (%s), retrying", e)
                await asyncio.sleep(2)
        raise RuntimeError("Kafka is not reachable at " + settings.kafka)

    async def stop(self) -> None:
        if self.producer:
            await self.producer.stop()

    async def publish(self, topic: str, event: dict[str, Any], key: str | None = None) -> None:
        # The key keeps every event of one order (or one rider) in order on one partition.
        await self.producer.send_and_wait(topic, event, key=key)

    async def ensure_topics(self, topics: Iterable[str]) -> None:
        """Create the topics up front, so a consumer that starts first doesn't wait for a metadata refresh."""
        from aiokafka.admin import AIOKafkaAdminClient, NewTopic
        from aiokafka.errors import TopicAlreadyExistsError

        admin = AIOKafkaAdminClient(bootstrap_servers=settings.kafka)
        for attempt in range(30):
            try:
                await admin.start()
                break
            except Exception as e:  # noqa: BLE001
                log.warning("kafka admin not ready (%s), retrying", e)
                await asyncio.sleep(2)
        try:
            existing = set(await admin.list_topics())
            new = [NewTopic(t, num_partitions=3, replication_factor=int(os.getenv("KAFKA_REPLICATION", "1"))) for t in topics if t not in existing]
            if new:
                try:
                    await admin.create_topics(new)
                except TopicAlreadyExistsError:
                    pass
        finally:
            await admin.close()

    async def consume(self, topics: Iterable[str], group: str):
        from aiokafka import AIOKafkaConsumer

        topics = list(topics)
        try:
            await self.ensure_topics(topics)
        except Exception as e:  # noqa: BLE001 — auto-creation still works, just slower
            log.warning("could not create topics: %s", e)
        c = AIOKafkaConsumer(
            *topics,
            bootstrap_servers=settings.kafka,
            group_id=group,
            enable_auto_commit=False,
            auto_offset_reset="earliest",
            metadata_max_age_ms=10000,
            value_deserializer=lambda b: json.loads(b.decode()),
        )
        for attempt in range(30):
            try:
                await c.start()
                break
            except Exception as e:  # noqa: BLE001
                log.warning("kafka consumer not ready (%s), retrying", e)
                await asyncio.sleep(2)
        try:
            async for msg in c:
                yield msg.topic, msg.value
                await c.commit()  # at-least-once: handlers are written to be safe to repeat
        finally:
            await c.stop()


class RedisStreamBus(Bus):
    """Same topics on Redis Streams, consumer groups included. Used for tests and tiny setups."""

    async def publish(self, topic: str, event: dict[str, Any], key: str | None = None) -> None:
        await rdb().xadd("bus:" + topic, {"v": json.dumps(event, separators=(",", ":"))}, maxlen=100000, approximate=True)

    async def consume(self, topics: Iterable[str], group: str):
        r = rdb()
        streams = ["bus:" + t for t in topics]
        for s in streams:
            try:
                await r.xgroup_create(s, group, id="0", mkstream=True)
            except Exception:  # group exists
                pass
        name = group + "-1"
        while True:
            res = await r.xreadgroup(group, name, {s: ">" for s in streams}, count=100, block=1000)
            for stream, msgs in res or []:
                for mid, fields in msgs:
                    yield stream[4:], json.loads(fields["v"])
                    await r.xack(stream, group, mid)


def make_bus() -> Bus:
    return KafkaBus() if settings.bus == "kafka" else RedisStreamBus()
