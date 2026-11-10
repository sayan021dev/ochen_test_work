"""Ordinary SVGs keep their source; custom shadows project the actual body."""

import math

import pytest
from app.catalog import CATALOG, asset_for
from app.models import Shadow
from app.shadow import shadow_matrix, with_custom_shadow
from app.svg import parse_safe_svg

NS = {"s": "http://www.w3.org/2000/svg"}


def original_asset(asset):
    return parse_safe_svg(asset_for(asset["family"], asset["detail"], asset["role"])["svg"])


def matrix_values(metadata, shadow):
    return list(map(float, shadow_matrix(metadata, shadow)[7:-1].split()))


def projected(matrix, point):
    a, b, c, d, e, f = matrix
    x, y = point
    return (a * x + c * y + e, b * x + d * y + f)


@pytest.mark.parametrize("asset", CATALOG, ids=lambda a: a["id"])
@pytest.mark.parametrize("settings", [Shadow(angle=45), Shadow(angle=130, length=2, x=90, y=-35)])
def test_projection_fixes_the_entire_ground_line_and_preserves_its_width(asset, settings):
    meta = asset["shadow"]
    x1, y1, x2, y2 = meta["projection"]["ground"]
    matrix = matrix_values(meta, settings)
    for t in (0, 0.25, 0.5, 1):
        point = (x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)
        assert projected(matrix, point) == pytest.approx(point, abs=0.002)
    first, last = projected(matrix, (x1, y1)), projected(matrix, (x2, y2))
    assert math.dist(first, last) == pytest.approx(math.hypot(x2 - x1, y2 - y1), abs=0.002)


def test_projection_uses_body_height_and_legacy_offsets_as_direction_not_translation():
    meta = {
        "projection": {"ground": [10, 100, 110, 100], "depth": 80, "body_bbox": [10, 0, 100, 100]}
    }
    settings = Shadow(angle=90, length=2, x=30, y=-20, scale_x=6, scale_y=0.1)
    matrix = matrix_values(meta, settings)
    assert projected(matrix, (10, 100)) == pytest.approx((10, 100), abs=1e-5)
    assert projected(matrix, (10, 0)) == pytest.approx((40, 240), abs=1e-5)
    assert matrix == matrix_values(meta, settings.model_copy(update={"scale_x": 1, "scale_y": 1}))


def test_inclined_ground_line_stays_fixed():
    meta = {
        "projection": {"ground": [20, 200, 120, 170], "depth": 100, "body_bbox": [0, 0, 200, 200]}
    }
    matrix = matrix_values(meta, Shadow(angle=73, length=1.7, x=35, y=60))
    for point in ((20, 200), (70, 185), (120, 170)):
        assert projected(matrix, point) == pytest.approx(point, abs=0.001)


@pytest.mark.parametrize("asset", CATALOG, ids=lambda a: a["id"])
def test_custom_projects_black_original_body_without_old_footprint_or_mesh(asset):
    original = original_asset(asset)
    result = with_custom_shadow(original, asset, Shadow(angle=45))
    layer = result.find("s:g[@data-custom-shadow]", NS)
    assert layer.get("data-shadow-source") == "body-silhouette"
    assert layer.get("mask") == "url(#custom-projection-occlusion)"
    assert result.find(".//*[@data-shadow-bridge]") is None
    assert result.find(".//*[@data-shadow-mesh]") is None
    subject = layer.find("s:g[@data-shadow-subject]", NS)
    assert subject is not None
    source = [
        p
        for p in original.findall(".//s:path", NS)
        if p.get("id") not in asset["shadow"].get("body_exclude_path_ids", [])
    ]
    projected_paths = subject.findall(".//s:path", NS)
    assert [p.get("d") for p in projected_paths[: len(source)]] == [p.get("d") for p in source]
    assert all(p.get("fill") in {"#181817", "none"} for p in projected_paths)
    body = result.find("s:g[@data-shadow-body]", NS)
    assert body.get("mask") is None  # source mask is on the subject, not the wall repair
    actual = body.find("s:g[@data-shadow-subject]", NS)
    assert actual.get("mask") == "url(#custom-body-mask)"
    assert [(p.get("d"), p.get("fill")) for p in actual.findall(".//s:path", NS)] == [
        (p.get("d"), p.get("fill")) for p in source
    ]
    assert not result.findall(".//s:image", NS) and not result.findall(".//s:filter", NS)


