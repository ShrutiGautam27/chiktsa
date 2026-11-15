from fastapi import APIRouter, Depends

from ...core.auth import CurrentUser, get_current_user
from ...db import Store, get_store
from ...schemas.households import InvitationOut
from ...schemas.users import MeOut, UserOut, UserUpdate
from ...services import invitations, users

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=MeOut)
def me(actor: CurrentUser = Depends(get_current_user), store: Store = Depends(get_store)):
    doc = store.get(f"users/{actor.uid}")
    ms = [users.membership_summary(store, m) for m in users.memberships_for(store, actor.uid)]
    return {"user": users.user_out(doc), "memberships": sorted(ms, key=lambda x: x["householdName"].lower())}


@router.patch("", response_model=UserOut)
def update_me(body: UserUpdate, actor: CurrentUser = Depends(get_current_user), store: Store = Depends(get_store)):
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if "accessibility" in changes:  # merge partial accessibility updates with saved preferences
        current = users.user_out(store.get(f"users/{actor.uid}"))["accessibility"]
        changes["accessibility"] = {**current, **changes["accessibility"]}
    return users.user_out(users.update_profile(store, actor.uid, changes))


@router.get("/invitations", response_model=list[InvitationOut])
def my_invitations(actor: CurrentUser = Depends(get_current_user), store: Store = Depends(get_store)):
    return invitations.list_for_me(store, actor)


@router.post("/invitations/{inv_id}/accept")
def accept_my_invitation(inv_id: str, actor: CurrentUser = Depends(get_current_user),
                         store: Store = Depends(get_store)):
    return invitations.accept(store, actor, inv_id)
