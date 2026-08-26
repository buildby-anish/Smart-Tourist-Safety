"""
Pydantic schemas for the DigiLocker KYC path.

Mirrors backend/document_verification/schemas.py's shape (upload/confirm/
status) so the frontend can reuse similar state-machine handling for
whichever verification path the tourist picks — OCR upload or DigiLocker.

Same anti-spoofing/anti-PII posture as document_verification: no raw
document number ever leaves the server, and only a masked value is ever
returned to the client.
"""

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DigiLockerDocType(str, Enum):
    AADHAAR = "AADHAAR"
    PAN = "PAN"
    DRIVING_LICENCE = "DRIVING_LICENCE"
    VOTER_ID = "VOTER_ID"


class DigiLockerSessionStatus(str, Enum):
    INITIATED = "INITIATED"
    AUTHORIZED = "AUTHORIZED"
    FETCHED = "FETCHED"
    VERIFIED = "VERIFIED"
    FAILED = "FAILED"


class DigiLockerInitiateRequest(BaseModel):
    tourist_id: UUID = Field(description="Suraksha Setu tourist profile id")
    document_type: DigiLockerDocType


class DigiLockerInitiateResponse(BaseModel):
    session_id: UUID
    status: DigiLockerSessionStatus
    # Real OAuth mode: the URL the frontend should redirect the tourist to.
    # Mock mode: null — fetch_document can be called immediately, no
    # redirect needed.
    auth_url: str | None = None
    mock_mode: bool = True


class DigiLockerFetchResponse(BaseModel):
    session_id: UUID
    status: DigiLockerSessionStatus
    document_type: DigiLockerDocType
    masked_document_number: str = Field(description="e.g. 'XXXX XXXX 1234' — never the full number")
    full_name: str
    mock_mode: bool = True


class DigiLockerConfirmRequest(BaseModel):
    session_id: UUID


class DigiLockerConfirmResponse(BaseModel):
    session_id: UUID
    status: DigiLockerSessionStatus
    tourist_id: UUID
    kyc_status: str
    blockchain_tx_hash: str | None = None
    blockchain_block_number: int | None = None
    blockchain_adapter: str | None = None  # "mock" | "sepolia"


class DigiLockerStatusResponse(BaseModel):
    session_id: UUID
    status: DigiLockerSessionStatus
    document_type: DigiLockerDocType
    created_at: datetime
    verified_at: datetime | None = None
