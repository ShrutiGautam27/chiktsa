from typing import Annotated, Literal

from pydantic import EmailStr, StringConstraints, field_validator

from .common import APIModel, Name, TimeZone

Password = Annotated[str, StringConstraints(min_length=10, max_length=128)]


class SignupRequest(APIModel):
    email: EmailStr
    password: Password
    displayName: Name
    timezone: TimeZone = "Asia/Kolkata"
    locale: Literal["en", "hi"] = "en"

    @field_validator("password")
    @classmethod
    def strength(cls, v: str) -> str:
        if not any(c.isalpha() for c in v) or not any(c.isdigit() for c in v):
            raise ValueError("Password must contain letters and numbers")
        return v


class LoginRequest(APIModel):
    email: EmailStr
    password: Annotated[str, StringConstraints(min_length=1, max_length=128)]


class TokenResponse(APIModel):
    accessToken: str
    expiresIn: int
    user: "UserOut"


from .users import UserOut  # noqa: E402

TokenResponse.model_rebuild()
