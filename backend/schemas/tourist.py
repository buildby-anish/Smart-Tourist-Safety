from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class EmergencyContact(BaseModel):
    name: str | None = None
    relation: str | None = None
    phone: str | None = None


class TouristCreate(BaseModel):
    username: str
    full_name: str
    phone_number: str | None = None
    email: str | None = None
    emergency_contacts: list[EmergencyContact] = []
    govt_id_type: str | None = None
    govt_id_number: str | None = None
    id_photo_url: str | None = None
    preferred_language: str | None = None


class TouristUpdate(BaseModel):
    username: str | None = None
    full_name: str | None = None
    phone_number: str | None = None
    email: str | None = None
    emergency_contacts: list[EmergencyContact] | None = None
    govt_id_type: str | None = None
    govt_id_number: str | None = None
    id_photo_url: str | None = None
    kyc_status: str | None = None
    preferred_language: str | None = None
    # KYC issuer + Sepolia anchoring (migration 004) — set by
    # backend/digilocker/router.py alongside kyc_status, never by the
    # frontend directly for arbitrary values (the digilocker/document
    # verification routers are the only real callers of these fields).
    kyc_document_type: str | None = None
    kyc_issuer: str | None = None
    kyc_verification_hash: str | None = None
    kyc_salt: str | None = None
    kyc_verified_at: datetime | None = None
    blockchain_tx_hash: str | None = None
    blockchain_block_number: int | None = None


class TouristResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tourist_id: str | None = None  # public code, format TOUR-YYYY-[HEX]
    username: str
    full_name: str | None = None
    phone_number: str | None = None
    email: str | None = None
    emergency_contacts: list[EmergencyContact] = []
    govt_id_type: str | None = None
    govt_id_number: str | None = None
    id_photo_url: str | None = None
    kyc_status: str | None = None
    preferred_language: str | None = None
    created_at: datetime
    kyc_document_type: str | None = None
    kyc_issuer: str | None = None
    kyc_verification_hash: str | None = None
    kyc_verified_at: datetime | None = None
    blockchain_tx_hash: str | None = None
    blockchain_block_number: int | None = None


class DigitalIdResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tourist_id: str | None = None
    full_name: str | None = None
    kyc_status: str | None = None
