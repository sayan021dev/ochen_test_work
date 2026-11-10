from xml.etree import ElementTree as ET

import pytest
from app.catalog import PALETTES
from app.models import Scene
from app.svg import render_scene

NS = {"s": "http://www.w3.org/2000/svg"}


@pytest.mark.parametrize("custom", [False, True])
def test_overlapping_instances_paint_all_shadows_before_all_bodies(custom):
    scene = Scene.model_validate(
        {
            "palette": PALETTES[0],
            "scale": 0.4,
            "elements": [
                {"id": "book", "family": "book", "x": 150, "y": 120},
                {
                    "id": "lamp",
                    "family": "lamp",
                    "x": 200,
                    "y": 150,
                    "shadow": {"angle": 30, "length": 1.3, "opacity": 0.8, "x": 120}
                    if custom
                    else None,
                },
            ],
        }
    )
    root = ET.fromstring(render_scene(scene))
    artwork = root.find("s:g[@clip-path]", NS)
    assert artwork[0].get("data-scene-shadows") == "true"
    assert (
        len(artwork[0].findall(".//s:g[@data-custom-shadow]", NS))
        + len(artwork[0].findall(".//s:g[@data-source-shadow]", NS))
        == 2
    )
    bodies = artwork.findall("s:g[@data-element-id]", NS)
    assert [b.get("data-element-id") for b in bodies] == ["book", "lamp"]
    assert all(not b.findall(".//s:g[@data-custom-shadow]", NS) for b in bodies)
    assert all(b.find(".//s:g[@data-shadow-body]", NS) is not None for b in bodies)
    identifiers = [node.get("id") for node in root.iter() if node.get("id")]
    assert len(identifiers) == len(set(identifiers))


def test_legacy_offset_with_zero_length_still_uses_lower_shadow_pass():
    scene = Scene.model_validate(
        {
            "palette": PALETTES[0],
            "format": "square",
            "scale": 0.2,
            "elements": [
                {
                    "id": "lamp",
                    "family": "lamp",
                    "x": 0,
                    "y": 0,
                    "shadow": {"length": 0, "x": 2000, "y": 1000},
                },
                {"id": "book", "family": "book", "x": 440, "y": 360},
            ],
        }
    )
    # The ordinary source boxes do not overlap; the historical endpoint does.
    root = ET.fromstring(render_scene(scene))
    artwork = root.find("s:g[@clip-path]", NS)
    assert artwork[0].get("data-scene-shadows") == "true"
    assert len(artwork[0].findall(".//s:g[@data-custom-shadow]", NS)) == 1
