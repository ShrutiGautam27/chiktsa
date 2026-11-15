"""Professional care organisations serving many households.

Model:
  organisations/{oid}                  name, connect-code hash
  organisations/{oid}/members/{uid}    role org_admin | org_caregiver
  organisations/{oid}/households/{hid} link record

A household owner/admin CONNECTS an organisation using the code the organisation shares. Connecting
grants the organisation's admins a normal household membership (role org_admin, marked viaOrg) —
so every existing permission, scope and consent rule applies unchanged. Org admins can then place
their caregivers on specific profiles. Disconnecting revokes every membership the org created.
"""
from __future__ import annotations

import secrets

from ..core.auth import CurrentUser
from ..core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from ..core.passwords import sha256
from ..core.rbac import P, Role, authorize
from ..core.timeutil import now
from ..db import Filter, Store
from . import audit, households, notifications
from .access import Access
from .continuity import detect_gaps
from .coordination import _load_by_member
from .ids import new_id
from .members import validate_scope
from .users import find_by_email


def _org_member(store: Store, oid: str, uid: str) -> dict:
    m = store.get(f"organisations/{oid}/members/{uid}")
    if not m or m.data.get("status") != "active":
        raise NotFound("Organisation not found.")
    return m.data


def _require_admin(store: Store, oid: str, uid: str) -> dict:
    m = _org_member(store, oid, uid)
    if m["role"] != "org_admin":
        raise Forbidden("Only organisation administrators can do this.")
    return m


def create_org(store: Store, actor: CurrentUser, name: str) -> dict:
    name = (name or "").strip()
    if not 2 <= len(name) <= 120:
        raise ValidationFailed("Give the organisation a name (2–120 characters).")
    oid, code = new_id(), secrets.token_hex(4).upper()
    store.set(f"organisations/{oid}", {"name": name, "createdBy": actor.uid, "createdAt": now(), "codeHash": sha256(code)})
    store.set(f"organisations/{oid}/members/{actor.uid}", {"uid": actor.uid, "role": "org_admin", "status": "active",
                                                           "displayName": actor.display_name, "email": actor.email, "joinedAt": now()})
    return {**org_out(store, oid, actor), "connectCode": code}


def my_orgs(store: Store, actor: CurrentUser) -> list[dict]:
    out = []
    for d in store.collection_group("members", [Filter("uid", "==", actor.uid), Filter("status", "==", "active")]):
        if d.path.startswith("organisations/"):
            out.append(org_out(store, d.path.split("/")[1], actor))
    return out


def org_out(store: Store, oid: str, actor: CurrentUser) -> dict:
    o = store.get(f"organisations/{oid}")
    me = _org_member(store, oid, actor.uid)
    return {"id": oid, "name": o.data["name"], "myRole": me["role"],
            "staff": [{"uid": m.data["uid"], "displayName": m.data["displayName"], "email": m.data["email"], "role": m.data["role"]}
                      for m in store.query(f"organisations/{oid}/members") if m.data.get("status") == "active"],
            "households": [{"householdId": h.id, "householdName": h.data["householdName"], "linkedAt": h.data["linkedAt"]}
                           for h in store.query(f"organisations/{oid}/households") if h.data.get("status") == "active"]}


def rotate_code(store: Store, actor: CurrentUser, oid: str) -> dict:
    _require_admin(store, oid, actor.uid)
    code = secrets.token_hex(4).upper()
    store.update(f"organisations/{oid}", {"codeHash": sha256(code)})
    return {"connectCode": code}


def add_staff(store: Store, actor: CurrentUser, oid: str, email: str, role: str) -> dict:
    _require_admin(store, oid, actor.uid)
    if role not in ("org_admin", "org_caregiver"):
        raise ValidationFailed("Unknown organisation role.")
    u = find_by_email(store, email)
    if not u:
        raise NotFound("No Chiktsa account uses that email yet. Ask them to sign up first.")
    store.set(f"organisations/{oid}/members/{u.id}", {"uid": u.id, "role": role, "status": "active", "displayName": u.data["displayName"],
                                                      "email": u.data["email"], "joinedAt": now(), "addedBy": actor.uid})
    o = store.get(f"organisations/{oid}").data
    notifications.notify(store, u.id, "org_added", f"You joined {o['name']}", f"{actor.display_name} added you to {o['name']}.",
                         "/app/organisation", f"org-staff:{oid}:{u.id}")
    return org_out(store, oid, actor)


def connect(store: Store, actor: CurrentUser, hid: str, code: str) -> dict:
    """Household side: connect an organisation by its code. Grants org admins household access."""
    authorize(store, actor.uid, hid, P.MEMBERS_MANAGE)
    target = next((o for o in store.query("organisations") if o.data.get("codeHash") == sha256((code or "").strip().upper())), None)
    if not target:
        raise NotFound("No organisation matches that code.")
    oid = target.id
    link = store.get(f"organisations/{oid}/households/{hid}")
    if link and link.data.get("status") == "active":
        raise Conflict("This organisation is already connected.")
    h = store.get(f"households/{hid}").data
    store.set(f"organisations/{oid}/households/{hid}", {"householdId": hid, "householdName": h["name"], "linkedAt": now(),
                                                        "linkedBy": actor.uid, "status": "active"})
    store.update(f"households/{hid}", {"organisationIds": sorted(set((h.get("organisationIds") or []) + [oid]))})
    for m in store.query(f"organisations/{oid}/members"):
        if m.data["role"] == "org_admin" and m.data.get("status") == "active":
            _grant(store, hid, m.data, Role.ORG_ADMIN, "all", oid, actor)
    audit.record(store, hid, actor, "org.connect", "organisation", oid, f"Connected care organisation '{target.data['name']}'")
    return {"organisationId": oid, "name": target.data["name"]}


