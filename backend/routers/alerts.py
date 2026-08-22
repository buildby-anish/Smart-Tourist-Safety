from datetime import datetime, timezone
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_db_cursor, get_authenticated_cursor
from routers.auth import get_current_user
from schemas.auth import SessionResponse
from schemas.alert import AlertCreate, AlertResponse

router = APIRouter(prefix="/alerts", tags=["alerts"])

# Temporary in-memory storage for local API development only (fallback).
_in_memory_alert_store: dict[UUID, AlertResponse] = {}


@router.post("", response_model=AlertResponse, status_code=status.HTTP_201_CREATED)
def create_alert(
    payload: AlertCreate,
    current_user: SessionResponse = Depends(get_current_user)
) -> AlertResponse:
    # 1. Fallback Mode
    if not is_db_active():
        from routers.incidents import _get_incident_or_404
        _get_incident_or_404(payload.incident_id)

        alert = AlertResponse(
            alert_id=uuid4(),
            incident_id=payload.incident_id,
            channel=payload.channel,
            recipient=payload.recipient,
            sent_at=payload.sent_at or datetime.now(timezone.utc),
        )
        _in_memory_alert_store[alert.alert_id] = alert
        return alert

    # 2. Database Mode
    now = datetime.now(timezone.utc)
    alert_id = uuid4()
    sent_at = payload.sent_at or now
    
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            # Verify incident exists
            cur.execute("SELECT id FROM public.incidents WHERE id = %s;", (payload.incident_id,))
            if not cur.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Incident not found",
                )
                
            cur.execute("""
                INSERT INTO public.alerts (alert_id, incident_id, channel, recipient, sent_at)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING alert_id, incident_id, channel, recipient, sent_at;
            """, (alert_id, payload.incident_id, payload.channel, payload.recipient, sent_at))
            
            row = cur.fetchone()
            return AlertResponse(
                alert_id=row[0],
                incident_id=row[1],
                channel=row[2],
                recipient=row[3],
                sent_at=row[4]
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create alert: {str(e)}"
        )


@router.get("", response_model=list[AlertResponse])
def list_alerts(
    incident_id: UUID | None = None,
    current_user: SessionResponse = Depends(get_current_user)
) -> list[AlertResponse]:
    # 1. Fallback Mode
    if not is_db_active():
        alerts = list(_in_memory_alert_store.values())
        if incident_id is not None:
            alerts = [a for a in alerts if a.incident_id == incident_id]
        return alerts

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            if incident_id is not None:
                cur.execute("""
                    SELECT alert_id, incident_id, channel, recipient, sent_at
                    FROM public.alerts
                    WHERE incident_id = %s;
                """, (incident_id,))
            else:
                cur.execute("""
                    SELECT alert_id, incident_id, channel, recipient, sent_at
                    FROM public.alerts;
                """)
                
            rows = cur.fetchall()
            return [
                AlertResponse(
                    alert_id=row[0],
                    incident_id=row[1],
                    channel=row[2],
                    recipient=row[3],
                    sent_at=row[4]
                )
                for row in rows
            ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve alerts: {str(e)}"
        )
