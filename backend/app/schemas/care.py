"""Request schemas for care records and intelligence-engine actions."""
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, field_validator, model_validator

from .common import APIModel

Text = lambda n: Annotated[str, StringConstraints(strip_whitespace=True, max_length=n)]  # noqa: E731
Req = lambda n: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=n)]  # noqa: E731
HHMM = Annotated[str, StringConstraints(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]

MED_FIELDS = ("name", "strength", "form", "doseQuantity", "doseUnit", "route", "frequencyText", "times",
              "daysOfWeek", "startDate", "endDate", "instructions", "prescriber")
Form = Literal["tablet", "capsule", "liquid", "injection", "inhaler", "drops", "patch", "other"]


def _aware(v: datetime | None) -> datetime | None:
    if v is not None and v.tzinfo is None:
        raise ValueError("Timestamp must include a time zone offset")
    return v


class _MedFields(APIModel):
    strength: Text(40) = ""
    form: Form = "tablet"
    doseQuantity: float | None = Field(None, gt=0, le=100)
    doseUnit: Text(30) = "tablet"
    route: Text(30) = "oral"
    frequencyText: Text(80) = ""
    times: list[HHMM] = Field(default_factory=list, max_length=8)
    daysOfWeek: list[Annotated[int, Field(ge=0, le=6)]] = Field(default_factory=lambda: list(range(7)), min_length=1)
    startDate: date | None = None
    endDate: date | None = None
    instructions: Text(500) = ""
    prescriber: Text(120) = ""
    source: Literal["manual", "prescription"] = "manual"
    prescriptionText: Text(4000) = ""
    uncertainFields: list[Literal[MED_FIELDS]] = Field(default_factory=list)  # type: ignore[valid-type]
    stockQuantity: float | None = Field(None, ge=0, le=100000)
    lowStockDays: int = Field(7, ge=1, le=60)
    responsibleUid: str | None = None
    pharmacy: Text(120) = ""

    @field_validator("times")
    @classmethod
    def unique_times(cls, v: list[str]) -> list[str]:
        return sorted(set(v))

    @field_validator("daysOfWeek")
    @classmethod
    def unique_days(cls, v: list[int]) -> list[int]:
        return sorted(set(v))


class MedicationCreate(_MedFields):
    # Name may be blank only when it is flagged as unclear on a transcribed prescription.
    name: Text(120) = ""


class MedicationUpdate(APIModel):
    name: Text(120) | None = None
    strength: Text(40) | None = None
    form: Form | None = None
    doseQuantity: float | None = Field(None, gt=0, le=100)
    doseUnit: Text(30) | None = None
    route: Text(30) | None = None
    frequencyText: Text(80) | None = None
    times: list[HHMM] | None = Field(None, max_length=8)
    daysOfWeek: list[Annotated[int, Field(ge=0, le=6)]] | None = Field(None, min_length=1)
    startDate: date | None = None
    endDate: date | None = None
    clearEndDate: bool = False
    instructions: Text(500) | None = None
    prescriber: Text(120) | None = None
    prescriptionText: Text(4000) | None = None
    uncertainFields: list[Literal[MED_FIELDS]] | None = None  # type: ignore[valid-type]
    stockQuantity: float | None = Field(None, ge=0, le=100000)
    lowStockDays: int | None = Field(None, ge=1, le=60)
    responsibleUid: str | None = None
    clearResponsible: bool = False
    pharmacy: Text(120) | None = None


class VerifyRequest(APIModel):
    acknowledgeWarnings: bool = False
    note: Text(500) = ""


class MedStatusRequest(APIModel):
    status: Literal["active", "paused", "ended"]
    reason: Text(300) = ""


class RefillRequest(APIModel):
    quantity: float = Field(gt=0, le=100000)
    note: Text(300) = ""


class DoseRecord(APIModel):
    medicationId: Req(64)
    scheduledFor: datetime
    status: Literal["taken", "skipped"]
    note: Text(300) = ""

    @field_validator("scheduledFor")
    @classmethod
    def tz_required(cls, v):
        return _aware(v)


class AppointmentCreate(APIModel):
    title: Req(120)
    providerName: Text(120) = ""
    location: Text(200) = ""
    startsAt: datetime
    durationMinutes: int = Field(30, ge=5, le=600)
    notes: Text(2000) = ""
    questions: list[Req(300)] = Field(default_factory=list, max_length=20)
    escortUid: str | None = None

    @field_validator("startsAt")
    @classmethod
    def tz_required(cls, v):
        return _aware(v)


class AppointmentUpdate(APIModel):
    title: Req(120) | None = None
    providerName: Text(120) | None = None
    location: Text(200) | None = None
    durationMinutes: int | None = Field(None, ge=5, le=600)
    notes: Text(2000) | None = None
    questions: list[Req(300)] | None = Field(None, max_length=20)
    escortUid: str | None = None
    clearEscort: bool = False


class PostponeRequest(APIModel):
    newStartsAt: datetime
    reason: Text(300) = ""

    @field_validator("newStartsAt")
    @classmethod
    def tz_required(cls, v):
        return _aware(v)


class CompleteAppointment(APIModel):
    visitNotes: Text(4000) = ""


class EscortAction(APIModel):
    action: Literal["accept", "decline", "volunteer"]


TaskKind = Literal["general", "medication_check", "appointment_escort", "errand", "follow_up", "household"]


class TaskCreate(APIModel):
    title: Req(160)
    description: Text(2000) = ""
    seniorId: str | None = None
    kind: TaskKind = "general"
    dueAt: datetime | None = None
    priority: Literal["low", "normal", "high"] = "normal"
    assigneeUid: str | None = None

    @field_validator("dueAt")
    @classmethod
    def tz_required(cls, v):
        return _aware(v)


class TaskUpdate(APIModel):
    title: Req(160) | None = None
    description: Text(2000) | None = None
    dueAt: datetime | None = None
    priority: Literal["low", "normal", "high"] | None = None

    @field_validator("dueAt")
    @classmethod
    def tz_required(cls, v):
        return _aware(v)


class TaskAction(APIModel):
    note: Text(500) = ""


class ReassignRequest(APIModel):
    assigneeUid: Req(64)


class HandoverCreate(APIModel):
    toUid: Req(64)
    seniorIds: list[Req(64)] = Field(min_length=1, max_length=20)
    observations: Text(4000) = ""
    instructions: list[Req(500)] = Field(default_factory=list, max_length=30)
    scheduleChanges: Text(2000) = ""


class AcknowledgeRequest(APIModel):
    note: Text(1000) = ""


class AbsenceCreate(APIModel):
    startsAt: datetime
    endsAt: datetime
    reason: Text(300) = ""

    @model_validator(mode="after")
    def check(self):
        _aware(self.startsAt), _aware(self.endsAt)
        if self.endsAt <= self.startsAt:
            raise ValueError("Absence must end after it starts")
        return self


class CoverRequest(APIModel):
    itemType: Literal["task", "appointment"]
    itemId: Req(64)


class ConsentUpsert(APIModel):
    categories: list[Literal["medications", "appointments", "care_notes", "documents"]] = Field(max_length=4)
    expiresAt: datetime | None = None

    @field_validator("expiresAt")
    @classmethod
    def tz_required(cls, v):
        return _aware(v)


class SimulationRequest(APIModel):
    scenario: Literal["caregiver_unavailable", "appointment_postponed", "stock_depletion", "connectivity_failure"]
    uid: str | None = None
    startsAt: datetime | None = None
    endsAt: datetime | None = None
    appointmentId: str | None = None
    newStartsAt: datetime | None = None
    medicationId: str | None = None
    assumeStock: float | None = Field(None, ge=0)
    hours: int | None = Field(None, ge=1, le=168)


class EscalationStep(APIModel):
    afterMinutes: int = Field(ge=5, le=24 * 60)
    roles: list[Literal["household_owner", "family_admin", "family_member", "primary_caregiver",
                        "secondary_caregiver", "org_admin"]] = Field(min_length=1)


class QuietHours(APIModel):
    enabled: bool = True
    start: HHMM = "22:00"
    end: HHMM = "07:00"


class NotificationRules(APIModel):
    doseReminders: bool | None = None
    escalationSteps: list[EscalationStep] | None = Field(None, max_length=4)
    quietHours: QuietHours | None = None
    appointmentReminderHours: list[Annotated[int, Field(ge=1, le=168)]] | None = Field(None, max_length=4)
    escortConfirmHours: int | None = Field(None, ge=1, le=168)
    taskDueReminderHours: int | None = Field(None, ge=1, le=48)
    handoverReminderHours: int | None = Field(None, ge=1, le=72)
    lowStockAlerts: bool | None = None
    consentExpiryNoticeDays: int | None = Field(None, ge=1, le=30)


class NotificationPrefs(APIModel):
    email: bool | None = None
    push: bool | None = None


class DeviceRegistration(APIModel):
    token: Annotated[str, StringConstraints(min_length=20, max_length=4096)]
