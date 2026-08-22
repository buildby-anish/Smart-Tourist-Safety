from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_authenticated_cursor
from routers.auth import get_current_user
from schemas.auth import SessionResponse
from schemas.location import PointOfInterestResponse

# The itinerary POI catalogue (name, risk_level) — formerly served at
# "/locations" before that path was reassigned to live GPS pings. See
# database/schema_definition.py for the split rationale.
router = APIRouter(prefix="/points-of-interest", tags=["points_of_interest"])

_in_memory_poi_store: dict[UUID, PointOfInterestResponse] = {}


def _row_to_poi(row) -> PointOfInterestResponse:
    return PointOfInterestResponse(
        poi_id=row[0],
        name=row[1],
        latitude=float(row[2]) if row[2] is not None else None,
        longitude=float(row[3]) if row[3] is not None else None,
        risk_level=row[4],
        recorded_at=row[5],
    )


def _get_poi_or_404(poi_id: UUID, current_user: SessionResponse) -> PointOfInterestResponse:
    if not is_db_active():
        poi = _in_memory_poi_store.get(poi_id)
        if poi is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Point of interest not found")
        return poi

    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT poi_id, name, latitude, longitude, risk_level, recorded_at
                FROM public.points_of_interest
                WHERE poi_id = %s;
            """, (poi_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Point of interest not found")
            return _row_to_poi(row)
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Database query failed: {str(e)}")


@router.get("", response_model=list[PointOfInterestResponse])
def list_points_of_interest(current_user: SessionResponse = Depends(get_current_user)) -> list[PointOfInterestResponse]:
    if not is_db_active():
        return list(_in_memory_poi_store.values())

    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT poi_id, name, latitude, longitude, risk_level, recorded_at
                FROM public.points_of_interest
                ORDER BY recorded_at DESC;
            """)
            return [_row_to_poi(row) for row in cur.fetchall()]
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to retrieve points of interest: {str(e)}")


@router.get("/{poi_id}", response_model=PointOfInterestResponse)
def get_point_of_interest(
    poi_id: UUID,
    current_user: SessionResponse = Depends(get_current_user)
) -> PointOfInterestResponse:
    return _get_poi_or_404(poi_id, current_user)
