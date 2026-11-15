"""Sliding-window in-process rate limiter for sensitive routes (auth, invitations accept).

On Cloud Run with several instances this is per-instance; pair it with Cloud Armor rate rules
in production for a global limit (documented in docs/DEPLOYMENT.md).
"""
import threading
import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from ..config import get_settings

LIMITED_PREFIXES = ("/api/auth/login", "/api/auth/signup", "/api/auth/refresh", "/api/invitations/")


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window: float) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and q[0] <= now - window:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        path = request.url.path
        if (request.method == "POST" and path.startswith(LIMITED_PREFIXES)) or path.startswith("/api/public/"):
            s = get_settings()
            client = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (
                request.client.host if request.client else "unknown")
            prefix = next((p for p in LIMITED_PREFIXES if path.startswith(p)), "/api/public/")
            if not limiter.allow(f"{client}:{prefix}", s.auth_rate_limit, s.auth_rate_window_seconds):
                return JSONResponse(status_code=429, content={"error": {"code": "rate_limited",
                                    "message": "Too many requests. Please wait a minute and try again."}})
        return await call_next(request)
