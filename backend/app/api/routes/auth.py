"""Local-mode authentication endpoints (disabled when AUTH_PROVIDER=firebase)."""
from fastapi import APIRouter, Depends, Request, Response

from ...config import get_settings
from ...core import auth
from ...core.errors import NotFound, Unauthorized
from ...db import Store, get_store
from ...schemas.auth import LoginRequest, SignupRequest, TokenResponse
from ...services import users

router = APIRouter(prefix="/auth", tags=["auth"])
COOKIE = "carehub_refresh"


def _local_only() -> None:
    if get_settings().auth_provider != "local":
        raise NotFound("Local authentication is disabled; sign in with Firebase.")


def _set_cookie(resp: Response, value: str) -> None:
    s = get_settings()
    resp.set_cookie(COOKIE, value, max_age=s.refresh_token_days * 86400, httponly=True, secure=s.cookie_secure,
                    samesite="strict", path="/api/auth")


def _session(store: Store, resp: Response, user_doc) -> dict:
    _set_cookie(resp, auth.issue_refresh_token(store, user_doc.id))
    return {"accessToken": auth.issue_access_token(user_doc.id, user_doc.data["email"]),
            "expiresIn": get_settings().access_token_minutes * 60, "user": users.user_out(user_doc)}


@router.get("/config")
def auth_config() -> dict:
    s = get_settings()
    return {"provider": s.auth_provider, "demo": s.environment == "demo"}


@router.post("/signup", response_model=TokenResponse, status_code=201, dependencies=[Depends(_local_only)])
def signup(body: SignupRequest, response: Response, store: Store = Depends(get_store)):
    doc = users.signup_local(store, body.email, body.password, body.displayName, body.timezone, body.locale)
    return _session(store, response, doc)


@router.post("/login", response_model=TokenResponse, dependencies=[Depends(_local_only)])
def login(body: LoginRequest, response: Response, store: Store = Depends(get_store)):
    return _session(store, response, users.login_local(store, body.email, body.password))


@router.post("/refresh", response_model=TokenResponse, dependencies=[Depends(_local_only)])
def refresh(request: Request, response: Response, store: Store = Depends(get_store)):
    raw = request.cookies.get(COOKIE)
    if not raw:
        raise Unauthorized("No active session.", code="no_session")
    try:
        uid, new_raw = auth.rotate_refresh_token(store, raw)
    except Unauthorized:
        response.delete_cookie(COOKIE, path="/api/auth")
        raise
    doc = store.get(f"users/{uid}")
    if not doc:
        raise Unauthorized("User no longer exists.")
    _set_cookie(response, new_raw)
    return {"accessToken": auth.issue_access_token(uid, doc.data["email"]),
            "expiresIn": get_settings().access_token_minutes * 60, "user": users.user_out(doc)}


@router.post("/logout", status_code=204, dependencies=[Depends(_local_only)])
def logout(request: Request, response: Response, store: Store = Depends(get_store)):
    raw = request.cookies.get(COOKIE)
    if raw:
        auth.revoke_refresh_token(store, raw)
    response.delete_cookie(COOKIE, path="/api/auth")
    response.status_code = 204
    return response
