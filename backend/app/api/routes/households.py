"""Household-scoped routes: households, members, invitations, seniors, audit.

Routes are deliberately thin — authorisation and validation live in the service layer.
"""
from fastapi import APIRouter, Depends, Query, Response

from ...core.auth import CurrentUser, get_current_user
from ...core.rbac import P, authorize
from ...db import Store, get_store
from ...schemas.households import (AuditLogOut, HouseholdCreate, HouseholdOut, HouseholdUpdate, InvitationCreate,
                                   InvitationOut, MemberOut, MemberUpdate)
from ...schemas.seniors import SeniorCreate, SeniorOut, SeniorUpdate
from ...services import audit, households, invitations, members, seniors

router = APIRouter(tags=["households"])
Actor = Depends(get_current_user)
DB = Depends(get_store)


# ---- households
@router.get("/households", response_model=list[HouseholdOut])
def list_households(actor: CurrentUser = Actor, store: Store = DB):
    return households.list_mine(store, actor)


@router.post("/households", response_model=HouseholdOut, status_code=201)
def create_household(body: HouseholdCreate, actor: CurrentUser = Actor, store: Store = DB):
    return households.create(store, actor, body.name, body.timezone)


@router.get("/households/{hid}", response_model=HouseholdOut)
def get_household(hid: str, actor: CurrentUser = Actor, store: Store = DB):
    return households.get(store, actor, hid)


@router.patch("/households/{hid}", response_model=HouseholdOut)
def update_household(hid: str, body: HouseholdUpdate, actor: CurrentUser = Actor, store: Store = DB):
    return households.update(store, actor, hid, body.model_dump(exclude_none=True))


@router.get("/households/{hid}/audit", response_model=list[AuditLogOut])
def get_audit(hid: str, seniorId: str | None = None, targetType: str | None = None, actorUid: str | None = None,
              limit: int = Query(100, le=500), actor: CurrentUser = Actor, store: Store = DB):
    """Care Change Detective: what changed, when, who changed it, who approved it, previous → current."""
    authorize(store, actor.uid, hid, P.AUDIT_READ, senior_id=seniorId)
    logs = audit.list_logs(store, hid, seniorId, 500 if (targetType or actorUid) else limit)
    if targetType:
        logs = [l for l in logs if l["targetType"] == targetType]
    if actorUid:
        logs = [l for l in logs if l["actorUid"] == actorUid]
    return logs[:limit]


# ---- members
@router.get("/households/{hid}/members", response_model=list[MemberOut])
def list_members(hid: str, actor: CurrentUser = Actor, store: Store = DB):
    return members.list_members(store, actor, hid)


@router.patch("/households/{hid}/members/{uid}", response_model=MemberOut)
def update_member(hid: str, uid: str, body: MemberUpdate, actor: CurrentUser = Actor, store: Store = DB):
    return members.update_member(store, actor, hid, uid, body.model_dump(exclude_unset=True))


@router.delete("/households/{hid}/members/{uid}", status_code=204)
def remove_member(hid: str, uid: str, actor: CurrentUser = Actor, store: Store = DB):
    members.remove_member(store, actor, hid, uid)
    return Response(status_code=204)


# ---- invitations
@router.get("/households/{hid}/invitations", response_model=list[InvitationOut])
def list_invitations(hid: str, actor: CurrentUser = Actor, store: Store = DB):
    return invitations.list_for_household(store, actor, hid)


@router.post("/households/{hid}/invitations", response_model=InvitationOut, status_code=201)
def create_invitation(hid: str, body: InvitationCreate, actor: CurrentUser = Actor, store: Store = DB):
    return invitations.create(store, actor, hid, body.model_dump())


@router.delete("/households/{hid}/invitations/{inv_id}", status_code=204)
def revoke_invitation(hid: str, inv_id: str, actor: CurrentUser = Actor, store: Store = DB):
    invitations.revoke(store, actor, hid, inv_id)
    return Response(status_code=204)


@router.get("/invitations/{token}", response_model=InvitationOut)
def preview_invitation(token: str, actor: CurrentUser = Actor, store: Store = DB):
    return invitations.preview_by_token(store, actor, token)


@router.post("/invitations/{token}/accept")
def accept_invitation(token: str, actor: CurrentUser = Actor, store: Store = DB):
    return invitations.accept_by_token(store, actor, token)


# ---- seniors
@router.get("/households/{hid}/seniors", response_model=list[SeniorOut])
def list_seniors(hid: str, includeArchived: bool = False, actor: CurrentUser = Actor, store: Store = DB):
    return seniors.list_seniors(store, actor, hid, includeArchived)


@router.post("/households/{hid}/seniors", response_model=SeniorOut, status_code=201)
def create_senior(hid: str, body: SeniorCreate, actor: CurrentUser = Actor, store: Store = DB):
    return seniors.create(store, actor, hid, body.model_dump(mode="json"))


@router.get("/households/{hid}/seniors/{sid}", response_model=SeniorOut)
def get_senior(hid: str, sid: str, actor: CurrentUser = Actor, store: Store = DB):
    return seniors.get(store, actor, hid, sid)


@router.patch("/households/{hid}/seniors/{sid}", response_model=SeniorOut)
def update_senior(hid: str, sid: str, body: SeniorUpdate, actor: CurrentUser = Actor, store: Store = DB):
    return seniors.update(store, actor, hid, sid, body.model_dump(mode="json", exclude_unset=True))


@router.delete("/households/{hid}/seniors/{sid}", status_code=204)
def archive_senior(hid: str, sid: str, actor: CurrentUser = Actor, store: Store = DB):
    seniors.archive(store, actor, hid, sid)
    return Response(status_code=204)
