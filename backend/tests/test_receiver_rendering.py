from xml.etree import ElementTree as ET

from app.catalog import PALETTES
from app.layers import needs_shadow_pass
from app.models import Scene
from app.svg import render_scene

NS = {"s": "http://www.w3.org/2000/svg"}


def chain():
    return Scene.model_validate(
        {
            "palette": PALETTES[0],
            "scale": 0.4,
            "light": {"enabled": True, "x": 50, "y": 50},
            "elements": [
                {"id": "pen", "family": "pen", "x": 180, "y": 40, "support_ids": ["lamp"]},
                {"id": "lamp", "family": "lamp", "x": 150, "y": 130, "support_ids": ["phone"]},
                {"id": "phone", "family": "phone", "x": 150, "y": 350},
            ],
        }
    )


def test_source_contact_chain_remains_when_every_custom_effect_is_disabled():
    scene = chain()
    root = ET.fromstring(render_scene(scene, custom_shadows_enabled=False))
    artwork = root.find("s:g[@clip-path]", NS)
    assert [
        (node.get("data-element-id"), node.get("data-contact-shadow-owner")) for node in artwork[1:]
    ] == [("phone", None), (None, "lamp"), ("lamp", None), (None, "pen"), ("pen", None)]
    assert root.find(".//*[@data-custom-shadow]") is None
    assert len(root.findall(".//*[@data-source-shadow]")) == 3
    assert [
        n.get("data-contact-shadow-receivers")
        for n in root.findall(".//*[@data-contact-shadow-owner]")
    ] == ["phone", "lamp"]
    ids = [n.get("id") for n in root.iter() if n.get("id")]
    assert len(ids) == len(set(ids))
    for use in root.findall(".//s:use", NS):
        assert use.get("href").removeprefix("#") in ids


def test_receiver_mask_uses_body_alpha_and_preserves_unrelated_foreground_occlusion():
    scene = Scene.model_validate(
        {
            "palette": PALETTES[0],
            "elements": [
                {"id": "rear", "family": "phone", "x": 0, "y": 0},
                {"id": "blocker", "family": "book", "x": 0, "y": 0},
                {"id": "front", "family": "wallet", "x": 0, "y": 0},
                {"id": "pen", "family": "pen", "x": 0, "y": 0, "support_ids": ["rear", "front"]},
            ],
        }
    )
    root = ET.fromstring(render_scene(scene))
    overlay = root.find(".//*[@data-contact-shadow-owner='pen']")
    assert overlay is not None and overlay.get("data-contact-shadow-receivers") == "rear front"
    maskid = overlay.get("mask")[5:-1]
    mask = root.find(f".//s:mask[@id='{maskid}']", NS)
    assert [(n.get("data-receiver-body"), n.get("data-receiver-fill")) for n in mask] == [
        ("rear", "allow"),
        ("blocker", "cut"),
        ("front", "allow"),
    ]
    assert len(root.findall(".//*[@data-contact-shadow-owner='pen']")) == 1
    alpha_masks = root.findall(".//s:mask[@data-body-alpha]", NS)
    assert len(alpha_masks) == 4 and all(mask.get("mask-type") == "alpha" for mask in alpha_masks)
    for alpha in alpha_masks:
        bodyid = alpha.find("s:use", NS).get("href")[1:]
        body = root.find(f".//s:g[@id='{bodyid}']", NS)
        assert body.get("data-shadow-body") == "true"
        assert body.find(".//*[@data-contact-shadow-owner]") is None


def test_hidden_receivers_do_not_take_shadow_or_remove_its_ground_copy():
    scene = chain()
    scene.elements[0].hidden = True
    root = ET.fromstring(render_scene(scene, custom_shadows_enabled=False))
    assert root.find(".//*[@data-contact-shadow-owner='lamp']") is None
    assert root.find(".//*[@data-contact-shadow-owner='pen']") is not None
    assert root.find(".//*[@data-ground-shadow-cut='lamp']") is None


def test_explicit_supports_force_the_separate_pass_even_before_ink_intersects():
    scene = Scene.model_validate(
        {
            "palette": PALETTES[0],
            "scale": 0.05,
            "elements": [
                {"id": "receiver", "family": "phone", "x": 0, "y": 0},
                {
                    "id": "caster",
                    "family": "pen",
                    "x": 4000,
                    "y": 4000,
                    "support_ids": ["receiver"],
                },
            ],
        }
    )
    assert needs_shadow_pass(scene)


def test_global_light_uses_the_same_active_cast_on_ground_and_receivers():
    root = ET.fromstring(render_scene(chain()))
    overlay = root.find(".//*[@data-contact-shadow-owner='pen']")
    castid = overlay.find(".//s:use", NS).get("href")[1:]
    cast = root.find(f".//s:g[@id='{castid}']", NS)
    assert cast.get("data-shadow-source") == "body-silhouette"
    assert root.find(".//*[@data-ground-shadow-cut='pen']") is not None
