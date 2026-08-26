"""
Adapter selection + the single call site that's allowed to hash and anchor a
KYC verification. Callers (backend/digilocker/, document_verification's
confirm step) pass a tourist UUID and a verification payload dict — never a
raw document number, name, DOB, or photo — this module hashes them and picks
the adapter, same is_db_active()-style branching used throughout the rest of
this codebase.
"""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
from uuid import UUID

from blockchain.base import AnchorResult
from config import Config

logger = logging.getLogger("blockchain.service")


def _sha256_hex(value: str) -> str:
    return "0x" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def get_active_adapter():
    """Sepolia when fully configured, mock ledger otherwise. Mirrors
    db.py's DATABASE_URL-presence branching pattern."""
    if Config.is_sepolia_configured():
        try:
            from blockchain.sepolia_adapter import SepoliaChainAdapter
            return SepoliaChainAdapter()
        except Exception as e:
            logger.warning(f"Sepolia adapter unavailable ({e}); falling back to offline ledger.")
    from blockchain.mock_adapter import MockChainAdapter
    return MockChainAdapter()


def anchor_kyc_verification(tourist_id: UUID, issuer: str, document_type: str | None) -> dict:
    """
    Hashes a pseudonymous verification record and anchors it via whichever
    adapter is active. Returns a dict ready to persist onto tourist_profiles
    (kyc_verification_hash, kyc_salt, blockchain_tx_hash,
    blockchain_block_number) — callers still own the actual UPDATE, this
    function never touches the database directly so it stays usable from
    both DB-active and offline-fallback request paths.

    NEVER pass raw govt_id_number, full_name, DOB, or a photo/document URL
    into this function — only tourist_id (a UUID, not a document number) and
    metadata about the verification event itself.
    """
    salt = secrets.token_hex(16)
    tourist_id_hash = _sha256_hex(str(tourist_id))
    verification_payload = json.dumps({
        "issuer": issuer,
        "document_type": document_type,
        "salt": salt,
    }, sort_keys=True)
    verification_hash = _sha256_hex(verification_payload)

    adapter = get_active_adapter()
    try:
        result: AnchorResult = adapter.anchor(tourist_id_hash, verification_hash)
    except Exception as e:
        # Anchoring must never block KYC completion — a tourist's
        # verification is valid the moment the issuer confirms it; the
        # chain record is supplementary proof, not a gate. Log and return a
        # result with no tx reference; a background retry can fill it in
        # later (see the note in the DigiLocker router).
        logger.error(f"Blockchain anchor failed for tourist {tourist_id}: {e}")
        return {
            "kyc_verification_hash": verification_hash,
            "kyc_salt": salt,
            "blockchain_tx_hash": None,
            "blockchain_block_number": None,
        }

    return {
        "kyc_verification_hash": verification_hash,
        "kyc_salt": salt,
        "blockchain_tx_hash": result.tx_hash,
        "blockchain_block_number": result.block_number,
    }
