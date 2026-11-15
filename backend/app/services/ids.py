import random
import secrets
import string
from collections.abc import Iterator
from contextlib import contextmanager

_ALPHABET = string.ascii_letters + string.digits
# Set only while seeding the public demo (see deterministic_ids); never in normal operation.
_demo_rng: random.Random | None = None


def new_id() -> str:
    """Unguessable 20-char identifier (~120 bits), Firestore-style alphabet."""
    if _demo_rng is not None:
        return "".join(_demo_rng.choice(_ALPHABET) for _ in range(20))
    return secrets.token_urlsafe(15).replace("-", "a").replace("_", "b")


def new_token() -> str:
    """256-bit URL-safe token (invitations)."""
    if _demo_rng is not None:
        return "".join(_demo_rng.choice(_ALPHABET) for _ in range(43))
    return secrets.token_urlsafe(32)


@contextmanager
def deterministic_ids(seed: str) -> Iterator[None]:
    """Demo seeding only: every serverless instance seeds identical record IDs, so a session
    started on one instance is valid on the next. Demo data is public sample data; IDs need not
    be secret there. Real data always uses `secrets`."""
    global _demo_rng
    _demo_rng = random.Random(seed)  # nosec B311  # noqa: S311 - reproducible demo IDs only
    try:
        yield
    finally:
        _demo_rng = None
