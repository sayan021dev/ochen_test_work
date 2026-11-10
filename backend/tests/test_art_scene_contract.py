import pytest
from app.catalog import PALETTES
from app.models import Element, Scene
from pydantic import ValidationError


def test_old_scene_keeps_fit_and_empty_color_mapping():
    scene = Scene(palette=PALETTES[0], elements=[Element(id="book", family="book", x=0, y=0)])
    assert scene.framing == "fit"
    assert scene.elements[0].color_map == {}


def test_art_scene_round_trip_and_background_palette_boundary():
    scene = Scene(
        palette=PALETTES[0],
        framing="bleed",
        elements=[
            Element(
                id="wallet", family="wallet", x=-20, y=0, color_map={"background-0": "object-0"}
            )
        ],
    )
    assert Scene.model_validate_json(scene.model_dump_json()) == scene
    with pytest.raises(ValidationError):
        Element(
            id="bg",
            family="wallet",
            role="background",
            x=0,
            y=0,
            color_map={"background-0": "object-0"},
        )
    with pytest.raises(ValidationError):
        Element(id="bad", family="wallet", x=0, y=0, color_map={"background-0": "#FF0000"})


def test_scene_retains_semantic_crop_anchor_without_coordinates():
    scene = Scene(
        palette=PALETTES[0],
        framing="bleed",
        crop={"family": "book", "horizontal": "left", "vertical": "center"},
    )
    assert Scene.model_validate_json(scene.model_dump_json()).crop.family == "book"
