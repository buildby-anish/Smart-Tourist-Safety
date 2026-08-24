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
    tourist_profile_id: UUID | None = None
    authority_id: UUID | None = None
    mfa_enabled: bool = False
    # Collected directly at signup time so a tourist's name/phone are set
    # atomically with account creation, rather than depending on a second
    # PATCH /tourists/{id} call succeeding afterward (which — being a
    # separate request — could silently fail/be skipped and leave
    # full_name defaulted to the account's username/email, which is what
    # was previously happening).
    full_name: str | None = None
    phone_number: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    auth_id: UUID
    tourist_profile_id: UUID | None = None
    authority_id: UUID | None = None
    username: str
    user_type: str
    mfa_enabled: bool
    last_login_at: datetime | None = None
    created_at: datetime


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    auth_id: UUID
    username: str
    user_type: str
    tourist_profile_id: UUID | None = None
    authority_id: UUID | None = None
    mfa_enabled: bool
    last_login_at: datetime | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class RefreshResponse(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    auth_id: UUID
    auth_user_id: UUID
    username: str
    user_type: str
    tourist_profile_id: UUID | None = None
    authority_id: UUID | None = None
    mfa_enabled: bool
    last_login_at: datetime | None = None