def _grant(store: Store, hid: str, m: dict, role: Role, scope, oid: str, actor: CurrentUser) -> None:
    path = f"households/{hid}/members/{m['uid']}"
    cur = store.get(path)
    if cur and cur.data.get("status") == "active" and not cur.data.get("viaOrg"):
        return  # already a direct member — never downgrade or override a family-granted role
    store.set(path, {"uid": m["uid"], "householdId": hid, "role": role.value, "status": "active", "seniorScope": scope,
                     "linkedSeniorId": None, "expiresAt": None, "displayName": m["displayName"], "email": m["email"],
                     "invitedBy": actor.uid, "viaOrg": oid, "joinedAt": now(), "updatedAt": now()})
    if not (cur and cur.data.get("status") == "active"):
        households.bump(store, hid, "memberCount", 1)


def disconnect(store: Store, actor: CurrentUser, hid: str, oid: str) -> None:
    authorize(store, actor.uid, hid, P.MEMBERS_MANAGE)
    link = store.get(f"organisations/{oid}/households/{hid}")
    if not link or link.data.get("status") != "active":
        raise NotFound("This organisation isn't connected.")
    store.update(link.path, {"status": "revoked", "revokedAt": now()})
    n = 0
    for m in store.query(f"households/{hid}/members"):
        if m.data.get("viaOrg") == oid and m.data.get("status") == "active":
            store.update(m.path, {"status": "revoked", "revokedAt": now(), "revokedBy": actor.uid})
            n += 1
    households.bump(store, hid, "memberCount", -n)
    audit.record(store, hid, actor, "org.disconnect", "organisation", oid, f"Disconnected a care organisation ({n} staff access removed)")


def assign_caregiver(store: Store, actor: CurrentUser, oid: str, hid: str, uid: str, role: str, scope) -> dict:
    _require_admin(store, oid, actor.uid)
    link = store.get(f"organisations/{oid}/households/{hid}")
    if not link or link.data.get("status") != "active":
        raise NotFound("This household isn't connected to your organisation.")
    authorize(store, actor.uid, hid)  # the org admin's own (org-granted) household membership must be active
    staff = _org_member(store, oid, uid)
    r = Role(role)
    if r not in (Role.PRIMARY_CAREGIVER, Role.SECONDARY_CAREGIVER):
        raise ValidationFailed("Organisation staff can be placed as primary or secondary caregivers.")
    scope, _ = validate_scope(store, hid, r, scope, None)
    _grant(store, hid, staff, r, scope, oid, actor)
    audit.record(store, hid, actor, "org.assign", "member", uid, f"Organisation assigned {staff['displayName']} as {r.value.replace('_', ' ')}")
    notifications.notify(store, uid, "org_assignment", "New client household", f"You've been assigned to {link.data['householdName']}.",
                         "/app", f"org-assign:{oid}:{hid}:{uid}:{now().isoformat()[:13]}", hid)
    return {"householdId": hid, "uid": uid, "role": r.value, "seniorScope": scope}


def dashboard(store: Store, actor: CurrentUser, oid: str) -> dict:
    _require_admin(store, oid, actor.uid)
    rows, staff_load = [], {}
    for link in store.query(f"organisations/{oid}/households"):
        if link.data.get("status") != "active":
            continue
        hid = link.id
        try:
            acc = Access(store, actor.uid, hid)
        except (Forbidden, NotFound):  # org admin access removed by the household
            continue
        gaps = detect_gaps(store, actor, hid)["counts"]
        load, tasks_ = _load_by_member(store, acc, 30)
        rows.append({"householdId": hid, "householdName": link.data["householdName"], "profiles": len(acc.visible_senior_ids()),
                     "openTasks": sum(1 for _, x in tasks_ if x["status"] in ("open", "assigned", "accepted")),
                     "unassignedTasks": sum(1 for _, x in tasks_ if x["status"] == "open"), "gaps": gaps})
        org_staff = {m.id for m in store.query(f"organisations/{oid}/members") if m.data.get("status") == "active"}
        for uid, r in load.items():
            if uid in org_staff:
                s = staff_load.setdefault(uid, {"uid": uid, "displayName": r["displayName"], "households": 0, "currentLoad": 0, "completed30d": 0})
                s["households"] += 1
                s["currentLoad"] += r["currentLoad"]
                s["completed30d"] += r["completed"]
    return {"households": sorted(rows, key=lambda r: (-(r["gaps"]["high"]), r["householdName"])),
            "staff": sorted(staff_load.values(), key=lambda s: s["displayName"].lower()),
            "totals": {"households": len(rows), "profiles": sum(r["profiles"] for r in rows),
                       "highGaps": sum(r["gaps"]["high"] for r in rows), "openTasks": sum(r["openTasks"] for r in rows)}}
