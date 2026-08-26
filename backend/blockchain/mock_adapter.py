"""
Offline-fallback ledger adapter.

Direct port of location-geofencing-backend-main/app/identity/chain.py's
append-only, SHA-256 hash-linked block logic — same hashing scheme
(`{index}:{timestamp}:{data}:{previous_hash}` -> sha256), same genesis-block
bootstrap — rewritten against psycopg2 (public.chain_blocks, see migration
004_kyc_blockchain_anchoring.sql) instead of a SQLAlchemy ChainBlock model,
so this module can be called from the same raw-SQL request handlers as the
rest of the backend without introducing a second ORM.

Not a real blockchain (no consensus, no distributed nodes) — it's a
tamper-evident local audit trail, used only when Sepolia isn't configured
(see blockchain/service.py). verify_chain() below is a direct port of the
teammate module's integrity-check logic and can be called from an admin/
audit endpoint if that's ever needed, same as the original.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from blockchain.base import AnchorResult, ChainAdapter

_in_memory_chain: list[dict] = []  # used only in mock-offline-DB mode (is_db_active() is False)


def _format_timestamp(dt: datetime) -> str:
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.isoformat()


def _compute_block_hash(index: int, timestamp_str: str, data_str: str, previous_hash: str) -> str:
    block_string = f"{index}:{timestamp_str}:{data_str}:{previous_hash}"
    return hashlib.sha256(block_string.encode("utf-8")).hexdigest()


def _append_block_db(cur, data: dict) -> dict:
    cur.execute("SELECT block_index, timestamp, data, previous_hash, hash FROM public.chain_blocks ORDER BY block_index DESC LIMIT 1;")
    latest = cur.fetchone()

    if latest is None:
        genesis_data = {"message": "Genesis Block - Suraksha Setu KYC Audit Trail"}
        genesis_data_str = json.dumps(genesis_data, sort_keys=True)
        genesis_time = datetime.now(timezone.utc)
        genesis_time_str = _format_timestamp(genesis_time)
        genesis_hash = _compute_block_hash(0, genesis_time_str, genesis_data_str, "0")
        cur.execute("""
            INSERT INTO public.chain_blocks (block_index, timestamp, data, previous_hash, hash)
            VALUES (0, %s, %s, '0', %s);
        """, (genesis_time, genesis_data_str, genesis_hash))
        latest = (0, genesis_time, genesis_data_str, "0", genesis_hash)

    latest_index, _, _, _, latest_hash = latest
    new_index = latest_index + 1
    new_time = datetime.now(timezone.utc)
    new_time_str = _format_timestamp(new_time)
    data_str = json.dumps(data, sort_keys=True)
    new_hash = _compute_block_hash(new_index, new_time_str, data_str, latest_hash)

    cur.execute("""
        INSERT INTO public.chain_blocks (block_index, timestamp, data, previous_hash, hash)
        VALUES (%s, %s, %s, %s, %s);
    """, (new_index, new_time, data_str, latest_hash, new_hash))

    return {"block_index": new_index, "hash": new_hash}


def _append_block_memory(data: dict) -> dict:
    if not _in_memory_chain:
        genesis_data = {"message": "Genesis Block - Suraksha Setu KYC Audit Trail"}
        genesis_data_str = json.dumps(genesis_data, sort_keys=True)
        genesis_time_str = _format_timestamp(datetime.now(timezone.utc))
        genesis_hash = _compute_block_hash(0, genesis_time_str, genesis_data_str, "0")
        _in_memory_chain.append({"block_index": 0, "data": genesis_data_str, "previous_hash": "0", "hash": genesis_hash})

    latest = _in_memory_chain[-1]
    new_index = latest["block_index"] + 1
    new_time_str = _format_timestamp(datetime.now(timezone.utc))
    data_str = json.dumps(data, sort_keys=True)
    new_hash = _compute_block_hash(new_index, new_time_str, data_str, latest["hash"])
    block = {"block_index": new_index, "data": data_str, "previous_hash": latest["hash"], "hash": new_hash}
    _in_memory_chain.append(block)
    return {"block_index": new_index, "hash": new_hash}


class MockChainAdapter(ChainAdapter):
    def anchor(self, tourist_id_hash: str, verification_hash: str) -> AnchorResult:
        from db import is_db_active, get_db_cursor

        anchor_data = {
            "event_type": "KYC_ANCHORED",
            "tourist_id_hash": tourist_id_hash,
            "verification_hash": verification_hash,
            "anchored_at": _format_timestamp(datetime.now(timezone.utc)),
        }

        if not is_db_active():
            block = _append_block_memory(anchor_data)
        else:
            with get_db_cursor(commit=True) as cur:
                block = _append_block_db(cur, anchor_data)

        # No real tx hash exists for an offline ledger — the block's own
        # hash IS the anchor reference, formatted to look like a tx hash
        # (0x + 64 hex chars) purely so the frontend can use one display
        # component for both adapters; AnchorResult.adapter distinguishes
        # "mock" from "sepolia" for anything that needs to tell them apart.
        return AnchorResult(tx_hash=f"0x{block['hash']}", block_number=block["block_index"], adapter="mock")
