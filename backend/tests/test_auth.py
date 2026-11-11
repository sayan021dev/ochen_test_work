"""The isolated fixture mirrors main's session/CSRF/gate middleware contract."""

import hashlib
import hmac
import re

import pytest
from app.auth import AUTH_COOKIE, LOGIN_LIMIT, SESSION_COOKIE, install_auth
from app.config import Settings
from app.db import Base, Budget, make_engine
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select


def csrf_token(session):
    return hashlib.sha256(f"csrf:{session}".encode()).hexdigest()


@pytest.fixture
def make_app(tmp_path):
    engines = []

    def factory(password="example-pass", secret="s" * 32, **overrides):
        config = Settings(
            _env_file=None,
            site_password=password,
            auth_secret=secret,
            database_url=f"sqlite:///{tmp_path}/auth.db",
            openai_api_key="",
            http_proxy="",
            **overrides,
        )
        app = FastAPI()
        app.state.engine = make_engine(config.database_url)
        engines.append(app.state.engine)
        Base.metadata.create_all(app.state.engine)
        install_auth(app, config, csrf_token)

        @app.middleware("http")
        async def protect(request: Request, call_next):
            session = request.cookies.get(SESSION_COOKIE, "")
            request.state.session = (
                session if re.fullmatch(r"[A-Za-z0-9_-]{40,64}", session) else ""
            )
            request.state.owner = hashlib.sha256(request.state.session.encode()).hexdigest()
            if app.state.auth.requires_auth(request.url.path) and not app.state.auth.is_authorized(
                request
            ):
                return JSONResponse({"detail": "Введите пароль для доступа"}, 401)
            if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
                origin = request.headers.get("origin")
                if (origin and origin not in config.allowed_origins) or not request.state.session:
                    return JSONResponse({"detail": "CSRF"}, 403)
                if not hmac.compare_digest(
                    request.headers.get("x-csrf-token", ""), csrf_token(session)
                ):
                    return JSONResponse({"detail": "CSRF"}, 403)
            return await call_next(request)

        for path in [
            "/api/bootstrap",
            "/api/projects",
            "/api/health",
            "/api/ready",
            "/assets/library/item.svg",
        ]:
            app.add_api_route(path, lambda: {"ok": True})
        return app

    yield factory
    for engine in engines:
        engine.dispose()


def start(client):
    response = client.get("/api/auth")
    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
    return response


def login(client, password="example-pass"):
    start(client)
    return client.post("/api/auth/login", json={"password": password})


def test_dev_mode_does_not_gate(make_app):
    with TestClient(make_app(password="")) as client:
        assert start(client).json()["required"] is False
        assert start(client).json()["authenticated"] is True
        assert client.get("/api/bootstrap").status_code == 200
        assert client.get("/assets/library/item.svg").status_code == 200


@pytest.mark.parametrize(
    "path",
    [
        "/api/bootstrap",
        "/api/projects",
        "/api/export",
        "/assets/library/item.svg",
        "/assets/library",
        "/docs",
        "/docs/oauth2-redirect",
        "/openapi.json",
        "/redoc",
    ],
)
def test_gate_protects_all_editor_data(make_app, path):
    with TestClient(make_app()) as client:
        assert client.get(path).status_code == 401


def test_status_creates_session_without_exposing_catalog(make_app):
    with TestClient(make_app()) as client:
        response = start(client)
        assert response.json() == {
            "required": True,
            "authenticated": False,
            "csrf_token": csrf_token(client.cookies[SESSION_COOKIE]),
        }
        assert len(client.cookies[SESSION_COOKIE]) == 43
        assert "httponly" in response.headers["set-cookie"].lower()
        assert "samesite=lax" in response.headers["set-cookie"].lower()
        assert "no-store" in response.headers["cache-control"]
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/ready").status_code == 200


def test_login_logout_and_wrong_password(make_app):
    with TestClient(make_app()) as client:
        assert login(client, "wrong").status_code == 401
        response = login(client)
        assert response.status_code == 200
        assert response.json()["authenticated"] is True
        assert "httponly" in response.headers["set-cookie"].lower()
        assert "max-age=28800" in response.headers["set-cookie"].lower()
        assert client.get("/api/bootstrap").status_code == 200
        assert client.get("/api/auth").json()["authenticated"] is True
        assert client.post("/api/auth/logout").json()["authenticated"] is False
        assert AUTH_COOKIE not in client.cookies
        assert client.get("/api/projects").status_code == 401


def test_real_app_protects_swagger_and_schema_with_secure_cookie(tmp_path):
    from app.main import create_app

    config = Settings(
        _env_file=None,
        site_password="test-production-password",
        require_site_password=True,
        auth_secret="a" * 64,
        cookie_secure=True,
        allowed_origins=["https://true-4.ru"],
        database_url=f"sqlite:///{tmp_path}/production.db",
        openai_api_key="",
        http_proxy="",
    )
    app = create_app(config)
    Base.metadata.create_all(app.state.engine)
    with TestClient(app, base_url="https://true-4.ru") as client:
        for path in ["/docs", "/redoc", "/openapi.json", "/api/bootstrap"]:
            assert client.get(path).status_code == 401
        start(client)
        result = client.post(
            "/api/auth/login",
            json={"password": "test-production-password"},
            headers={"Origin": "https://true-4.ru"},
        )
        assert result.status_code == 200
        auth_header = next(h for h in result.headers.get_list("set-cookie") if AUTH_COOKIE in h)
        assert all(flag in auth_header.lower() for flag in ["secure", "httponly", "samesite=lax"])
        assert "SwaggerUIBundle" in client.get("/docs").text
        assert "redoc" in client.get("/redoc").text.lower()
        assert client.get("/openapi.json").json()["openapi"].startswith("3.")
        assert len(client.get("/api/bootstrap").json()["assets"]) == 40
        assert client.post("/api/auth/logout").status_code == 200
        assert client.get("/docs").status_code == 401


