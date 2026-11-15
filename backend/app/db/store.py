"""Path-based document store abstraction.

Both implementations (in-memory for development/tests and Firestore for production) expose
identical semantics, mirroring the Firestore Admin SDK. The store itself performs NO
authorisation — that is the job of the service layer (`app.core.rbac`), exactly as with the
Admin SDK in production. Paths always alternate collection/document segments, e.g.
``households/{hid}/seniors/{sid}``.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol

Op = Literal["==", "!=", "<", "<=", ">", ">=", "in", "array_contains"]


@dataclass(frozen=True)
class Filter:
    field: str
    op: Op
    value: Any


@dataclass
class Doc:
    id: str
    path: str
    data: dict[str, Any]


class Store(Protocol):
    def get(self, path: str) -> Doc | None: ...

    def set(self, path: str, data: dict[str, Any]) -> Doc: ...

    def create(self, path: str, data: dict[str, Any]) -> bool:
        """Atomically create a document; return False if it already exists (idempotency primitive)."""
        ...

    def update(self, path: str, data: dict[str, Any]) -> Doc: ...

    def delete(self, path: str) -> None: ...

    def query(
        self,
        collection_path: str,
        filters: list[Filter] | None = None,
        order_by: str | None = None,
        descending: bool = False,
        limit: int | None = None,
    ) -> list[Doc]: ...

    def collection_group(self, name: str, filters: list[Filter] | None = None) -> list[Doc]: ...

    def transaction_set_many(self, writes: list[tuple[str, dict[str, Any]]]) -> None:
        """Atomically write several documents."""
        ...


def is_document_path(path: str) -> bool:
    parts = [p for p in path.split("/") if p]
    return len(parts) > 0 and len(parts) % 2 == 0


def is_collection_path(path: str) -> bool:
    parts = [p for p in path.split("/") if p]
    return len(parts) % 2 == 1


def match(data: dict[str, Any], f: Filter) -> bool:
    v = data.get(f.field)
    try:
        if f.op == "==":
            return v == f.value
        if f.op == "!=":
            return v != f.value
        if f.op == "in":
            return v in f.value
        if f.op == "array_contains":
            return isinstance(v, list) and f.value in v
        if v is None:
            return False
        if f.op == "<":
            return v < f.value
        if f.op == "<=":
            return v <= f.value
        if f.op == ">":
            return v > f.value
        if f.op == ">=":
            return v >= f.value
    except TypeError:
        return False
    return False
