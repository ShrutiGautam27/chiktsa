from ..core.errors import Conflict, NotFound, Unauthorized
from ..core.passwords import hash_password, verify_password
from ..core.rbac import ROLE_LABELS, Membership, Role
from ..core.timeutil import now
from ..db import Doc, Filter, Store
from .ids import new_id

DEFAULT_A11Y = {"fontScale": 1.0, "highContrast": False, "simplifiedNav": False, "voiceRate": 1.0,
                "reduceMotion": False}
# Dummy hash so unknown-email logins take as long as real ones (no user enumeration by timing).
_DUMMY_HASH = hash_password("timing-equaliser-not-a-real-password-1")


def user_out(d: Doc) -> dict:
    x = d.data
    return {"uid": d.id, "email": x["email"], "displayName": x.get("displayName", ""),
            "timezone": x.get("timezone", "Asia/Kolkata"), "locale": x.get("locale", "en"),
            "platformRole": x.get("platformRole", "user"),
            "accessibility": {**DEFAULT_A11Y, **x.get("accessibility", {})}}


def find_by_email(store: Store, email: str) -> Doc | None:
    docs = store.query("users", [Filter("emailLower", "==", email.lower())], limit=1)
    return docs[0] if docs else None


def create_user_profile(store: Store, uid: str, email: str, display_name: str, timezone: str = "Asia/Kolkata",
                        locale: str = "en") -> Doc:
    t = now()
    return store.set(f"users/{uid}", {
        "email": email, "emailLower": email.lower(), "displayName": display_name or email.split("@")[0],
        "timezone": timezone, "locale": locale, "platformRole": "user", "accessibility": dict(DEFAULT_A11Y),
        "createdAt": t, "updatedAt": t,
    })


def signup_local(store: Store, email: str, password: str, display_name: str, timezone: str, locale: str) -> Doc:
    if find_by_email(store, email):
        raise Conflict("An account with this email already exists.", code="email_taken")
    uid = new_id()
    store.set(f"authCredentials/{uid}", {"passwordHash": hash_password(password), "refreshTokens": []})
    return create_user_profile(store, uid, email, display_name, timezone, locale)


def login_local(store: Store, email: str, password: str) -> Doc:
    user = find_by_email(store, email)
    cred = store.get(f"authCredentials/{user.id}") if user else None
    ok = verify_password(password, cred.data["passwordHash"] if cred else _DUMMY_HASH)
    if not (user and cred and ok):
        raise Unauthorized("Incorrect email or password.", code="invalid_credentials")
    return user


def update_profile(store: Store, uid: str, changes: dict) -> Doc:
    if not store.get(f"users/{uid}"):
        raise NotFound("User not found.")
    changes = {k: v for k, v in changes.items() if v is not None}
    changes["updatedAt"] = now()
    return store.update(f"users/{uid}", changes)


def memberships_for(store: Store, uid: str) -> list[Membership]:
    """All active memberships of a user across households (collection-group query, indexed)."""
    docs = store.collection_group("members", [Filter("uid", "==", uid), Filter("status", "==", "active")])
    out = []
    for d in docs:
        if not d.path.startswith("households/"):
            continue  # organisation members share the subcollection name
        m = Membership.from_doc(d.data)
        if m.is_active:
            out.append(m)
    return out


def effective_scope(m: Membership) -> str | list[str]:
    if m.role == Role.SENIOR:
        return [m.linked_senior_id] if m.linked_senior_id else []
    return m.senior_scope


def membership_summary(store: Store, m: Membership) -> dict:
    h = store.get(f"households/{m.household_id}")
    return {"householdId": m.household_id, "householdName": h.data["name"] if h else "",
            "role": m.role.value, "roleLabel": ROLE_LABELS[m.role], "seniorScope": effective_scope(m),
            "linkedSeniorId": m.linked_senior_id, "permissions": sorted(p.value for p in m.permissions)}
