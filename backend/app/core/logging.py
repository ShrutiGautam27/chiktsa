"""Structured request logging. Never logs bodies, tokens or care-record contents (no PHI)."""
import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = logging.getLogger("carehub")


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format='{"t":"%(asctime)s","lvl":"%(levelname)s","msg":%(message)s}')


class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        start = time.perf_counter()
        response = await call_next(request)
        ms = (time.perf_counter() - start) * 1000
        # Path templates would be ideal; raw path contains only opaque IDs, never names/medical data.
        logger.info('"%s %s %s %.1fms rid=%s"', request.method, request.url.path, response.status_code, ms, rid)
        response.headers["x-request-id"] = rid
        return response
