"""
Swappable blockchain-anchoring adapter interface.

Two implementations:
  - MockChainAdapter (mock_adapter.py) — an offline, hash-linked ledger
    stored in public.chain_blocks. Ported from location-geofencing-backend-
    main/app/identity/chain.py's SHA-256 block-chaining logic, rewritten
    against psycopg instead of SQLAlchemy. Used whenever Sepolia isn't
    configured, so KYC verification never blocks on testnet availability.
  - SepoliaChainAdapter (sepolia_adapter.py) — real Ethereum Sepolia testnet
    anchoring via web3.py (see the module docstring there for why web3.py
    was chosen over ethers.js/Node for this Python backend).

blockchain/service.py picks between them the same way db.py picks between
live-Postgres and in-memory mode: by whether the relevant env vars are set,
never by a runtime flag the frontend controls.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class AnchorResult:
    tx_hash: str
    block_number: int | None
    adapter: str  # "mock" | "sepolia" — surfaced to the frontend so it can
    # decide whether to render a live Etherscan link or a "demo ledger" badge


class ChainAdapter(ABC):
    @abstractmethod
    def anchor(self, tourist_id_hash: str, verification_hash: str) -> AnchorResult:
        """Anchor a pseudonymous KYC verification record on-chain (or on the
        offline ledger). Must NEVER receive raw PII — callers are
        responsible for hashing tourist_id and the verification payload
        before calling this."""
        raise NotImplementedError
