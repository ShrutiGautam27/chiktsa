"""Routes: care records + the three intelligence engines. Thin — logic lives in services."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query, Response

from ...core.auth import CurrentUser, get_current_user
from ...core.errors import ValidationFailed
from ...db import Store, get_store
from ...schemas import care as S
from ...services import appointments, consent, continuity, coordination, handovers, jobs, medications, notifications, tasks

router = APIRouter(tags=["care"])
Actor = Depends(get_current_user)
DB = Depends(get_store)
SEN = "/households/{hid}/seniors/{sid}"


# ============================================================ ENGINE 2 · Medication Safety
@router.get(SEN + "/medications")
def list_medications(hid: str, sid: str, includeEnded: bool = False, actor: CurrentUser = Actor, store: Store = DB):
    return medications.list_meds(store, actor, hid, sid, includeEnded)


@router.post(SEN + "/medications", status_code=201)
def create_medication(hid: str, sid: str, body: S.MedicationCreate, actor: CurrentUser = Actor, store: Store = DB):
    return medications.create(store, actor, hid, sid, body.model_dump())


@router.get(SEN + "/medications/{mid}")
def get_medication(hid: str, sid: str, mid: str, actor: CurrentUser = Actor, store: Store = DB):
    return medications.get_med(store, actor, hid, sid, mid)


@router.patch(SEN + "/medications/{mid}")
def update_medication(hid: str, sid: str, mid: str, body: S.MedicationUpdate, actor: CurrentUser = Actor,
                      store: Store = DB):
    return medications.update(store, actor, hid, sid, mid, body.model_dump(exclude_unset=True))


@router.post(SEN + "/medications/{mid}/verify")
def verify_medication(hid: str, sid: str, mid: str, body: S.VerifyRequest, actor: CurrentUser = Actor, store: Store = DB):
    return medications.verify(store, actor, hid, sid, mid, body.acknowledgeWarnings, body.note)


@router.post(SEN + "/medications/{mid}/status")
def medication_status(hid: str, sid: str, mid: str, body: S.MedStatusRequest, actor: CurrentUser = Actor,
                      store: Store = DB):
    return medications.set_status(store, actor, hid, sid, mid, body.status, body.reason)


@router.post(SEN + "/medications/{mid}/refill")
def refill_medication(hid: str, sid: str, mid: str, body: S.RefillRequest, actor: CurrentUser = Actor, store: Store = DB):
    return medications.refill(store, actor, hid, sid, mid, body.quantity, body.note)


@router.get(SEN + "/medications/{mid}/journey")
def medication_journey(hid: str, sid: str, mid: str, actor: CurrentUser = Actor, store: Store = DB):
    return medications.journey(store, actor, hid, sid, mid)


@router.get(SEN + "/medication-review")
def medication_review(hid: str, sid: str, actor: CurrentUser = Actor, store: Store = DB):
    return medications.interaction_review(store, actor, hid, sid)


@router.get(SEN + "/doses")
def dose_schedule(hid: str, sid: str, start: date | None = None, end: date | None = None, actor: CurrentUser = Actor,
                  store: Store = DB):
    if start and end and end < start:
        raise ValidationFailed("End date must be on or after start date.")
    return medications.schedule(store, actor, hid, sid, start, end)  # defaults to the senior's local "today"


@router.post(SEN + "/doses")
def record_dose(hid: str, sid: str, body: S.DoseRecord, actor: CurrentUser = Actor, store: Store = DB):
    return medications.record_dose(store, actor, hid, sid, body.model_dump())


@router.get(SEN + "/adherence")
def adherence(hid: str, sid: str, days: int = Query(7, ge=1, le=60), actor: CurrentUser = Actor, store: Store = DB):
    return medications.adherence(store, actor, hid, sid, days)


# ============================================================ Appointments
@router.get(SEN + "/appointments")
def list_appointments(hid: str, sid: str, actor: CurrentUser = Actor, store: Store = DB):
    return appointments.list_for_senior(store, actor, hid, sid)


@router.get("/households/{hid}/appointments")
def household_appointments(hid: str, days: int = Query(14, ge=1, le=90), actor: CurrentUser = Actor, store: Store = DB):
    return appointments.list_household(store, actor, hid, days)


@router.post(SEN + "/appointments", status_code=201)
def create_appointment(hid: str, sid: str, body: S.AppointmentCreate, actor: CurrentUser = Actor, store: Store = DB):
    return appointments.create(store, actor, hid, sid, body.model_dump())


@router.patch(SEN + "/appointments/{aid}")
def update_appointment(hid: str, sid: str, aid: str, body: S.AppointmentUpdate, actor: CurrentUser = Actor,
                       store: Store = DB):
    return appointments.update(store, actor, hid, sid, aid, body.model_dump(exclude_unset=True))


@router.post(SEN + "/appointments/{aid}/escort")
def escort(hid: str, sid: str, aid: str, body: S.EscortAction, actor: CurrentUser = Actor, store: Store = DB):
    return appointments.escort_action(store, actor, hid, sid, aid, body.action)


@router.post(SEN + "/appointments/{aid}/postpone")
def postpone(hid: str, sid: str, aid: str, body: S.PostponeRequest, actor: CurrentUser = Actor, store: Store = DB):
    return appointments.postpone(store, actor, hid, sid, aid, body.newStartsAt, body.reason)


@router.post(SEN + "/appointments/{aid}/complete")
def complete_appointment(hid: str, sid: str, aid: str, body: S.CompleteAppointment, actor: CurrentUser = Actor,
                         store: Store = DB):
    return appointments.complete(store, actor, hid, sid, aid, body.visitNotes)


@router.post(SEN + "/appointments/{aid}/cancel")
def cancel_appointment(hid: str, sid: str, aid: str, actor: CurrentUser = Actor, store: Store = DB):
    return appointments.complete(store, actor, hid, sid, aid, "", cancel=True)


# ============================================================ Tasks (Responsibility Centre)
@router.get("/households/{hid}/tasks")
def list_tasks(hid: str, status: str | None = None, mine: bool = False, seniorId: str | None = None,
               actor: CurrentUser = Actor, store: Store = DB):
    return tasks.list_tasks(store, actor, hid, status, mine, seniorId)


@router.post("/households/{hid}/tasks", status_code=201)
def create_task(hid: str, body: S.TaskCreate, actor: CurrentUser = Actor, store: Store = DB):
    return tasks.create(store, actor, hid, body.model_dump())


@router.patch("/households/{hid}/tasks/{tid}")
def update_task(hid: str, tid: str, body: S.TaskUpdate, actor: CurrentUser = Actor, store: Store = DB):
    return tasks.update(store, actor, hid, tid, body.model_dump(exclude_unset=True))


@router.post("/households/{hid}/tasks/{tid}/{action}")
def task_action(hid: str, tid: str, action: str, body: dict | None = None, actor: CurrentUser = Actor,
                store: Store = DB):
    body = body or {}
    if action == "accept":
        return tasks.accept(store, actor, hid, tid)
    if action == "decline":
        return tasks.decline(store, actor, hid, tid)
    if action == "claim":
        return tasks.claim(store, actor, hid, tid)
    if action == "complete":
        return tasks.complete(store, actor, hid, tid, S.TaskAction(**body).note)
    if action == "cancel":
        return tasks.cancel(store, actor, hid, tid)
    if action == "reassign":
        return tasks.reassign(store, actor, hid, tid, S.ReassignRequest(**body).assigneeUid)
    raise ValidationFailed("Unknown task action.")


# ============================================================ ENGINE 1 · Care Continuity
@router.get("/households/{hid}/gaps")
def gaps(hid: str, seniorId: str | None = None, actor: CurrentUser = Actor, store: Store = DB):
    return continuity.detect_gaps(store, actor, hid, seniorId)


@router.post("/households/{hid}/simulate")
def simulate(hid: str, body: S.SimulationRequest, actor: CurrentUser = Actor, store: Store = DB):
    return continuity.simulate(store, actor, hid, body.model_dump())


@router.get("/households/{hid}/handovers")
def list_handovers(hid: str, actor: CurrentUser = Actor, store: Store = DB):
    return handovers.list_handovers(store, actor, hid)


@router.post("/households/{hid}/handovers", status_code=201)
def create_handover(hid: str, body: S.HandoverCreate, actor: CurrentUser = Actor, store: Store = DB):
    return handovers.create_handover(store, actor, hid, body.model_dump())


@router.post("/households/{hid}/handovers/{hoid}/acknowledge")
def acknowledge_handover(hid: str, hoid: str, body: S.AcknowledgeRequest, actor: CurrentUser = Actor, store: Store = DB):
    return handovers.acknowledge(store, actor, hid, hoid, body.note)


@router.get("/households/{hid}/absences")
def list_absences(hid: str, actor: CurrentUser = Actor, store: Store = DB):
    return handovers.list_absences(store, actor, hid)


@router.post("/households/{hid}/absences", status_code=201)
def report_absence(hid: str, body: S.AbsenceCreate, actor: CurrentUser = Actor, store: Store = DB):
    return handovers.report_absence(store, actor, hid, body.model_dump())


@router.post("/households/{hid}/absences/{aid}/cover")
def cover(hid: str, aid: str, body: S.CoverRequest, actor: CurrentUser = Actor, store: Store = DB):
    return handovers.cover(store, actor, hid, aid, body.itemType, body.itemId)


@router.delete("/households/{hid}/absences/{aid}", status_code=204)
def cancel_absence(hid: str, aid: str, actor: CurrentUser = Actor, store: Store = DB):
    handovers.cancel_absence(store, actor, hid, aid)
    return Response(status_code=204)


# ============================================================ ENGINE 3 · Family Coordination
@router.get("/households/{hid}/contribution")
def contribution(hid: str, days: int = Query(30, ge=7, le=90), actor: CurrentUser = Actor, store: Store = DB):
    return coordination.contribution(store, actor, hid, days)


@router.get("/me/overview")
def my_overview(actor: CurrentUser = Actor, store: Store = DB):
    return coordination.overview(store, actor)


@router.get("/me/responsibilities")
def my_responsibilities(actor: CurrentUser = Actor, store: Store = DB):
    return coordination.responsibilities(store, actor)


@router.get(SEN + "/consents")
def list_consents(hid: str, sid: str, actor: CurrentUser = Actor, store: Store = DB):
    return consent.list_access(store, actor, hid, sid)


@router.put(SEN + "/consents/{uid}")
def set_consent(hid: str, sid: str, uid: str, body: S.ConsentUpsert, actor: CurrentUser = Actor, store: Store = DB):
    return consent.upsert(store, actor, hid, sid, uid, body.categories, body.expiresAt)


@router.post(SEN + "/consents/{uid}/revoke")
def revoke_consent(hid: str, sid: str, uid: str, actor: CurrentUser = Actor, store: Store = DB):
    return consent.revoke(store, actor, hid, sid, uid)


@router.delete(SEN + "/consents/{uid}")
def restore_consent(hid: str, sid: str, uid: str, actor: CurrentUser = Actor, store: Store = DB):
    return consent.restore(store, actor, hid, sid, uid)


# ============================================================ Notifications
@router.get("/me/notifications")
def my_notifications(actor: CurrentUser = Actor, store: Store = DB):
    items = notifications.list_for(store, actor.uid)
    return {"items": items, "unread": sum(1 for i in items if not i["read"])}


@router.post("/me/notifications/read-all")
def read_all(actor: CurrentUser = Actor, store: Store = DB):
    return {"updated": notifications.mark_read(store, actor.uid)}


@router.post("/me/notifications/{nid}/read")
def read_one(nid: str, actor: CurrentUser = Actor, store: Store = DB):
    return {"updated": notifications.mark_read(store, actor.uid, nid)}


@router.post("/me/notifications/{nid}/acknowledge")
def acknowledge(nid: str, actor: CurrentUser = Actor, store: Store = DB):
    return notifications.acknowledge(store, actor.uid, actor.display_name, nid)


@router.get("/me/notification-preferences")
def get_prefs(actor: CurrentUser = Actor, store: Store = DB):
    return notifications.get_prefs(store, actor.uid)


@router.put("/me/notification-preferences")
def set_prefs(body: S.NotificationPrefs, actor: CurrentUser = Actor, store: Store = DB):
    return notifications.set_prefs(store, actor.uid, body.email, body.push)


@router.post("/me/devices")
def register_device(body: S.DeviceRegistration, actor: CurrentUser = Actor, store: Store = DB):
    return notifications.register_device(store, actor.uid, body.token)


# ============================================================ Automation
@router.get("/households/{hid}/notification-rules")
def get_rules(hid: str, actor: CurrentUser = Actor, store: Store = DB):
    from ...core.rbac import authorize

    authorize(store, actor.uid, hid)
    return jobs.get_rules(store, hid)


@router.put("/households/{hid}/notification-rules")
def put_rules(hid: str, body: S.NotificationRules, actor: CurrentUser = Actor, store: Store = DB):
    return jobs.update_rules(store, actor, hid, body.model_dump(exclude_none=True))


@router.get("/households/{hid}/reminders")
def reminders(hid: str, days: int = Query(3, ge=1, le=30), actor: CurrentUser = Actor, store: Store = DB):
    return jobs.list_reminders(store, actor, hid, days)


@router.post("/households/{hid}/reminders/run")
def run_reminders(hid: str, actor: CurrentUser = Actor, store: Store = DB):
    return jobs.run_now(store, actor, hid)


_ = timedelta  # noqa
