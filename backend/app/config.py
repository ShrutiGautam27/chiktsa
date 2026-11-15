"""Application settings, loaded from environment variables (see .env.example)."""
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_DEV_SECRET = "dev-only-change-me-carehub-local-secret-0000000000"  # noqa: S105 - rejected in production


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Literal["development", "test", "demo", "production"] = "development"  # demo = public showcase, resets
    app_name: str = "Chiktsa"

    # Auth: "local" (dev/demo, email+password handled here) or "firebase" (production)
    auth_provider: Literal["local", "firebase"] = "local"
    jwt_secret: str = DEFAULT_DEV_SECRET
    access_token_minutes: int = 15
    refresh_token_days: int = 14

    # Data store: "memory" (dev/tests, optional JSON persistence) or "firestore"
    data_store: Literal["memory", "firestore"] = "memory"
    memory_store_path: str | None = str(Path(__file__).resolve().parent.parent / ".data" / "dev-store.json")
    firebase_project_id: str | None = None

    # CORS / cookies
    cors_origins: str = "http://localhost:5391"
    cookie_secure: bool = False

    # Rate limiting (requests per window per client for sensitive routes)
    auth_rate_limit: int = 20
    auth_rate_window_seconds: int = 60

    invitation_days: int = 7

    # Background jobs. Cloud Scheduler calls POST /api/internal/jobs/tick with X-Job-Token.
    job_token: str | None = None
    cron_secret: str | None = None             # Vercel Cron sends "Authorization: Bearer <CRON_SECRET>"
    run_scheduler_in_process: bool = True      # local development convenience; disable on Cloud Run
    scheduler_interval_seconds: int = 60

    # Delivery channels — all optional; without credentials deliveries are recorded as not configured.
    email_provider: Literal["none", "resend", "sendgrid"] = "none"
    email_api_key: str | None = None
    email_from: str = "Chiktsa <no-reply@carehub.local>"
    app_base_url: str = "http://localhost:5391"
    push_enabled: bool = False                  # Firebase Cloud Messaging via firebase-admin

    # AI. Without a key every AI workflow uses its deterministic offline engine.
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"
    ai_rate_limit_per_hour: int = 60

    # Document vault storage: "local" (dev, backend/.data/files) or "gcs" (Firebase Storage bucket)
    file_storage: Literal["local", "gcs"] = "local"
    local_file_dir: str = str(Path(__file__).resolve().parent.parent / ".data" / "files")
    storage_bucket: str | None = None
    max_upload_mb: int = 10

    def validate_for_production(self) -> None:
        if self.environment == "production":
            if self.auth_provider == "local" and self.jwt_secret == DEFAULT_DEV_SECRET:
                raise RuntimeError("Refusing to start: JWT_SECRET must be set in production.")
            if self.data_store == "memory":
                raise RuntimeError("Refusing to start: DATA_STORE=memory is not allowed in production.")
            if not self.job_token or len(self.job_token) < 32:
                raise RuntimeError("Refusing to start: JOB_TOKEN (>=32 chars) is required in production.")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
