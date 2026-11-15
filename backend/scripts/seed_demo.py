"""DEMO DATA ONLY — seeds the local development store with the multi-household scenarios from the
product brief. Refuses to run in production or against Firestore.

    cd backend && .venv/Scripts/python -m scripts.seed_demo      (Windows)
    cd backend && .venv/bin/python -m scripts.seed_demo          (macOS/Linux)

All demo accounts use the password in DEMO_PASSWORD below and @example.com addresses.
  Household A "Sharma Family — Delhi": Grandfather, Grandmother, Uncle (Scenario A: several elders)
  Household B "Verma Family — Pune":  Grandfather, Grandmother
  Household C "Iyer Home — Chennai":  one elder
  priya@example.com   belongs to A (family admin) and B (family member)        (Scenario B)
  anita@example.com   primary caregiver in A (2 elders only) and B (all)       (Scenario C)
  kamla@example.com   senior login linked to Grandmother in A (Senior Mode)
"""
from __future__ import annotations

import os
import sys

from app.config import get_settings
from app.core.auth import CurrentUser
from app.db import get_store
from app.services import households, invitations, seniors, users

DEMO_PASSWORD = "CareHubDemo2026"

ACCOUNTS = {
    "ravi": ("Ravi Sharma", "ravi@example.com"),
    "meera": ("Meera Verma", "meera@example.com"),
    "lakshmi": ("Lakshmi Iyer", "lakshmi@example.com"),
    "priya": ("Priya Sharma", "priya@example.com"),
    "anita": ("Anita Desai", "anita@example.com"),
    "kamla": ("Kamla Sharma", "kamla@example.com"),
}


def main() -> None:
    s = get_settings()
    if s.environment == "production" or s.data_store != "memory":
        sys.exit("Refusing to seed: demo data is only allowed in the local development memory store.")
    store = get_store()
    if users.find_by_email(store, "ravi@example.com"):
        sys.exit("Demo data already present. Delete backend/.data/dev-store.json to reseed.")
    seed(store)
    print("Demo data seeded into", s.memory_store_path)
    print("Accounts:", ", ".join(e for _, e in ACCOUNTS.values()))
    print("Password for every demo account is DEMO_PASSWORD in backend/scripts/seed_demo.py")


def seed(store) -> None:
    """Create the demo households. Never runs in production or against Firestore."""
    s = get_settings()
    if s.environment == "production" or s.data_store != "memory":
        raise RuntimeError("Demo seeding is only allowed in non-production memory stores.")

    actors: dict[str, CurrentUser] = {}
    for key, (name, email) in ACCOUNTS.items():
        doc = users.signup_local(store, email, DEMO_PASSWORD, name, "Asia/Kolkata", "en")
        actors[key] = CurrentUser(uid=doc.id, email=email, display_name=name)

    def invite(owner, hid, who, role, scope="all", linked=None):
        inv = invitations.create(store, actors[owner], hid, {"email": actors[who].email, "role": role,
                                                             "seniorScope": scope, "linkedSeniorId": linked})
        invitations.accept_by_token(store, actors[who], inv["token"])

    def senior(owner, hid, name, preferred, dob, lang="hi", gender="undisclosed", notes=""):
        return seniors.create(store, actors[owner], hid, {
            "fullName": name, "preferredName": preferred, "dateOfBirth": dob, "gender": gender,
            "primaryLanguage": lang, "notes": notes, "emergencyContacts": [], "timezone": None})["id"]

    a = households.create(store, actors["ravi"], "Sharma Family — Delhi", "Asia/Kolkata")["id"]
    a1 = senior("ravi", a, "Mohan Lal Sharma", "Dadaji", "1944-02-11", gender="male", notes="Morning walks; prefers Hindi.")
    a2 = senior("ravi", a, "Kamla Sharma", "Dadi", "1948-09-23", gender="female")
    senior("ravi", a, "Suresh Sharma", "Chachaji", "1958-06-04", gender="male", lang="en")

    b = households.create(store, actors["meera"], "Verma Family — Pune", "Asia/Kolkata")["id"]
    senior("meera", b, "Harish Verma", "Nanaji", "1946-12-01", gender="male")
    senior("meera", b, "Sunita Verma", "Nani", "1950-03-17", gender="female")

    c = households.create(store, actors["lakshmi"], "Iyer Home — Chennai", "Asia/Kolkata")["id"]
    senior("lakshmi", c, "Venkatesh Iyer", "Appa", "1941-07-30", gender="male", lang="en")

    invite("ravi", a, "priya", "family_admin")
    invite("meera", b, "priya", "family_member")
    invite("ravi", a, "anita", "primary_caregiver", scope=[a1, a2])
    invite("meera", b, "anita", "primary_caregiver")
    invite("ravi", a, "kamla", "senior", linked=a2)

    seed_care_records(store, actors, a, a1, a2)


