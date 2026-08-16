from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class SendOtpRequest(BaseModel):
    phone: str


class SendOtpResponse(BaseModel):
    message: str


class VerifyOtpRequest(BaseModel):
    phone: str
    otp: str


class VerifyOtpResponse(BaseModel):
    verified: bool
    message: str


class RegisterRequest(BaseModel):
    username: str
    password: str
    user_type: str = "tourist"  # "tourist" or "authority"
    tourist_id: UUID | None = None
    authority_id: UUID | None = None
    mfa_enabled: bool = False


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    auth_id: UUID
    tourist_id: UUID | None = None
    authority_id: UUID | None = None
    username: str
    user_type: str
    mfa_enabled: bool
    last_login_at: datetime | None = None
    created_at: datetime


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    auth_id: UUID
    username: str
    user_type: str
    tourist_id: UUID | None = None
    authority_id: UUID | None = None
    mfa_enabled: bool
    last_login_at: datetime | None = None


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    auth_id: UUID
    auth_user_id: UUID
    username: str
    user_type: str
    tourist_id: UUID | None = None
    authority_id: UUID | None = None
    mfa_enabled: bool
    last_login_at: datetime | None = None
