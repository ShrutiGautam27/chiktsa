"""Wellbeing routes: preferences, wellness, emergency snapshot, offline sync, voice, reports, calendar, organisations."""
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import Field, StringConstraints

from ...core.auth import CurrentUser, get_current_user
from ...db import Store, get_store
from ...schemas.common import APIModel
from ...services import offline_sync, orgs, reports, voice, wellbeing

router = APIRouter(tags=["wellbeing"])
Actor = Depends(get_current_user)
DB = Depends(get_store)
SEN = "/households/{hid}/seniors/{sid}"
Txt = lambda n: Annotated[str, StringConstraints(strip_whitespace=True, max_length=n)]  # noqa: E731
Score = Annotated[int, Field(ge=1, le=5)]


class Preferences(APIModel):
    preferredLanguage: Txt(60) | None = None
    communicationStyle: Txt(500) | None = None
    dailyRoutine: Txt(1000) | None = None
    foodPreferences: Txt(500) | None = None
    faithAndCulture: Txt(500) | None = None
    likes: Txt(500) | None = None
    dislikes: Txt(500) | None = None
    careWishes: Txt(1500) | None = None
    trustedContactsNote: Txt(500) | None = None


class CheckIn(APIModel):
    mood: Score
    sleep: Score | None = None
    energy: Score | None = None
    pain: Literal["none", "mild", "moderate", "severe"] | None = None
    note: Txt(500) = ""
    wantsCall: bool = False


class Emergency(APIModel):
    fields: dict[str, Txt(500)] = Field(default_factory=dict)
    include: dict[str, bool] = Field(default_factory=dict)


class ShareBody(APIModel):
    hours: int = Field(24, ge=1, le=72)


class SyncOp(APIModel):
    clientOpId: Txt(64)
    type: Txt(40)
    householdId: Txt(64)
    seniorId: Txt(64) | None = None
    clientTimestamp: Txt(40)
    payload: dict[str, Any] = Field(default_factory=dict)


class SyncBody(APIModel):
    ops: list[SyncOp] = Field(max_length=100)


class VoiceBody(APIModel):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    lang: Literal["en", "hi"] = "en"


class OrgCreate(APIModel):
    name: Txt(120)


class StaffBody(APIModel):
    email: Txt(254)
    role: Literal["org_admin", "org_caregiver"] = "org_caregiver"


class ConnectBody(APIModel):
    code: Txt(32)


class AssignBody(APIModel):
    householdId: Txt(64)
    uid: Txt(64)
    role: Literal["primary_caregiver", "secondary_caregiver"]
    seniorScope: Literal["all"] | list[str] = "all"


# ---- preferences & wellness
@router.get(SEN + "/preferences")
def get_prefs(hid: str, sid: str, actor: CurrentUser = Actor, store: Store = DB):
    return wellbeing.get_preferences(store, actor, hid, sid)


@router.put(SEN + "/preferences")
def put_prefs(hid: str, sid: str, body: Preferences, actor: CurrentUser = Actor, store: Store = DB):
    return wellbeing.set_preferences(store, actor, hid, sid, body.model_dump(exclude_none=True))


@router.post(SEN + "/wellness")
def wellness_checkin(hid: str, sid: str, body: CheckIn, actor: CurrentUser = Actor, store: Store = DB):
    return wellbeing.checkin(store, actor, hid, sid, body.model_dump())


@router.get(SEN + "/wellness")
def wellness(hid: str, sid: str, days: int = Query(30, ge=7, le=90), actor: CurrentUser = Actor, store: Store = DB):
    return wellbeing.wellness_history(store, actor, hid, sid, days)


# ---- emergency snapshot
@router.get(SEN + "/emergency")
def get_emergency(hid: str, sid: str, actor: CurrentUser = Actor, store: Store = DB):
    return wellbeing.get_emergency(store, actor, hid, sid)


@router.put(SEN + "/emergency")
def put_emergency(hid: str, sid: str, body: Emergency, actor: CurrentUser = Actor, store: Store = DB):
    return wellbeing.set_emergency(store, actor, hid, sid, body.fields, body.include)


