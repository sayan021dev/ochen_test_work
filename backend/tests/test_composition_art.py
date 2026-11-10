import pytest
from app.art_direction import ArtDirection, RoleDirective
from app.catalog import PALETTES, asset_for
from app.composition import compose_variants, select_components
from app.layout import LayoutIntent
from app.models import ComposeRequest


def scenes(prompt, *, format="square", detail="L"):
    families, unknown = select_components(prompt)
    assert not unknown
    return compose_variants(
        families,
        ComposeRequest(
            prompt=prompt, mode="components", palette=PALETTES[0], format=format, detail=detail
        ),
    )


@pytest.mark.parametrize("detail", ["L", "S"])
def test_explicit_background_and_color_override_automatic_extras(detail):
    for scene in scenes("фоновая лампа, желтый кошелек, монета, крупным планом", detail=detail):
        by_family = {e.family: e for e in scene.elements}
        assert by_family["lamp"].role == "background"
        assert scene.elements[0].family == "lamp"
        assert by_family["wallet"].role == "main"
        assert by_family["wallet"].color_map["background-0"] == "object-0"
        assert scene.framing == "close"


@pytest.mark.parametrize("format", ["square", "landscape", "portrait"])
def test_requested_camera_crops_book_but_preserves_contact_and_common_sizes(format):
    result = scenes("телефон на книге, книга за левый край", format=format)
    for scene in result:
        by_family = {e.family: e for e in scene.elements}
        book, phone = by_family["book"], by_family["phone"]
        assert book.x < 0
        assert scene.framing == "bleed"
        assert phone.support_ids == [book.id]
        assert scene.elements.index(book) < scene.elements.index(phone)
        assert all(e.scale_x == e.scale_y == 1 and e.angle == 0 for e in scene.elements)
        # The physical contact intersection remains inside the camera, not merely offscreen.
        boxes = []
        for e in (book, phone):
            asset = asset_for(e.family, scene.detail, e.role)
            boxes.append(
                (e.x, e.y, e.x + asset["width"] * scene.scale, e.y + asset["height"] * scene.scale)
            )
        assert max(0, *(b[0] for b in boxes)) < min(scene.size[0], *(b[2] for b in boxes))
        assert max(0, *(b[1] for b in boxes)) < min(scene.size[1], *(b[3] for b in boxes))


def test_artistic_variants_are_repeatable_and_visibly_different():
    prompt = "книга, телефон, наушники, крупным планом"
    first, second = scenes(prompt), scenes(prompt)
    assert [s.model_dump() for s in first] == [s.model_dump() for s in second]
    poses = [tuple((e.family, round(e.x), round(e.y)) for e in s.elements) for s in first]
    assert len(set(poses)) == 3
    assert (
        max(
            abs(a.x - b.x) + abs(a.y - b.y)
            for a in first[0].elements
            for b in first[1].elements
            if a.family == b.family
        )
        > 30
    )


def test_background_order_respects_contact_and_other_independent_objects():
    result = scenes("телефон на книге, фоновая лампа")
    for scene in result:
        assert [e.family for e in scene.elements] == ["lamp", "book", "phone"]


def test_background_checkbox_blocks_inferred_roles_but_not_explicit_request():
    proposed = LayoutIntent(
        relations=[], art=ArtDirection(roles=[RoleDirective(family="lamp", role="background")])
    )
    for prompt, expected in (("лампа, книга", "main"), ("фоновая лампа, книга", "background")):
        request = ComposeRequest(
            prompt=prompt, mode="metaphor", backgrounds=False, palette=PALETTES[0]
        )
        for scene in compose_variants(["lamp", "book"], request, proposed):
            assert next(e.role for e in scene.elements if e.family == "lamp") == expected


@pytest.mark.parametrize("format", ["square", "landscape", "portrait"])
def test_requested_background_crop_is_not_lost_in_alternative_packing(format):
    prompt = (
        "фоновая лампа позади желтого кошелька и монеты, кошелек ниже монеты, "
        "лампа выходит за верхний край"
    )
    for scene in scenes(prompt, format=format):
        assert next(e.y for e in scene.elements if e.family == "lamp") < 0
