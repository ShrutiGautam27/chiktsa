import os

os.environ["ENVIRONMENT"] = "test"
os.environ["AUTH_PROVIDER"] = "local"
os.environ["DATA_STORE"] = "memory"
os.environ["AUTH_RATE_LIMIT"] = "1000"
os.environ["RUN_SCHEDULER_IN_PROCESS"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.ratelimit import limiter  # noqa: E402
from app.db import set_store  # noqa: E402
from app.db.memory import MemoryStore  # noqa: E402
from app.main import app  # noqa: E402

PASSWORD = "CorrectHorse42"


USE_FIRESTORE = os.environ.get("CAREHUB_TEST_STORE") == "firestore" or (
    bool(os.environ.get("FIRESTORE_EMULATOR_HOST")) and os.environ.get("CAREHUB_TEST_STORE") != "memory")
EMULATOR_PROJECT = "demo-carehub"


def _clear_firestore_emulator() -> None:
    import httpx

    host = os.environ["FIRESTORE_EMULATOR_HOST"]
    httpx.delete(f"http://{host}/emulator/v1/projects/{EMULATOR_PROJECT}/databases/(default)/documents",
                 timeout=10).raise_for_status()


@pytest.fixture()
def store():
    """MemoryStore by default. With CAREHUB_TEST_STORE=firestore (+ FIRESTORE_EMULATOR_HOST), the
    whole suite runs against the real Firestore emulator — proving production-store parity."""
    if USE_FIRESTORE:
        from app.db.firestore import FirestoreStore

        _clear_firestore_emulator()
        s = FirestoreStore(EMULATOR_PROJECT)
    else:
        s = MemoryStore()
    set_store(s)
    limiter.reset()
    yield s
    set_store(None)


@pytest.fixture()
def client(store):
    with TestClient(app) as c:
        yield c


class Actor:
    """A signed-in test user with an Authorization header."""

    def __init__(self, client: TestClient, name: str):
        self.client = client
        self.email = f"{name.lower()}@example.com"
        r = client.post("/api/auth/signup", json={"email": self.email, "password": PASSWORD, "displayName": name})
        assert r.status_code == 201, r.text
        body = r.json()
        self.uid = body["user"]["uid"]
        self.headers = {"Authorization": f"Bearer {body['accessToken']}"}

    def get(self, url, **kw):
        return self.client.get(url, headers=self.headers, **kw)

    def post(self, url, **kw):
        return self.client.post(url, headers=self.headers, **kw)

    def patch(self, url, **kw):
        return self.client.patch(url, headers=self.headers, **kw)

    def put(self, url, **kw):
        return self.client.put(url, headers=self.headers, **kw)

    def delete(self, url, **kw):
        return self.client.delete(url, headers=self.headers, **kw)

    # helpers
    def create_household(self, name="Sharma Family"):
        r = self.post("/api/households", json={"name": name, "timezone": "Asia/Kolkata"})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def add_senior(self, hid, name):
        r = self.post(f"/api/households/{hid}/seniors", json={"fullName": name, "dateOfBirth": "1946-03-12"})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def invite(self, hid, other: "Actor", role, scope="all", linked=None):
        body = {"email": other.email, "role": role, "seniorScope": scope}
        if linked:
            body["linkedSeniorId"] = linked
        r = self.post(f"/api/households/{hid}/invitations", json=body)
        assert r.status_code == 201, r.text
        token = r.json()["token"]
        r2 = other.post(f"/api/invitations/{token}/accept")
        assert r2.status_code == 200, r2.text
        return token


@pytest.fixture()
def make_actor(client):
    return lambda name: Actor(client, name)


# Monday 16 Nov 2026, 10:00 in Asia/Kolkata (04:30 UTC) — households default to Asia/Kolkata.
from datetime import UTC, datetime  # noqa: E402

from app.core import timeutil  # noqa: E402

FROZEN = datetime(2026, 11, 16, 4, 30, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _reset_clock():
    yield
    timeutil.set_clock(None)


@pytest.fixture()
def clock():
    """Freeze time; call clock(dt) to move it."""
    timeutil.set_clock(FROZEN)
    return timeutil.set_clock


def iso(dt):
    return dt.isoformat()
