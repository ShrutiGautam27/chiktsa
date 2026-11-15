"""Voice-First Care Companion — intent handling for spoken requests (English & Hindi).

Speech-to-text and text-to-speech run in the browser (Web Speech API) today; Google Cloud
Speech-to-Text / Text-to-Speech are pending credentials. This service turns a transcript into a
safe reply and, where useful, a PROPOSED action the user confirms with one tap (never automatic).
"""
from __future__ import annotations

import re
from datetime import timedelta

from ..ai.guardrails import is_clinical_question
from ..core.auth import CurrentUser
from ..core.rbac import P, Role
from ..core.timeutil import aware, local_date, now
from ..db import Store
from . import medications as meds
from .access import Access

PATTERNS = {
    "emergency": r"\b(help|emergency|madad|bachao|sos)\b|मदद|बचाओ",
    "took_med": r"\b(took|taken|have taken|le li|kha li|li hai|le liya|kha liya)\b|ले ली|खा ली",
    "meds_today": r"\b(medicine|medicines|medication|tablet|tablets|pill|pills|dawai|dawa|goli)\b|दवा|दवाई|गोली",
    "appointment": r"\b(appointment|doctor|checkup|check-up|daktar|clinic|hospital)\b|डॉक्टर|अस्पताल",
    "call": r"\b(call|phone|ring|baat|fon)\b|फोन|बात",
    "wellness": r"\b(feel|feeling|tabiyat|mood|check.?in)\b|तबीयत",
}

T = {
    "en": {
        "no_meds": "You have no verified medicines scheduled for the rest of today.",
        "next_meds": "Your next medicines: {list}.",
        "confirm_took": "Did you just take {name} due at {time}? Tap yes to record it.",
        "no_due": "I couldn't find a medicine due around now. Your family can check the schedule.",
        "next_appt": "Your next appointment is {title} on {when}{escort}.",
        "with": ", and {name} will go with you",
        "no_appt": "You have no upcoming appointments.",
        "call": "Calling {name}.",
        "no_contact": "I couldn't find that person in your trusted contacts.",
        "emergency": "Showing your emergency card and your first trusted contact. If this is a medical emergency, call 112 now.",
        "wellness": "Let's do today's check-in. How are you feeling?",
        "clinical": "That's a question for your doctor or nurse. I can help you remember to ask them.",
        "fallback": "I can tell you about your medicines, your next appointment, call your family, or open your emergency card.",
    },
    "hi": {
        "no_meds": "आज बाकी दिन के लिए कोई जाँची हुई दवा तय नहीं है।",
        "next_meds": "आपकी अगली दवाइयाँ: {list}।",
        "confirm_took": "क्या आपने अभी {time} वाली {name} ले ली? दर्ज करने के लिए हाँ दबाएँ।",
        "no_due": "अभी के आसपास कोई दवा तय नहीं मिली। आपका परिवार समय-सारणी देख सकता है।",
        "next_appt": "आपका अगला अपॉइंटमेंट {title} है, {when}{escort}।",
        "with": ", और {name} आपके साथ जाएँगे",
        "no_appt": "कोई आने वाला अपॉइंटमेंट नहीं है।",
        "call": "{name} को फोन कर रहे हैं।",
        "no_contact": "यह व्यक्ति आपके भरोसेमंद संपर्कों में नहीं मिला।",
        "emergency": "आपका आपातकालीन कार्ड और पहला संपर्क दिखा रहे हैं। अगर यह मेडिकल इमरजेंसी है, तो अभी 112 पर कॉल करें।",
        "wellness": "चलिए आज की तबीयत दर्ज करते हैं। आप कैसा महसूस कर रहे हैं?",
        "clinical": "यह सवाल अपने डॉक्टर या नर्स से पूछें। मैं याद रखने में मदद कर सकता हूँ।",
        "fallback": "मैं आपकी दवाइयों, अगले अपॉइंटमेंट, परिवार को फोन करने या आपातकालीन कार्ड में मदद कर सकता हूँ।",
    },
}


