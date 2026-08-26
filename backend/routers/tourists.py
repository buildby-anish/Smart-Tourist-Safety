import json
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_db_cursor, get_authenticated_cursor
from routers.auth import get_current_user
from schemas.auth import SessionResponse
from schemas.tourist import DigitalIdResponse, EmergencyContact, TouristCreate, TouristResponse, TouristUpdate

router = APIRouter(prefix="/tourists", tags=["tourists"])

# Temporary in-memory storage for local API development only (fallback).
_in_memory_tourist_store: dict[UUID, TouristResponse] = {}

_PROFILE_COLUMNS = (
    "id, tourist_id, username, full_name, phone_number, email, emergency_contacts, "
    "govt_id_type, govt_id_number, id_photo_url, kyc_status, preferred_language, created_at, "
    "kyc_document_type, kyc_issuer, kyc_verification_hash, kyc_verified_at, "
    "blockchain_tx_hash, blockchain_block_number"
)


def _generate_tourist_code() -> str:
    """Public-facing tourist identifier, format TOUR-YYYY-[HEX] per the directive."""
    year = datetime.now(timezone.utc).year
    return f"TOUR-{year}-{uuid4().hex[:8].upper()}"


def _row_to_response(row) -> TouristResponse:
    raw_contacts = row[6]
    if isinstance(raw_contacts, str):
        raw_contacts = json.loads(raw_contacts) if raw_contacts else []
    return TouristResponse(
        id=row[0],
        tourist_id=row[1],
        username=row[2],
        full_name=row[3],
        phone_number=row[4],
        email=row[5],
        emergency_contacts=[EmergencyContact(**c) for c in (raw_contacts or [])],
        govt_id_type=row[7],
        govt_id_number=row[8],
        id_photo_url=row[9],
        kyc_status=row[10],
        preferred_language=row[11],
        created_at=row[12],
        kyc_document_type=row[13],
        kyc_issuer=row[14],
        kyc_verification_hash=row[15],
        kyc_verified_at=row[16],
        blockchain_tx_hash=row[17],
        blockchain_block_number=row[18],
    )


def _get_tourist_or_404(profile_id: UUID, current_user: SessionResponse | None = None) -> TouristResponse:
    # 1. Fallback Mode
    if not is_db_active():
        tourist = _in_memory_tourist_store.get(profile_id)
        if tourist is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tourist not found",
            )
        return tourist

    # 2. Database Mode
    # If a current user is present, use their authenticated cursor so RLS
    # policy applies. Otherwise, fall back to the system db cursor (e.g. for
    # registration or other trusted system actions with no request-scoped user).
    #
    # SECURITY: this endpoint (GET /tourists/{id}) is tourist-facing
    # ("get my own profile"). It previously fell back to the RLS-bypassing
    # get_db_cursor() for ANY non-tourist caller, which let any authenticated
    # authority account fetch any tourist's full PII (name, phone, email,
    # KYC info) by guessing/enumerating the id, with no authorization check
    # at all. Authorities have a dedicated, properly-scoped endpoint for this
    # (GET /authority/tourists/{id}), so here we require tourists to be
    # fetching their own profile and reject other callers.
    if current_user is not None:
        if current_user.user_type == "tourist":
            if current_user.tourist_profile_id is not None and current_user.tourist_profile_id != profile_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Tourists may only access their own profile.",
                )
            cursor_ctx = get_authenticated_cursor(current_user.auth_user_id)
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Use /authority/tourists/{id} for authority access to tourist profiles.",
            )
    else:
        cursor_ctx = get_db_cursor()

    try:
        with cursor_ctx as cur:
            cur.execute(f"""
                SELECT {_PROFILE_COLUMNS}
                FROM public.tourist_profiles
                WHERE id = %s;
            """, (profile_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Tourist profile not found",
                )
            return _row_to_response(row)
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
    contacts_json = json.dumps([c.model_dump() for c in payload.emergency_contacts])

    # 1. Fallback Mode
    if not is_db_active():
        tourist = TouristResponse(
            id=uuid4(),
            tourist_id=None,
            username=payload.username,
            full_name=payload.full_name,
            phone_number=payload.phone_number,
            email=payload.email,
            emergency_contacts=payload.emergency_contacts,
            govt_id_type=payload.govt_id_type,
            govt_id_number=payload.govt_id_number,
            id_photo_url=payload.id_photo_url,
            kyc_status="PENDING",
            preferred_language=payload.preferred_language,
            created_at=datetime.now(timezone.utc),
        )
        _in_memory_tourist_store[tourist.id] = tourist
        return tourist

    # 2. Database Mode
    now = datetime.now(timezone.utc)
    profile_id = uuid4()

    try:
        # Run under the current user's authenticated transaction
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute(f"""
                INSERT INTO public.tourist_profiles (
                    id, user_id, username, full_name, phone_number, email,
                    emergency_contacts, govt_id_type, govt_id_number, id_photo_url,
                    kyc_status, preferred_language, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING {_PROFILE_COLUMNS};
            """, (
                profile_id, current_user.auth_user_id, payload.username, payload.full_name,
                payload.phone_number, payload.email, contacts_json, payload.govt_id_type,
                payload.govt_id_number, payload.id_photo_url, "PENDING", payload.preferred_language, now
            ))
            row = cur.fetchone()

            # Map this profile to authentication table as well if needed
            cur.execute("""
                UPDATE public.authentication
                SET tourist_profile_id = %s
                WHERE auth_user_id = %s;
            """, (profile_id, current_user.auth_user_id))

            return _row_to_response(row)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create tourist profile: {str(e)}"
        )


