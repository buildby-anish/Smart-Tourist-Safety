"""
DigiLocker KYC endpoints.

In-memory session store, same posture as backend/document_verification
(see main.py's comment on that module: sessions live only in this process's
memory, no persistent verification audit trail beyond what lands on
tourist_profiles once confirmed). This is an ADDITIONAL verification path
next to the existing OCR upload flow — both end at the same place: a
PATCH to tourist_profiles via routers.tourists.update_tourist, so there is
exactly one code path that flips kyc_status, not two divergent ones.
"""

import logging
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from blockchain.service import anchor_kyc_verification
from digilocker.adapter import get_active_adapter
from digilocker.schemas import (
    DigiLockerConfirmRequest,
    DigiLockerConfirmResponse,
    DigiLockerFetchResponse,
    DigiLockerInitiateRequest,
    DigiLockerInitiateResponse,
    DigiLockerSessionStatus,
    DigiLockerStatusResponse,
)
from routers.auth import get_current_user
from schemas.auth import SessionResponse
from schemas.tourist import TouristUpdate

logger = logging.getLogger("digilocker")

router = APIRouter(prefix="/digilocker", tags=["DigiLocker KYC"])

_sessions: dict[UUID, dict] = {}


@router.post("/initiate", response_model=DigiLockerInitiateResponse)
def initiate(
    payload: DigiLockerInitiateRequest,
    current_user: SessionResponse = Depends(get_current_user),
) -> DigiLockerInitiateResponse:
    from config import Config

    adapter = get_active_adapter()
    session_id = uuid4()
    auth_url = adapter.initiate_auth(str(payload.tourist_id))

    _sessions[session_id] = {
        "tourist_id": payload.tourist_id,
        "document_type": payload.document_type,
        "status": DigiLockerSessionStatus.INITIATED if auth_url else DigiLockerSessionStatus.AUTHORIZED,
        "created_at": datetime.now(timezone.utc),
        "verified_at": None,
        "document": None,
    }

    return DigiLockerInitiateResponse(
        session_id=session_id,
        status=_sessions[session_id]["status"],
        auth_url=auth_url,
        mock_mode=not Config.is_digilocker_configured(),
    )


@router.post("/fetch/{session_id}", response_model=DigiLockerFetchResponse)
def fetch_document(
    session_id: UUID,
    current_user: SessionResponse = Depends(get_current_user),
) -> DigiLockerFetchResponse:
    from config import Config

    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DigiLocker session not found")

    adapter = get_active_adapter()

    # Look up the tourist's actual registered full_name so the mock
    # adapter echoes back the real identity they signed up with, instead
    # of an unrelated randomly-picked demo name — a real DigiLocker pull
    # would return the identity tied to their own document, not a
    # stranger's. Falls back to None (mock adapter then uses a generic
    # placeholder name) if the profile lookup fails for any reason.
    registered_name = None
    try:
        from routers.tourists import _get_tourist_or_404
        registered_name = _get_tourist_or_404(session["tourist_id"], current_user).full_name
    except Exception:
        pass

    try:
        doc = adapter.fetch_document(session["document_type"], str(session["tourist_id"]), registered_name)
    except NotImplementedError as e:
        session["status"] = DigiLockerSessionStatus.FAILED
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))

    session["document"] = doc
    session["status"] = DigiLockerSessionStatus.FETCHED

    return DigiLockerFetchResponse(
        session_id=session_id,
        status=session["status"],
        document_type=session["document_type"],
        masked_document_number=doc.document_number_masked,
        full_name=doc.full_name,
        mock_mode=not Config.is_digilocker_configured(),
    )


@router.post("/confirm", response_model=DigiLockerConfirmResponse)
def confirm(
    payload: DigiLockerConfirmRequest,
    current_user: SessionResponse = Depends(get_current_user),
) -> DigiLockerConfirmResponse:
    session = _sessions.get(payload.session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DigiLocker session not found")
    if session["status"] != DigiLockerSessionStatus.FETCHED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Document must be fetched before confirming")

    tourist_id = session["tourist_id"]
    issuer = "DigiLocker_Demo"
    document_type = session["document_type"].value

    # Zero-PII anchoring: only tourist_id, issuer, and document_type reach
    # this call — never doc.raw_document_number or doc.full_name.
    anchor = anchor_kyc_verification(tourist_id=tourist_id, issuer=issuer, document_type=document_type)

    update_payload = TouristUpdate(
        kyc_status="VERIFIED",
        kyc_document_type=document_type,
        kyc_issuer=issuer,
        kyc_verification_hash=anchor["kyc_verification_hash"],
        kyc_salt=anchor["kyc_salt"],
        kyc_verified_at=datetime.now(timezone.utc),
        blockchain_tx_hash=anchor["blockchain_tx_hash"],
        blockchain_block_number=anchor["blockchain_block_number"],
    )

    # Reuse the SAME update path the OCR flow and the rest of the app use to
    # flip kyc_status — routers.tourists.update_tourist — rather than a
    # second, divergent UPDATE query. Imported lazily to avoid a circular
    # import at module load time (routers.tourists doesn't import this
    # module, so this is safe).
    from routers.tourists import update_tourist
    updated = update_tourist(profile_id=tourist_id, payload=update_payload, current_user=current_user)

    session["status"] = DigiLockerSessionStatus.VERIFIED
    session["verified_at"] = datetime.now(timezone.utc)

    # adapter name isn't tracked on the anchor dict itself (kept lean) —
    # infer it display-only from whether Sepolia is configured.
    from config import Config
    adapter_name = "sepolia" if Config.is_sepolia_configured() and anchor["blockchain_tx_hash"] else ("mock" if anchor["blockchain_tx_hash"] else None)

    return DigiLockerConfirmResponse(
        session_id=payload.session_id,
        status=session["status"],
        tourist_id=tourist_id,
        kyc_status=updated.kyc_status,
        blockchain_tx_hash=anchor["blockchain_tx_hash"],
        blockchain_block_number=anchor["blockchain_block_number"],
        blockchain_adapter=adapter_name,
    )


@router.get("/status/{session_id}", response_model=DigiLockerStatusResponse)
def get_status(
    session_id: UUID,
    current_user: SessionResponse = Depends(get_current_user),
) -> DigiLockerStatusResponse:
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DigiLocker session not found")
    return DigiLockerStatusResponse(
        session_id=session_id,
        status=session["status"],
        document_type=session["document_type"],
        created_at=session["created_at"],
        verified_at=session["verified_at"],
    )
