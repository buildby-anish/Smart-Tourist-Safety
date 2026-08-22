import logging
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, WebSocketException, status

from realtime import manager
from routers.auth import resolve_session

logger = logging.getLogger("ws")

router = APIRouter(tags=["realtime"])


@router.websocket("/ws/authority")
async def ws_authority_feed(websocket: WebSocket, token: str | None = None):
    """
    Authority dashboard realtime feed. Broadcasts:
      - sos.created           (directive §B.1: SOS & Emergency Alerts Desk)
      - incident.updated      (status/priority/assignment changes)
      - geofence.breach       (directive §B.3: Geofence Breach Monitor)
      - location.ping         (directive §B.2: Live Tourist Tracker)
    """
    try:
        session = resolve_session(token)
    except Exception:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or missing token")

    if session.user_type != "authority":
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Authority access required")

    await manager.connect_authority(websocket)
    try:
        while True:
            # No inbound messages expected on this feed; just keep the
            # connection open and drop it cleanly on disconnect.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect_authority(websocket)


@router.websocket("/ws/tourist/{tourist_id}")
async def ws_tourist_feed(websocket: WebSocket, tourist_id: UUID, token: str | None = None):
    """
    Per-tourist realtime feed — geofence alert popups and SOS
    acknowledgment/dispatch status pushed to the tourist's own device
    (directive §A.3: "trigger an immediate in-app modal popup alert").
    """
    try:
        session = resolve_session(token)
    except Exception:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or missing token")

    if session.user_type != "tourist" or session.tourist_profile_id != tourist_id:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Tourists may only subscribe to their own feed")

    await manager.connect_tourist(websocket, tourist_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect_tourist(websocket, tourist_id)
