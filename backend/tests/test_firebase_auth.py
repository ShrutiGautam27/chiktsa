"""Firebase Authentication integration — runs against the Firebase Auth emulator.

Skipped unless FIREBASE_AUTH_EMULATOR_HOST is set. Run with:
    cd firestore-tests && npm run test:api
"""
import os

import httpx
import pytest

from app.config import get_settings

AUTH_HOST = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST")
pytestmark = pytest.mark.skipif(not AUTH_HOST, reason="Firebase Auth emulator not running")


def firebase_sign_up(email: str, password: str = "CorrectHorse42", name: str = "Test User") -> str:
    """Create a user in the Auth emulator and return a real Firebase ID token."""
    base = f"http://{AUTH_HOST}/identitytoolkit.googleapis.com/v1"
    r = httpx.post(f"{base}/accounts:signUp?key=demo-api-key",
                   json={"email": email, "password": password, "returnSecureToken": True}, timeout=10)
    r.raise_for_status()
    token = r.json()["idToken"]
    httpx.post(f"{base}/accounts:update?key=demo-api-key", json={"idToken": token, "displayName": name},
               timeout=10).raise_for_status()
    # Re-sign-in so the token carries the display name claim.
    r = httpx.post(f"{base}/accounts:signInWithPassword?key=demo-api-key",
                   json={"email": email, "password": password, "returnSecureToken": True}, timeout=10)
    r.raise_for_status()
    return r.json()["idToken"]


@pytest.fixture(autouse=True)
def firebase_mode(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "auth_provider", "firebase")
    monkeypatch.setattr(s, "firebase_project_id", "demo-carehub")
    base = f"http://{AUTH_HOST}/emulator/v1/projects/demo-carehub/accounts"
    httpx.delete(base, timeout=10)
    yield


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_firebase_id_token_provisions_profile(client, store):
    token = firebase_sign_up("asha.fb@example.com", name="Asha FB")
    r = client.get("/api/me", headers=bearer(token))
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email"] == "asha.fb@example.com"
    assert r.json()["user"]["displayName"] == "Asha FB"
    uid = r.json()["user"]["uid"]
    assert store.get(f"users/{uid}") is not None
    assert store.get(f"authCredentials/{uid}") is None  # no passwords stored by Chiktsa in Firebase mode


def test_firebase_mode_rejects_bad_tokens_and_disables_local_auth(client):
    assert client.get("/api/me", headers=bearer("not-a-token")).status_code == 401
    assert client.get("/api/auth/config").json() == {"provider": "firebase"}
    r = client.post("/api/auth/login", json={"email": "a@example.com", "password": "x"})
    assert r.status_code == 404


def test_tenant_isolation_with_firebase_identities(client):
    owner = bearer(firebase_sign_up("owner.fb@example.com", name="Owner"))
    other = bearer(firebase_sign_up("other.fb@example.com", name="Other"))
    hid = client.post("/api/households", json={"name": "FB Household", "timezone": "Asia/Kolkata"},
                      headers=owner).json()["id"]
    sid = client.post(f"/api/households/{hid}/seniors", json={"fullName": "Grandpa"}, headers=owner).json()["id"]
    assert client.get(f"/api/households/{hid}/seniors/{sid}", headers=owner).status_code == 200
    assert client.get(f"/api/households/{hid}/seniors/{sid}", headers=other).status_code == 404
    assert client.get(f"/api/households/{hid}", headers=other).status_code == 404
