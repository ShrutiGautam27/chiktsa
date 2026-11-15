import secrets


def new_id() -> str:
    """Unguessable 20-char identifier (~120 bits), Firestore-style alphabet."""
    return secrets.token_urlsafe(15).replace("-", "a").replace("_", "b")


def new_token() -> str:
    """256-bit URL-safe token (invitations)."""
    return secrets.token_urlsafe(32)
