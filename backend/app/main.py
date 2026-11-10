import hashlib
import hmac
import re
import secrets
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from app.ai import AIError, OpenAISelector, build_client
from app.auth import install_auth
from app.catalog import ASSET_ROOT, PALETTES, ROOT, public_catalog
from app.composition import compose_variants, select_components, select_offline_metaphor
from app.config import Settings
from app.db import BudgetExceeded, Project, make_engine, reserve_ai_request
from app.models import FORMATS, ComposeRequest, ProjectWrite, Scene
from app.prompts import validate_illustration_prompt
from app.svg import render_scene


def csrf_token(session: str) -> str:
    return hashlib.sha256(f"csrf:{session}".encode()).hexdigest()


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or Settings()

    @asynccontextmanager
    async def lifespan(app):
        async with build_client(config) as client:
            app.state.ai = OpenAISelector(config, client)
            yield
        app.state.engine.dispose()

    app = FastAPI(title="Иллюстрации · Очень", version="0.1.0", lifespan=lifespan)
    app.state.engine = make_engine(config.database_url)
    install_auth(app, config, csrf_token)
    app.state.ai_cache = {}
    # One worker in V1: check + add happen without an await on its event loop.
    # Reject before reserving budget, so repeated clicks cannot spend extra tokens.
    app.state.ai_active_owners = set()
    app.mount("/assets/library", StaticFiles(directory=ASSET_ROOT / "library"), name="artwork")

    @app.middleware("http")
    async def protect(request: Request, call_next):
        session = request.cookies.get("illustration_session", "")
        request.state.session = session if re.fullmatch(r"[A-Za-z0-9_-]{40,64}", session) else ""
        request.state.owner = hashlib.sha256(request.state.session.encode()).hexdigest()
        if app.state.auth.requires_auth(request.url.path) and not app.state.auth.is_authorized(
            request
        ):
            return JSONResponse({"detail": "Введите пароль для доступа"}, 401)
        if request.method in {"POST", "PUT", "DELETE", "PATCH"}:
            origin = request.headers.get("origin")
            if (origin and origin not in config.allowed_origins) or not request.state.session:
                return JSONResponse({"detail": "Обновите страницу для безопасной сессии"}, 403)
            if not hmac.compare_digest(
                request.headers.get("x-csrf-token", ""), csrf_token(session)
            ):
                return JSONResponse({"detail": "Обновите страницу для безопасной сессии"}, 403)
            try:
                if int(request.headers.get("content-length", "0")) > 262144:
                    return JSONResponse({"detail": "Запрос слишком большой"}, 413)
            except ValueError:
                return JSONResponse({"detail": "Некорректный запрос"}, 400)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(_, exc):
        fields = [".".join(str(p) for p in error["loc"][1:]) for error in exc.errors()]
        return JSONResponse({"detail": "Проверьте поля: " + ", ".join(fields)}, 422)

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/ready")
    def ready():
        try:
            with app.state.engine.connect() as connection:
                connection.execute(text("SELECT 1 FROM projects LIMIT 1"))
            return {"status": "ready"}
        except Exception:
            return JSONResponse({"status": "database_unavailable"}, 503)

    @app.get("/api/bootstrap")
    def bootstrap(request: Request, response: Response):
        session = request.state.session or secrets.token_urlsafe(32)
        response.set_cookie(
            "illustration_session",
            session,
            httponly=True,
            secure=config.cookie_secure,
            samesite="lax",
            max_age=60 * 60 * 24 * 30,
        )
        return {
            "csrf_token": csrf_token(session),
            "features": {"custom_shadows": config.custom_shadows_enabled},
            "assets": public_catalog(),
            "palettes": PALETTES,
            "formats": FORMATS,
            "ai": {
                "configured": bool(config.openai_api_key.get_secret_value()),
                "model": config.openai_model,
            },
        }

    @app.post("/api/compose")
    async def compose(payload: ComposeRequest, request: Request):
        provider = "components"
        layout = None
        try:
            validate_illustration_prompt(payload.prompt)
            if payload.mode == "components":
                families, unknown = select_components(payload.prompt)
                if unknown:
                    raise ValueError("Нет в библиотеке: " + ", ".join(unknown))
                explanation = "Подобраны названные предметы из исходной библиотеки."
            elif payload.use_ai and config.openai_api_key.get_secret_value():
                provider = "openai"
                cache_key = payload.prompt.strip().lower()
                if cache_key in app.state.ai_cache:
                    families, explanation, layout = app.state.ai_cache[cache_key]
                else:
                    active = app.state.ai_active_owners
                    owner = request.state.owner
                    if owner in active or len(active) >= 2:
                        raise HTTPException(429, "Подбор уже выполняется. Дождитесь результата.")
                    active.add(owner)
                    try:
                        reserve_ai_request(
                            app.state.engine,
                            owner,
                            config.ai_request_limit,
                            config.ai_session_limit,
                        )
                        families, explanation, layout = await app.state.ai.select(payload.prompt)
                    finally:
                        active.discard(owner)
                    if len(app.state.ai_cache) >= 64:
                        app.state.ai_cache.pop(next(iter(app.state.ai_cache)))
                    app.state.ai_cache[cache_key] = (families, explanation, layout)
            else:
                provider = "dictionary"
                families, explanation = select_offline_metaphor(payload.prompt)
            scenes = compose_variants(families, payload, layout)
            return {
                "scenes": scenes,
                "explanation": explanation,
                "provider": provider,
                "model": config.openai_model if provider == "openai" else None,
            }
        except AIError as exc:
            raise HTTPException(502, str(exc)) from None
        except BudgetExceeded as exc:
            raise HTTPException(429, str(exc)) from None
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None

    @app.post("/api/export")
    def export(scene: Scene, experimental: bool = False):
        return Response(
            render_scene(
                scene,
                custom_shadows_enabled=config.custom_shadows_enabled and experimental,
            ),
            media_type="image/svg+xml",
            headers={"Content-Disposition": 'attachment; filename="composition.svg"'},
        )

    @app.post("/api/validate")
    def validate_scene(scene: Scene):
        return scene

    def require_session(request):
        if not request.state.session:
            raise HTTPException(401, "Откройте редактор для создания сессии")

    def representation(project):
        return {
            "id": project.id,
            "scene": project.scene,
            "revision": project.revision,
            "updated_at": project.updated_at.isoformat(),
        }

    @app.get("/api/projects")
    def projects(request: Request):
        require_session(request)
        with Session(app.state.engine) as db:
            rows = db.scalars(
                select(Project)
                .where(Project.owner == request.state.owner)
                .order_by(Project.updated_at.desc())
                .limit(50)
            ).all()
            return [representation(p) for p in rows]

    @app.post("/api/projects", status_code=201)
    def create_project(payload: ProjectWrite, request: Request):
        with Session(app.state.engine) as db:
            project = Project(
                id=str(uuid4()),
                owner=request.state.owner,
                scene=payload.scene.model_dump(mode="json"),
                revision=1,
            )
            db.add(project)
            db.commit()
            db.refresh(project)
            return representation(project)

    @app.get("/api/projects/{project_id}")
    def get_project(project_id: str, request: Request):
        require_session(request)
        with Session(app.state.engine) as db:
            project = db.scalar(
                select(Project).where(
                    Project.id == project_id, Project.owner == request.state.owner
                )
            )
            if project is None:
                raise HTTPException(404, "Проект не найден")
            return representation(project)

    @app.put("/api/projects/{project_id}")
    def save_project(project_id: str, payload: ProjectWrite, request: Request):
        with Session(app.state.engine) as db:
            result = db.execute(
                update(Project)
                .where(
                    Project.id == project_id,
                    Project.owner == request.state.owner,
                    Project.revision == payload.revision,
                )
                .values(
                    scene=payload.scene.model_dump(mode="json"),
                    revision=Project.revision + 1,
                    updated_at=datetime.now(UTC),
                )
                .returning(Project.id, Project.scene, Project.revision, Project.updated_at)
            ).one_or_none()
            if result is None:
                exists = db.scalar(
                    select(Project.id).where(
                        Project.id == project_id, Project.owner == request.state.owner
                    )
                )
                raise HTTPException(
                    409 if exists else 404,
                    "Проект изменён в другой вкладке. Скачайте JSON или сохраните копию."
                    if exists
                    else "Проект не найден",
                )
            written = representation(result)
            db.commit()
            return written

    frontend = ROOT / "frontend" / "dist"
    if frontend.is_dir():
        app.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
    return app


app = create_app()
