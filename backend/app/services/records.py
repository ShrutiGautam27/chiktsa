"""Care notes (daily observations) and the Secure Medical Document Vault.

Documents are stored privately (local disk in development, a private Cloud Storage bucket in
production) and are only ever streamed through the API after authorisation — no public URLs.
File types are verified by content (magic bytes), not by the client-supplied name or MIME type.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

from ..config import get_settings
from ..core.auth import CurrentUser
from ..core.errors import Forbidden, NotFound, ValidationFailed
from ..core.rbac import P
from ..core.timeutil import now
from ..db import Store
from . import audit
from .access import Access
from .ids import new_id

# ================================================================ care notes
NOTE_TAGS = {"mood", "meals", "sleep", "mobility", "activity", "social", "other"}


def add_note(store: Store, actor: CurrentUser, hid: str, sid: str, text: str, tags: list[str]) -> dict:
    acc = Access(store, actor.uid, hid)
    acc.require(sid, P.CARE_LOG_WRITE, "care_notes")
    text = (text or "").strip()
    if not text:
        raise ValidationFailed("Write an observation first.")
    nid, t = new_id(), now()
    data = {"text": text[:2000], "tags": sorted(set(tags) & NOTE_TAGS), "authorUid": actor.uid,
            "authorName": actor.display_name, "createdAt": t}
    store.set(f"households/{hid}/seniors/{sid}/careNotes/{nid}", data)
    audit.record(store, hid, actor, "note.create", "care_note", nid, "Added a care observation", senior_id=sid)
    return {"id": nid, "seniorId": sid, **data}


def list_notes(store: Store, actor: CurrentUser, hid: str, sid: str, limit: int = 50) -> list[dict]:
    acc = Access(store, actor.uid, hid)
    acc.require(sid, P.SENIOR_READ, "care_notes")
    docs = store.query(f"households/{hid}/seniors/{sid}/careNotes", order_by="createdAt", descending=True, limit=limit)
    return [{"id": d.id, "seniorId": sid, **d.data} for d in docs]


# ================================================================ file storage
MAGIC = [
    (b"%PDF-", "application/pdf", ".pdf"),
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
]


def sniff(data: bytes) -> tuple[str, str] | None:
    for sig, mime, ext in MAGIC:
        if data.startswith(sig):
            return mime, ext
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", ".webp"
    return None


class LocalStorage:
    """Development only. Files live outside any web root and are served only via the API."""

    def __init__(self, root: str):
        self.root = Path(root)

    def _p(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if not str(p).startswith(str(self.root.resolve())):
            raise ValidationFailed("Invalid storage key.")
        return p

    def put(self, key: str, data: bytes, mime: str) -> None:
        p = self._p(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def get(self, key: str) -> bytes:
        p = self._p(key)
        if not p.exists():
            raise NotFound("File not found.")
        return p.read_bytes()


class GCSStorage:  # pragma: no cover - needs a Firebase/GCS bucket
    def __init__(self, bucket: str):
        from firebase_admin import storage

        self.bucket = storage.bucket(bucket)

    def put(self, key: str, data: bytes, mime: str) -> None:
        self.bucket.blob(key).upload_from_string(data, content_type=mime)

    def get(self, key: str) -> bytes:
        return self.bucket.blob(key).download_as_bytes()


_storage = None


def get_storage():
    global _storage
    if _storage is None:
        s = get_settings()
        _storage = GCSStorage(s.storage_bucket) if s.file_storage == "gcs" else LocalStorage(s.local_file_dir)
    return _storage


def set_storage(st) -> None:
    global _storage
    _storage = st


# ================================================================ documents
DOC_KINDS = {"prescription", "lab_report", "discharge_summary", "visit_summary", "insurance", "other"}


def doc_out(sid: str, did: str, d: dict) -> dict:
    return {"id": did, "seniorId": sid, **{k: d.get(k) for k in (
        "kind", "title", "filename", "contentType", "size", "uploadedByName", "createdAt", "status", "documentDate",
        "extraction", "extractedText")}}


def upload(store: Store, actor: CurrentUser, hid: str, sid: str, filename: str, data: bytes, kind: str, title: str,
           document_date: str | None) -> dict:
    acc = Access(store, actor.uid, hid)
    acc.require(sid, P.CARE_LOG_WRITE, "documents")
    s = get_settings()
    if kind not in DOC_KINDS:
        raise ValidationFailed("Unknown document type.")
    if not data:
        raise ValidationFailed("The file is empty.")
    if len(data) > s.max_upload_mb * 1024 * 1024:
        raise ValidationFailed(f"Files must be {s.max_upload_mb} MB or smaller.")
    sniffed = sniff(data)
    if not sniffed:
        raise ValidationFailed("Only PDF, PNG, JPEG or WebP files can be uploaded.")
    mime, ext = sniffed
    did = new_id()
    key = f"households/{hid}/seniors/{sid}/{did}{ext}"
    get_storage().put(key, data, mime)
    t = now()
    meta = {"kind": kind, "title": (title or filename or "Document").strip()[:120],
            "filename": os.path.basename(filename or f"document{ext}")[:120], "contentType": mime, "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(), "storageKey": key, "uploadedBy": actor.uid,
            "uploadedByName": actor.display_name, "documentDate": document_date, "status": "active",
            "extraction": None, "extractedText": "", "createdAt": t}
    store.set(f"households/{hid}/seniors/{sid}/documents/{did}", meta)
    audit.record(store, hid, actor, "document.upload", "document", did, f"Uploaded {kind.replace('_', ' ')} '{meta['title']}'",
                 senior_id=sid)
    return doc_out(sid, did, meta)


def list_docs(store: Store, actor: CurrentUser, hid: str, sid: str) -> list[dict]:
    acc = Access(store, actor.uid, hid)
    acc.require(sid, P.SENIOR_MEDICAL_READ, "documents")
    docs = [doc_out(sid, d.id, d.data) for d in store.query(f"households/{hid}/seniors/{sid}/documents")
            if d.data.get("status") == "active"]
    return sorted(docs, key=lambda x: x["createdAt"], reverse=True)


def get_doc(store: Store, actor: CurrentUser, hid: str, sid: str, did: str):
    acc = Access(store, actor.uid, hid)
    acc.require(sid, P.SENIOR_MEDICAL_READ, "documents")
    d = store.get(f"households/{hid}/seniors/{sid}/documents/{did}")
    if not d or d.data.get("status") != "active":
        raise NotFound("Document not found.")
    return d


def download(store: Store, actor: CurrentUser, hid: str, sid: str, did: str) -> tuple[bytes, dict]:
    d = get_doc(store, actor, hid, sid, did)
    data = get_storage().get(d.data["storageKey"])
    audit.record(store, hid, actor, "document.access", "document", did, f"Opened '{d.data['title']}'", senior_id=sid)
    return data, d.data


def archive(store: Store, actor: CurrentUser, hid: str, sid: str, did: str) -> None:
    acc = Access(store, actor.uid, hid)
    acc.require(sid, P.SENIOR_MEDICAL_WRITE, "documents")
    d = store.get(f"households/{hid}/seniors/{sid}/documents/{did}")
    if not d or d.data.get("status") != "active":
        raise NotFound("Document not found.")
    if d.data["uploadedBy"] != actor.uid and not acc.can(P.SENIORS_MANAGE):
        raise Forbidden("Only the uploader or an administrator can remove this document.")
    store.update(d.path, {"status": "archived", "archivedAt": now()})
    audit.record(store, hid, actor, "document.archive", "document", did, f"Archived '{d.data['title']}'", senior_id=sid)
