"""CareHub AI API — application factory."""
import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.routes import ai, auth, care, households, internal, me, phase5
from .config import get_settings
from .core.errors import AppError, app_error_handler
from .core.logging import RequestLogMiddleware, configure_logging
from .core.ratelimit import RateLimitMiddleware


def _scheduler_loop(stop: threading.Event, interval: int) -> None:
    """Development scheduler. In production Cloud Scheduler calls /api/internal/jobs/tick instead."""
    from .db import get_store
    from .services.jobs import run_tick

    log = logging.getLogger("carehub.scheduler")
    while not stop.wait(interval):
        try:
            run_tick(get_store())
        except Exception:  # keep the loop alive; errors are logged without care data
            log.exception('"scheduled tick failed"')


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    stop = threading.Event()
    if s.environment == "demo" and s.data_store == "memory":
        # Public demo: every cold start begins with the same seeded households.
        from .db import get_store
        from .services.users import find_by_email

        store = get_store()
        if not find_by_email(store, "ravi@example.com"):
            from scripts.seed_demo import seed

            seed(store)
    if s.run_scheduler_in_process and s.environment == "development":
        threading.Thread(target=_scheduler_loop, args=(stop, s.scheduler_interval_seconds), daemon=True,
                         name="carehub-scheduler").start()
    yield
    stop.set()


def create_app() -> FastAPI:
    settings = get_settings()
    settings.validate_for_production()
    configure_logging()

    app = FastAPI(title="CareHub AI API", version="0.3.0", docs_url="/api/docs", openapi_url="/api/openapi.json",
                  redoc_url=None, lifespan=lifespan)
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(RequestLogMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=True,
                       allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
                       allow_headers=["Authorization", "Content-Type", "X-Request-Id"])

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        resp = await call_next(request)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/docs"):
            resp.headers["Cache-Control"] = "no-store"  # never cache care data in shared caches
        return resp

    app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_: Request, exc: RequestValidationError):
        fields = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
        return JSONResponse(status_code=422, content={"error": {"code": "validation_failed",
                            "message": "Some fields are invalid.", "fields": fields}})

    for r in (auth.router, me.router, ai.router, phase5.router, care.router, households.router, internal.router):
        app.include_router(r, prefix="/api")

    @app.get("/api/health", tags=["ops"])
    def health() -> dict:
        return {"status": "ok", "authProvider": settings.auth_provider, "dataStore": settings.data_store,
                "environment": settings.environment}

    return app


app = create_app()
