"""Diagnostic matching must not be confused with automatic layout generation."""

import json
from xml.etree import ElementTree as ET

import pytest
from app.catalog import PALETTES
from app.composition import compose_variants, select_components
from app.models import ComposeRequest

from scripts.compare_figma_examples import BRIEFS, ROOT, fit, frames, path_data


def test_absolute_path_axis_parser_handles_hv_and_multiple_subpaths():
    signature, axes, values = path_data("M10 20H30V40L50 60C1 2 3 4 5 6ZM7 8Z")
    assert signature == "MHVLCZMZ"
    assert axes == [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]
    assert values == [10, 20, 30, 40, 50, 60, 1, 2, 3, 4, 5, 6, 7, 8]


def test_matching_recovers_common_scale_and_translation_without_distorting_shape():
    _, axes, source = path_data("M10 20H30V40L50 60C1 2 3 4 5 6Z")
    target = [
        value * 0.7 + (120 if axis == 0 else -80) for value, axis in zip(source, axes, strict=True)
    ]
    scale, offsets, error = fit(source, target, axes)
    assert scale == pytest.approx(0.7)
    assert offsets == pytest.approx([120, -80])
    assert error < 1e-10


def test_all_eighteen_reference_frames_are_extracted_with_native_sizes():
    root = ET.parse(ROOT / "examples/figma-reference/source.svg").getroot()
    examples = frames(root)
    assert len(examples) == 18
    for format_name, width, height in [
        ("square", 1000, 1000),
        ("landscape", 1200, 630),
        ("portrait", 800, 1200),
    ]:
        cohort = [frame for frame in examples if frame["format"] == format_name]
        assert len(cohort) == 6
        assert all(frame["width"] == width and frame["height"] == height for frame in cohort)
        assert len({(frame["x"], frame["y"]) for frame in cohort}) == 6


@pytest.mark.parametrize("format_name", ["square", "landscape", "portrait"])
@pytest.mark.parametrize("detail", ["S", "L"])
@pytest.mark.parametrize("brief", BRIEFS, ids=[brief[0] for brief in BRIEFS])
def test_reference_component_briefs_keep_all_families_and_common_source_proportions(
    format_name, detail, brief
):
    _, families, prompt = brief
    selected, unknown = select_components(prompt)
    assert selected == families
    assert unknown == []
    scenes = compose_variants(
        selected,
        ComposeRequest(
            prompt=prompt,
            mode="components",
            format=format_name,
            detail=detail,
            palette=PALETTES[0],
            use_ai=False,
        ),
    )
    assert len(scenes) == 3
    for scene in scenes:
        assert {element.family for element in scene.elements} == set(families)
        for element in scene.elements:
            assert element.scale_x == element.scale_y == 1


def test_audit_labels_coordinate_replay_as_diagnostic_and_records_no_provider_calls():
    manifest = json.loads((ROOT / "examples/figma-reference/manifest.json").read_text())
    assert manifest["replay_is_generation"] is False
    assert manifest["provider_calls"] == 0
    assert len(manifest["examples"]) == 18
    for example in manifest["examples"]:
        assert {pose["family"] for pose in example["poses"]} == set(example["families"])
        assert all(pose["matched_long_paths"] >= 3 for pose in example["poses"])
        assert all(pose["max_control_point_rms"] < 0.035 for pose in example["poses"])


def test_visual_relation_check_separates_position_from_exact_geometry_and_supports():
    from app.models import Element, Scene

    from scripts.compare_figma_examples import assess_relations

    scene = Scene(
        palette=PALETTES[0],
        scale=0.2,
        elements=[
            Element(id="book", family="book", x=100, y=220),
            Element(id="phone", family="phone", x=120, y=180, support_ids=["book"]),
        ],
    )
    relation = {"subject": "phone", "relation": "on", "targets": ["book"]}
    assert assess_relations(scene, [relation])[0]["satisfied"] is True
    scene.elements[1].support_ids = []
    assert assess_relations(scene, [relation])[0]["satisfied"] is False
    assert assess_relations(scene, [relation], require_supports=False)[0]["satisfied"] is True


@pytest.mark.parametrize("format_name", ["square", "landscape", "portrait"])
@pytest.mark.parametrize("brief_index", range(6))
def test_spatial_reference_briefs_parse_exact_relations_and_keep_them_in_all_three_variants(
    format_name, brief_index
):
    from app.layout import resolve_intent

    from scripts.compare_figma_examples import SPATIAL_BRIEFS, assess_relations, relation_triples

    prompt, expected = SPATIAL_BRIEFS[brief_index]
    selected, unknown = select_components(prompt)
    assert unknown == []
    relations = resolve_intent(prompt, selected, None).model_dump()["relations"]
    assert relation_triples(relations) == set(expected)
    scenes = compose_variants(
        selected,
        ComposeRequest(
            prompt=prompt,
            mode="components",
            format=format_name,
            detail="L",
            palette=PALETTES[0],
            use_ai=False,
        ),
    )
    assert len(scenes) == 3
    for scene in scenes:
        assert {item.family for item in scene.elements} == set(BRIEFS[brief_index][1])
        assert all(check["satisfied"] for check in assess_relations(scene, relations))


def test_spatial_audit_keeps_name_list_and_descriptive_cohorts_separate():
    manifest = json.loads((ROOT / "examples/figma-reference/manifest.json").read_text())
    metrics = json.loads((ROOT / "examples/figma-reference/metrics.json").read_text())
    assert metrics["algorithm_count"] == 108
    assert metrics["spatial_algorithm_count"] == 54
    assert metrics["provider_calls"] == 0
    for example in manifest["examples"]:
        spatial = example["spatial"]
        assert spatial["prompt"] != example["prompt"]
        assert spatial["parsed_matches_expected"] is True
        assert spatial["selection_status"] == "native_measured"
        assert spatial["best_variant"] in {1, 2, 3}
        assert len(spatial["variants"]) == 3
        best = json.loads(
            (ROOT / "examples/figma-reference" / spatial["best"]).with_suffix(".json").read_text()
        )
        assert {item["family"] for item in best["elements"]} == set(example["families"])
