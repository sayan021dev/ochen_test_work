"""Frozen literal scenarios test general composition, never reference coordinates."""

from xml.etree import ElementTree as ET

import pytest
from app.catalog import PALETTES, asset_for
from app.composition import compose_variants, select_components
from app.layout import resolve_intent
from app.models import ComposeRequest
from app.svg import render_scene

from scripts.audit_art_direction import HELD_OUT_BRIEFS, REFERENCE_BRIEFS, assess_scene


@pytest.mark.parametrize("brief", HELD_OUT_BRIEFS, ids=lambda b: b.id)
@pytest.mark.parametrize("format_name", ["square", "landscape", "portrait"])
@pytest.mark.parametrize("detail", ["L", "S"])
def test_held_out_literal_art_direction_keeps_all_invariants(brief, format_name, detail):
    selected, unknown = select_components(brief.prompt)
    assert not unknown
    assert set(selected) == set(brief.families)
    intent = resolve_intent(brief.prompt, selected, None)
    scenes = compose_variants(
        selected,
        ComposeRequest(
            prompt=brief.prompt,
            mode="components",
            format=format_name,
            detail=detail,
            palette=PALETTES[0],
            use_ai=False,
        ),
    )
    assert len(scenes) == 3
    assert len({tuple((e.family, e.x, e.y) for e in s.elements) for s in scenes}) == 3
    for scene in scenes:
        result = assess_scene(scene, brief, intent)
        for name in (
            "families_match",
            "roles_match",
            "parsed_relations_match",
            "backgrounds_first",
            "framing_matches",
            "source_proportions_preserved",
        ):
            assert result[name], (brief.id, name, result)
        assert all(check["satisfied"] for check in result["relation_checks"]), result
        assert not result["unlinked_intersections"], result
        if brief.crop:
            assert result["crop_satisfied"], result
        assert result["parsed_colors"] == brief.colors
        main = [e for e in scene.elements if e.role == "main"]
        max_area = max(
            asset_for(e.family, detail, e.role)["width"]
            * asset_for(e.family, detail, e.role)["height"]
            for e in main
        )
        focus = intent.art.focus if intent.art else None
        for element in scene.elements:
            source = asset_for(element.family, detail, element.role)
            minimum = 0.28
            if brief.framing == "fit":
                minimum = 1
            elif element.role == "main":
                area = source["width"] * source["height"]
                minimum = (
                    0.9
                    if area <= max_area * 0.22
                    else (
                        (0.7 if element.family == focus else 0.75)
                        if brief.framing == "close"
                        else (0.45 if element.family == focus else 0.55)
                    )
                )
            assert result["bbox_visibility"][element.family] >= minimum - 1e-6, result
            if element.role == "background":
                assert all(v.startswith("background-") for v in element.color_map.values())
        if brief.colors:
            root = ET.fromstring(render_scene(scene, custom_shadows_enabled=False))
            for family, target in {"phone": "#F9ECB0", "wallet": "#F9A3AA"}.items():
                element = next(e for e in scene.elements if e.family == family)
                assert element.color_map
                groups = [n for n in root.iter() if n.get("data-family") == family]
                assert groups
                assert any(
                    n.get("fill", "").upper() == target for group in groups for n in group.iter()
                )


def test_held_out_corpus_excludes_reference_combinations_and_covers_two_to_six_objects():
    reference_sets = {frozenset(b.families) for b in REFERENCE_BRIEFS}
    assert len(HELD_OUT_BRIEFS) == 12
    assert {len(b.families) for b in HELD_OUT_BRIEFS} == {2, 3, 4, 5, 6}
    assert all(frozenset(b.families) not in reference_sets for b in HELD_OUT_BRIEFS)
    assert {b.crop[1] for b in HELD_OUT_BRIEFS if b.crop} == {"left", "right", "top", "bottom"}
