from uuid import UUID
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, status, Depends

from db import is_db_active, get_authenticated_cursor
from routers.auth import get_current_user
from schemas.auth import SessionResponse
from schemas.location import LocationResponse

router = APIRouter(prefix="/locations", tags=["locations"])

# Temporary in-memory location storage for local API development only (fallback).
_in_memory_location_store: dict[UUID, LocationResponse] = {}


def _get_location_or_404(location_id: UUID, current_user: SessionResponse) -> LocationResponse:
    # 1. Fallback Mode
    if not is_db_active():
        location = _in_memory_location_store.get(location_id)
        if location is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Location not found",
            )
        return location

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT location_id, name, latitude, longitude, risk_level, recorded_at
                FROM public.locations
                WHERE location_id = %s;
            """, (location_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Location not found",
                )
            return LocationResponse(
                location_id=row[0],
                name=row[1],
                latitude=float(row[2]) if row[2] is not None else None,
                longitude=float(row[3]) if row[3] is not None else None,
                risk_level=row[4],
                recorded_at=row[5]
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database query failed: {str(e)}"
        )


@router.get("", response_model=list[LocationResponse])
def list_locations(current_user: SessionResponse = Depends(get_current_user)) -> list[LocationResponse]:
    # 1. Fallback Mode
    if not is_db_active():
        return list(_in_memory_location_store.values())

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT location_id, name, latitude, longitude, risk_level, recorded_at
                FROM public.locations
                ORDER BY recorded_at DESC;
            """)
            rows = cur.fetchall()
            return [
                LocationResponse(
                    location_id=row[0],
                    name=row[1],
                    latitude=float(row[2]) if row[2] is not None else None,
                    longitude=float(row[3]) if row[3] is not None else None,
                    risk_level=row[4],
                    recorded_at=row[5]
                )
                for row in rows
            ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve locations: {str(e)}"
        )


@router.get("/{location_id}", response_model=LocationResponse)
def get_location(
    location_id: UUID,
    current_user: SessionResponse = Depends(get_current_user)
) -> LocationResponse:
    return _get_location_or_404(location_id, current_user)
