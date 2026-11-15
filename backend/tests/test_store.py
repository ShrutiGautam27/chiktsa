"""Contract tests for the Store abstraction (MemoryStore; FirestoreStore shares the contract)."""
from datetime import UTC, datetime

from app.db import Filter
from app.db.memory import MemoryStore


def test_query_only_returns_direct_children():
    s = MemoryStore()
    s.set("households/h1", {"n": 1})
    s.set("households/h1/members/u1", {"uid": "u1", "status": "active"})
    s.set("households/h2/members/u1", {"uid": "u1", "status": "revoked"})
    s.set("households/h1/seniors/s1/medications/m1", {"x": 1})
    assert [d.id for d in s.query("households")] == ["h1"]
    assert [d.id for d in s.query("households/h1/members")] == ["u1"]
    assert len(s.collection_group("members", [Filter("uid", "==", "u1")])) == 2
    assert len(s.collection_group("members", [Filter("status", "==", "active")])) == 1


def test_ordering_limit_and_persistence(tmp_path):
    p = tmp_path / "store.json"
    s = MemoryStore(str(p))
    for i in range(5):
        s.set(f"c/d{i}", {"i": i, "at": datetime(2026, 1, i + 1, tzinfo=UTC)})
    assert [d.data["i"] for d in s.query("c", order_by="at", descending=True, limit=2)] == [4, 3]
    s2 = MemoryStore(str(p))
    assert s2.get("c/d3").data["at"] == datetime(2026, 1, 4, tzinfo=UTC)


def test_returned_data_is_a_copy():
    s = MemoryStore()
    s.set("c/d", {"list": [1]})
    s.get("c/d").data["list"].append(2)
    assert s.get("c/d").data["list"] == [1]
