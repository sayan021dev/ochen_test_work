"""Ground supports are reviewed data; they must scale with the source detail."""

import math

import pytest
from app.catalog import CATALOG, FAMILIES


@pytest.mark.parametrize("asset", CATALOG, ids=lambda a: a["id"])
def test_each_source_variant_has_finite_ground_support(asset):
    projection = asset["shadow"]["projection"]
    x, y, w, h = projection["body_bbox"]
    x1, y1, x2, y2 = projection["ground"]
    assert all(math.isfinite(n) for n in [x, y, w, h, x1, y1, x2, y2, projection["depth"]])
    assert w > 0 and h > 0 and projection["depth"] > 0
    assert x <= x1 < x2 <= x + w + 1
    assert y <= y1 <= y + h + 1 and y <= y2 <= y + h + 1
    assert (y1 + y2) / 2 >= y + h * 0.55
    assert -4 <= x < asset["width"] and -4 <= y < asset["height"]
    assert x + w <= asset["width"] + 4
    assert y + h <= asset["height"] + 4


@pytest.mark.parametrize("family", FAMILIES)
@pytest.mark.parametrize("role", ["main", "background"])
def test_ground_support_scales_with_source_detail(family, role):
    large, small = [
        next(a for a in CATALOG if (a["family"], a["role"], a["detail"]) == (family, role, detail))
        for detail in ["L", "S"]
    ]
    for axis, (large_value, small_value) in enumerate(
        zip(
            large["shadow"]["projection"]["body_bbox"],
            small["shadow"]["projection"]["body_bbox"],
            strict=True,
        )
    ):
        # S is a distinct artwork, not an exact half-size duplicate (coin/flowers).
        dimension = "height" if axis % 2 else "width"
        assert abs(large_value / large[dimension] - small_value / small[dimension]) < 0.03
    # A round base's final raster row has different spans at different resolutions.
    # Its contact position must scale; exact endpoint widths need not be identical.
    lg, sg = [a["shadow"]["projection"]["ground"] for a in [large, small]]
    for axis, dimension in [(0, "width"), (1, "height")]:
        large_mid = (lg[axis] + lg[axis + 2]) / 2 / large[dimension]
        small_mid = (sg[axis] + sg[axis + 2]) / 2 / small[dimension]
        assert abs(large_mid - small_mid) < 0.03
