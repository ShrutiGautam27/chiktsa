"""In-memory Store with optional JSON persistence. DEVELOPMENT AND TESTS ONLY.

Production refuses to start with this store (see Settings.validate_for_production).
"""
from __future__ import annotations

import copy
import json
import os
import threading
from datetime import datetime
from typing import Any

from .store import Doc, Filter, is_collection_path, is_document_path, match


def _json_default(o: Any) -> Any:
    if isinstance(o, datetime):
        return {"__dt__": o.isoformat()}
    raise TypeError(f"Unserialisable: {type(o)}")


def _json_hook(o: dict[str, Any]) -> Any:
    if "__dt__" in o and len(o) == 1:
        return datetime.fromisoformat(o["__dt__"])
    return o


class MemoryStore:
    def __init__(self, persist_path: str | None = None) -> None:
        self._docs: dict[str, dict[str, Any]] = {}
        self._lock = threading.RLock()
        self._persist_path = persist_path
        if persist_path and os.path.exists(persist_path):
            with open(persist_path, encoding="utf-8") as fh:
                self._docs = json.load(fh, object_hook=_json_hook)

    # -- internals -------------------------------------------------------
    def _flush(self) -> None:
        if not self._persist_path:
            return
        os.makedirs(os.path.dirname(self._persist_path) or ".", exist_ok=True)
        tmp = self._persist_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(self._docs, fh, default=_json_default)
        os.replace(tmp, self._persist_path)

    @staticmethod
    def _norm(path: str) -> str:
        return "/".join(p for p in path.split("/") if p)

    # -- API -------------------------------------------------------------
    def get(self, path: str) -> Doc | None:
        path = self._norm(path)
        if not is_document_path(path):
            raise ValueError(f"Not a document path: {path}")
        with self._lock:
            data = self._docs.get(path)
            if data is None:
                return None
            return Doc(id=path.rsplit("/", 1)[-1], path=path, data=copy.deepcopy(data))

    def set(self, path: str, data: dict[str, Any]) -> Doc:
        path = self._norm(path)
        if not is_document_path(path):
            raise ValueError(f"Not a document path: {path}")
        with self._lock:
            self._docs[path] = copy.deepcopy(data)
            self._flush()
        return Doc(id=path.rsplit("/", 1)[-1], path=path, data=copy.deepcopy(data))

    def create(self, path: str, data: dict[str, Any]) -> bool:
        path = self._norm(path)
        with self._lock:
            if path in self._docs:
                return False
            self._docs[path] = copy.deepcopy(data)
            self._flush()
            return True

    def update(self, path: str, data: dict[str, Any]) -> Doc:
        path = self._norm(path)
        with self._lock:
            if path not in self._docs:
                raise KeyError(path)
            self._docs[path].update(copy.deepcopy(data))
            self._flush()
            return Doc(id=path.rsplit("/", 1)[-1], path=path, data=copy.deepcopy(self._docs[path]))

    def delete(self, path: str) -> None:
        path = self._norm(path)
        with self._lock:
            self._docs.pop(path, None)
            self._flush()

    def query(
        self,
        collection_path: str,
        filters: list[Filter] | None = None,
        order_by: str | None = None,
        descending: bool = False,
        limit: int | None = None,
    ) -> list[Doc]:
        collection_path = self._norm(collection_path)
        if not is_collection_path(collection_path):
            raise ValueError(f"Not a collection path: {collection_path}")
        prefix = collection_path + "/"
        depth = collection_path.count("/") + 2
        with self._lock:
            out = [
                Doc(id=p.rsplit("/", 1)[-1], path=p, data=copy.deepcopy(d))
                for p, d in self._docs.items()
                if p.startswith(prefix) and p.count("/") + 1 == depth
                and all(match(d, f) for f in (filters or []))
            ]
        if order_by:
            out.sort(key=lambda d: (d.data.get(order_by) is None, d.data.get(order_by)), reverse=descending)
        return out[:limit] if limit else out

    def collection_group(self, name: str, filters: list[Filter] | None = None) -> list[Doc]:
        with self._lock:
            out = []
            for p, d in self._docs.items():
                parts = p.split("/")
                if len(parts) >= 2 and parts[-2] == name and all(match(d, f) for f in (filters or [])):
                    out.append(Doc(id=parts[-1], path=p, data=copy.deepcopy(d)))
            return out

    def transaction_set_many(self, writes: list[tuple[str, dict[str, Any]]]) -> None:
        with self._lock:
            for path, data in writes:
                self._docs[self._norm(path)] = copy.deepcopy(data)
            self._flush()

    def clear(self) -> None:
        with self._lock:
            self._docs.clear()
            self._flush()
