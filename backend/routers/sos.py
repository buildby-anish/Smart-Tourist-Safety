from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_db_cursor, get_authenticated_cursor
from routers.auth import get_current_user
from schemas.auth import SessionResponse
from schemas.incident import IncidentResponse
from schemas.location import LocationResponse
from schemas.sos import SOSCreate, SOSResponse

router = APIRouter(prefix="/sos", tags=["sos"])

# Temporary in-memory storage for local API development only (fallback).
_in_memory_sos_store: dict[UUID, SOSResponse] = {}


@router.post("", response_model=SOSResponse, status_code=status.HTTP_201_CREATED)
def create_sos(
    payload: SOSCreate,
    current_user: SessionResponse = Depends(get_current_user)
) -> SOSResponse:
    # SECURITY: a tourist caller must only ever raise an SOS for themselves.
    # payload.tourist_id is client-supplied and was previously trusted as-is,
    # which would let one tourist's session trigger an SOS "for" another
    # tourist_id. Force it to the caller's own tourist_id when the caller is
    # a tourist (DATABASE.md section 21: "Do not let a tourist submit
    # another tourist's tourist_id"). This must run before the in-memory
    # fallback return — that path used to skip the bind, so tests and
    # DATABASE_URL-less local mode still accepted a spoofed tourist_id.
    # Non-tourist callers (e.g. AI/system triggered SOS submitted by an
    # authority/system account) keep the explicit payload value.
    if current_user.user_type == "tourist":
        if current_user.tourist_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tourist profile is associated with this account.",
            )
        payload.tourist_id = current_user.tourist_id

    # 1. Fallback Mode
    if not is_db_active():
        from routers.tourists import _get_tourist_or_404
        from routers.incidents import _in_memory_incident_store
        from routers.locations import _in_memory_location_store
        
        _get_tourist_or_404(payload.tourist_id)

        now = datetime.now(timezone.utc)
        location_id = uuid4()
        location = LocationResponse(
            location_id=location_id,
            name=f"SOS Alarm - {payload.tourist_id}",
            latitude=payload.latitude,
            longitude=payload.longitude,
            risk_level="HIGH",
            recorded_at=now,
        )
        _in_memory_location_store[location_id] = location

        incident_id = uuid4()
        incident = IncidentResponse(
            incident_id=incident_id,
            tourist_id=payload.tourist_id,
            location_id=location_id,
            incident_type="SOS",
            severity="HIGH",
            status="OPEN",
            description="SOS Alarm Triggered",
            created_at=now,
            authority_id=None,
        )
        _in_memory_incident_store[incident_id] = incident

        sos = SOSResponse(
            sos_id=uuid4(),
            tourist_id=payload.tourist_id,
            incident_id=incident_id,
            location_id=location_id,
            incident_type="SOS",
            severity="HIGH",
            status="OPEN",
            description="SOS Alarm Triggered",
            triggered_at=now,
            created_at=now,
            trigger_source=payload.trigger_source or "APP",
            sos_status="ACTIVE"
        )
        _in_memory_sos_store[sos.sos_id] = sos
        return sos

    # 2. Database Mode
    now = datetime.now(timezone.utc)
    location_id = uuid4()
    incident_id = uuid4()
    sos_id = uuid4()
    
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            # Verify tourist profile exists
            cur.execute("SELECT tourist_id FROM public.tourists WHERE tourist_id = %s;", (payload.tourist_id,))
            if not cur.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Tourist profile not found",
                )
                
            # Create a location record for this SOS coordinate
            cur.execute("""
                INSERT INTO public.locations (location_id, name, latitude, longitude, risk_level, recorded_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING location_id;
            """, (location_id, f"SOS Alarm - {payload.tourist_id}", payload.latitude, payload.longitude, "HIGH", now))
            
            # Create an incident record linking to the location
            cur.execute("""
                INSERT INTO public.incidents (incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING incident_id;
            """, (incident_id, payload.tourist_id, location_id, "SOS", "HIGH", "OPEN", "SOS Alarm Triggered", now))
            
            # Create the SOS request record
            cur.execute("""
                INSERT INTO public.sos_requests (sos_id, tourist_id, incident_id, location_id, trigger_source, sos_status, triggered_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING sos_id, tourist_id, incident_id, location_id, trigger_source, sos_status, triggered_at;
            """, (sos_id, payload.tourist_id, incident_id, location_id, payload.trigger_source or "APP", "ACTIVE", now))
            
            row = cur.fetchone()
            return SOSResponse(
                sos_id=row[0],
                tourist_id=row[1],
                incident_id=row[2],
                location_id=row[3],
                incident_type="SOS",
                severity="HIGH",
                status="OPEN",
                description="SOS Alarm Triggered",
                triggered_at=row[6],
                created_at=row[6],
                trigger_source=row[4],
                sos_status=row[5]
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to activate SOS alarm: {str(e)}"
        )
