"""
Swappable DigiLocker adapter — Mock/Sandbox Adapter Pattern.

MockDigiLockerAdapter: returns realistic fake document payloads instantly,
no external calls. Active whenever Config.is_digilocker_configured() is
False (the default), so local/demo signup flows never depend on real
DigiLocker sandbox credentials.

DigiLockerOAuthAdapter: real API Setu / DigiLocker OAuth2 authorization-code
flow skeleton. Only usable when DIGILOCKER_CLIENT_ID/SECRET/REDIRECT_URI are
set. API Setu's actual document-pull endpoints require a registered
sandbox/production app and a signed agreement to call in this environment,
so the token-exchange and document-fetch calls here are the documented
integration points (fill in the real API Setu base URL + endpoints once
sandbox credentials are issued) rather than working requests — the
mock adapter is what actually runs the demo end-to-end.
"""

from __future__ import annotations

import random
import string
from abc import ABC, abstractmethod
from dataclasses import dataclass

from digilocker.schemas import DigiLockerDocType


@dataclass(frozen=True)
class DigiLockerDocument:
    document_number_masked: str
    full_name: str
    raw_document_number: str  # server-side only — NEVER returned to the frontend, hashed then discarded


class DigiLockerAdapter(ABC):
    @abstractmethod
    def initiate_auth(self, tourist_id: str) -> str | None:
        """Returns an OAuth authorization URL for the real adapter, or None
        for the mock adapter (no redirect needed)."""
        raise NotImplementedError

    @abstractmethod
    def fetch_document(self, document_type: DigiLockerDocType, tourist_id: str) -> DigiLockerDocument:
        raise NotImplementedError


_MOCK_NAMES = ["Aarav Sharma", "Priya Nair", "Rohan Mehta", "Isha Kapoor", "Vikram Singh"]


class MockDigiLockerAdapter(DigiLockerAdapter):
    def initiate_auth(self, tourist_id: str) -> str | None:
        return None  # mock mode: caller can go straight to fetch_document

    def fetch_document(self, document_type: DigiLockerDocType, tourist_id: str) -> DigiLockerDocument:
        # Deterministic-looking but fake — seeded off tourist_id so repeated
        # calls in the same demo session return the same fake identity
        # instead of a different random one each time.
        rng = random.Random(tourist_id + document_type.value)
        digits = "".join(rng.choice(string.digits) for _ in range(12))
        name = rng.choice(_MOCK_NAMES)

        if document_type == DigiLockerDocType.AADHAAR:
            masked = f"XXXX XXXX {digits[-4:]}"
        elif document_type == DigiLockerDocType.PAN:
            masked = f"{''.join(rng.choice(string.ascii_uppercase) for _ in range(5))}XXXX{digits[-1]}"
        else:
            masked = f"{digits[:2]}-XXXX-{digits[-4:]}"

        return DigiLockerDocument(document_number_masked=masked, full_name=name, raw_document_number=digits)


class DigiLockerOAuthAdapter(DigiLockerAdapter):
    """Real API Setu/DigiLocker OAuth2 flow. See module docstring — the
    token exchange and document-pull calls are the integration points to
    fill in with real API Setu endpoints once sandbox credentials exist."""

    _AUTHORIZE_URL = "https://api.setu.co/api/digilocker/authorize"  # placeholder — confirm against API Setu's current sandbox docs before going live

    def __init__(self):
        from config import Config
        self._client_id = Config.DIGILOCKER_CLIENT_ID
        self._client_secret = Config.DIGILOCKER_CLIENT_SECRET
        self._redirect_uri = Config.DIGILOCKER_REDIRECT_URI

    def initiate_auth(self, tourist_id: str) -> str | None:
        return (
            f"{self._AUTHORIZE_URL}?client_id={self._client_id}"
            f"&redirect_uri={self._redirect_uri}&state={tourist_id}&response_type=code"
        )

    def fetch_document(self, document_type: DigiLockerDocType, tourist_id: str) -> DigiLockerDocument:
        # Requires a completed OAuth code exchange (session already carries
        # an access token by the time fetch_document is reachable in the
        # router flow below) plus the actual API Setu document-pull call.
        # Not implemented against a live sandbox in this environment — wire
        # the real HTTP calls here once DIGILOCKER_* credentials are issued.
        raise NotImplementedError(
            "Real DigiLocker document fetch requires live API Setu sandbox credentials; "
            "MockDigiLockerAdapter is used until DIGILOCKER_CLIENT_ID/SECRET/REDIRECT_URI are configured "
            "AND this method is wired to the actual API Setu document-pull endpoint."
        )


def get_active_adapter() -> DigiLockerAdapter:
    from config import Config
    if Config.is_digilocker_configured():
        return DigiLockerOAuthAdapter()
    return MockDigiLockerAdapter()
