"""Camera behaviour uses synthetic geometry, independently of the asset catalogue."""

from types import SimpleNamespace

import pytest
from app.framing import frame_candidates
from app.layout import Box


def visible_fraction(box, frame, width, height):
    x, y = frame.tx + box.x * frame.scale, frame.ty + box.y * frame.scale
    w, h = box.width * frame.scale, box.height * frame.scale
    return max(0, min(width, x + w) - max(0, x)) * max(0, min(height, y + h) - max(0, y)) / (w * h)


@pytest.mark.parametrize("variant, scale, tx, ty", [(0, 1.66, 51.8, 500.0), (2, 1.54, 84.2, 500.0)])
def test_fit_preserves_existing_full_bounds_camera(variant, scale, tx, ty):
    # A 500x200 scene starts at (20,-100), on a 1000px square.
    frames = frame_candidates(
        [Box(20, -100, 500, 200)],
        ["unseen"],
        {"unseen": "main"},
        1000,
        1000,
        mode="fit",
        variant=variant,
        max_scale=4,
    )
    assert len(frames) == 1
    assert frames[0].scale == pytest.approx(scale)
    assert frames[0].tx == pytest.approx(tx)
    assert frames[0].ty == pytest.approx(ty)


def test_close_increases_common_scale_without_losing_small_foreground():
    boxes = [Box(0, 0, 700, 500), Box(760, 320, 120, 80)]
    families = ["large-unseen", "tiny-unseen"]
    roles = dict.fromkeys(families, "main")
    fit = frame_candidates(boxes, families, roles, 1000, 1000, mode="fit", max_scale=4)[0]
    close = frame_candidates(boxes, families, roles, 1000, 1000, mode="close", max_scale=4)
    assert 1 <= len(close) <= 6
    assert close[0].scale > fit.scale
    assert all(visible_fraction(boxes[1], f, 1000, 1000) >= 0.9 for f in close)
    assert all(visible_fraction(boxes[0], f, 1000, 1000) >= 0.7 for f in close)


@pytest.mark.parametrize(
    "horizontal,vertical",
    [("left", "center"), ("right", "center"), ("center", "top"), ("center", "bottom")],
)
def test_bleed_crosses_requested_edge_and_retains_recognizable_object(horizontal, vertical):
    box = Box(0, 0, 600, 600)
    crop = SimpleNamespace(family="unknown-future-asset", horizontal=horizontal, vertical=vertical)
    frames = frame_candidates(
        [box],
        [crop.family],
        {crop.family: "main"},
        1000,
        1000,
        mode="bleed",
        crop=crop,
        focus=crop.family,
        max_scale=4,
    )
    assert frames
    for frame in frames:
        x, y = frame.tx, frame.ty
        edge = {
            "left": x < 0,
            "right": x + box.width * frame.scale > 1000,
            "top": y < 0,
            "bottom": y + box.height * frame.scale > 1000,
        }
        assert edge[horizontal if horizontal != "center" else vertical]
        assert visible_fraction(box, frame, 1000, 1000) >= 0.45


@pytest.mark.parametrize("width,height", [(1200, 630), (800, 1200)])
def test_bleed_protects_small_objects_across_formats_and_generic_families(width, height):
    boxes = [Box(-100, 0, 800, 600), Box(750, 450, 100, 100), Box(250, -500, 350, 400)]
    families = ["large", "small", "decor"]
    frames = frame_candidates(
        boxes,
        families,
        {"large": "main", "small": "main", "decor": "background"},
        width,
        height,
        mode="bleed",
        focus="large",
        max_scale=4,
    )
    assert frames
    for frame in frames:
        assert visible_fraction(boxes[0], frame, width, height) >= 0.45
        assert visible_fraction(boxes[1], frame, width, height) >= 0.9
        assert visible_fraction(boxes[2], frame, width, height) >= 0.28


def test_small_isolated_object_respects_maximum_scale():
    frames = frame_candidates(
        [Box(0, 0, 10, 10)],
        ["new"],
        {"new": "main"},
        1000,
        1000,
        mode="close",
        max_scale=4,
    )
    assert frames
    assert all(frame.scale <= 4 for frame in frames)
    assert all(visible_fraction(Box(0, 0, 10, 10), f, 1000, 1000) == 1 for f in frames)


def test_small_foreground_is_protected_relative_to_large_background_too():
    boxes = [Box(0, 0, 1400, 1000), Box(700, 100, 300, 180), Box(500, 1020, 280, 160)]
    frames = frame_candidates(
        boxes,
        ["decor", "part", "tool"],
        {"decor": "background", "part": "main", "tool": "main"},
        1000,
        1000,
        mode="bleed",
        focus="decor",
        crop=SimpleNamespace(family="decor", horizontal="right", vertical="center"),
    )
    for frame in frames:
        assert visible_fraction(boxes[1], frame, 1000, 1000) >= 0.98
        assert visible_fraction(boxes[2], frame, 1000, 1000) >= 0.98


def test_infeasible_crop_falls_back_without_hiding_an_object():
    # Cropping the central giant at the left would hide the much smaller item left of it.
    boxes = [Box(0, 0, 500, 500), Box(-200, 0, 20, 20)]
    frames = frame_candidates(
        boxes,
        ["giant", "tiny"],
        {"giant": "main", "tiny": "main"},
        1000,
        1000,
        mode="bleed",
        crop=SimpleNamespace(family="giant", horizontal="left", vertical="center"),
        max_scale=4,
    )
    assert len(frames) == 1
    assert visible_fraction(boxes[0], frames[0], 1000, 1000) == pytest.approx(1)
    assert visible_fraction(boxes[1], frames[0], 1000, 1000) == pytest.approx(1)


def test_camera_is_deterministic_and_does_not_mutate_source_boxes():
    boxes = [Box(20, -20, 500, 300), Box(560, 150, 140, 100)]
    original = [(b.x, b.y, b.width, b.height) for b in boxes]
    args = (
        boxes,
        ["arbitrary-a", "arbitrary-b"],
        {"arbitrary-a": "main", "arbitrary-b": "main"},
        1200,
        630,
    )
    first = frame_candidates(*args, mode="bleed", variant=2, max_scale=4)
    second = frame_candidates(*args, mode="bleed", variant=2, max_scale=4)
    assert first
    assert first == second
    assert len({(f.scale, f.tx, f.ty) for f in first}) == len(first)
    assert [f.score for f in first] == sorted(f.score for f in first)
    assert [(b.x, b.y, b.width, b.height) for b in boxes] == original


def test_feasible_requested_crop_ranks_ahead_of_safe_fit_fallback():
    crop = SimpleNamespace(family="giant", horizontal="left", vertical="center")
    impossible = frame_candidates(
        [Box(0, 0, 500, 20), Box(-200, 0, 20, 5)],
        ["giant", "tiny"],
        {"giant": "main", "tiny": "main"},
        1000,
        1000,
        mode="bleed",
        crop=crop,
    )[0]
    possible = frame_candidates(
        [Box(0, 0, 500, 20), Box(550, 0, 20, 5)],
        ["giant", "tiny"],
        {"giant": "main", "tiny": "main"},
        1000,
        1000,
        mode="bleed",
        crop=crop,
    )[0]
    assert possible.tx < 0
    assert possible.score < impossible.score
