"""Invitation-based membership.

The raw invitation token is returned exactly once (to the inviter, for sharing). Only its SHA-256
hash is stored as the document ID, so a database read never yields a usable invitation link.
Acceptance requires the signed-in user's email to match the invited email.
"""
from datetime import timedelta

from ..config import get_settings
from ..core.auth import CurrentUser
from ..core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from ..core.passwords import sha256
from ..core.rbac import ROLE_LABELS, P, Role, authorize, can_grant, member_path
from ..core.timeutil import aware, now
from ..db import Filter, Store
from . import audit, households
from .ids import new_token
from .members import validate_scope


def _out(inv_id: str, d: dict, token: str | None = None) -> dict:
    status = d["status"]
    if status == "pending" and aware(d["expiresAt"]) <= now():
        status = "expired"
    return {"id": inv_id, "token": token, "householdId": d["householdId"], "householdName": d["householdName"],
            "email": d["email"], "role": d["role"], "roleLabel": ROLE_LABELS[Role(d["role"])],
            "seniorScope": d["seniorScope"], "linkedSeniorId": d.get("linkedSeniorId"), "status": status,
            "invitedByName": d["invitedByName"], "expiresAt": d["expiresAt"], "createdAt": d["createdAt"]}


def create(store: Store, actor: CurrentUser, hid: str, payload: dict) -> dict:
    actor_m = authorize(store, actor.uid, hid, P.MEMBERS_MANAGE)
    role = Role(payload["role"])
    if not can_grant(actor_m, role):
        raise Forbidden("You cannot invite someone with this role.")
    scope, linked = validate_scope(store, hid, role, payload.get("seniorScope", "all"),
                                   payload.get("linkedSeniorId"))
    email = payload["email"].lower()
    if email == actor.email.lower():
        raise ValidationFailed("You cannot invite yourself.")
    for d in store.query(f"households/{hid}/members", [Filter("status", "==", "active")]):
        if d.data.get("email", "").lower() == email:
            raise Conflict("This person is already a member of the household.")
    # Supersede earlier pending invitations to the same email for this household.
    for d in store.query("invitations", [Filter("householdId", "==", hid), Filter("status", "==", "pending")]):
        if d.data["emailLower"] == email:
            store.update(d.path, {"status": "revoked", "revokedAt": now()})

    access_exp = aware(payload.get("accessExpiresAt"))
    if access_exp is not None and access_exp <= now():
        raise ValidationFailed("Temporary access end must be in the future.")

    token = new_token()
    inv_id = sha256(token)
    house = store.get(f"households/{hid}").data
    t = now()
    data = {"householdId": hid, "householdName": house["name"], "email": payload["email"], "emailLower": email,
            "role": role.value, "seniorScope": scope, "linkedSeniorId": linked, "accessExpiresAt": access_exp,
            "status": "pending", "invitedBy": actor.uid, "invitedByName": actor.display_name,
            "expiresAt": t + timedelta(days=get_settings().invitation_days), "createdAt": t}
    store.set(f"invitations/{inv_id}", data)
    audit.record(store, hid, actor, "invitation.create", "invitation", inv_id,
                 f"Invited {payload['email']} as {ROLE_LABELS[role]}")
    # NOTE: email delivery is a pending integration (Resend/SendGrid, needs provider credentials). The inviter shares the link.
    return _out(inv_id, data, token)


def list_for_household(store: Store, actor: CurrentUser, hid: str) -> list[dict]:
    authorize(store, actor.uid, hid, P.MEMBERS_MANAGE)
    docs = store.query("invitations", [Filter("householdId", "==", hid)], order_by="createdAt", descending=True)
    return [_out(d.id, d.data) for d in docs]


def revoke(store: Store, actor: CurrentUser, hid: str, inv_id: str) -> None:
    authorize(store, actor.uid, hid, P.MEMBERS_MANAGE)
    d = store.get(f"invitations/{inv_id}")
    if not d or d.data["householdId"] != hid:
        raise NotFound("Invitation not found.")
    if d.data["status"] != "pending":
        raise Conflict("Only pending invitations can be revoked.")
    store.update(d.path, {"status": "revoked", "revokedAt": now()})
    audit.record(store, hid, actor, "invitation.revoke", "invitation", inv_id,
                 f"Revoked invitation for {d.data['email']}")


def list_for_me(store: Store, actor: CurrentUser) -> list[dict]:
    docs = store.query("invitations", [Filter("emailLower", "==", actor.email.lower()),
                                       Filter("status", "==", "pending")])
    return [o for o in (_out(d.id, d.data) for d in docs) if o["status"] == "pending"]


def _load_for_actor(store: Store, actor: CurrentUser, inv_id: str) -> dict:
    d = store.get(f"invitations/{inv_id}")
    if not d:
        raise NotFound("Invitation not found or no longer valid.")
    if d.data["emailLower"] != actor.email.lower():
        # Same response as not-found: don't confirm a token belongs to someone else.
        raise NotFound("Invitation not found or no longer valid.")
    return d.data


def preview_by_token(store: Store, actor: CurrentUser, token: str) -> dict:
    inv_id = sha256(token)
    return _out(inv_id, _load_for_actor(store, actor, inv_id))


def accept(store: Store, actor: CurrentUser, inv_id: str) -> dict:
    d = _load_for_actor(store, actor, inv_id)
    if d["status"] != "pending":
        raise Conflict(f"This invitation is {d['status']}.")
    if aware(d["expiresAt"]) <= now():
        raise Conflict("This invitation has expired. Ask for a new one.")
    hid = d["householdId"]
    existing = store.get(member_path(hid, actor.uid))
    if existing and existing.data.get("status") == "active":
        raise Conflict("You are already a member of this household.")
    role = Role(d["role"])
    # Re-validate scope: a profile may have been archived since the invitation was sent.
    scope, linked = validate_scope(store, hid, role, d["seniorScope"], d.get("linkedSeniorId"))
    t = now()
    store.set(member_path(hid, actor.uid), {
        "uid": actor.uid, "householdId": hid, "role": role.value, "status": "active", "seniorScope": scope,
        "linkedSeniorId": linked, "expiresAt": d.get("accessExpiresAt"), "displayName": actor.display_name,
        "email": actor.email, "invitedBy": d["invitedBy"], "joinedAt": t, "updatedAt": t})
    store.update(f"invitations/{inv_id}", {"status": "accepted", "acceptedBy": actor.uid, "acceptedAt": t})
    households.bump(store, hid, "memberCount", 1)
    audit.record(store, hid, actor, "invitation.accept", "member", actor.uid,
                 f"{actor.display_name} joined as {ROLE_LABELS[role]}")
    return {"householdId": hid, "role": role.value}


def accept_by_token(store: Store, actor: CurrentUser, token: str) -> dict:
    return accept(store, actor, sha256(token))
