from datetime import timedelta

import jwt

from app.config import get_settings
from app.core.ratelimit import limiter
from app.core.timeutil import now
from tests.conftest import PASSWORD


def signup(client, email="asha@example.com", password=PASSWORD, name="Asha"):
    return client.post("/api/auth/signup", json={"email": email, "password": password, "displayName": name})


def test_signup_returns_token_and_sets_httponly_refresh_cookie(client):
    r = signup(client)
    assert r.status_code == 201
    body = r.json()
    assert body["accessToken"] and body["user"]["email"] == "asha@example.com"
    cookie = r.headers["set-cookie"]
    assert "carehub_refresh=" in cookie and "HttpOnly" in cookie and "SameSite=strict" in cookie
    assert "Path=/api/auth" in cookie


def test_signup_rejects_weak_password_and_duplicate_email(client):
    assert signup(client, password="short").status_code == 422
    assert signup(client, password="lettersonlyxx").status_code == 422
    assert signup(client).status_code == 201
    r = signup(client, email="ASHA@example.com")
    assert r.status_code == 409 and r.json()["error"]["code"] == "email_taken"


def test_password_is_never_stored_in_plaintext(client, store):
    uid = signup(client).json()["user"]["uid"]
    cred = store.get(f"authCredentials/{uid}").data
    assert PASSWORD not in str(cred) and cred["passwordHash"].startswith("scrypt$")
    assert "passwordHash" not in store.get(f"users/{uid}").data


def test_login_success_and_generic_failure(client):
    signup(client)
    assert client.post("/api/auth/login", json={"email": "asha@example.com", "password": PASSWORD}).status_code == 200
    bad = client.post("/api/auth/login", json={"email": "asha@example.com", "password": "Wrong12345"})
    unknown = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "Wrong12345"})
    assert bad.status_code == unknown.status_code == 401
    assert bad.json()["error"]["message"] == unknown.json()["error"]["message"]  # no user enumeration


def test_protected_route_requires_valid_token(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Bearer garbage"}).status_code == 401
    forged = jwt.encode({"sub": "x", "typ": "access", "iss": "carehub-local", "exp": now() + timedelta(minutes=5)},
                        "wrong-secret", algorithm="HS256")
    assert client.get("/api/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_expired_token_rejected(client):
    uid = signup(client).json()["user"]["uid"]
    expired = jwt.encode({"sub": uid, "typ": "access", "iss": "carehub-local", "exp": now() - timedelta(seconds=1)},
                         get_settings().jwt_secret, algorithm="HS256")
    r = client.get("/api/me", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "token_expired"


def test_refresh_rotates_and_detects_reuse(client, store):
    r = signup(client)
    uid = r.json()["user"]["uid"]
    old_cookie = r.cookies.get("carehub_refresh")
    r2 = client.post("/api/auth/refresh")
    assert r2.status_code == 200 and r2.json()["accessToken"]
    new_cookie = r2.cookies.get("carehub_refresh")
    assert new_cookie and new_cookie != old_cookie
    # Concurrent refresh with the just-rotated token (second tab / StrictMode) is tolerated briefly.
    client.cookies.set("carehub_refresh", old_cookie, path="/api/auth")
    assert client.post("/api/auth/refresh").status_code == 200
    # After the grace window, replaying the rotated token is treated as theft: all sessions revoked.
    tokens = store.get(f"authCredentials/{uid}").data["refreshTokens"]
    for t in tokens:
        if t.get("rotatedAt"):
            t["rotatedAt"] = now() - timedelta(minutes=5)
    store.update(f"authCredentials/{uid}", {"refreshTokens": tokens})
    client.cookies.set("carehub_refresh", old_cookie, path="/api/auth")
    assert client.post("/api/auth/refresh").status_code == 401
    client.cookies.set("carehub_refresh", new_cookie, path="/api/auth")
    assert client.post("/api/auth/refresh").status_code == 401


def test_logout_revokes_refresh_token(client):
    r = signup(client)
    raw = r.cookies.get("carehub_refresh")
    assert client.post("/api/auth/logout").status_code == 204
    client.cookies.set("carehub_refresh", raw, path="/api/auth")
    assert client.post("/api/auth/refresh").status_code == 401


def test_rate_limit_on_login(client, monkeypatch):
    limiter.reset()
    monkeypatch.setattr(get_settings(), "auth_rate_limit", 3)
    codes = [client.post("/api/auth/login", json={"email": "a@example.com", "password": "x"}).status_code
             for _ in range(5)]
    assert codes[:3] == [401, 401, 401] and codes[3:] == [429, 429]


def test_profile_update_and_validation(make_actor):
    a = make_actor("Asha")
    r = a.patch("/api/me", json={"timezone": "Europe/London", "accessibility": {"fontScale": 1.25,
                                                                                "highContrast": True}})
    assert r.status_code == 200
    assert r.json()["timezone"] == "Europe/London" and r.json()["accessibility"]["fontScale"] == 1.25
    assert a.patch("/api/me", json={"timezone": "Mars/Base"}).status_code == 422
    assert a.patch("/api/me", json={"accessibility": {"fontScale": 9}}).status_code == 422


def test_production_refuses_insecure_config():
    from app.config import Settings
    import pytest

    with pytest.raises(RuntimeError):
        Settings(environment="production", data_store="firestore").validate_for_production()
    with pytest.raises(RuntimeError):
        Settings(environment="production", jwt_secret="x" * 40, data_store="memory").validate_for_production()
