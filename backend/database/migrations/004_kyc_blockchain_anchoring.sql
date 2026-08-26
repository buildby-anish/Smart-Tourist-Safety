-- Migration 004: DigiLocker KYC issuer fields + Ethereum Sepolia anchoring
--
-- Why: DigiLocker KYC (backend/digilocker/) is a new, additional
-- verification path alongside the existing OCR-based
-- backend/document_verification/ module — both flip the same
-- tourist_profiles.kyc_status flag (no schema change needed for that part,
-- it already exists). What's new here is recording WHICH issuer verified a
-- tourist and the pseudonymous on-chain anchor reference for that
-- verification. Per the zero-PII-on-chain rule, none of these columns ever
-- hold a raw document number, name, DOB, or photo — only a hash, an
-- issuer/document-type label, and a blockchain transaction reference.
--
-- Idempotent — safe to re-run against an already-migrated database.

ALTER TABLE IF EXISTS public.tourist_profiles
    ADD COLUMN IF NOT EXISTS kyc_document_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS kyc_issuer VARCHAR(50) DEFAULT 'DigiLocker_Demo',
    ADD COLUMN IF NOT EXISTS kyc_verification_hash VARCHAR(66),
    ADD COLUMN IF NOT EXISTS kyc_salt VARCHAR(64),
    ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS blockchain_tx_hash VARCHAR(66),
    ADD COLUMN IF NOT EXISTS blockchain_block_number BIGINT;

CREATE INDEX IF NOT EXISTS idx_tourist_profiles_kyc_hash ON public.tourist_profiles(kyc_verification_hash);
CREATE INDEX IF NOT EXISTS idx_tourist_profiles_blockchain_tx ON public.tourist_profiles(blockchain_tx_hash);

-- Offline-fallback ledger (used only when no Sepolia RPC URL/private key is
-- configured — see backend/blockchain/mock_adapter.py). Ported from
-- location-geofencing-backend-main/app/identity/chain.py's hash-linked
-- block pattern.
CREATE TABLE IF NOT EXISTS public.chain_blocks (
    block_index    INTEGER PRIMARY KEY,
    timestamp      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data           TEXT NOT NULL,
    previous_hash  VARCHAR(64) NOT NULL,
    hash           VARCHAR(64) NOT NULL
);