def seed_care_records(store, actors, hid, mohan, kamla) -> None:
    """Phase 2 demo records so every intelligence engine has something real to analyse."""
    from datetime import timedelta

    from app.core.timeutil import now
    from app.services import appointments, handovers, medications, tasks

    ravi, anita, priya, kamla_u = actors["ravi"], actors["anita"], actors["priya"], actors["kamla"]
    start = (now() - timedelta(days=10)).date().isoformat()
    base = {"form": "tablet", "doseUnit": "tablet", "route": "oral", "daysOfWeek": list(range(7)), "endDate": None,
            "prescriber": "Dr. Rao", "source": "manual", "prescriptionText": "", "uncertainFields": [], "lowStockDays": 7,
            "pharmacy": "Apollo Pharmacy", "startDate": start}

    def med(sid, **kw):
        return medications.create(store, ravi, hid, sid, {**base, **kw})["id"]

    m1 = med(mohan, name="Metformin", strength="500 mg", doseQuantity=1, frequencyText="BD", times=["08:00", "20:00"],
             instructions="After food", stockQuantity=9, responsibleUid=anita.uid)
    medications.verify(store, anita, hid, mohan, m1, False, "Checked against Dr. Rao's prescription")
    m2 = med(mohan, name="Amlodipine", strength="5 mg", doseQuantity=1, frequencyText="OD", times=["09:00"],
             stockQuantity=40, responsibleUid=None)
    medications.verify(store, anita, hid, mohan, m2, True, "")
    med(mohan, name="Atorvastatin", strength="10 mg", doseQuantity=1, frequencyText="HS", times=["21:00"], source="prescription",
        prescriptionText="Tab Atorvastatin 10mg ? at night", uncertainFields=["doseQuantity"], responsibleUid=anita.uid)
    m4 = med(kamla, name="Levothyroxine", strength="50 mcg", doseQuantity=1, frequencyText="OD", times=["07:00"],
             instructions="Empty stomach", stockQuantity=60, responsibleUid=kamla_u.uid)
    medications.verify(store, ravi, hid, kamla, m4, False, "")

    t = now()
    appointments.create(store, ravi, hid, mohan, {"title": "Cardiology follow-up", "providerName": "Dr. Mehta",
                        "location": "Max Hospital, Saket", "startsAt": t + timedelta(hours=26), "durationMinutes": 45,
                        "notes": "", "questions": ["Is the new blood pressure dose working?"], "escortUid": None})
    appointments.create(store, ravi, hid, kamla, {"title": "Eye check-up", "providerName": "Dr. Kapoor", "location": "Centre for Sight",
                        "startsAt": t + timedelta(days=4), "durationMinutes": 30, "notes": "", "questions": [],
                        "escortUid": priya.uid})

    def task(title, assignee=None, sid=None, hours=None, kind="general", accept=False):
        x = tasks.create(store, ravi, hid, {"title": title, "description": "", "seniorId": sid, "kind": kind, "priority": "normal",
                                           "dueAt": (t + timedelta(hours=hours)) if hours else None,
                                           "assigneeUid": assignee.uid if assignee else None})
        if accept and assignee:
            tasks.accept(store, assignee, hid, x["id"])
        return x["id"]

    done = task("Collect blood test report", anita, mohan, 2, accept=True)
    tasks.complete(store, anita, hid, done, "Report uploaded to the family")
    task("Refill weekly pill organiser", anita, mohan, 30, kind="medication_check", accept=True)
    task("Book physiotherapy session", anita, mohan, 72, accept=True)
    task("Pick up Dadi's new glasses", anita, kamla, 96)
    task("Arrange transport to hospital", anita, mohan, 24, accept=True)
    task("Buy groceries for the week", None, None, 8, kind="household")
    handovers.create_handover(store, anita, hid, {"toUid": priya.uid, "seniorIds": [kamla], "instructions": ["Remind Dadi about her eye drops"],
                                                  "observations": "Dadi slept well and had a good appetite.", "scheduleChanges": ""})


if __name__ == "__main__":
    os.environ.setdefault("ENVIRONMENT", "development")
    main()
