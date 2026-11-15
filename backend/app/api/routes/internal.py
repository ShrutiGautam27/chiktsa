"""Internal job endpoints — called by Cloud Scheduler, never by browsers.

Authentication: a shared secret in the `X-Job-Token` header (constant-time comparison). On Cloud
Run, restrict the scheduler's invocation further with an OIDC-authenticated job (see DEPLOYMENT.md).
"""
import hmac

from fastapi import APIRouter, Depends, Header

from ...config import get_settings
from ...core.errors import NotFound, Unauthorized
from ...db import Store, get_store
from ...services import jobs

router = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)


def require_job_token(x_job_token: str | None = Header(default=None)) -> None:
    expected = get_settings().job_token
    if not expected:
        raise NotFound("Not found.")  # endpoint disabled unless a token is configured
    if not x_job_token or not hmac.compare_digest(x_job_token, expected):
        raise Unauthorized("Invalid job token.")


@router.post("/jobs/tick", dependencies=[Depends(require_job_token)])
def tick(store: Store = Depends(get_store)) -> dict:
    return jobs.run_tick(store)


def require_cron_secret(authorization: str | None = Header(default=None)) -> None:
    secret = get_settings().cron_secret
    if not secret:
        raise NotFound("Not found.")
    if not authorization or not hmac.compare_digest(authorization, f"Bearer {secret}"):
        raise Unauthorized("Invalid cron credentials.")


@router.get("/jobs/cron", dependencies=[Depends(require_cron_secret)])
def cron(store: Store = Depends(get_store)) -> dict:
    """Vercel Cron entry point (GET with a bearer secret). Same idempotent tick."""
    return jobs.run_tick(store)
