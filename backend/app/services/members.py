"""Household membership management: roles, senior scope, temporary access, revocation."""
from ..core.auth import CurrentUser
from ..core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from ..core.rbac import ROLE_LABELS, P, Role, authorize, can_grant, member_path
from ..core.timeutil import aware, now
from ..db import Filter, Store
from . import audit, households


def member_out(d: dict) -> dict:
    return {"uid": d["uid"], "householdId": d["householdId"], "displayName": d.get("displayName", ""),
            "email": d.get("email", ""), "role": d["role"], "roleLabel": ROLE_LABELS[Role(d["role"])],
            "status": d.get("status", "active"), "seniorScope": d.get("seniorScope", "all"),
            "linkedSeniorId": d.get("linkedSeniorId"), "expiresAt": d.get("expiresAt"),
            "joinedAt": d.get("joinedAt")}


def validate_scope(store: Store, hid: str, role: Role, scope, linked_senior_id: str | None):
    """Normalise and validate the senior scope for a role. Returns (scope, linkedSeniorId)."""
    def exists(sid: str) -> bool:
        s = store.get(f"households/{hid}/seniors/{sid}")
        return bool(s and s.data.get("status") == "active")

    if role == Role.SENIOR:
        if not linked_senior_id or not exists(linked_senior_id):
            raise ValidationFailed("A senior member must be linked to an existing elderly profile.")
        return [linked_senior_id], linked_senior_id
    if role in (Role.HOUSEHOLD_OWNER, Role.FAMILY_ADMIN):
        return "all", None  # administrators always see the whole household
    if scope == "all":
        return "all", None
    if not isinstance(scope, list) or not scope:
        raise ValidationFailed("Choose at least one elderly profile, or 'all'.")
    missing = [s for s in scope if not exists(s)]
    if missing:
        raise ValidationFailed("One or more selected profiles do not exist in this household.")
    return sorted(set(scope)), None


def list_members(store: Store, actor: CurrentUser, hid: str, include_revoked: bool = False) -> list[dict]:
    authorize(store, actor.uid, hid, P.MEMBERS_READ)
    filters = None if include_revoked else [Filter("status", "!=", "revoked")]
    docs = store.query(f"households/{hid}/members", filters)
    return sorted((member_out(d.data) for d in docs), key=lambda m: (m["role"] != "household_owner",
                                                                       m["displayName"].lower()))


def _check_can_manage(actor_m, target: dict) -> None:
    target_role = Role(target["role"])
    if target_role == Role.HOUSEHOLD_OWNER:
        raise Forbidden("The household owner cannot be modified or removed.")
    if not can_grant(actor_m, target_role):
        raise Forbidden("You cannot manage a member with this role.")


def update_member(store: Store, actor: CurrentUser, hid: str, uid: str, changes: dict) -> dict:
    actor_m = authorize(store, actor.uid, hid, P.MEMBERS_MANAGE)
    doc = store.get(member_path(hid, uid))
    if not doc or doc.data.get("status") == "revoked":
        raise NotFound("Member not found.")
    if uid == actor.uid:
        raise Forbidden("You cannot change your own role or access.")
    before = doc.data
    _check_can_manage(actor_m, before)

    new_role = Role(changes["role"]) if changes.get("role") else Role(before["role"])
    if new_role != Role(before["role"]) and not can_grant(actor_m, new_role):
        raise Forbidden("You cannot grant this role.")
    scope_in = changes.get("seniorScope", before.get("seniorScope", "all"))
    linked_in = changes.get("linkedSeniorId", before.get("linkedSeniorId"))
    scope, linked = validate_scope(store, hid, new_role, scope_in, linked_in)

    update = {"role": new_role.value, "seniorScope": scope, "linkedSeniorId": linked, "updatedAt": now()}
    if changes.get("clearExpiry"):
        update["expiresAt"] = None
    elif changes.get("expiresAt") is not None:
        exp = aware(changes["expiresAt"])
        if exp <= now():
            raise ValidationFailed("Access expiry must be in the future.")
        update["expiresAt"] = exp
    if changes.get("status"):
        update["status"] = changes["status"]

    after = store.update(member_path(hid, uid), update).data
    keys = ["role", "seniorScope", "linkedSeniorId", "expiresAt", "status"]
    audit.record(store, hid, actor, "member.update", "member", uid,
                 f"Updated access for {before.get('displayName', 'member')}",
                 {k: before.get(k) for k in keys}, {k: after.get(k) for k in keys})
    return member_out(after)


def remove_member(store: Store, actor: CurrentUser, hid: str, uid: str) -> None:
    """Revoke a member (or leave the household when uid is the caller). Record is kept for audit."""
    if uid == actor.uid:
        m = authorize(store, actor.uid, hid)
        if m.role == Role.HOUSEHOLD_OWNER:
            raise Conflict("The owner cannot leave the household.")
        target = m.raw
    else:
        actor_m = authorize(store, actor.uid, hid, P.MEMBERS_MANAGE)
        doc = store.get(member_path(hid, uid))
        if not doc or doc.data.get("status") == "revoked":
            raise NotFound("Member not found.")
        target = doc.data
        _check_can_manage(actor_m, target)
    store.update(member_path(hid, uid), {"status": "revoked", "revokedAt": now(), "revokedBy": actor.uid,
                                         "updatedAt": now()})
    households.bump(store, hid, "memberCount", -1)
    action = "member.leave" if uid == actor.uid else "member.revoke"
    audit.record(store, hid, actor, action, "member", uid,
                 f"{'Left household' if uid == actor.uid else 'Revoked access for ' + target.get('displayName', 'member')}",
                 {"status": target.get("status")}, {"status": "revoked"})
