from ..core.auth import CurrentUser
from ..core.rbac import P, Role, authorize
from ..core.timeutil import now
from ..db import Store
from . import audit
from .ids import new_id
from .users import memberships_for


def _out(hid: str, data: dict, my_role: str | None) -> dict:
    return {"id": hid, "name": data["name"], "timezone": data["timezone"], "ownerId": data["ownerId"],
            "seniorCount": data.get("seniorCount", 0), "memberCount": data.get("memberCount", 0),
            "myRole": my_role, "createdAt": data.get("createdAt")}


def create(store: Store, actor: CurrentUser, name: str, timezone: str) -> dict:
    hid = new_id()
    t = now()
    house = {"name": name, "timezone": timezone, "ownerId": actor.uid, "seniorCount": 0, "memberCount": 1,
             "createdAt": t, "updatedAt": t}
    member = {"uid": actor.uid, "householdId": hid, "role": Role.HOUSEHOLD_OWNER.value, "status": "active",
              "seniorScope": "all", "linkedSeniorId": None, "expiresAt": None,
              "displayName": actor.display_name, "email": actor.email, "invitedBy": None,
              "joinedAt": t, "updatedAt": t}
    store.transaction_set_many([(f"households/{hid}", house), (f"households/{hid}/members/{actor.uid}", member)])
    audit.record(store, hid, actor, "household.create", "household", hid, f"Created household '{name}'")
    return _out(hid, house, Role.HOUSEHOLD_OWNER.value)


def list_mine(store: Store, actor: CurrentUser) -> list[dict]:
    out = []
    for m in memberships_for(store, actor.uid):
        h = store.get(f"households/{m.household_id}")
        if h:
            out.append(_out(h.id, h.data, m.role.value))
    return sorted(out, key=lambda x: x["name"].lower())


def get(store: Store, actor: CurrentUser, hid: str) -> dict:
    m = authorize(store, actor.uid, hid, P.HOUSEHOLD_READ)
    return _out(hid, store.get(f"households/{hid}").data, m.role.value)


def update(store: Store, actor: CurrentUser, hid: str, changes: dict) -> dict:
    m = authorize(store, actor.uid, hid, P.HOUSEHOLD_MANAGE)
    before = store.get(f"households/{hid}").data
    changes = {k: v for k, v in changes.items() if v is not None}
    after = store.update(f"households/{hid}", {**changes, "updatedAt": now()}).data
    audit.record(store, hid, actor, "household.update", "household", hid, "Updated household details",
                 {k: before.get(k) for k in changes}, {k: after.get(k) for k in changes})
    return _out(hid, after, m.role.value)


def bump(store: Store, hid: str, field: str, delta: int) -> None:
    h = store.get(f"households/{hid}")
    if h:
        store.update(f"households/{hid}", {field: max(0, h.data.get(field, 0) + delta)})
