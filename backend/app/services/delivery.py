"""Delivery channels for notifications: in-app (always), email (Resend / SendGrid), push (FCM).

Without credentials a channel records `skipped_not_configured` — CareHub never reports a delivery
that did not happen. Message bodies are already data-minimised by the caller (no medicine names or
clinical details), because email and push leave our infrastructure.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from ..config import get_settings
from ..core.timeutil import now

log = logging.getLogger("carehub.delivery")


def _record(channel: str, status: str, error: str | None = None) -> dict[str, Any]:
    return {"channel": channel, "status": status, "at": now(), **({"error": error} if error else {})}


def send_email(to: str, subject: str, body: str, link: str) -> dict[str, Any]:
    s = get_settings()
    if s.email_provider == "none" or not s.email_api_key:
        return _record("email", "skipped_not_configured")
    url = s.app_base_url.rstrip("/") + link
    text = f"{body}\n\nOpen CareHub: {url}\n\nYou can change notification settings in CareHub → Settings."
    try:
        if s.email_provider == "resend":
            r = httpx.post("https://api.resend.com/emails", timeout=10,
                           headers={"Authorization": f"Bearer {s.email_api_key}"},
                           json={"from": s.email_from, "to": [to], "subject": subject, "text": text})
        else:
            r = httpx.post("https://api.sendgrid.com/v3/mail/send", timeout=10,
                           headers={"Authorization": f"Bearer {s.email_api_key}"},
                           json={"personalizations": [{"to": [{"email": to}]}], "from": {"email": s.email_from},
                                 "subject": subject, "content": [{"type": "text/plain", "value": text}]})
        if r.status_code >= 300:
            return _record("email", "failed", f"HTTP {r.status_code}")
        return _record("email", "delivered")
    except httpx.HTTPError as e:  # network failure: record, never raise into the job loop
        log.warning('"email delivery failed: %s"', type(e).__name__)
        return _record("email", "failed", type(e).__name__)


def send_push(tokens: list[str], title: str, body: str, link: str) -> dict[str, Any]:
    s = get_settings()
    if not s.push_enabled:
        return _record("push", "skipped_not_configured")
    if not tokens:
        return _record("push", "skipped_no_device")
    try:  # pragma: no cover - requires a Firebase project with FCM
        from firebase_admin import messaging

        msg = messaging.MulticastMessage(tokens=tokens, notification=messaging.Notification(title=title, body=body),
                                         webpush=messaging.WebpushConfig(fcm_options=messaging.WebpushFCMOptions(link=link)))
        res = messaging.send_each_for_multicast(msg)
        return _record("push", "delivered" if res.success_count else "failed",
                       None if res.success_count else f"{res.failure_count} failures")
    except Exception as e:  # noqa: BLE001
        return _record("push", "failed", type(e).__name__)


def channel_status() -> dict[str, str]:
    s = get_settings()
    return {"in_app": "active",
            "email": "configured" if s.email_provider != "none" and s.email_api_key else "not_configured",
            "push": "configured" if s.push_enabled else "not_configured"}
