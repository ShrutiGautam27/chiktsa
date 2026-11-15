"""Cloud Firestore Store implementation (production).

Uses Application Default Credentials (Cloud Run's service account in production;
GOOGLE_APPLICATION_CREDENTIALS locally). When FIRESTORE_EMULATOR_HOST is set it connects to the
local Firestore emulator with anonymous credentials — this is how the full API test-suite is run
against real Firestore semantics without a cloud project (see tests/conftest.py).
"""
from __future__ import annotations

import os
from typing import Any

from .store import Doc, Filter


class FirestoreStore:
    def __init__(self, project_id: str | None = None) -> None:
        from google.cloud import firestore  # optional dependency, imported lazily

        project = project_id or os.environ.get("GOOGLE_CLOUD_PROJECT")
        if os.environ.get("FIRESTORE_EMULATOR_HOST"):
            from google.auth.credentials import AnonymousCredentials

            self._db = firestore.Client(project=project or "demo-carehub", credentials=AnonymousCredentials())
        else:
            self._db = firestore.Client(project=project)
        self._fs = firestore

    @staticmethod
    def _filter(q: Any, f: Filter) -> Any:
        from google.cloud.firestore_v1.base_query import FieldFilter

        op = "array_contains" if f.op == "array_contains" else f.op
        return q.where(filter=FieldFilter(f.field, op, f.value))

    def get(self, path: str) -> Doc | None:
        snap = self._db.document(path).get()
        if not snap.exists:
            return None
        return Doc(id=snap.id, path=path, data=snap.to_dict() or {})

    def set(self, path: str, data: dict[str, Any]) -> Doc:
        self._db.document(path).set(data)
        return Doc(id=path.rsplit("/", 1)[-1], path=path, data=data)

    def create(self, path: str, data: dict[str, Any]) -> bool:
        from google.api_core.exceptions import AlreadyExists, Conflict

        try:
            self._db.document(path).create(data)  # server-side precondition: fails if the doc exists
            return True
        except (AlreadyExists, Conflict):
            return False

    def update(self, path: str, data: dict[str, Any]) -> Doc:
        from google.api_core.exceptions import NotFound as GNotFound

        ref = self._db.document(path)
        try:
            ref.update(data)  # all CareHub field names are plain identifiers (no dots)
        except GNotFound as e:
            raise KeyError(path) from e
        snap = ref.get()
        return Doc(id=snap.id, path=path, data=snap.to_dict() or {})

    def delete(self, path: str) -> None:
        self._db.document(path).delete()

    def query(self, collection_path: str, filters: list[Filter] | None = None, order_by: str | None = None,
              descending: bool = False, limit: int | None = None) -> list[Doc]:
        q: Any = self._db.collection(collection_path)
        for f in filters or []:
            q = self._filter(q, f)
        if order_by:
            q = q.order_by(order_by, direction=self._fs.Query.DESCENDING if descending else self._fs.Query.ASCENDING)
        if limit:
            q = q.limit(limit)
        return [Doc(id=s.id, path=s.reference.path, data=s.to_dict() or {}) for s in q.stream()]

    def collection_group(self, name: str, filters: list[Filter] | None = None) -> list[Doc]:
        q: Any = self._db.collection_group(name)
        for f in filters or []:
            q = self._filter(q, f)
        return [Doc(id=s.id, path=s.reference.path, data=s.to_dict() or {}) for s in q.stream()]

    def transaction_set_many(self, writes: list[tuple[str, dict[str, Any]]]) -> None:
        batch = self._db.batch()
        for path, data in writes:
            batch.set(self._db.document(path), data)
        batch.commit()