def detect_intent(text: str) -> str:
    low = (text or "").lower()
    if is_clinical_question(low):
        return "clinical"
    for intent, pat in PATTERNS.items():
        if re.search(pat, low):
            return intent
    return "fallback"


def handle(store: Store, actor: CurrentUser, hid: str, sid: str, text: str, lang: str) -> dict:
    acc = Access(store, actor.uid, hid)
    senior = acc.require(sid, P.SENIOR_READ)
    lang = lang if lang in T else "en"
    s = T[lang]
    tz = senior.get("timezone") or "UTC"
    intent = detect_intent(text)
    action = None
    reply = s["fallback"]
    t = now()

    def hhmm(dt):
        return aware(dt).astimezone(__import__("zoneinfo").ZoneInfo(tz)).strftime("%H:%M")

    if intent in ("meds_today", "took_med"):
        if not (acc.allowed(sid, "medications") and acc.can(P.SENIOR_MEDICAL_READ)):
            reply = s["fallback"]
        else:
            ev = meds._schedule(store, hid, sid, tz, local_date(t, tz), local_date(t, tz))
            if intent == "meds_today":
                upcoming = [e for e in ev if e["status"] in ("scheduled", "unconfirmed")]
                reply = s["no_meds"] if not upcoming else s["next_meds"].format(
                    list=", ".join(f"{e['medicationName']} {hhmm(e['scheduledFor'])}" for e in upcoming[:4]))
            else:
                near = [e for e in ev if e["status"] in ("scheduled", "unconfirmed") and abs(e["scheduledFor"] - t) <= timedelta(hours=2)]
                if near and acc.can(P.CARE_LOG_WRITE):
                    e = min(near, key=lambda x: abs(x["scheduledFor"] - t))
                    reply = s["confirm_took"].format(name=e["medicationName"], time=hhmm(e["scheduledFor"]))
                    action = {"type": "record_dose", "medicationId": e["medicationId"], "scheduledFor": e["scheduledFor"].isoformat(),
                              "status": "taken", "label": e["medicationName"]}
                else:
                    reply = s["no_due"]
    elif intent == "appointment":
        if acc.allowed(sid, "appointments") and acc.can(P.SENIOR_MEDICAL_READ):
            up = sorted([a.data for a in store.query(f"households/{hid}/seniors/{sid}/appointments")
                         if a.data["status"] == "scheduled" and aware(a.data["startsAt"]) > t], key=lambda a: a["startsAt"])
            if up:
                a = up[0]
                when = aware(a["startsAt"]).astimezone(__import__("zoneinfo").ZoneInfo(tz)).strftime("%d %b, %H:%M")
                reply = s["next_appt"].format(title=a["title"], when=when,
                                              escort=s["with"].format(name=a["escortName"]) if a.get("escortName") else "")
            else:
                reply = s["no_appt"]
    elif intent == "call":
        low = text.lower()
        contacts = senior.get("emergencyContacts", [])
        match = next((c for c in contacts if c["name"].split()[0].lower() in low or (c.get("relationship") or "-").lower() in low), None)
        if match:
            reply = s["call"].format(name=match["name"])
            action = {"type": "call", "phone": re.sub(r"[^+\d]", "", match["phone"]), "label": match["name"]}
        else:
            reply = s["no_contact"]
    elif intent == "emergency":
        reply = s["emergency"]
        first = (senior.get("emergencyContacts") or [None])[0]
        action = {"type": "emergency", "phone": re.sub(r"[^+\d]", "", first["phone"]) if first else None,
                  "label": first["name"] if first else None}
    elif intent == "wellness":
        reply = s["wellness"]
        action = {"type": "navigate", "to": "/app?checkin=1" if acc.m.role == Role.SENIOR else f"/app/households/{hid}/profiles/{sid}"}
    elif intent == "clinical":
        reply = s["clinical"]
    return {"intent": intent, "reply": reply, "lang": lang, "action": action}
