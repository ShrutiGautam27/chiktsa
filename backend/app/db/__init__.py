"""Store factory. The active store is created once per process and can be overridden in tests."""
from __future__ import annotations

from ..config import get_settings
from .store import Doc, Filter, Store

_store: Store | None = None


def get_store() -> Store:
    global _store
    if _store is None:
        s = get_settings()
        if s.data_store == "firestore":
            from .firestore import FirestoreStore

            _store = FirestoreStore(s.firebase_project_id)
        else:
            from .memory import MemoryStore

            path = None if s.environment == "test" else s.memory_store_path
            _store = MemoryStore(path)
    return _store


def set_store(store: Store | None) -> None:
    global _store
    _store = store


__all__ = ["Doc", "Filter", "Store", "get_store", "set_store"]
