"""Typed domain errors mapped to HTTP responses with a uniform error envelope."""
from fastapi import Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str = "", code: str | None = None) -> None:
        super().__init__(message)
        self.message = message or self.__class__.__doc__ or "Error"
        if code:
            self.code = code


class Unauthorized(AppError):
    """Authentication required."""
    status_code = 401
    code = "unauthorized"


class Forbidden(AppError):
    """You do not have permission to perform this action."""
    status_code = 403
    code = "forbidden"


class NotFound(AppError):
    """Not found."""
    status_code = 404
    code = "not_found"


class Conflict(AppError):
    """Conflict."""
    status_code = 409
    code = "conflict"


class ValidationFailed(AppError):
    """Validation failed."""
    status_code = 422
    code = "validation_failed"


class RateLimited(AppError):
    """Too many requests. Please slow down."""
    status_code = 429
    code = "rate_limited"


async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": {"code": exc.code, "message": exc.message}})
