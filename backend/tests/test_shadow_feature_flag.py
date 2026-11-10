"""The experiment can be disabled without suppressing ordinary receiver shadows."""

import pytest
from app.catalog import PALETTES
from app.config import Settings
from app.db import Base
from app.main import create_app
from fastapi.testclient import TestClient


@pytest.mark.parametrize("enabled", [False, True])
def test_bootstrap_and_export_respect_custom_shadow_master_flag(tmp_path, enabled):
    app = create_app(
        Settings(
            _env_file=None,
            database_url=f"sqlite:///{tmp_path}/flag.db",
            openai_api_key="",
            http_proxy="",
            custom_shadows_enabled=enabled,
            allowed_origins=["http://testserver"],
        )
    )
    Base.metadata.create_all(app.state.engine)
    try:
        with TestClient(app) as client:
            bootstrap = client.get("/api/bootstrap").json()
            assert bootstrap["features"]["custom_shadows"] is enabled
            client.headers["X-CSRF-Token"] = bootstrap["csrf_token"]
            scene = {
                "palette": PALETTES[0],
                "scale": 0.4,
                "light": {"enabled": True, "x": 100, "y": 50, "height": 1000, "opacity": 0.5},
                "elements": [
                    {"id": "phone", "family": "phone", "x": 100, "y": 350},
                    {
                        "id": "lamp",
                        "family": "lamp",
                        "x": 120,
                        "y": 0,
                        "support_ids": ["phone"],
                        "shadow": {"angle": 135},
                    },
                ],
            }
            saved = client.post("/api/projects", json={"scene": scene}).json()
            loaded = client.get(f"/api/projects/{saved['id']}").json()["scene"]
            # Disable rendering/interaction without deleting saved settings.
            assert loaded["light"]["enabled"] is True
            assert loaded["elements"][1]["shadow"]["angle"] == 135
            exported = client.post("/api/export", json=loaded)
            assert exported.status_code == 200, exported.text
            assert "data-contact-shadow-owner" in exported.text
            assert ('data-custom-shadow="true"' in exported.text) is enabled
            if not enabled:
                assert "body-silhouette" not in exported.text
    finally:
        app.state.engine.dispose()
