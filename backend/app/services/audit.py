"""Audit trail. Every mutation of household data records who/what/when and a field-level diff.

The diff is the data source for the Care Change Detective (Phase 3).
"""
import time
from typing import Any

from ..core.auth import CurrentUser
from ..core.timeutil import now
from ..db import Filter, Store
from .ids import new_id

_SKIP = {"updatedAt", "createdAt"}


def diff(before: dict[str, Any] | None, after: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    before, after = before or {}, after or {}
    out = {}
    for k in sorted(set(before) | set(after)):
        if k in _SKIP:
            continue
        if before.get(k) != after.get(k):
            out[k] = {"from": before.get(k), "to": after.get(k)}
    return out


def record(store: Store, household_id: str, actor: CurrentUser, action: str, target_type: str, target_id: str,
           summary: str, before: dict | None = None, after: dict | None = None,
           senior_id: str | None = None) -> None:
    store.set(f"households/{household_id}/auditLogs/{new_id()}", {
        "actorUid": actor.uid, "actorName": actor.display_name, "action": action,
        "targetType": target_type, "targetId": target_id, "seniorId": senior_id,
        "summary": summary, "changes": diff(before, after) if (before or after) else None, "at": now(),
        # Wall-clock nanoseconds break ties between entries written in the same instant.
        "seq": time.time_ns(),
    })


def list_logs(store: Store, household_id: str, senior_id: str | None = None, limit: int = 100) -> list[dict]:
    filters = [Filter("seniorId", "==", senior_id)] if senior_id else None
    docs = store.query(f"households/{household_id}/auditLogs", filters, order_by="at", descending=True,
                       limit=limit)
    out = [{"id": d.id, **d.data} for d in docs]
    out.sort(key=lambda x: (x["at"], x.get("seq", 0)), reverse=True)
    for x in out:
        x.pop("seq", None)
    return out
