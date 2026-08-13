from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_db_cursor, get_authenticated_cursor
from routers.auth import get_current_user
from schemas.auth import SessionResponse
from schemas.tourist import DigitalIdResponse, TouristCreate, TouristResponse, TouristUpdate

router = APIRouter(prefix="/tourists", tags=["tourists"])

# Temporary in-memory storage for local API development only (fallback).
_in_memory_tourist_store: dict[UUID, TouristResponse] = {}


def _get_tourist_or_404(tourist_id: UUID, current_user: SessionResponse | None = None) -> TouristResponse:
    # 1. Fallback Mode
    if not is_db_active():
        tourist = _in_memory_tourist_store.get(tourist_id)
        if tourist is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tourist not found",
            )
        return tourist

    # 2. Database Mode
    # If a current user is present, use their authenticated cursor (RLS policy applies).
    # Otherwise, fallback to system db cursor (e.g. for registration or system actions).
    try:
        if current_user and current_user.user_type == "tourist":
            cursor_ctx = get_authenticated_cursor(current_user.auth_user_id)
        else:
            cursor_ctx = get_db_cursor()
            
        with cursor_ctx as cur:
            cur.execute("""
                SELECT tourist_id, digital_id, full_name, kyc_document_type, kyc_verified, phone, email, emergency_contact, preferred_language, created_at
                FROM public.tourists
                WHERE tourist_id = %s;
            """, (tourist_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Tourist profile not found",
                )
            return TouristResponse(
                tourist_id=row[0],
                digital_id=row[1],
                full_name=row[2],
                kyc_document_type=row[3],
                kyc_verified=row[4],
                phone=row[5],
                email=row[6],
                emergency_contact=row[7],
                preferred_language=row[8],
                created_at=row[9]
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database query failed: {str(e)}"
        )


@router.post("", response_model=TouristResponse, status_code=status.HTTP_201_CREATED)
def create_tourist(
    payload: TouristCreate,
    current_user: SessionResponse = Depends(get_current_user)
) -> TouristResponse:
    # 1. Fallback Mode
    if not is_db_active():
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

    # 2. Database Mode
    now = datetime.now(timezone.utc)
    tourist_id = uuid4()
    digital_id = payload.digital_id or f"DIG-{uuid4().hex[:8].upper()}"
    
    try:
        # Run under the current user's authenticated transaction
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute("""
                INSERT INTO public.tourists (
                    tourist_id, auth_user_id, digital_id, full_name, kyc_document_type, 
                    kyc_verified, phone, email, emergency_contact, preferred_language, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING tourist_id, digital_id, full_name, kyc_document_type, kyc_verified, phone, email, emergency_contact, preferred_language, created_at;
            """, (
                tourist_id, current_user.auth_user_id, digital_id, payload.full_name, payload.kyc_document_type,
                payload.kyc_verified or False, payload.phone, payload.email, payload.emergency_contact, payload.preferred_language, now
            ))
            row = cur.fetchone()
            
            # Map this profile to authentication table as well if needed
            cur.execute("""
                UPDATE public.authentication
                SET tourist_id = %s
                WHERE auth_user_id = %s;
            """, (tourist_id, current_user.auth_user_id))
            
            return TouristResponse(
                tourist_id=row[0],
                digital_id=row[1],
                full_name=row[2],
                kyc_document_type=row[3],
                kyc_verified=row[4],
                phone=row[5],
                email=row[6],
                emergency_contact=row[7],
                preferred_language=row[8],
                created_at=row[9]
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create tourist profile: {str(e)}"
        )


@router.get("/{tourist_id}", response_model=TouristResponse)
def get_tourist(
    tourist_id: UUID,
    current_user: SessionResponse = Depends(get_current_user)
) -> TouristResponse:
    return _get_tourist_or_404(tourist_id, current_user)


@router.get("/{tourist_id}/digital-id", response_model=DigitalIdResponse)
def get_tourist_digital_id(
    tourist_id: UUID,
    current_user: SessionResponse = Depends(get_current_user)
) -> DigitalIdResponse:
    tourist = _get_tourist_or_404(tourist_id, current_user)
    return DigitalIdResponse.model_validate(tourist)


@router.patch("/{tourist_id}", response_model=TouristResponse)
def update_tourist(
    tourist_id: UUID,
    payload: TouristUpdate,
    current_user: SessionResponse = Depends(get_current_user)
) -> TouristResponse:
    # 1. Fallback Mode
    if not is_db_active():
        tourist = _get_tourist_or_404(tourist_id)
        update_data = payload.model_dump(exclude_unset=True)
        updated = tourist.model_copy(update=update_data)
        _in_memory_tourist_store[tourist_id] = updated
        return updated

    # 2. Database Mode
    _get_tourist_or_404(tourist_id, current_user)  # Verify existence and RLS permission first
    
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return _get_tourist_or_404(tourist_id, current_user)
        
    set_clauses = []
    params = []
    for k, v in update_data.items():
        set_clauses.append(f"{k} = %s")
        params.append(v)
        
    params.append(tourist_id)
    query = f"UPDATE public.tourists SET {', '.join(set_clauses)} WHERE tourist_id = %s RETURNING tourist_id, digital_id, full_name, kyc_document_type, kyc_verified, phone, email, emergency_contact, preferred_language, created_at;"
    
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute(query, tuple(params))
            row = cur.fetchone()
            return TouristResponse(
                tourist_id=row[0],
                digital_id=row[1],
                full_name=row[2],
                kyc_document_type=row[3],
                kyc_verified=row[4],
                phone=row[5],
                email=row[6],
                emergency_contact=row[7],
                preferred_language=row[8],
                created_at=row[9]
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update tourist profile: {str(e)}"
        )

