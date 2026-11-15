"""Routes: AI workflows, care notes and the secure document vault."""
import re
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from pydantic import Field, StringConstraints

from ...ai import services as ai
from ...core.auth import CurrentUser, get_current_user
from ...db import Store, get_store
from ...schemas.common import APIModel
from ...services import records

router = APIRouter(tags=["ai"])
Actor = Depends(get_current_user)
DB = Depends(get_store)
SEN = "/households/{hid}/seniors/{sid}"


class AIModeBody(APIModel):
    mode: Literal["offline", "gemini"]


class QuestionBody(APIModel):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)]


class NoteBody(APIModel):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    tags: list[str] = Field(default_factory=list, max_length=7)


class ExtractBody(APIModel):
    transcription: Annotated[str, StringConstraints(max_length=6000)] | None = None


class DraftsBody(APIModel):
    indexes: list[int] = Field(min_length=1, max_length=20)
    responsibleUid: str | None = None


class ConvertBody(APIModel):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=1000)]


# ---- AI settings (cloud AI is opt-in per household)
@router.get("/households/{hid}/ai")
def ai_status(hid: str, actor: CurrentUser = Actor, store: Store = DB):
    return ai.ai_status(store, actor, hid)


@router.put("/households/{hid}/ai")
def set_ai(hid: str, body: AIModeBody, actor: CurrentUser = Actor, store: Store = DB):
    return ai.set_ai_mode(store, actor, hid, body.mode)


# ---- AI workflows
@router.post(SEN + "/memory/query")
def memory(hid: str, sid: str, body: QuestionBody, actor: CurrentUser = Actor, store: Store = DB):
    return ai.ask_memory(store, actor, hid, sid, body.question)


@router.get("/households/{hid}/briefing")
def briefing(hid: str, refresh: bool = False, actor: CurrentUser = Actor, store: Store = DB):
    return ai.daily_briefing(store, actor, hid, refresh)


@router.get(SEN + "/appointments/{aid}/prep")
def prep(hid: str, sid: str, aid: str, actor: CurrentUser = Actor, store: Store = DB):
    return ai.appointment_prep(store, actor, hid, sid, aid)


@router.post("/households/{hid}/tasks/convert")
def convert(hid: str, body: ConvertBody, actor: CurrentUser = Actor, store: Store = DB):
    return ai.convert_tasks(store, actor, hid, body.text)


# ---- care notes
@router.get(SEN + "/notes")
def notes(hid: str, sid: str, actor: CurrentUser = Actor, store: Store = DB):
    return records.list_notes(store, actor, hid, sid)


@router.post(SEN + "/notes", status_code=201)
def add_note(hid: str, sid: str, body: NoteBody, actor: CurrentUser = Actor, store: Store = DB):
    return records.add_note(store, actor, hid, sid, body.text, body.tags)


# ---- document vault
@router.get(SEN + "/documents")
def documents(hid: str, sid: str, actor: CurrentUser = Actor, store: Store = DB):
    return records.list_docs(store, actor, hid, sid)


@router.post(SEN + "/documents", status_code=201)
async def upload(hid: str, sid: str, file: UploadFile = File(...), kind: str = Form("other"), title: str = Form(""),
                 documentDate: str | None = Form(None), actor: CurrentUser = Actor, store: Store = DB):
    from ...config import get_settings

    limit = get_settings().max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)  # bounded read: never buffer more than the limit + 1 byte
    if documentDate and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", documentDate):
        documentDate = None
    return records.upload(store, actor, hid, sid, file.filename or "", data, kind, title, documentDate)


@router.get(SEN + "/documents/{did}/file")
def download(hid: str, sid: str, did: str, actor: CurrentUser = Actor, store: Store = DB):
    data, meta = records.download(store, actor, hid, sid, did)
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", meta["filename"])[:80] or "document"
    return Response(content=data, media_type=meta["contentType"], headers={
        "Content-Disposition": f'inline; filename="{safe}"', "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"})


@router.delete(SEN + "/documents/{did}", status_code=204)
def archive(hid: str, sid: str, did: str, actor: CurrentUser = Actor, store: Store = DB):
    records.archive(store, actor, hid, sid, did)
    return Response(status_code=204)


@router.post(SEN + "/documents/{did}/extract")
def extract(hid: str, sid: str, did: str, body: ExtractBody, actor: CurrentUser = Actor, store: Store = DB):
    return ai.extract_prescription(store, actor, hid, sid, did, body.transcription)


@router.post(SEN + "/documents/{did}/drafts", status_code=201)
def drafts(hid: str, sid: str, did: str, body: DraftsBody, actor: CurrentUser = Actor, store: Store = DB):
    return ai.create_drafts(store, actor, hid, sid, did, body.indexes, body.responsibleUid)
