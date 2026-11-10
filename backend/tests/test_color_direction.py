"""Named paints affect one reviewed source role, without flattening illustrations."""

from collections import Counter
from typing import get_args

import pytest
from app.art_direction import ColorName
from app.catalog import FAMILIES, PALETTES, asset_for
from app.color_direction import color_map_for
from app.models import Palette
from app.svg import parse_safe_svg, recolor_and_namespace

PRIMARY = {
    "book": "object-0",
    "phone": "object-0",
    "puzzle": "object-0",
    "coin": "object-0",
    "headphones": "background-0",
    "lamp": "object-1",
    "flowers": "object-1",
    "wallet": "background-0",
    "folder": "object-0",
    "pen": "object-1",
}
NS = {"s": "http://www.w3.org/2000/svg"}
CUSTOM_PALETTE = {
    "id": "custom",
    "name": "Custom",
    "background": ["#305070", "#C02060", "#101010", "#181817"],
    "object": ["#00FF00", "#FF69B4", "#EEEEEE", "#FFFFFF"],
}


def test_primary_surface_uses_exact_reviewed_source_role_and_preserves_white_and_ink():
    palette = Palette.model_validate(PALETTES[0])
    for family in FAMILIES:
        mapping = color_map_for(family, "main", "pink", palette)
        assert mapping == {PRIMARY[family]: "object-1"}
        assert "background-3" not in mapping and "object-3" not in mapping


@pytest.mark.parametrize("family", FAMILIES)
@pytest.mark.parametrize("role", ["main", "background"])
@pytest.mark.parametrize("palette_data", [*PALETTES, CUSTOM_PALETTE])
def test_every_family_role_palette_has_one_surface_and_only_allowed_targets(
    family, role, palette_data
):
    palette = Palette.model_validate(palette_data)
    for color in get_args(ColorName):
        mapping = color_map_for(family, role, color, palette)
        assert set(mapping) == {PRIMARY[family] if role == "main" else "background-0"}
        assert "background-3" not in mapping
        assert all(
            role == "main" or target.startswith("background-") for target in mapping.values()
        )
        # The same semantic source role exists in actual S and L variants.
        for detail in ("S", "L"):
            source = parse_safe_svg(asset_for(family, detail, role)["svg"])
            painted = recolor_and_namespace(source, palette.model_dump(), "source")
            roles = {node.get("data-fill-role") for node in painted.iter()}
            assert set(mapping) <= roles
            before_paths = [node.get("d") for node in source.findall(".//s:path", NS)]
            remapped = recolor_and_namespace(source, palette.model_dump(), "target", mapping)
            assert [node.get("d") for node in remapped.findall(".//s:path", NS)] == before_paths
            before = list(painted.iter())
            after = list(remapped.iter())
            for original, result in zip(before, after, strict=True):
                for paint in ("fill", "stroke", "stop-color"):
                    if original.get(f"data-{paint}-role") not in mapping:
                        assert original.get(paint) == result.get(paint)
            # Outlines/details retain independent color roles and source paths.
            assert (
                len(Counter(node.get("fill") for node in remapped.iter() if node.get("fill"))) > 1
            )


def test_custom_palette_uses_its_closest_allowed_slot_without_adding_requested_hex():
    palette = Palette.model_validate(CUSTOM_PALETTE)
    assert color_map_for("phone", "main", "pink", palette) == {"object-0": "object-1"}
    assert color_map_for("phone", "background", "pink", palette) == {"background-0": "background-1"}
    assert color_map_for("book", "main", "white", palette) == {"object-0": "object-3"}
    assert color_map_for("book", "main", "black", palette) == {"object-0": "background-2"}


def test_surface_mapping_never_mutates_the_palette_or_source_catalog():
    palette = Palette.model_validate(PALETTES[1])
    before = palette.model_dump()
    source = asset_for("flowers", "L", "main")["svg"]
    color_map_for("flowers", "main", "green", palette)
    assert palette.model_dump() == before
    assert asset_for("flowers", "L", "main")["svg"] == source
