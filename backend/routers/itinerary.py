from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_authenticated_cursor
from routers.auth import require_tourist
from schemas.auth import SessionResponse
from schemas.itinerary import ItineraryEntryCreate, ItineraryEntryResponse

router = APIRouter(prefix="/itinerary", tags=["itinerary"])

# Temporary in-memory storage for local API development only (fallback).
_in_memory_itinerary_store: dict[UUID, ItineraryEntryResponse] = {}


@router.post("", response_model=ItineraryEntryResponse, status_code=status.HTTP_201_CREATED)
def create_itinerary_entry(
    payload: ItineraryEntryCreate,
    current_user: SessionResponse = Depends(require_tourist)
) -> ItineraryEntryResponse:
    tourist_id = current_user.tourist_id

    # 1. Fallback Mode
    if not is_db_active():
        location_id = payload.location_id or uuid4()
        entry = ItineraryEntryResponse(
            itinerary_id=uuid4(),
            tourist_id=tourist_id,
            location_id=location_id,
            location_name=payload.destination_name,
            planned_arrival=payload.planned_arrival,
            planned_departure=payload.planned_departure,
        )
        _in_memory_itinerary_store[entry.itinerary_id] = entry
        return entry

    # 2. Database Mode
    now = datetime.now(timezone.utc)
    itinerary_id = uuid4()

    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            loc_id = payload.location_id
            loc_name = payload.destination_name

            if loc_id:
                cur.execute("SELECT location_id, name FROM public.locations WHERE location_id = %s;", (loc_id,))
                row = cur.fetchone()
                if not row:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Location not found",
                    )
                loc_name = row[1]
            else:
                # No location_id supplied — resolve/create one from the
                # destination name and optional coordinates, matching the
                # existing location-resolution pattern used by incidents/SOS.
                loc_id = uuid4()
                cur.execute("""
                    INSERT INTO public.locations (location_id, name, latitude, longitude, risk_level, recorded_at)
                    VALUES (%s, %s, %s, %s, %s, %s);
                """, (
                    loc_id, payload.destination_name or "Itinerary Destination",
                    payload.latitude if payload.latitude is not None else 0.0,
                    payload.longitude if payload.longitude is not None else 0.0,
                    "LOW", now
                ))

            cur.execute("""
                INSERT INTO public.itinerary_entries (itinerary_id, tourist_id, location_id, planned_arrival, planned_departure)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING itinerary_id, tourist_id, location_id, planned_arrival, planned_departure;
            """, (itinerary_id, tourist_id, loc_id, payload.planned_arrival, payload.planned_departure))

            row = cur.fetchone()
            return ItineraryEntryResponse(
                itinerary_id=row[0],
                tourist_id=row[1],
                location_id=row[2],
                location_name=loc_name,
                planned_arrival=row[3],
                planned_departure=row[4],
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create itinerary entry: {str(e)}"
        )


@router.get("", response_model=list[ItineraryEntryResponse])
def list_itinerary_entries(
    current_user: SessionResponse = Depends(require_tourist)
) -> list[ItineraryEntryResponse]:
    tourist_id = current_user.tourist_id

    # 1. Fallback Mode
    if not is_db_active():
        return [e for e in _in_memory_itinerary_store.values() if e.tourist_id == tourist_id]

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT ie.itinerary_id, ie.tourist_id, ie.location_id, l.name, ie.planned_arrival, ie.planned_departure
                FROM public.itinerary_entries ie
                LEFT JOIN public.locations l ON l.location_id = ie.location_id
                WHERE ie.tourist_id = %s;
            """, (tourist_id,))
            rows = cur.fetchall()
            return [
                ItineraryEntryResponse(
                    itinerary_id=row[0],
                    tourist_id=row[1],
                    location_id=row[2],
                    location_name=row[3],
                    planned_arrival=row[4],
                    planned_departure=row[5],
                )
                for row in rows
            ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve itinerary entries: {str(e)}"
        )


@router.delete("/{itinerary_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_itinerary_entry(
    itinerary_id: UUID,
    current_user: SessionResponse = Depends(require_tourist)
) -> None:
    # 1. Fallback Mode
    if not is_db_active():
        entry = _in_memory_itinerary_store.get(itinerary_id)
        if entry is None or entry.tourist_id != current_user.tourist_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Itinerary entry not found",
            )
        del _in_memory_itinerary_store[itinerary_id]
        return None

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute("""
                DELETE FROM public.itinerary_entries
                WHERE itinerary_id = %s AND tourist_id = %s
                RETURNING itinerary_id;
            """, (itinerary_id, current_user.tourist_id))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Itinerary entry not found or unauthorized to delete",
                )
            return None
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete itinerary entry: {str(e)}"
        )
