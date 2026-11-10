import copy
from xml.etree import ElementTree as ET

import pytest
from app.catalog import CATALOG, PALETTES, asset_for
from app.models import Scene
from app.svg import parse_safe_svg, render_scene
from pydantic import ValidationError

NS = {"s": "http://www.w3.org/2000/svg"}


def scene(**updates):
    return Scene.model_validate(
        {
            "format": "landscape",
            "detail": "L",
            "scale": 0.4,
            "palette": PALETTES[0],
            "elements": [
                {"id": "one", "family": "lamp", "role": "main", "x": 50, "y": 60},
                {"id": "two", "family": "lamp", "role": "background", "x": 700, "y": 30},
            ],
            **updates,
        }
    )


def test_export_preserves_paths_and_namespaces_every_instance():
    original = parse_safe_svg(asset_for("lamp", "L", "main")["svg"])
    result = ET.fromstring(render_scene(scene()))
    assert result.get("viewBox") == "0 0 1200 630"
    groups = result.findall(".//s:g[@data-element-id]", NS)
    assert len(groups) == 2
    assert [p.get("d") for p in groups[0].findall(".//s:path", NS)] == [
        p.get("d") for p in original.findall(".//s:path", NS)
    ]
    ids = [e.get("id") for e in result.iter() if e.get("id")]
    assert len(ids) == len(set(ids))
    assert all(identifier.isascii() for identifier in ids)
    assert groups[0].get("transform") == "translate(50.0 60.0) rotate(0.0) scale(0.4)"
    assert not result.findall(".//s:image", NS)
    assert not result.findall(".//s:foreignObject", NS)


def test_artwork_is_clipped_to_canvas_while_remaining_editable():
    result = ET.fromstring(render_scene(scene()))
    clip = result.find(".//s:clipPath", NS)
    assert clip is not None, "Objects outside canvas need the same clipping in preview and export"
    rectangle = clip.find("s:rect", NS)
    assert rectangle.get("width") == "1200"
    assert rectangle.get("height") == "630"
    wrapper = result.find("s:g[@clip-path]", NS)
    assert wrapper.get("clip-path") == f"url(#{clip.get('id')})"
    assert len(wrapper.findall("s:g[@data-element-id]", NS)) == 2


@pytest.mark.parametrize("detail", ["S", "L"])
@pytest.mark.parametrize("palette", PALETTES)
def test_every_variant_recolors_by_role_without_changing_geometry(detail, palette):
    for family in {a["family"] for a in CATALOG}:
        result = ET.fromstring(
            render_scene(
                scene(
                    detail=detail,
                    palette=palette,
                    elements=[{"id": "a", "family": family, "role": "background", "x": 0, "y": 0}],
                )
            )
        )
        for element in result.iter():
            for prop in ("fill", "stroke"):
                color = element.get(prop, "none")
                if color.startswith("#"):
                    assert color.upper() in palette["background"]


@pytest.mark.parametrize(
    "change",
    [
        {"scale": float("nan")},
        {"scale": -1},
        {"detail": "XL"},
        {"elements": [{"id": "a", "family": "dragon", "x": 0, "y": 0}]},
        {"elements": [{"id": "a", "family": "lamp", "x": 0, "y": 0}] * 2},
    ],
)
def test_invalid_scenes_cannot_be_exported(change):
    with pytest.raises(ValidationError):
        scene(**change)


@pytest.mark.parametrize(
    "payload",
    [
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>',
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.org/x"/></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(https://x)"/></svg>',
        '<!DOCTYPE svg [<!ENTITY x "bad">]><svg>&x;</svg>',
    ],
)
def test_unsafe_svg_is_rejected(payload):
    with pytest.raises(ValueError):
        parse_safe_svg(payload)


def test_palette_validation_and_non_mutation():
    invalid = copy.deepcopy(PALETTES[0])
    invalid["object"][0] = "url(https://x)"
    with pytest.raises(ValidationError):
        scene(palette=invalid)
    original = copy.deepcopy(PALETTES[0])
    for palette in PALETTES:
        render_scene(scene(palette=palette))
    assert PALETTES[0] == original


def test_local_gradient_mask_clip_and_use_references_remain_independent_and_mask_is_neutral():
    from pathlib import Path

    from app.svg import URL, recolor_and_namespace

    source = parse_safe_svg((Path(__file__).parent / "fixtures/references.svg").read_text())
    palette = {**PALETTES[0], "object": ["#111111", "#222222", "#333333", "#444444"]}
    first = recolor_and_namespace(source, palette, "one")
    second = recolor_and_namespace(source, palette, "two")
    ids = {n.get("id") for n in first.iter() if n.get("id")}
    assert ids.isdisjoint({n.get("id") for n in second.iter() if n.get("id")})
    for node in first.iter():
        for key, value in node.attrib.items():
            if key.split("}")[-1] == "href":
                assert value[1:] in ids
            for match in URL.finditer(value):
                assert match[1] in ids
    assert first.find(".//s:mask/s:rect", NS).get("fill") == "white"
    assert first.find(".//s:stop", NS).get("stop-color") == "#111111"


