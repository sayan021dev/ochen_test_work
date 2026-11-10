"""Deterministic native-render fixtures; only this test cohort substitutes SVGs."""

import json
from unittest.mock import patch

from app import svg as svg_module
from app.catalog import PALETTES, asset_for
from app.composition import compose_variants
from app.models import ComposeRequest, Scene, SceneLight, Shadow

PROMPT = "лампа стоит на телефоне и на лампе лежит ручка"


def _record(name, scene, enabled=True, replacements=None, samples=None):
    selected = {}
    for element in scene.elements:
        asset = (
            replacements[element.family]
            if replacements
            else asset_for(element.family, scene.detail, element.role)
        )
        selected[asset["id"]] = asset
    public = [
        {key: value for key, value in asset.items() if key != "svg"} for asset in selected.values()
    ]
    with patch.object(
        svg_module,
        "asset_for",
        side_effect=lambda family, detail, role: (
            replacements[family] if replacements else asset_for(family, detail, role)
        ),
    ):
        exported = svg_module.render_scene(scene, custom_shadows_enabled=enabled)
    return {
        "name": name,
        "scene": scene.model_dump(),
        "enabled": enabled,
        "assets": public,
        "sources": {key: asset["svg"] for key, asset in selected.items()},
        "exported": exported,
        "samples": samples,
    }


def _synthetic_asset(family, body, cast, width=240, height=260):
    return {
        "id": f"fixture-{family}",
        "family": family,
        "detail": "L",
        "role": "main",
        "source_node_id": f"fixture:{family}",
        "width": width,
        "height": height,
        "svg": (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}" fill="none"><g transform="translate(0 0)">'
            f'<path id="body" d="{body}" fill="#F9A3AA" fill-rule="evenodd"/>'
            f'<path id="cast" d="{cast}" fill="#181817"/></g></svg>'
        ),
        "shadow": {
            "body_path_ids": ["body"],
            "cast_path_ids": ["cast"],
            "outline": 0,
            "anchor": [100, 190],
            "width": 180,
            "height": 180,
            "projection": {
                "ground": [10, 190, 190, 190],
                "depth": 30,
                "body_bbox": [10, 10, 180, 180],
            },
        },
    }


def build_fixtures():
    result = []
    for detail in ("L", "S"):
        request = ComposeRequest(
            prompt=PROMPT, mode="components", detail=detail, palette=PALETTES[0], use_ai=False
        )
        variants = compose_variants(["lamp", "phone", "pen"], request)
        for index, scene in enumerate(variants):
            result.append(_record(f"chain-{detail}-{index}-source", scene, False))
        source = variants[0]
        custom = source.model_copy(deep=True)
        custom.light = SceneLight(enabled=True, x=50, y=50, height=1000, opacity=0.35)
        result.append(_record(f"chain-{detail}-global", custom))
        custom.elements[-1].shadow = Shadow(angle=135, length=1.2, opacity=0.6)
        result.append(_record(f"chain-{detail}-flag-off", custom, False))
    replacements = {
        "phone": _synthetic_asset(
            "phone", "M10 10H190V190H10Z M70 70H130V130H70Z", "M0 220H200V240H0Z"
        ),
        "book": _synthetic_asset("book", "M20 30H180V60H20Z", "M0 220H200V240H0Z"),
        "pen": _synthetic_asset("pen", "M1000 10H1020V30H1000Z", "M0 0H900V900H0Z", 1200, 1000),
    }
    for transformed in (False, True):
        pose = {
            "x": 100,
            "y": 100,
            "angle": 25 if transformed else 0,
            "scale_x": 1.3 if transformed else 1,
            "scale_y": 0.8 if transformed else 1,
        }
        scene = Scene.model_validate(
            {
                "palette": PALETTES[0],
                "format": "square",
                "scale": 1,
                "transparent": True,
                "elements": [
                    {"id": "receiver", "family": "phone", **pose},
                    {"id": "blocker", "family": "book", **pose},
                    {"id": "caster", "family": "pen", "x": 0, "y": 0, "support_ids": ["receiver"]},
                ],
            }
        )
        result.append(
            _record(
                f"synthetic-{'transformed' if transformed else 'plain'}",
                scene,
                False,
                replacements,
                {
                    "owner": "caster",
                    "receiver": "receiver",
                    "solid": [40, 100],
                    "hole": [100, 100],
                    "blocked": [40, 45],
                    "outside": [0, 0],
                },
            )
        )
    return result


if __name__ == "__main__":
    print(json.dumps(build_fixtures()))
