from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status

from db import is_db_active, get_authenticated_cursor
from routers.auth import require_authority
from schemas.auth import SessionResponse
from schemas.audit_log import AuditLogCreate, AuditLogRecord

router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])

# Temporary in-memory storage for local API development only (fallback).
_in_memory_audit_log_store: dict[UUID, AuditLogRecord] = {}


@router.post("", response_model=AuditLogRecord, status_code=status.HTTP_201_CREATED)
def create_audit_log(
    payload: AuditLogCreate,
    request: Request,
    current_user: SessionResponse = Depends(require_authority)
) -> AuditLogRecord:
    now = datetime.now(timezone.utc)
    audit_id = uuid4()
    ip_address = payload.ip_address or (request.client.host if request.client else None)

    # 1. Fallback Mode
    if not is_db_active():
        record = AuditLogRecord(
            audit_id=audit_id,
            authority_id=current_user.authority_id,
            action_type=payload.action_type,
            target_id=payload.target_id,
            reason=payload.reason,
            details=payload.details,
            ip_address=ip_address,
            created_at=now,
        )
        _in_memory_audit_log_store[audit_id] = record
        return record

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute("""
                INSERT INTO public.audit_logs (audit_id, authority_id, action_type, target_id, reason, details, ip_address, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING audit_id, authority_id, action_type, target_id, reason, details, ip_address, created_at;
            """, (
                audit_id, current_user.authority_id, payload.action_type, payload.target_id,
                payload.reason, payload.details, ip_address, now
            ))
            row = cur.fetchone()
            return AuditLogRecord(
                audit_id=row[0],
                authority_id=row[1],
                action_type=row[2],
                target_id=row[3],
                reason=row[4],
                details=row[5],
                ip_address=row[6],
                created_at=row[7],
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to persist audit log: {str(e)}"
        )


@router.get("", response_model=list[AuditLogRecord])
def list_audit_logs(
    current_user: SessionResponse = Depends(require_authority)
) -> list[AuditLogRecord]:
    # 1. Fallback Mode
    if not is_db_active():
        return sorted(_in_memory_audit_log_store.values(), key=lambda r: r.created_at, reverse=True)

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT audit_id, authority_id, action_type, target_id, reason, details, ip_address, created_at
                FROM public.audit_logs
                ORDER BY created_at DESC;
            """)
            rows = cur.fetchall()
            return [
                AuditLogRecord(
                    audit_id=row[0],
                    authority_id=row[1],
                    action_type=row[2],
                    target_id=row[3],
                    reason=row[4],
                    details=row[5],
                    ip_address=row[6],
                    created_at=row[7],
                )
                for row in rows
            ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve audit logs: {str(e)}"
        )
