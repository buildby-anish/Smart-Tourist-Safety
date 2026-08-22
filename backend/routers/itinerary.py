import json
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_authenticated_cursor
from routers.auth import require_tourist
from schemas.auth import SessionResponse
from schemas.itinerary import Destination, ItineraryCreate, ItineraryResponse, ItineraryUpdate

router = APIRouter(prefix="/itinerary", tags=["itinerary"])

# Temporary in-memory storage for local API development only (fallback).
_in_memory_itinerary_store: dict[UUID, ItineraryResponse] = {}

_ITINERARY_COLUMNS = "id, tourist_id, title, destinations, start_date, end_date, created_at"


def _row_to_itinerary(row) -> ItineraryResponse:
    raw = row[3]
    if isinstance(raw, str):
        raw = json.loads(raw) if raw else []
    return ItineraryResponse(
        id=row[0],
        tourist_id=row[1],
        title=row[2],
        destinations=[Destination(**d) for d in (raw or [])],
        start_date=row[4],
        end_date=row[5],
        created_at=row[6],
    )


@router.post("", response_model=ItineraryResponse, status_code=status.HTTP_201_CREATED)
def create_itinerary(
    payload: ItineraryCreate,
    current_user: SessionResponse = Depends(require_tourist)
) -> ItineraryResponse:
    tourist_id = current_user.tourist_profile_id
    now = datetime.now(timezone.utc)
    destinations_json = json.dumps([d.model_dump(mode="json") for d in payload.destinations])

    # 1. Fallback Mode
    if not is_db_active():
        itinerary = ItineraryResponse(
            id=uuid4(),
            tourist_id=tourist_id,
            title=payload.title,
            destinations=payload.destinations,
            start_date=payload.start_date,
            end_date=payload.end_date,
            created_at=now,
        )
        _in_memory_itinerary_store[itinerary.id] = itinerary
        return itinerary

    # 2. Database Mode
    itinerary_id = uuid4()
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute(f"""
                INSERT INTO public.itineraries (id, tourist_id, title, destinations, start_date, end_date, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING {_ITINERARY_COLUMNS};
            """, (itinerary_id, tourist_id, payload.title, destinations_json, payload.start_date, payload.end_date, now))
            row = cur.fetchone()
            return _row_to_itinerary(row)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create itinerary: {str(e)}"
        )


@router.get("", response_model=list[ItineraryResponse])
def list_itineraries(
    current_user: SessionResponse = Depends(require_tourist)
) -> list[ItineraryResponse]:
    tourist_id = current_user.tourist_profile_id

    # 1. Fallback Mode
    if not is_db_active():
        return [e for e in _in_memory_itinerary_store.values() if e.tourist_id == tourist_id]

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute(f"""
                SELECT {_ITINERARY_COLUMNS}
                FROM public.itineraries
                WHERE tourist_id = %s
                ORDER BY start_date NULLS LAST, created_at DESC;
            """, (tourist_id,))
            return [_row_to_itinerary(row) for row in cur.fetchall()]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve itineraries: {str(e)}"
        )


@router.patch("/{itinerary_id}", response_model=ItineraryResponse)
def update_itinerary(
    itinerary_id: UUID,
    payload: ItineraryUpdate,
    current_user: SessionResponse = Depends(require_tourist)
) -> ItineraryResponse:
    update_data = payload.model_dump(exclude_unset=True)

    # 1. Fallback Mode
    if not is_db_active():
        entry = _in_memory_itinerary_store.get(itinerary_id)
        if entry is None or entry.tourist_id != current_user.tourist_profile_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Itinerary not found")
        updated = entry.model_copy(update=update_data)
        _in_memory_itinerary_store[itinerary_id] = updated
        return updated

    # 2. Database Mode
    if not update_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    if "destinations" in update_data:
        update_data["destinations"] = json.dumps(update_data["destinations"])

    set_clauses = []
    params = []
    for k, v in update_data.items():
        set_clauses.append(f"{k} = %s")
        params.append(v)
    params.extend([itinerary_id, current_user.tourist_profile_id])

    query = (
        f"UPDATE public.itineraries SET {', '.join(set_clauses)} "
        f"WHERE id = %s AND tourist_id = %s RETURNING {_ITINERARY_COLUMNS};"
    )
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute(query, tuple(params))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Itinerary not found or unauthorized to update",
                )
            return _row_to_itinerary(row)
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update itinerary: {str(e)}"
        )


@router.delete("/{itinerary_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_itinerary(
    itinerary_id: UUID,
    current_user: SessionResponse = Depends(require_tourist)
) -> None:
    # 1. Fallback Mode
    if not is_db_active():
        entry = _in_memory_itinerary_store.get(itinerary_id)
        if entry is None or entry.tourist_id != current_user.tourist_profile_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Itinerary not found",
            )
        del _in_memory_itinerary_store[itinerary_id]
        return None

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute("""
                DELETE FROM public.itineraries
                WHERE id = %s AND tourist_id = %s
                RETURNING id;
            """, (itinerary_id, current_user.tourist_profile_id))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Itinerary not found or unauthorized to delete",
                )
            return None
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete itinerary: {str(e)}"
        )
