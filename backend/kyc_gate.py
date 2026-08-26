"""
Server-side mandatory-KYC gate.

The frontend gate (LoginModal.tsx / a "Verify now" banner) is UX only — it
can be bypassed by calling the API directly, so real enforcement has to live
here. Used by routers/itinerary.py's create_itinerary.

Deliberately NOT used by routers/sos.py: refusing to raise an SOS because a
tourist hasn't finished KYC would withhold emergency response from someone
who may be in genuine danger. sos.py instead flags unverified-identity SOS
events in the incident description for authorities to see, without ever
blocking the alert — see the comment in create_sos for the reasoning.
"""

from uuid import UUID

from fastapi import HTTPException, status

from db import is_db_active, get_authenticated_cursor


def require_verified_kyc(tourist_id: UUID, auth_user_id) -> None:
    """Raises 403 if the given tourist profile's kyc_status isn't VERIFIED.
    No-ops in offline/fallback mode (no persistent kyc_status to check
    against) so local/demo runs without a database aren't blocked."""
    if not is_db_active():
        return

    with get_authenticated_cursor(auth_user_id) as cur:
        cur.execute("SELECT kyc_status FROM public.tourist_profiles WHERE id = %s;", (tourist_id,))
        row = cur.fetchone()

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tourist profile not found")

    if row[0] != "VERIFIED":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="KYC verification is required before using this feature. Please complete DigiLocker or document verification first.",
        )
