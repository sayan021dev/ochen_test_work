"""Persisted receiver references and optional scene light are JSON v1 extensions."""

import pytest
from app.catalog import PALETTES
from app.models import Element, Scene
from pydantic import ValidationError


def element(identifier, support_ids=(), **kwargs):
    return {
        "id": identifier,
        "family": "book",
        "x": 0,
        "y": 0,
        "support_ids": list(support_ids),
        **kwargs,
    }


def scene(elements, **kwargs):
    return Scene.model_validate({"palette": PALETTES[0], "elements": elements, **kwargs})


def test_support_chain_is_validated_and_canonically_ordered():
    result = scene([element("pen", ["lamp"]), element("lamp", ["phone"]), element("phone")])
    assert [e.id for e in result.elements] == ["phone", "lamp", "pen"]
    assert result.elements[-1].support_ids == ["lamp"]
    assert Scene.model_validate_json(result.model_dump_json()).model_dump() == result.model_dump()


@pytest.mark.parametrize(
    "elements",
    [
        [element("a", ["missing"])],
        [element("a", ["a"])],
        [element("a", ["b", "b"]), element("b")],
        [element("a", ["b"]), element("b", ["a"])],
        [element("a", ["b"]), element("b", ["c"]), element("c", ["a"])],
        [element("a", ["bad id"]), element("bad-id")],
        [element("a", [f"host-{i}" for i in range(7)])] + [element(f"host-{i}") for i in range(7)],
    ],
)
def test_invalid_support_graph_is_rejected(elements):
    with pytest.raises(ValidationError):
        scene(elements)


def test_multiple_supports_hidden_receivers_and_duplicate_families_are_valid():
    result = scene(
        [element("child", ["left", "right"]), element("left", hidden=True), element("right")]
    )
    assert [e.id for e in result.elements] == ["left", "right", "child"]
    assert result.elements[-1].support_ids == ["left", "right"]


def test_order_helper_is_pure_and_stable():
    from app.models import support_order

    elements = [
        Element(**element("child", ["parent"])),
        Element(**element("unrelated")),
        Element(**element("parent")),
    ]
    result = support_order(elements)
    assert [e.id for e in result] == ["unrelated", "parent", "child"]
    assert [e.id for e in elements] == ["child", "unrelated", "parent"]
    assert result[0] is elements[1]
    assert support_order(result) == result


def test_legacy_v1_scene_without_supports_or_light_loads():
    result = Scene.model_validate(
        {
            "version": 1,
            "palette": PALETTES[0],
            "elements": [{"id": "old", "family": "book", "x": 1, "y": 2}],
        }
    )
    assert result.elements[0].support_ids == []
    assert result.light is None


def test_scene_light_defaults_and_roundtrip():
    result = scene([], light={"x": 50, "y": -20})
    assert result.light.model_dump() == {
        "enabled": False,
        "x": 50,
        "y": -20,
        "height": 1000,
        "opacity": 0.35,
    }
    assert Scene.model_validate_json(result.model_dump_json()).light == result.light


@pytest.mark.parametrize(
    "field,value",
    [
        ("x", float("nan")),
        ("y", float("inf")),
        ("x", -5001),
        ("y", 5001),
        ("height", 49),
        ("height", 5001),
        ("height", float("nan")),
        ("opacity", -0.01),
        ("opacity", 1.01),
        ("opacity", float("inf")),
    ],
)
def test_scene_light_rejects_invalid_values(field, value):
    light = {"x": 0, "y": 0, field: value}
    with pytest.raises(ValidationError):
        scene([], light=light)


def test_replacing_scene_elements_revalidates_and_orders_supports():
    result = scene([])
    result.elements = [Element(**element("child", ["parent"])), Element(**element("parent"))]
    assert [item.id for item in result.elements] == ["parent", "child"]


@pytest.mark.parametrize("height,opacity", [(50, 0), (5000, 1)])
def test_scene_light_accepts_documented_boundaries(height, opacity):
    result = scene(
        [], light={"enabled": True, "x": -5000, "y": 5000, "height": height, "opacity": opacity}
    )
    assert result.light.enabled
    assert result.light.height == height
    assert result.light.opacity == opacity
