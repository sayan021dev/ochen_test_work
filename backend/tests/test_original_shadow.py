"""The opt-in control transforms the source cast footprint, never a body projection."""

import math

import pytest
from app.catalog import CATALOG, asset_for
from app.models import Shadow
from app.shadow import shadow_matrix, with_custom_shadow
from app.svg import parse_safe_svg

NS = {"s": "http://www.w3.org/2000/svg"}


def original_asset(asset):
    return parse_safe_svg(asset_for(asset["family"], asset["detail"], asset["role"])["svg"])


@pytest.mark.parametrize("asset", CATALOG, ids=lambda asset: asset["id"])
def test_default_transform_keeps_original_footprint_and_color(asset):
    original = original_asset(asset)
    result = with_custom_shadow(original, asset, Shadow(angle=0, length=1, opacity=1))
    cast = result.find(".//s:g[@data-custom-shadow]", NS)
    assert cast is not None
    assert cast.get("data-shadow-source") == "original-footprint"
    assert cast.get("transform") == "matrix(1.000000 0.000000 -0.000000 1.000000 0.000000 0.000000)"
    source = cast.find(".//s:g[@data-shadow-subject]", NS)
    assert source is not None
    assert [
        (p.get("d"), p.get("fill"), p.get("stroke")) for p in source.findall(".//s:path", NS)
    ] == [
        (p.get("d"), p.get("fill"), p.get("stroke"))
        for p in original.findall(".//s:path", NS)
        if p.get("id") in asset["shadow"]["cast_path_ids"]
    ]
    assert cast.get("display") == "none"
    body = result[-1]
    assert body.get("mask") is None
    assert body.get("data-shadow-body") == "true"
    assert all(
        repair.get("display") == "none"
        for repair in body.findall("s:g[@data-shadow-body-repair]", NS)
    )
    assert not cast.findall(".//s:g[@data-shadow-body-repair]", NS)
    assert not result.findall(".//s:filter", NS)


def test_shadow_matrix_rotates_and_scales_original_around_contact_anchor():
    meta = {"anchor": [123, 456], "width": 100, "height": 200}
    matrix = shadow_matrix(meta, Shadow(angle=90, length=2, opacity=0.5))
    values = list(map(float, matrix.removeprefix("matrix(").removesuffix(")").split()))
    a, b, c, d, e, f = values
    assert (a, b, c, d) == (0, 2, -2, 0)
    assert math.isclose(a * 123 + c * 456 + e, 123)
    assert math.isclose(b * 123 + d * 456 + f, 456)


@pytest.mark.parametrize("asset", CATALOG, ids=lambda asset: asset["id"])
def test_cast_and_body_use_complementary_luminance_masks(asset):
    result = with_custom_shadow(original_asset(asset), asset, Shadow(angle=30))
    body_mask = result.find(".//s:mask[@id='custom-body-mask']", NS)
    cast_mask = result.find(".//s:mask[@id='custom-cast-mask']", NS)
    assert body_mask is not None and cast_mask is not None
    assert body_mask.get("mask-type") == cast_mask.get("mask-type") == "luminance"
    assert cast_mask[0].tag.endswith("rect") and cast_mask[0].get("fill") == "white"
    positives = body_mask.findall(".//*[@data-mask-part='body']")
    negatives = cast_mask.findall(".//*[@data-mask-part='body']")
    assert len(positives) == len(negatives) == 1
    for positive, negative in zip(positives[0].iter(), negatives[0].iter(), strict=True):
        assert positive.tag == negative.tag
        assert positive.get("d") == negative.get("d")
        assert positive.get("points") == negative.get("points")
        if positive.get("fill"):
            assert positive.get("fill") == "white" and negative.get("fill") == "black"
    cast = result.find(".//s:g[@data-custom-shadow]", NS)
    assert cast.find("s:g", NS).get("mask") == "url(#custom-cast-mask)"


@pytest.mark.parametrize(
    "asset", [a for a in CATALOG if a["family"] == "headphones"], ids=lambda a: a["id"]
)
def test_headphones_keep_band_depth_without_convex_hull_across_cups(asset):
    meta = asset["shadow"]
    assert "hull" not in meta
    assert len(meta["keep_polygons"]) == 1
    source = original_asset(asset)
    paths = list(source.findall(".//s:path", NS))
    assert not {paths[0].get("id"), paths[1].get("id")} & set(meta["body_path_ids"])
    assert len(meta["keep_polygons"][0]) > 10


