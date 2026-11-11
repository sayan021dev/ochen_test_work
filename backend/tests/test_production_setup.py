import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

from scripts.prepare_production_env import build_values, write_env


def test_production_secrets_are_literal_and_file_is_private(tmp_path):
    password = "Разные $quotes ' and \\slashes #42"
    values = build_values(password, "sk-test-$key", "http://user:p$ss@proxy:443", 18017)
    target = tmp_path / ".env.production"
    write_env(target, values)
    assert 'SITE_PASSWORD="' in target.read_text()
    assert values["REQUIRE_SITE_PASSWORD"] == "true"
    assert values["COOKIE_SECURE"] == "true"
    assert len(values["AUTH_SECRET"]) >= 32
    assert len(values["POSTGRES_PASSWORD"]) >= 32
    assert stat.S_IMODE(target.stat().st_mode) == 0o600


def test_existing_environment_is_never_overwritten(tmp_path):
    target = tmp_path / ".env.production"
    target.write_text("keep existing secrets")
    with pytest.raises(FileExistsError):
        write_env(target, build_values("long-test-password", "", "", 18017))
    assert target.read_text() == "keep existing secrets"


@pytest.mark.parametrize("password", ["", "short", "long-password\nINJECT=true", "a" * 4097])
def test_invalid_password_cannot_create_environment(password):
    with pytest.raises(ValueError):
        build_values(password, "", "", 18017)


@pytest.mark.parametrize("port", [0, 80, 65536])
def test_production_port_must_be_unprivileged(port):
    with pytest.raises(ValueError):
        build_values("long-test-password", "", "", port)


@pytest.mark.skipif(not shutil.which("docker"), reason="Docker CLI required for Compose validation")
def test_compose_keeps_literal_credentials_and_isolates_database(tmp_path):
    values = build_values(
        "$literal 'quoted' \\slashes\\", "fake-$key", "http://a:b@proxy:443", 18017
    )
    target = tmp_path / ".env.production"
    write_env(target, values)
    env = {key: value for key, value in os.environ.items() if key not in values}
    env["RELEASE_SHA"] = "a" * 40
    command = [
        "docker",
        "compose",
        "--env-file",
        str(target),
        "-f",
        str(Path(__file__).resolve().parents[2] / "compose.production.yaml"),
        "config",
        "--format",
        "json",
    ]
    result = subprocess.run(command, env=env, capture_output=True, text=True, check=True)
    config = json.loads(result.stdout)
    web, db = config["services"]["web"], config["services"]["db"]
    # `config` escapes dollars for a second Compose read; runtime receives one dollar.
    assert web["environment"]["SITE_PASSWORD"].replace("$$", "$") == values["SITE_PASSWORD"]
    assert web["environment"]["OPENAI_API_KEY"].replace("$$", "$") == values["OPENAI_API_KEY"]
    assert web["environment"]["REQUIRE_SITE_PASSWORD"] == "true"
    assert web["environment"]["COOKIE_SECURE"] == "true"
    assert web["ports"][0]["host_ip"] == "127.0.0.1"
    assert not db.get("ports")
    assert set(db["networks"]) == {"backend"}
    assert config["networks"]["backend"]["internal"] is True
