from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class TouristCreate(BaseModel):
    digital_id: str | None = None
    full_name: str | None = None
    kyc_document_type: str | None = None
    kyc_verified: bool | None = None
    phone: str | None = None
    email: str | None = None
    emergency_contact: str | None = None
    preferred_language: str | None = None


class TouristUpdate(BaseModel):
    digital_id: str | None = None
    full_name: str | None = None
    kyc_document_type: str | None = None
    kyc_verified: bool | None = None
    phone: str | None = None
    email: str | None = None
    emergency_contact: str | None = None
    preferred_language: str | None = None


class TouristResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tourist_id: UUID
    digital_id: str | None = None
    full_name: str | None = None
    kyc_document_type: str | None = None
    kyc_verified: bool | None = None
    phone: str | None = None
    email: str | None = None
    emergency_contact: str | None = None
    preferred_language: str | None = None
    created_at: datetime


class DigitalIdResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tourist_id: UUID
    digital_id: str | None = None
    full_name: str | None = None
    kyc_document_type: str | None = None
    kyc_verified: bool | None = None