def test_csrf_and_origin_required_for_login_logout(make_app):
    with TestClient(make_app()) as client:
        assert client.post("/api/auth/login", json={"password": "example-pass"}).status_code == 403
        start(client)
        assert (
            client.post(
                "/api/auth/login",
                json={"password": "example-pass"},
                headers={"X-CSRF-Token": "invalid"},
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/api/auth/login",
                json={"password": "example-pass"},
                headers={"Origin": "https://evil.invalid"},
            ).status_code
            == 403
        )
        assert login(client).status_code == 200
        assert (
            client.post("/api/auth/logout", headers={"X-CSRF-Token": "invalid"}).status_code == 403
        )
        assert client.get("/api/bootstrap").status_code == 200


def test_auth_cookie_rejects_tamper_expiry_and_session_reuse(make_app, monkeypatch):
    import app.auth as auth

    now = 1800000000
    monkeypatch.setattr(auth.time, "time", lambda: now)
    app = make_app()
    with TestClient(app) as client:
        assert login(client).status_code == 200
        token = client.cookies[AUTH_COOKIE]
        with TestClient(app) as other:
            start(other)
            other.cookies.set(AUTH_COOKIE, token)
            assert other.get("/api/bootstrap").status_code == 401
        client.cookies.set(AUTH_COOKIE, token + "x", domain="testserver.local", path="/")
        assert client.get("/api/bootstrap").status_code == 401
        client.cookies.set(AUTH_COOKIE, token, domain="testserver.local", path="/")
        now += 28800
        assert client.get("/api/bootstrap").status_code == 401


def test_password_rotation_and_secret_rotation_invalidate_existing_cookie(make_app):
    with TestClient(make_app()) as original:
        assert login(original).status_code == 200
        for app in [make_app(password="new-pass"), make_app(secret="n" * 32)]:
            with TestClient(app) as other:
                other.cookies.update(original.cookies)
                assert other.get("/api/bootstrap").status_code == 401


def test_auth_secret_fallback_expires_on_new_app(make_app):
    with TestClient(make_app(secret="")) as original:
        assert login(original).status_code == 200
        with TestClient(make_app(secret="")) as other:
            other.cookies.update(original.cookies)
            assert other.get("/api/bootstrap").status_code == 401


def test_secure_cookie_configuration(make_app):
    with TestClient(make_app(cookie_secure=True), base_url="https://testserver") as client:
        assert "secure" in start(client).headers["set-cookie"].lower()
        assert "secure" in login(client).headers["set-cookie"].lower()


def test_rate_limit_persists_ignores_spoofed_forwarded_headers_and_expires(make_app, monkeypatch):
    import app.auth as auth

    now = 1800000000
    monkeypatch.setattr(auth.time, "time", lambda: now)
    app = make_app()
    with TestClient(app) as client:
        start(client)
        for i in range(LOGIN_LIMIT):
            assert (
                client.post(
                    "/api/auth/login",
                    json={"password": "wrong"},
                    headers={"X-Forwarded-For": f"192.0.2.{i}"},
                ).status_code
                == 401
            )
    with TestClient(make_app()) as other:
        assert login(other).status_code == 429
        assert int(login(other).headers["retry-after"]) > 0
        now += 60
        assert login(other).status_code == 200
    with app.state.engine.connect() as connection:
        rows = connection.execute(select(Budget.id, Budget.count)).all()
    assert len(rows) == 2
    assert all(count == 1 for _, count in rows)


@pytest.mark.parametrize("values", [{"require_site_password": True}, {"auth_secret": "too-short"}])
def test_missing_required_password_or_short_secret_fail_closed(values):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, site_password="", **values)


def test_config_errors_do_not_expose_secret_input():
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, site_password="private-password", auth_secret="private-key")
    assert "private-password" not in str(error.value)
    assert "private-key" not in str(error.value)


def test_atomic_login_cap_under_parallel_requests(make_app):
    from concurrent.futures import ThreadPoolExecutor

    from app.auth import reserve_login
    from fastapi import HTTPException

    app = make_app()

    def attempt(_):
        try:
            reserve_login(app.state.engine, "same-peer")
            return True
        except HTTPException as error:
            assert error.status_code == 429
            return False

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(attempt, range(16)))
    assert sum(results) == LOGIN_LIMIT


def test_global_cap_bounds_client_buckets_and_preserves_ai_budgets(make_app, monkeypatch):
    import app.auth as auth
    from fastapi import HTTPException
    from sqlalchemy import insert

    monkeypatch.setattr(auth, "GLOBAL_LOGIN_LIMIT", 3)
    app = make_app()
    with app.state.engine.begin() as connection:
        connection.execute(insert(Budget).values(id="2026-11-10:global", count=7))
    for host in ["first-peer", "second-peer", "third-peer"]:
        auth.reserve_login(app.state.engine, host)
    with pytest.raises(HTTPException) as error:
        auth.reserve_login(app.state.engine, "fourth-peer")
    assert error.value.status_code == 429
    with app.state.engine.connect() as connection:
        rows = dict(connection.execute(select(Budget.id, Budget.count)).all())
    assert len(rows) == 5  # one AI budget, three client buckets, one global bucket
    assert rows["2026-11-10:global"] == 7


@pytest.mark.parametrize("password", ["", "x" * 4097, None, 123])
def test_invalid_password_body_is_rejected(make_app, password):
    with TestClient(make_app()) as client:
        start(client)
        assert client.post("/api/auth/login", json={"password": password}).status_code == 422
