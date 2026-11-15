"""Authentication: token issuing (local mode) and verification (local | firebase).

Local mode is for development and demos. Production should use AUTH_PROVIDER=firebase, in which
case the SPA signs in with the Firebase JS SDK and sends a Firebase ID token.
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from fastapi import Depends, Request

from ..config import get_settings
from ..db import Store, get_store
from .errors import Unauthorized
from .passwords import sha256
from .timeutil import aware


def now() -> datetime:
    """Security tokens always use the real wall clock (never the test/simulation clock)."""
    return datetime.now(UTC)

ALGO = "HS256"
ISSUER = "carehub-local"


@dataclass
class CurrentUser:
    uid: str
    email: str
    display_name: str
    platform_role: str = "user"


# ---------------------------------------------------------------- local tokens
def issue_access_token(uid: str, email: str) -> str:
    s = get_settings()
    t = now()
    payload = {"sub": uid, "email": email, "typ": "access", "iss": ISSUER, "iat": t,
               "exp": t + timedelta(minutes=s.access_token_minutes), "jti": secrets.token_hex(8)}
    return jwt.encode(payload, s.jwt_secret, algorithm=ALGO)


def _verify_local(token: str) -> dict[str, Any]:
    try:
        claims = jwt.decode(token, get_settings().jwt_secret, algorithms=[ALGO], issuer=ISSUER,
                            options={"require": ["exp", "sub", "iss"]})
    except jwt.ExpiredSignatureError as e:
        raise Unauthorized("Session expired.", code="token_expired") from e
    except jwt.PyJWTError as e:
        raise Unauthorized("Invalid token.") from e
    if claims.get("typ") != "access":
        raise Unauthorized("Invalid token type.")
    return claims


# Public demo (serverless, per-instance memory): a refresh token stored on one instance would be
# unknown to the next, so demo refresh tokens are signed and stateless instead. They expire, are
# HttpOnly cookies and are bound to an existing user, but lack server-side rotation/reuse
# detection, which production (shared Firestore store) keeps.
DEMO_PREFIX = "demo."


def _demo_refresh(uid: str) -> str:
    s = get_settings()
    t = now()
    return DEMO_PREFIX + jwt.encode({"sub": uid, "typ": "refresh", "iss": ISSUER, "iat": t,
                                     "exp": t + timedelta(days=1), "jti": secrets.token_hex(8)},
                                    s.jwt_secret, algorithm=ALGO)


def issue_refresh_token(store: Store, uid: str) -> str:
    """Create an opaque refresh token; only its hash is stored. Format: `<uid>.<secret>`."""
    s = get_settings()
    if s.environment == "demo":
        return _demo_refresh(uid)
    secret = secrets.token_urlsafe(32)
    cred = store.get(f"authCredentials/{uid}")
    t = now()
    kept = [x for x in (cred.data.get("refreshTokens", []) if cred else [])
            if aware(x["expiresAt"]) > t
            and (x.get("rotatedAt") is None or t - aware(x["rotatedAt"]) <= ROTATION_GRACE)]
    active = [x for x in kept if x.get("rotatedAt") is None][-9:]  # cap active sessions at 10
    grace = [x for x in kept if x.get("rotatedAt") is not None]
    active.append({"hash": sha256(secret), "expiresAt": t + timedelta(days=s.refresh_token_days), "rotatedAt": None})
    store.update(f"authCredentials/{uid}", {"refreshTokens": grace + active})
    return f"{uid}.{secret}"


# A just-rotated token stays usable briefly so concurrent refreshes (two tabs, React StrictMode)
# don't trip reuse detection. Replays after this window are treated as theft.
ROTATION_GRACE = timedelta(seconds=30)


def rotate_refresh_token(store: Store, raw: str) -> tuple[str, str]:
    """Validate and rotate. Replaying a rotated token after the grace window, or presenting an
    unknown token, revokes every session for the user (token-theft signal)."""
    if raw.startswith(DEMO_PREFIX):
        if get_settings().environment != "demo":
            raise Unauthorized("Invalid session.")
        try:
            claims = jwt.decode(raw[len(DEMO_PREFIX):], get_settings().jwt_secret, algorithms=[ALGO],
                                issuer=ISSUER, options={"require": ["exp", "sub", "iss"]})
        except jwt.PyJWTError as e:
            raise Unauthorized("Session expired. Please sign in again.") from e
        if claims.get("typ") != "refresh" or not store.get(f"users/{claims['sub']}"):
            raise Unauthorized("Invalid session.")
        return claims["sub"], _demo_refresh(claims["sub"])
    try:
        uid, secret = raw.split(".", 1)
    except ValueError as e:
        raise Unauthorized("Invalid session.") from e
    cred = store.get(f"authCredentials/{uid}")
    if not cred:
        raise Unauthorized("Invalid session.")
    h = sha256(secret)
    tokens = cred.data.get("refreshTokens", [])
    match = next((t for t in tokens if t["hash"] == h), None)
    if match is None:
        store.update(f"authCredentials/{uid}", {"refreshTokens": []})
        raise Unauthorized("Session no longer valid. Please sign in again.")
    if aware(match["expiresAt"]) <= now():
        raise Unauthorized("Session expired. Please sign in again.")
    if match.get("rotatedAt") is not None:
        if now() - aware(match["rotatedAt"]) > ROTATION_GRACE:
            store.update(f"authCredentials/{uid}", {"refreshTokens": []})
            raise Unauthorized("Session no longer valid. Please sign in again.")
        return uid, issue_refresh_token(store, uid)  # concurrent refresh within grace window
    store.update(f"authCredentials/{uid}", {"refreshTokens": [
        {**t, "rotatedAt": now()} if t["hash"] == h else t for t in tokens]})
    return uid, issue_refresh_token(store, uid)


def revoke_refresh_token(store: Store, raw: str) -> None:
    if raw.startswith(DEMO_PREFIX):
        return  # stateless demo token: logout clears the cookie
    try:
        uid, secret = raw.split(".", 1)
    except ValueError:
        return
    cred = store.get(f"authCredentials/{uid}")
    if cred:
        h = sha256(secret)
        store.update(f"authCredentials/{uid}",
                     {"refreshTokens": [t for t in cred.data.get("refreshTokens", []) if t["hash"] != h]})


# ---------------------------------------------------------------- firebase
def _verify_firebase(token: str) -> dict[str, Any]:  # exercised against the Auth emulator in tests
    try:
        import firebase_admin
        from firebase_admin import auth as fb_auth

        if not firebase_admin._apps:
            # Honours FIREBASE_AUTH_EMULATOR_HOST automatically (local emulator testing).
            firebase_admin.initialize_app(options={"projectId": get_settings().firebase_project_id})
        claims = fb_auth.verify_id_token(token, check_revoked=True)
    except Exception as e:  # noqa: BLE001 - surface as 401, never leak details
        raise Unauthorized("Invalid or expired Firebase token.") from e
    return {"sub": claims["uid"], "email": claims.get("email", ""), "name": claims.get("name", "")}


# ---------------------------------------------------------------- dependency
def get_current_user(request: Request, store: Store = Depends(get_store)) -> CurrentUser:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise Unauthorized("Missing bearer token.")
    token = header[7:].strip()
    claims = _verify_firebase(token) if get_settings().auth_provider == "firebase" else _verify_local(token)
    uid = claims["sub"]
    user = store.get(f"users/{uid}")
    if user is None:
        if get_settings().auth_provider != "firebase":
            raise Unauthorized("User no longer exists.")
        # First request from a Firebase user: provision their profile record.
        from ..services.users import create_user_profile

        user = create_user_profile(store, uid, claims.get("email", ""), claims.get("name") or "")
    d = user.data
    if d.get("disabled"):
        raise Unauthorized("Account disabled.")
    return CurrentUser(uid=uid, email=d["email"], display_name=d.get("displayName", ""),
                       platform_role=d.get("platformRole", "user"))