@pytest.mark.parametrize("asset", CATALOG, ids=lambda asset: asset["id"])
def test_cast_source_is_reviewed_ground_paths_not_full_body_outlines(asset):
    meta = asset["shadow"]
    source = original_asset(asset)
    expected = [p for p in source.findall(".//s:path", NS) if p.get("id") in meta["cast_path_ids"]]
    assert 0 < len(expected) <= 3
    assert all(p.get("fill") in {"#181817", "#7864D7"} for p in expected)
    assert set(meta["cast_path_ids"]).isdisjoint(meta["body_path_ids"])
    result = with_custom_shadow(source, asset, Shadow(angle=90, length=1, opacity=0.5))
    cast = result.find(".//s:g[@data-custom-shadow]", NS)
    assert [
        p.get("d") for p in cast.find(".//s:g[@data-shadow-subject]", NS).findall(".//s:path", NS)
    ] == [p.get("d") for p in expected]
    if asset["family"] in {"headphones", "pen", "wallet", "lamp"}:
        regions = result.find(".//s:clipPath[@id='custom-cast-region']", NS)
        assert regions is not None
        assert len(regions) == (2 if asset["family"] == "headphones" else 1)
        assert all(node.tag.endswith("polygon") for node in regions)
        assert cast.find("s:g", NS).get("clip-path") == "url(#custom-cast-region)"
    else:
        assert "cast_regions" not in meta


@pytest.mark.parametrize(
    "asset", [a for a in CATALOG if a["family"] == "headphones"], ids=lambda a: a["id"]
)
def test_headphone_positive_body_mask_does_not_retain_detached_dark_dashes(asset):
    source = original_asset(asset)
    paths = {p.get("id"): p for p in source.findall(".//s:path", NS)}
    assert all(
        paths[identifier].get("fill") not in {"#181817", "#7864D7"}
        for identifier in asset["shadow"]["body_path_ids"]
    )


def test_shadow_matrix_accepts_independent_scales_and_translation():
    from types import SimpleNamespace

    shadow = SimpleNamespace(angle=90, length=1.5, scale_x=2, scale_y=0.5, x=17, y=-23)
    matrix = shadow_matrix({"anchor": [123, 456]}, shadow)
    a, b, c, d, e, f = map(float, matrix.removeprefix("matrix(").removesuffix(")").split())
    assert (a, b, c, d) == (0, 3, -0.75, 0)
    assert math.isclose(a * 123 + c * 456 + e, 140)
    assert math.isclose(b * 123 + d * 456 + f, 433)


@pytest.mark.parametrize("overrides", [{"x": 1}, {"y": -1}, {"scale_x": 2}, {"scale_y": 0.5}])
def test_shadow_identity_requires_default_offsets_and_scales(overrides):
    from types import SimpleNamespace

    options = {
        "angle": 0,
        "length": 1,
        "opacity": 1,
        "x": 0,
        "y": 0,
        "scale_x": 1,
        "scale_y": 1,
        **overrides,
    }
    asset = next(a for a in CATALOG if a["id"] == "l-main-headphones")
    result = with_custom_shadow(original_asset(asset), asset, SimpleNamespace(**options))
    cast = result.find(".//s:g[@data-custom-shadow]", NS)
    assert cast.get("display") != "none"
    assert result[-1].get("mask") == "url(#custom-body-mask)"


@pytest.mark.parametrize("asset", CATALOG, ids=lambda a: a["id"])
def test_original_cast_has_mask_aware_selection_bounds(asset):
    x, y, width, height = asset["shadow"]["cast_bbox"]
    assert x >= 0 and y >= 0 and width > 0 and height > 0
    assert x + width <= asset["width"] + 0.001
    assert y + height <= asset["height"] + 0.001
    if asset["family"] == "headphones":
        assert y > asset["height"] * 0.3


@pytest.mark.parametrize("asset", CATALOG, ids=lambda a: a["id"])
def test_contact_edges_are_measured_locally_not_a_whole_subject_hull(asset):
    edges = asset["shadow"]["attachment_edges"]
    assert edges
    for x1, y1, x2, y2 in edges:
        assert 0 <= x1 <= asset["width"] and 0 <= x2 <= asset["width"]
        assert 0 <= y1 <= asset["height"] and 0 <= y2 <= asset["height"]
    assert len(edges) == len(asset["shadow"]["attachment_cast_edges"])
    assert all(edge[:2] != edge[2:] for edge in asset["shadow"]["attachment_cast_edges"])


