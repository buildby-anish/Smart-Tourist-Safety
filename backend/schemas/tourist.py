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


class DigitalIdResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tourist_id: str | None = None
    full_name: str | None = None
    kyc_status: str | None = None
