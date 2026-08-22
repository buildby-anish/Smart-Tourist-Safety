import asyncio
import json
import logging
from uuid import UUID

import anyio
from fastapi import WebSocket

logger = logging.getLogger("realtime")


class ConnectionManager:
    """
    In-process WebSocket broadcast hub for the directive's "Real Endpoints &
    Sockets" requirement (SOS triggers, telemetry updates). Authority
    dashboard clients connect once and receive every event; tourist clients
    connect scoped to their own tourist_id and receive only events
    concerning them (e.g. their own SOS acknowledgment).

    Scope note: this is a single-process hub — fine for one Railway
    instance, but it will NOT fan out events across multiple backend
    replicas. If this deploys behind more than one instance, swap the
    broadcast_* calls here for Supabase Realtime (Postgres NOTIFY-backed,
    already fans out across replicas) instead of scaling this in-memory
    manager.
    """

    def __init__(self):
        self._authority_sockets: set[WebSocket] = set()
        self._tourist_sockets: dict[UUID, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect_authority(self, websocket: WebSocket):
        await websocket.accept()
        async with self._lock:
            self._authority_sockets.add(websocket)

    async def disconnect_authority(self, websocket: WebSocket):
        async with self._lock:
            self._authority_sockets.discard(websocket)

    async def connect_tourist(self, websocket: WebSocket, tourist_id: UUID):
        await websocket.accept()
        async with self._lock:
            self._tourist_sockets.setdefault(tourist_id, set()).add(websocket)

    async def disconnect_tourist(self, websocket: WebSocket, tourist_id: UUID):
        async with self._lock:
            sockets = self._tourist_sockets.get(tourist_id)
            if sockets:
                sockets.discard(websocket)
                if not sockets:
                    del self._tourist_sockets[tourist_id]

    async def _send_all(self, sockets: set[WebSocket], payload: dict):
        dead = []
        for ws in list(sockets):
            try:
                await ws.send_text(json.dumps(payload, default=str))
            except Exception as e:
                logger.warning(f"Dropping dead websocket: {e}")
                dead.append(ws)
        for ws in dead:
            sockets.discard(ws)

    async def broadcast_to_authorities(self, event_type: str, data: dict):
        payload = {"type": event_type, "data": data}
        await self._send_all(self._authority_sockets, payload)

    async def send_to_tourist(self, tourist_id: UUID, event_type: str, data: dict):
        sockets = self._tourist_sockets.get(tourist_id)
        if sockets:
            await self._send_all(sockets, {"type": event_type, "data": data})


manager = ConnectionManager()


def broadcast_sync(coro_func, *args, **kwargs) -> None:
    """
    Fire a realtime broadcast from inside a synchronous (def, not async def)
    FastAPI route/db-transaction handler. FastAPI runs sync route handlers
    in a worker thread via anyio's threadpool; anyio.from_thread.run hops
    back onto the event loop to actually await the coroutine.

    Best-effort: a broadcast failure must never fail the underlying request
    (e.g. an SOS write succeeding but the dashboard push failing shouldn't
    turn into a 500 for the tourist who just triggered the SOS).
    """
    try:
        anyio.from_thread.run(coro_func, *args, **kwargs)
    except Exception as e:
        logger.warning(f"Realtime broadcast failed (request continues normally): {e}")
