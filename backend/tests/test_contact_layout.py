import hashlib

import pytest
from app.catalog import CATALOG, PALETTES, asset_for
from app.composition import compose_variants
from app.models import ComposeRequest


def test_contact_metadata_is_derived_from_all_unchanged_sources():
    for entry in CATALOG:
        asset = asset_for(entry["family"], entry["detail"], entry["role"])
        points = asset["contact"]
        assert points["source_sha256"] == hashlib.sha256(asset["svg"].encode()).hexdigest()
        for kind in ("contact", "surface"):
            x, y = points[kind]
            assert 0 <= x <= asset["width"] and 0 <= y <= asset["height"]


@pytest.mark.parametrize("detail", ["S", "L"])
@pytest.mark.parametrize("role", ["main", "background"])
@pytest.mark.parametrize(
    "prompt,owner,support",
    [
        ("телефон на книге", "phone", "book"),
        ("пазлы на книге", "puzzle", "book"),
        ("ручка на лампе", "pen", "lamp"),
        ("лампа на телефоне", "lamp", "phone"),
    ],
)
def test_physical_contact_uses_source_foot_and_receiver_interior(
    detail, role, prompt, owner, support
):
    if role == "background":
        prompt += {
            "book": ", фоновая книга",
            "lamp": ", фоновая лампа",
            "phone": ", фоновый телефон",
        }[support]
    request = ComposeRequest(prompt=prompt, mode="components", detail=detail, palette=PALETTES[0])
    for scene in compose_variants([owner, support], request):
        items = {e.family: e for e in scene.elements}
        a, b = items[owner], items[support]
        foot = asset_for(owner, detail, a.role)["contact"]["contact"]
        surface = asset_for(support, detail, b.role)["contact"]["surface"]
        assert a.x + foot[0] * scene.scale == pytest.approx(
            b.x + surface[0] * scene.scale, abs=0.001
        )
        assert a.y + foot[1] * scene.scale == pytest.approx(
            b.y + surface[1] * scene.scale, abs=0.001
        )
        assert a.support_ids == [b.id]