@pytest.mark.parametrize("asset", CATALOG, ids=lambda a: a["id"])
def test_only_explicit_preserve_source_keeps_ordinary_original_cast(asset):
    original = original_asset(asset)
    result = with_custom_shadow(
        original, asset, Shadow(), separate_layers=True, preserve_source=True
    )
    layer = result.find("s:g[@data-custom-shadow]", NS)
    assert layer.get("data-shadow-source") == "original-footprint"
    assert projected(list(map(float, layer.get("transform")[7:-1].split())), (10, 20)) == (10, 20)
    cast = layer.find(".//s:g[@data-shadow-subject]", NS)
    assert [(p.get("d"), p.get("fill")) for p in cast.findall(".//s:path", NS)] == [
        (p.get("d"), p.get("fill"))
        for p in original.findall(".//s:path", NS)
        if p.get("id") in asset["shadow"]["cast_path_ids"]
    ]
    body = result.find("s:g[@data-shadow-body]", NS)
    actual = body.find("s:g[@data-shadow-subject]", NS)
    assert actual.get("mask") == "url(#custom-source-body-mask)"
    assert [
        (p.get("d"), p.get("fill"), p.get("stroke")) for p in actual.findall(".//s:path", NS)
    ] == [(p.get("d"), p.get("fill"), p.get("stroke")) for p in original.findall(".//s:path", NS)]
    assert result.find(".//*[@data-shadow-body-repair]") is None
    assert result.find(".//*[@data-shadow-occluder]") is None


def test_zero_length_and_edge_on_projection_are_empty_but_body_is_retained():
    asset = next(a for a in CATALOG if a["id"] == "l-main-folder")
    x1, y1, x2, y2 = asset["shadow"]["projection"]["ground"]
    parallel = math.degrees(math.atan2(y2 - y1, x2 - x1))
    for shadow in (Shadow(angle=45, length=0), Shadow(angle=parallel, length=1)):
        result = with_custom_shadow(original_asset(asset), asset, shadow)
        assert result.find("s:g[@data-custom-shadow]", NS).get("display") == "none"
        assert result.find("s:g[@data-shadow-body]", NS) is not None


def test_projection_occluder_countertransform_keeps_opaque_body_fixed_at_far_offsets():
    asset = next(a for a in CATALOG if a["id"] == "s-main-coin")
    settings = Shadow(angle=130, length=2, x=5000, y=-5000)
    result = with_custom_shadow(original_asset(asset), asset, settings)
    forward = matrix_values(asset["shadow"], settings)
    occluder = result.find(".//s:g[@data-shadow-occluder]", NS)
    inverse = list(map(float, occluder.get("transform")[7:-1].split()))
    for point in ((0, 0), (asset["width"], asset["height"])):
        assert projected(forward, projected(inverse, point)) == pytest.approx(point, abs=0.01)
    assert result.find(".//s:g[@data-shadow-body-repair]", NS) is not None


def test_phone_custom_body_omits_only_reviewed_separate_ground_path():
    import copy

    asset = copy.deepcopy(next(a for a in CATALOG if a["id"] == "l-main-phone"))
    excluded = asset["shadow"]["cast_path_ids"]
    asset["shadow"]["body_exclude_path_ids"] = excluded
    original = original_asset(asset)
    result = with_custom_shadow(original, asset, Shadow(angle=45))
    body = result.find("s:g[@data-shadow-body]/s:g[@data-shadow-subject]", NS)
    assert set(excluded).isdisjoint({p.get("id") for p in body.findall(".//s:path", NS)})
    ordinary = with_custom_shadow(original, asset, Shadow(), preserve_source=True)
    ordinary_body = ordinary.find("s:g[@data-shadow-body]/s:g[@data-shadow-subject]", NS)
    assert set(excluded) <= {p.get("id") for p in ordinary_body.findall(".//s:path", NS)}
