import pytest
from app.catalog import PALETTES
from app.config import Settings
from app.db import Base
from app.main import create_app
from fastapi.testclient import TestClient


@pytest.fixture
def app(tmp_path):
    app = create_app(
        Settings(
            _env_file=None,
            database_url=f"sqlite:///{tmp_path}/test.db",
            openai_api_key="",
            http_proxy="",
            allowed_origins=["http://testserver"],
        )
    )
    Base.metadata.create_all(app.state.engine)
    yield app
    app.state.engine.dispose()


@pytest.fixture
def client(app):
    with TestClient(app) as client:
        bootstrap = client.get("/api/bootstrap").json()
        client.headers["X-CSRF-Token"] = bootstrap["csrf_token"]
        yield client


def composition(client):
    response = client.post(
        "/api/compose",
        json={
            "prompt": "книга, лампа, монета",
            "mode": "components",
            "palette": PALETTES[0],
            "use_ai": False,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["scenes"][0]


def test_catalog_and_export_are_standalone(client):
    data = client.get("/api/bootstrap").json()
    assert len(data["assets"]) == 40
    assert data["ai"]["configured"] is False
    assert "api_key" not in str(data)
    result = client.post("/api/export", json=composition(client))
    assert result.status_code == 200
    assert "image/svg+xml" in result.headers["content-type"]
    assert "data-source-node" in result.text


def test_project_roundtrip_revision_and_session_isolation(client, app):
    scene = composition(client)
    created = client.post("/api/projects", json={"scene": scene}).json()
    assert created["revision"] == 1
    assert client.get(f"/api/projects/{created['id']}").json()["scene"] == scene
    scene["title"] = "Изменённый проект"
    updated = client.put(f"/api/projects/{created['id']}", json={"scene": scene, "revision": 1})
    assert updated.json()["revision"] == 2
    assert (
        client.put(
            f"/api/projects/{created['id']}", json={"scene": scene, "revision": 1}
        ).status_code
        == 409
    )
    with TestClient(app) as other:
        other.get("/api/bootstrap")
        assert other.get(f"/api/projects/{created['id']}").status_code == 404
        assert other.get("/api/projects").json() == []


def test_missing_csrf_and_foreign_origin_cannot_write(client):
    payload = {"prompt": "лампа", "mode": "components", "palette": PALETTES[0]}
    assert (
        client.post("/api/compose", json=payload, headers={"X-CSRF-Token": "wrong"}).status_code
        == 403
    )
    assert (
        client.post(
            "/api/compose", json=payload, headers={"Origin": "https://evil.invalid"}
        ).status_code
        == 403
    )


@pytest.mark.parametrize("payload", [{"prompt": " "}, {"prompt": "x" * 1001}])
def test_invalid_prompt_is_rejected(client, payload):
    assert client.post("/api/compose", json={"palette": PALETTES[0], **payload}).status_code == 422


def test_unknown_components_are_reported_without_silent_replacement(client):
    r = client.post(
        "/api/compose",
        json={"prompt": "лампа, дракон", "mode": "components", "palette": PALETTES[0]},
    )
    assert r.status_code == 422
    assert "дракон" in r.json()["detail"]


def test_no_key_has_honest_offline_mode(client):
    r = client.post(
        "/api/compose", json={"prompt": "Собрать знания в систему", "palette": PALETTES[0]}
    )
    assert r.status_code == 200
    assert r.json()["provider"] == "dictionary"


def test_atomic_ai_budget_survives_new_connection(client, app):
    from app.db import reserve_ai_request

    for _ in range(2):
        reserve_ai_request(app.state.engine, "owner", global_limit=3, session_limit=2)
    with pytest.raises(ValueError):
        reserve_ai_request(app.state.engine, "owner", global_limit=3, session_limit=2)
    reserve_ai_request(app.state.engine, "other", global_limit=3, session_limit=2)
    with pytest.raises(ValueError):
        reserve_ai_request(app.state.engine, "third", global_limit=3, session_limit=2)