@router.get("/{profile_id}", response_model=TouristResponse)
def get_tourist(
    profile_id: UUID,
    current_user: SessionResponse = Depends(get_current_user)
) -> TouristResponse:
    return _get_tourist_or_404(profile_id, current_user)


@router.get("/{profile_id}/digital-id", response_model=DigitalIdResponse)
def get_tourist_digital_id(
    profile_id: UUID,
    current_user: SessionResponse = Depends(get_current_user)
) -> DigitalIdResponse:
    tourist = _get_tourist_or_404(profile_id, current_user)
    return DigitalIdResponse.model_validate(tourist)


@router.patch("/{profile_id}", response_model=TouristResponse)
def update_tourist(
    profile_id: UUID,
    payload: TouristUpdate,
    current_user: SessionResponse = Depends(get_current_user)
) -> TouristResponse:
    # 1. Fallback Mode
    if not is_db_active():
        tourist = _get_tourist_or_404(profile_id)
        update_data = payload.model_dump(exclude_unset=True)
        # Mirror the DB-mode KYC-completion auto-code-generation below so
        # fallback/mock mode doesn't silently diverge from production.
        if update_data.get("kyc_status") == "VERIFIED" and tourist.tourist_id is None:
            update_data["tourist_id"] = _generate_tourist_code()
        updated = tourist.model_copy(update=update_data)
        _in_memory_tourist_store[profile_id] = updated
        return updated

    # 2. Database Mode
    _get_tourist_or_404(profile_id, current_user)  # Verify existence and RLS permission first

    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return _get_tourist_or_404(profile_id, current_user)

    # KYC completion: per the directive, a public tourist_id code
    # (TOUR-YYYY-[HEX]) is auto-generated the moment kyc_status becomes
    # VERIFIED, if one hasn't already been assigned.
    generated_code = None
    if update_data.get("kyc_status") == "VERIFIED":
        current = _get_tourist_or_404(profile_id, current_user)
        if current.tourist_id is None:
            generated_code = _generate_tourist_code()
            update_data["tourist_id"] = generated_code

    if "emergency_contacts" in update_data:
        update_data["emergency_contacts"] = json.dumps(update_data["emergency_contacts"])

    set_clauses = []
    params = []
    for k, v in update_data.items():
        set_clauses.append(f"{k} = %s")
        params.append(v)

    params.append(profile_id)
    query = (
        f"UPDATE public.tourist_profiles SET {', '.join(set_clauses)} "
        f"WHERE id = %s RETURNING {_PROFILE_COLUMNS};"
    )

    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute(query, tuple(params))
            row = cur.fetchone()
            return _row_to_response(row)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update tourist profile: {str(e)}"
        )
