"""Safety guardrails applied to every AI workflow.

Rules (also given to the model in SYSTEM_RULES, and enforced again on the output):
  * never diagnose; never prescribe, start, stop or change medication; never suggest extra doses;
  * distinguish verified records from suggestions; cite source record IDs;
  * admit when information is unavailable; escalate clinical questions to a professional.
"""
from __future__ import annotations

import re

SYSTEM_RULES = """You are CareHub AI, a care-COORDINATION assistant for families of elderly people.
Strict rules:
1. Use ONLY the records provided in the context. Never invent names, dates, medicines, doses or events.
2. If the records do not contain the answer, say so plainly and set the insufficient flag.
3. Cite the record IDs you relied on. Do not cite records you did not use.
4. Never diagnose, never interpret symptoms clinically, never prescribe, never recommend starting,
   stopping, skipping or changing any medicine or dose, and never suggest taking an extra dose.
5. If asked a clinical/medical question, say it must be answered by a doctor, nurse or pharmacist
   and set the clinical escalation flag.
6. Clearly separate verified record facts from your own organisational suggestions.
7. Be concise, warm and practical. Plain language suitable for family members."""

CLINICAL_ESCALATION = ("This is a medical question. Please ask a doctor, nurse or pharmacist — CareHub can help you "
                       "prepare for that conversation but can't give medical advice.")

_UNSAFE = re.compile(
    r"\b(take (an |one )?(extra|additional|double|another) (dose|tablet|pill)|double (the|your|his|her) dose|"
    r"increase (the|your|his|her) (dose|dosage)|decrease (the|your|his|her) (dose|dosage)|"
    r"stop taking|skip (the|this|that|his|her) (dose|medicine|medication)|you (probably |likely )?have [a-z ]{3,40}(disease|infection|syndrome|disorder))",
    re.I)
_CLINICAL_Q = re.compile(
    r"\b(should (he|she|i|we|they|grandpa|grandma|dad|mom) (take|stop|increase|decrease|skip)|is it safe to|"
    r"what (dose|dosage)|how much (medicine|medication|of the)|side effects?|diagnos|symptoms? (of|mean)|"
    r"is (this|it) (serious|normal|dangerous)|can (he|she|i) take|interaction|overdose|kya (dawai|dawa) (le|lena)|"
    r"dose (badha|kam))", re.I)


def is_clinical_question(text: str) -> bool:
    return bool(_CLINICAL_Q.search(text or ""))


def contains_unsafe_advice(text: str) -> bool:
    return bool(_UNSAFE.search(text or ""))


def sanitize(text: str) -> tuple[str, bool]:
    """Return (safe_text, was_blocked). Unsafe model output is replaced, never shown."""
    if contains_unsafe_advice(text):
        return CLINICAL_ESCALATION, True
    return text, False