@router.post(SEN + "/emergency/approve")
def approve_emergency(hid: str, sid: str, actor: CurrentUser = Actor, store: Store = DB):
    return wellbeing.approve_emergency(store, actor, hid, sid)


@router.post(SEN + "/emergency/shares", status_code=201)
def share_emergency(hid: str, sid: str, body: ShareBody, actor: CurrentUser = Actor, store: Store = DB):
    return wellbeing.create_share(store, actor, hid, sid, body.hours)


@router.delete(SEN + "/emergency/shares/{share_id}", status_code=204)
def unshare_emergency(hid: str, sid: str, share_id: str, actor: CurrentUser = Actor, store: Store = DB):
    wellbeing.revoke_share(store, actor, hid, sid, share_id)
    return Response(status_code=204)


@router.get("/public/emergency/{token}")
def public_emergency(token: str, response: Response, store: Store = DB):
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    response.headers["Cache-Control"] = "no-store"
    return wellbeing.public_card(store, token)


# ---- offline sync & voice
@router.post("/sync/batch")
def sync(body: SyncBody, actor: CurrentUser = Actor, store: Store = DB):
    return offline_sync.sync_batch(store, actor, [o.model_dump() for o in body.ops])


@router.post(SEN + "/voice")
def voice_intent(hid: str, sid: str, body: VoiceBody, actor: CurrentUser = Actor, store: Store = DB):
    return voice.handle(store, actor, hid, sid, body.text, body.lang)


# ---- reports & calendar
@router.get("/households/{hid}/reports")
def report(hid: str, days: int = Query(30, ge=7, le=90), actor: CurrentUser = Actor, store: Store = DB):
    return reports.household_report(store, actor, hid, days)


@router.get("/households/{hid}/reports.csv")
def report_csv(hid: str, days: int = Query(30, ge=7, le=90), actor: CurrentUser = Actor, store: Store = DB):
    return Response(reports.report_csv(store, actor, hid, days), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="carehub-report.csv"', "Cache-Control": "no-store"})


@router.get(SEN + "/appointments/{aid}/ics")
def ics(hid: str, sid: str, aid: str, actor: CurrentUser = Actor, store: Store = DB):
    body, name = reports.appointment_ics(store, actor, hid, sid, aid)
    return Response(body, media_type="text/calendar", headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})


# ---- organisations
@router.get("/organisations")
def my_orgs(actor: CurrentUser = Actor, store: Store = DB):
    return orgs.my_orgs(store, actor)


@router.post("/organisations", status_code=201)
def create_org(body: OrgCreate, actor: CurrentUser = Actor, store: Store = DB):
    return orgs.create_org(store, actor, body.name)


@router.post("/organisations/{oid}/code")
def rotate_code(oid: str, actor: CurrentUser = Actor, store: Store = DB):
    return orgs.rotate_code(store, actor, oid)


@router.post("/organisations/{oid}/staff")
def add_staff(oid: str, body: StaffBody, actor: CurrentUser = Actor, store: Store = DB):
    return orgs.add_staff(store, actor, oid, body.email, body.role)


@router.get("/organisations/{oid}/dashboard")
def org_dashboard(oid: str, actor: CurrentUser = Actor, store: Store = DB):
    return orgs.dashboard(store, actor, oid)


@router.post("/organisations/{oid}/assignments")
def assign(oid: str, body: AssignBody, actor: CurrentUser = Actor, store: Store = DB):
    return orgs.assign_caregiver(store, actor, oid, body.householdId, body.uid, body.role, body.seniorScope)


@router.post("/households/{hid}/organisations")
def connect_org(hid: str, body: ConnectBody, actor: CurrentUser = Actor, store: Store = DB):
    return orgs.connect(store, actor, hid, body.code)


@router.delete("/households/{hid}/organisations/{oid}", status_code=204)
def disconnect_org(hid: str, oid: str, actor: CurrentUser = Actor, store: Store = DB):
    orgs.disconnect(store, actor, hid, oid)
    return Response(status_code=204)
