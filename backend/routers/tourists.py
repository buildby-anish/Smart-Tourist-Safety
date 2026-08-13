from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status

from schemas.tourist import DigitalIdResponse, TouristCreate, TouristResponse, TouristUpdate

router = APIRouter(prefix="/tourists", tags=["tourists"])

# Temporary in-memory storage for local API development only.
# Replace with PostgreSQL queries when database connection details are provided.
_in_memory_tourist_store: dict[UUID, TouristResponse] = {}


def _get_tourist_or_404(tourist_id: UUID) -> TouristResponse:
    tourist = _in_memory_tourist_store.get(tourist_id)
    if tourist is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tourist not found",
        )
    return tourist


@router.post("", response_model=TouristResponse, status_code=status.HTTP_201_CREATED)
def create_tourist(payload: TouristCreate) -> TouristResponse:
    tourist = TouristResponse(
        tourist_id=uuid4(),
        digital_id=payload.digital_id,
        full_name=payload.full_name,
        kyc_document_type=payload.kyc_document_type,
        kyc_verified=payload.kyc_verified,
        phone=payload.phone,
        email=payload.email,
        emergency_contact=payload.emergency_contact,
        preferred_language=payload.preferred_language,
        created_at=datetime.now(timezone.utc),
    )
    _in_memory_tourist_store[tourist.tourist_id] = tourist
    return tourist


@router.get("/{tourist_id}", response_model=TouristResponse)
def get_tourist(tourist_id: UUID) -> TouristResponse:
    return _get_tourist_or_404(tourist_id)


@router.get("/{tourist_id}/digital-id", response_model=DigitalIdResponse)
def get_tourist_digital_id(tourist_id: UUID) -> DigitalIdResponse:
    tourist = _get_tourist_or_404(tourist_id)
    return DigitalIdResponse.model_validate(tourist)


@router.patch("/{tourist_id}", response_model=TouristResponse)
def update_tourist(tourist_id: UUID, payload: TouristUpdate) -> TouristResponse:
    tourist = _get_tourist_or_404(tourist_id)
    update_data = payload.model_dump(exclude_unset=True)

    updated = tourist.model_copy(update=update_data)
    _in_memory_tourist_store[tourist_id] = updated
    return updated