def test_custom_shadow_is_opt_in_and_exported_as_separate_vector_group():
    custom = {"angle": 90, "length": 1.2, "opacity": 0.4}
    original = scene(elements=[{"id": "a", "family": "lamp", "x": 0, "y": 0}])
    modified = scene(elements=[{"id": "a", "family": "lamp", "x": 0, "y": 0, "shadow": custom}])
    result = ET.fromstring(render_scene(modified))
    shadow = result.find(".//s:g[@data-custom-shadow]", NS)
    assert shadow is not None
    assert shadow.get("opacity") == "0.4"
    assert shadow.get("transform").startswith("matrix(")
    assert result.find(".//s:mask", NS) is not None
    assert not result.findall(".//s:filter", NS)
    assert "data-custom-shadow" not in render_scene(original)
    ids = [n.get("id") for n in result.iter() if n.get("id")]
    assert len(ids) == len(set(ids))


@pytest.mark.parametrize(
    "shadow",
    [{"angle": -1}, {"angle": 361}, {"length": 3}, {"opacity": 1.1}, {"angle": float("nan")}],
)
def test_invalid_custom_shadow_is_rejected(shadow):
    with pytest.raises(ValidationError):
        scene(elements=[{"id": "a", "family": "lamp", "x": 0, "y": 0, "shadow": shadow}])


@pytest.mark.parametrize("asset", CATALOG, ids=lambda a: a["id"])
def test_every_custom_shadow_keeps_source_paths_unique_references_and_palette(asset):
    from app.svg import URL

    value = scene(
        detail=asset["detail"],
        elements=[
            {
                "id": "one",
                "family": asset["family"],
                "role": asset["role"],
                "x": 0,
                "y": 0,
                "shadow": {"angle": 240, "length": 1.3, "opacity": 0.6},
            }
        ],
    )
    result = ET.fromstring(render_scene(value))
    original = parse_safe_svg(asset_for(asset["family"], asset["detail"], asset["role"])["svg"])
    subjects = result.findall(".//s:g[@data-shadow-subject]", NS)
    assert len(subjects) == 2
    assert [p.get("d") for p in subjects[-1].findall(".//s:path", NS)] == [
        p.get("d") for p in original.findall(".//s:path", NS)
    ]
    ids = [n.get("id") for n in result.iter() if n.get("id")]
    assert len(ids) == len(set(ids))
    for node in result.iter():
        for val in node.attrib.values():
            for match in URL.finditer(val):
                assert match[1] in ids
    assert not result.findall(".//s:filter", NS) and not result.findall(".//s:image", NS)
    assert result.find(".//s:g[@data-custom-shadow]", NS).get("opacity") == "0.6"


def test_two_custom_instances_have_no_shared_ids_and_default_export_remains_exact():
    from app.svg import URL

    baseline = scene()
    before = render_scene(baseline)
    changed = baseline.model_copy(deep=True)
    for element in changed.elements:
        from app.models import Shadow

        element.shadow = Shadow(angle=135)
    exported = ET.fromstring(render_scene(changed))
    ids = [n.get("id") for n in exported.iter() if n.get("id")]
    assert len(ids) == len(set(ids))
    assert len(exported.findall(".//s:g[@data-custom-shadow]", NS)) == 2
    for node in exported.iter():
        for value in node.attrib.values():
            assert all(m[1] in ids for m in URL.finditer(value))
    for element in changed.elements:
        element.shadow = None
    assert render_scene(changed) == before


def test_optional_coin_restores_continuous_sidewall_when_fused_shadow_is_hidden():
    result = ET.fromstring(
        render_scene(
            scene(elements=[{"id": "coin", "family": "coin", "x": 0, "y": 0, "shadow": {}}])
        )
    )
    repair = result.find(".//s:g[@data-shadow-body-repair]", NS)
    assert repair is not None
    path = repair.find("s:path", NS)
    assert path.get("d").count("A") == 2
    assert path.get("stroke") == PALETTES[0]["background"][3]


def test_optional_free_transform_exports_independent_axes_without_rewriting_source_paths():
    result = ET.fromstring(
        render_scene(
            scene(
                elements=[
                    {
                        "id": "resize",
                        "family": "lamp",
                        "x": 10,
                        "y": 20,
                        "scale_x": 1.5,
                        "scale_y": 0.7,
                    }
                ]
            )
        )
    )
    group = result.find(".//s:g[@data-element-id]", NS)
    assert "scale(0.6000000000000001 0.27999999999999997)" in group.get("transform")