@pytest.mark.parametrize(
    "settings", [Shadow(x=90, y=40), Shadow(angle=65), Shadow(scale_x=1.8, scale_y=0.4)]
)
def test_shadow_bridge_fixes_contact_edge_and_fills_to_moved_footprint(settings):
    asset = next(a for a in CATALOG if a["id"] == "l-main-folder")
    result = with_custom_shadow(original_asset(asset), asset, settings)
    bridge = result.find(".//s:g[@data-shadow-attachment]", NS)
    assert bridge is not None
    assert bridge.get("mask") == "url(#custom-bridge-mask)"
    mesh = bridge.find("s:path[@data-shadow-mesh]", NS)
    assert mesh is not None and mesh.get("fill-rule") == "nonzero"
    assert mesh.get("fill") == mesh.get("stroke") == "#181817"
    a, b, c, d, e, f = map(float, shadow_matrix(asset["shadow"], settings)[7:-1].split())
    allowed = set()
    for edge, cast_edge in zip(
        asset["shadow"]["attachment_edges"], asset["shadow"]["attachment_cast_edges"], strict=True
    ):
        for x, y in (edge[:2], edge[2:]):
            allowed.add(f"{x:.6f},{y:.6f}")
        for x, y in (cast_edge[:2], cast_edge[2:]):
            allowed.add(f"{a * x + c * y + e:.6f},{b * x + d * y + f:.6f}")
    points = mesh.get("d").replace("M", "").replace("L", "").replace("Z", "").split()
    assert points and set(points) <= allowed


def test_separated_identity_exposes_real_body_and_cast_for_scene_shadow_pass():
    asset = next(a for a in CATALOG if a["id"] == "l-main-folder")
    result = with_custom_shadow(original_asset(asset), asset, Shadow(), separate_layers=True)
    assert result.find("s:g[@data-custom-shadow]", NS).get("display") != "none"
    assert result.find("s:g[@data-shadow-body]", NS).get("mask") == "url(#custom-source-body-mask)"
    assert result.find(".//s:g[@data-shadow-bridge]", NS) is None
    assert result.find(".//s:g[@data-shadow-body-repair]", NS) is None


@pytest.mark.parametrize("offset", [(5000, 0), (-5000, 0), (0, 5000), (0, -5000)])
def test_bridge_mask_covers_fixed_and_far_transformed_contact(offset):
    asset = next(a for a in CATALOG if a["id"] == "s-main-coin")
    settings = Shadow(x=offset[0], y=offset[1], angle=130, scale_x=6, scale_y=6)
    result = with_custom_shadow(original_asset(asset), asset, settings)
    mask = result.find(".//s:mask[@id='custom-bridge-mask']", NS)
    left, top = float(mask.get("x")), float(mask.get("y"))
    right, bottom = left + float(mask.get("width")), top + float(mask.get("height"))
    assert {key: mask.get(key) for key in ("x", "y", "width", "height")} == {
        key: mask[0].get(key) for key in ("x", "y", "width", "height")
    }
    mesh = result.find(".//s:path[@data-shadow-mesh]", NS)
    for point in mesh.get("d").replace("M", "").replace("L", "").replace("Z", "").split():
        x, y = map(float, point.split(","))
        assert left < x < right
        assert top < y < bottom


@pytest.mark.parametrize("asset", CATALOG, ids=lambda a: a["id"])
def test_preserve_source_split_retains_complete_original_without_artistic_repairs(asset):
    original = original_asset(asset)
    result = with_custom_shadow(
        original, asset, Shadow(), separate_layers=True, preserve_source=True
    )
    body = result.find("s:g[@data-shadow-body]", NS)
    assert body.get("mask") == "url(#custom-source-body-mask)"
    source = body.find("s:g[@data-shadow-subject]", NS)
    expected = [
        (p.get("d"), p.get("fill"), p.get("stroke")) for p in original.findall(".//s:path", NS)
    ]
    assert [
        (p.get("d"), p.get("fill"), p.get("stroke")) for p in source.findall(".//s:path", NS)
    ] == expected
    assert result.find(".//s:g[@data-shadow-bridge]", NS) is None
    assert result.find(".//s:g[@data-shadow-body-repair]", NS) is None
    subtraction = result.find(".//s:mask[@id='custom-source-body-mask']/s:g", NS)
    assert subtraction.get("mask") == "url(#custom-cast-mask)"
    assert [p.get("d") for p in subtraction.findall(".//s:path", NS)] == [
        p.get("d")
        for p in original.findall(".//s:path", NS)
        if p.get("id") in asset["shadow"]["cast_path_ids"]
    ]
