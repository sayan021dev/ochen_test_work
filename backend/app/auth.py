"""Optional shared-password gate, independent from editor ownership and AI keys.

The main HTTP middleware establishes request.state.session and validates CSRF
for mutations before calling these routes. Keep its gate check before bootstrap.
"""

import hashlib
import hmac
import re
import secrets
import time
from collections.abc import Callable

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy import delete, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.config import Settings
from app.db import Budget

SESSION_COOKIE = "illustration_session"
AUTH_COOKIE = "illustration_auth"
AUTH_LIFETIME = 8 * 60 * 60
LOGIN_LIMIT = 5
GLOBAL_LOGIN_LIMIT = 120
PUBLIC_PATHS = frozenset(
    {
        "/api/auth",
        "/api/auth/login",
        "/api/auth/logout",
        "/api/health",
        "/api/ready",
    }
)


class Login(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: SecretStr = Field(min_length=1, max_length=4096)


class SiteAuth:
    def __init__(self, config: Settings):
        password = config.site_password.get_secret_value()
        self.required = bool(password)
        secret = config.auth_secret.get_secret_value().encode() or secrets.token_bytes(32)
        self._salt = hmac.digest(secret, b"site-password-salt-v1", "sha256")
        self._password_hash = self._hash_password(password)
        # Password rotation invalidates signed cookies even with a stable AUTH_SECRET.
        self._signing_key = hmac.digest(secret, self._password_hash, "sha256")

    def _hash_password(self, password: str) -> bytes:
        return hashlib.scrypt(password.encode(), salt=self._salt, n=16384, r=8, p=1)

    def accepts_password(self, password: str) -> bool:
        return hmac.compare_digest(self._hash_password(password), self._password_hash)

    def requires_auth(self, path: str) -> bool:
        if not self.required or path in PUBLIC_PATHS:
            return False
        return any(
            path == prefix or path.startswith(prefix + "/")
            for prefix in (
                "/api",
                "/assets/library",
                "/docs",
                "/redoc",
                "/openapi.json",
            )
        )

    def _signature(self, session: str, expiry: str) -> str:
        return hmac.new(
            self._signing_key, f"site-auth-v1:{session}:{expiry}".encode(), hashlib.sha256
        ).hexdigest()

    def issue_token(self, session: str) -> str:
        expiry = str(int(time.time()) + AUTH_LIFETIME)
        return f"{expiry}.{self._signature(session, expiry)}"

    def is_authorized(self, request: Request) -> bool:
        if not self.required:
            return True
        session = getattr(request.state, "session", "")
        token = request.cookies.get(AUTH_COOKIE, "")
        if not session or not re.fullmatch(r"[0-9]{1,12}\.[0-9a-f]{64}", token):
            return False
        expiry, signature = token.split(".")
        return int(expiry) > time.time() and hmac.compare_digest(
            signature, self._signature(session, expiry)
        )


def reserve_login(engine, host: str):
    """Atomic minute caps in the existing budget table, with bounded retention.

    Only the ASGI peer is used; arbitrary forwarded headers cannot reset a cap.
    The global cap bounds new client buckets created in each minute.
    """
    now = int(time.time())
    minute = now // 60
    prefix = f"auth:{minute:012d}:"
    client = hashlib.sha256(host.encode()).hexdigest()
    insert = sqlite_insert if engine.dialect.name == "sqlite" else pg_insert
    with engine.begin() as connection:
        connection.execute(delete(Budget).where(Budget.id.like("auth:%"), Budget.id < prefix))
        for identifier, limit in [
            (prefix + "global", GLOBAL_LOGIN_LIMIT),
            (prefix + client, LOGIN_LIMIT),
        ]:
            connection.execute(
                insert(Budget).values(id=identifier, count=0).on_conflict_do_nothing()
            )
            used = connection.execute(
                update(Budget)
                .where(Budget.id == identifier, Budget.count < limit)
                .values(count=Budget.count + 1)
                .returning(Budget.count)
            ).scalar_one_or_none()
            if used is None:
                raise HTTPException(
                    429,
                    "Слишком много попыток входа. Подождите минуту.",
                    headers={"Retry-After": str(60 - now % 60)},
                )


def install_auth(app: FastAPI, config: Settings, csrf_token: Callable[[str], str]):
    auth = SiteAuth(config)
    app.state.auth = auth

    def status(request: Request, response: Response, authenticated: bool | None = None):
        session = getattr(request.state, "session", "") or secrets.token_urlsafe(32)
        response.headers["Cache-Control"] = "no-store"
        response.set_cookie(
            SESSION_COOKIE,
            session,
            httponly=True,
            secure=config.cookie_secure,
            samesite="lax",
            max_age=60 * 60 * 24 * 30,
        )
        return {
            "required": auth.required,
            "authenticated": auth.is_authorized(request)
            if authenticated is None
            else authenticated,
            "csrf_token": csrf_token(session),
        }

    @app.get("/api/auth")
    def auth_status(request: Request, response: Response):
        return status(request, response)

    @app.post("/api/auth/login")
    def login(payload: Login, request: Request, response: Response):
        if auth.required:
            reserve_login(app.state.engine, request.client.host if request.client else "unknown")
            if not auth.accepts_password(payload.password.get_secret_value()):
                raise HTTPException(401, "Неверный пароль")
            response.set_cookie(
                AUTH_COOKIE,
                auth.issue_token(request.state.session),
                httponly=True,
                secure=config.cookie_secure,
                samesite="lax",
                max_age=AUTH_LIFETIME,
            )
        return status(request, response, authenticated=True)

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response):
        response.delete_cookie(
            AUTH_COOKIE, httponly=True, secure=config.cookie_secure, samesite="lax"
        )
        return status(request, response, authenticated=not auth.required)
