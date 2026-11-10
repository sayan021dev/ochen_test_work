import math

import pytest
from app.catalog import PALETTES
from app.lighting import effective_shadow
from app.models import Scene

ASSET = {
    "shadow": {
        "projection": {"ground": [0, 100, 200, 100], "depth": 100, "body_bbox": [0, 0, 200, 100]}
    }
}


def scene(light=None, **element):
    return Scene.model_validate(
        {
            "palette": PALETTES[0],
            "scale": 0.5,
            "light": light,
            "elements": [
                {
                    "id": "owner",
                    "family": "lamp",
                    "x": 500,
                    "y": 300,
                    "angle": 90,
                    "scale_x": 3,
                    "scale_y": 2,
                    "shadow": {"angle": 77, "length": 0.4},
                    **element,
                }
            ],
        }
    )


def test_master_off_ignores_global_and_individual_settings_without_mutating_them():
    value = scene({"enabled": True, "x": 200, "y": 450})
    before = value.model_dump()
    assert effective_shadow(value, value.elements[0], ASSET, False) is None
    assert value.model_dump() == before


def test_inactive_global_light_returns_saved_individual_shadow():
    value = scene({"enabled": False, "x": 200, "y": 450})
    assert effective_shadow(value, value.elements[0], ASSET) is value.elements[0].shadow


def test_point_light_direction_is_in_scene_space_under_rotation_and_nonuniform_scale():
    value = scene({"enabled": True, "x": 200, "y": 450, "height": 1000, "opacity": 0.35})
    result = effective_shadow(value, value.elements[0], ASSET)
    assert result.angle == pytest.approx(270)
    assert result.length == pytest.approx(2 / 9)
    assert result.opacity == 0.35
    assert (result.x, result.y, result.scale_x, result.scale_y) == (0, 0, 1, 1)
    assert value.elements[0].shadow.angle == 77


def test_light_height_changes_length_and_low_lights_remain_bounded():
    low = scene({"enabled": True, "x": -5000, "y": -5000, "height": 50})
    assert effective_shadow(low, low.elements[0], ASSET).length == 2
    near = scene({"enabled": True, "x": 200, "y": 450, "height": 500})
    high = scene({"enabled": True, "x": 200, "y": 450, "height": 2000})
    assert (
        effective_shadow(near, near.elements[0], ASSET).length
        > effective_shadow(high, high.elements[0], ASSET).length
    )
    assert math.isfinite(effective_shadow(low, low.elements[0], ASSET).angle)


def test_light_above_anchor_produces_zero_direction_not_an_invalid_number():
    value = scene({"enabled": True, "x": 400, "y": 450})
    result = effective_shadow(value, value.elements[0], ASSET)
    assert result.length == 0 and math.isfinite(result.angle)
