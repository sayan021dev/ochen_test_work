"""Spatial language must survive every generated variant and canvas preset."""

import pytest
from app.catalog import PALETTES, asset_for
from app.composition import compose_variants
from app.models import FORMATS, ComposeRequest


def boxes(scene):
    return {
        e.family: (
            e.x,
            e.y,
            asset_for(e.family, scene.detail, e.role)["width"] * scene.scale,
            asset_for(e.family, scene.detail, e.role)["height"] * scene.scale,
        )
        for e in scene.elements
    }


def test_explicit_left_is_obeyed_by_every_variant():
    request = ComposeRequest(prompt="книга слева от монеты", mode="components", palette=PALETTES[0])
    for scene in compose_variants(["book", "coin"], request):
        book, coin = boxes(scene)["book"], boxes(scene)["coin"]
        assert book[0] + book[2] < coin[0]


# Expected semantics are authored independently of the production parser.
CASES = [
    ("книга слева от монеты", ["book", "coin"], [("book", "left_of", ["coin"])]),
    ("книга справа от монеты", ["book", "coin"], [("book", "right_of", ["coin"])]),
    ("книга над монетой", ["book", "coin"], [("book", "above", ["coin"])]),
    ("книга под монетой", ["book", "coin"], [("book", "below", ["coin"])]),
    (
        "пазл на монете а под ними книга",
        ["puzzle", "coin", "book"],
        [("puzzle", "on", ["coin"]), ("book", "below", ["puzzle", "coin"])],
    ),
    ("монета на книге", ["coin", "book"], [("coin", "on", ["book"])]),
    ("пазл над книгой", ["puzzle", "book"], [("puzzle", "above", ["book"])]),
    ("лампа правее телефона", ["lamp", "phone"], [("lamp", "right_of", ["phone"])]),
    ("кошелёк левее папки", ["wallet", "folder"], [("wallet", "left_of", ["folder"])]),
    ("ручка ниже цветов", ["pen", "flowers"], [("pen", "below", ["flowers"])]),
    ("наушники выше кошелька", ["headphones", "wallet"], [("headphones", "above", ["wallet"])]),
    ("телефон позади книги", ["phone", "book"], [("phone", "behind", ["book"])]),
    ("монета перед папкой", ["coin", "folder"], [("coin", "in_front_of", ["folder"])]),
    ("book left of coin", ["book", "coin"], [("book", "left_of", ["coin"])]),
    ("phone right of lamp", ["phone", "lamp"], [("phone", "right_of", ["lamp"])]),
    ("puzzle above book", ["puzzle", "book"], [("puzzle", "above", ["book"])]),
    ("wallet under folder", ["wallet", "folder"], [("wallet", "below", ["folder"])]),
    ("coin on top of book", ["coin", "book"], [("coin", "on", ["book"])]),
    ("phone behind book", ["phone", "book"], [("phone", "behind", ["book"])]),
    ("pen in front of folder", ["pen", "folder"], [("pen", "in_front_of", ["folder"])]),
    (
        "книга и лампа слева от монеты",
        ["book", "lamp", "coin"],
        [("book", "left_of", ["coin"]), ("lamp", "left_of", ["coin"])],
    ),
    ("монета под книгой и лампой", ["coin", "book", "lamp"], [("coin", "below", ["book", "lamp"])]),
    (
        "пазл и монета над книгой",
        ["puzzle", "coin", "book"],
        [("puzzle", "above", ["book"]), ("coin", "above", ["book"])],
    ),
    (
        "book and coin above folder",
        ["book", "coin", "folder"],
        [("book", "above", ["folder"]), ("coin", "above", ["folder"])],
    ),
    (
        "книга слева от монеты, монета слева от лампы",
        ["book", "coin", "lamp"],
        [("book", "left_of", ["coin"]), ("coin", "left_of", ["lamp"])],
    ),
    (
        "книга над телефоном, телефон над папкой",
        ["book", "phone", "folder"],
        [("book", "above", ["phone"]), ("phone", "above", ["folder"])],
    ),
    (
        "монета на пазле, а под ними книга",
        ["coin", "puzzle", "book"],
        [("coin", "on", ["puzzle"]), ("book", "below", ["coin", "puzzle"])],
    ),
    (
        "книга слева от лампы и над монетой",
        ["book", "lamp", "coin"],
        [("book", "left_of", ["lamp"]), ("book", "above", ["coin"])],
    ),
    ("книга не слева, а справа от монеты", ["book", "coin"], [("book", "right_of", ["coin"])]),
    ("монета не под книгой, а над ней", ["coin", "book"], [("coin", "above", ["book"])]),
    (
        "папка, лампа, книга, телефон, монета и ручка без наложений",
        ["folder", "lamp", "book", "phone", "coin", "pen"],
        [],
    ),
    (
        "цветы, наушники, пазл, кошелёк, монета и телефон",
        ["flowers", "headphones", "puzzle", "wallet", "coin", "phone"],
        [],
    ),
]


def assert_relation(scene, relation):
    subject, kind, targets = relation
    b = boxes(scene)
    x, y, w, h = b[subject]
    order = [e.family for e in scene.elements]
    for target in targets:
        tx, ty, tw, th = b[target]
        if kind == "left_of":
            assert x + w < tx
        elif kind == "right_of":
            assert tx + tw < x
        elif kind == "above":
            assert y + h < ty
        elif kind == "below":
            assert ty + th < y
        else:
            assert min(x + w, tx + tw) > max(x, tx)
            assert min(y + h, ty + th) > max(y, ty)
            if kind == "on":
                assert y < ty
            assert (order.index(subject) < order.index(target)) == (kind == "behind")


@pytest.mark.parametrize("prompt,families,expected", CASES)
@pytest.mark.parametrize("format", FORMATS)
@pytest.mark.parametrize("detail", ["S", "L"])
def test_spatial_language_matrix_all_variants_formats_details(
    prompt, families, expected, format, detail
):
    request = ComposeRequest(
        prompt=prompt, mode="components", format=format, detail=detail, palette=PALETTES[0]
    )
    scenes = compose_variants(families, request)
    assert len(scenes) == 3
    allowed = {
        frozenset((subject, target))
        for subject, kind, targets in expected
        if kind in {"on", "behind", "in_front_of"}
        for target in targets
    }
    for scene in scenes:
        b = boxes(scene)
        for relation in expected:
            assert_relation(scene, relation)
        for family, (x, y, w, h) in b.items():
            assert 0 <= x <= x + w <= scene.size[0] + 0.001
            assert 0 <= y <= y + h <= scene.size[1] + 0.001
            element = next(e for e in scene.elements if e.family == family)
            assert element.role == "main"
            assert element.scale_x == element.scale_y == 1
            assert element.angle == 0
            for other, (ox, oy, ow, oh) in b.items():
                if other == family or frozenset((family, other)) in allowed:
                    continue
                assert x + w <= ox or ox + ow <= x or y + h <= oy or oy + oh <= y, (family, other)


@pytest.mark.parametrize("prompt,families,expected", CASES)
def test_component_mode_accepts_relations_and_inflections(prompt, families, expected):
    from app.composition import select_components

    found, unknown = select_components(prompt)
    assert found == families
    assert not unknown


def test_contradictory_relations_report_error_instead_of_ignoring_request():
    request = ComposeRequest(
        prompt="книга слева от монеты, монета слева от книги",
        mode="components",
        palette=PALETTES[0],
    )
    with pytest.raises(ValueError, match="Противоречивое"):
        compose_variants(["book", "coin"], request)


@pytest.mark.parametrize(
    "prompt,families,relation",
    [
        ("слева от монеты книга", ["coin", "book"], ("book", "left_of", ["coin"])),
        ("над книгой монета", ["book", "coin"], ("coin", "above", ["book"])),
        ("книга, а справа монета", ["book", "coin"], ("coin", "right_of", ["book"])),
        ("слева книга, справа монета", ["book", "coin"], ("coin", "right_of", ["book"])),
    ],
)
def test_reversed_clause_word_order(prompt, families, relation):
    request = ComposeRequest(prompt=prompt, mode="components", palette=PALETTES[0])
    for scene in compose_variants(families, request):
        assert_relation(scene, relation)


def test_group_reference_after_subject():
    request = ComposeRequest(
        prompt="пазл на монете, а книга под ними", mode="components", palette=PALETTES[0]
    )
    for scene in compose_variants(["puzzle", "coin", "book"], request):
        assert_relation(scene, ("puzzle", "on", ["coin"]))
        assert_relation(scene, ("book", "below", ["puzzle", "coin"]))


def test_book_is_centered_below_explicit_contact_group():
    request = ComposeRequest(
        prompt="пазл на монете а под ними книга", mode="components", palette=PALETTES[0]
    )
    for scene in compose_variants(["puzzle", "coin", "book"], request):
        b = boxes(scene)
        assert abs(b["book"][0] + b["book"][2] / 2 - b["puzzle"][0] - b["puzzle"][2] / 2) < 0.001


def test_every_named_object_is_main_unless_explicitly_background():
    request = ComposeRequest(
        prompt="пазл на монете а под ними книга", mode="components", palette=PALETTES[0]
    )
    for scene in compose_variants(["puzzle", "coin", "book"], request):
        assert all(e.role == "main" for e in scene.elements)


def test_implicit_metaphor_supports_can_still_use_background_variants():
    request = ComposeRequest(prompt="Свет знаний", palette=PALETTES[0])
    for scene in compose_variants(["lamp", "book", "pen"], request):
        assert next(e for e in scene.elements if e.family == "pen").role == "background"


@pytest.mark.parametrize(
    "prompt",
    [
        "Над книгой монета, справа от книги телефон",
        "Над книгой монета; справа от книги телефон",
        "Above book coin, to the right of book phone",
        "Above book coin; to the right of book phone",
        "Книга, монета над книгой; справа от книги телефон",
    ],
)
@pytest.mark.parametrize("format", FORMATS)
@pytest.mark.parametrize("detail", ["S", "L"])
def test_inverted_clauses_have_exact_relations_without_cross_clause_subjects(
    prompt, format, detail
):
    from app.layout import LayoutIntent, LayoutRelation, parse_layout_intent, resolve_intent

    families = ["book", "coin", "phone"]
    expected = {("coin", "above", ("book",)), ("phone", "right_of", ("book",))}
    literal = parse_layout_intent(prompt, families)
    assert {(r.subject, r.relation, tuple(r.targets)) for r in literal.relations} == expected
    model = LayoutIntent(
        relations=[LayoutRelation(subject=s, relation=r, targets=list(t)) for s, r, t in expected]
    )
    merged = resolve_intent(prompt, families, model)
    assert {(r.subject, r.relation, tuple(r.targets)) for r in merged.relations} == expected
    request = ComposeRequest(
        prompt=prompt, mode="components", palette=PALETTES[0], format=format, detail=detail
    )
    for scene in compose_variants(families, request, model):
        assert_relation(scene, ("coin", "above", ["book"]))
        assert_relation(scene, ("phone", "right_of", ["book"]))
        b = boxes(scene)
        assert abs(b["coin"][0] + b["coin"][2] / 2 - b["book"][0] - b["book"][2] / 2) < 0.001


@pytest.mark.parametrize("prompt,families,expected", CASES)
def test_literal_relation_set_has_no_unrequested_relations(prompt, families, expected):
    from app.layout import parse_layout_intent

    actual = parse_layout_intent(prompt, families)
    assert {(r.subject, r.relation, tuple(r.targets)) for r in actual.relations} == {
        (subject, kind, tuple(targets)) for subject, kind, targets in expected
    }


@pytest.mark.parametrize(
    "prompt,families,expected",
    [
        (
            "Пазл и монета на книге",
            ["puzzle", "coin", "book"],
            [("puzzle", "on", ["book"]), ("coin", "on", ["book"])],
        ),
        (
            "Монета слева от книги, а телефон справа от неё",
            ["coin", "book", "phone"],
            [("coin", "left_of", ["book"]), ("phone", "right_of", ["book"])],
        ),
        (
            "Coin left of book, phone right of it",
            ["coin", "book", "phone"],
            [("coin", "left_of", ["book"]), ("phone", "right_of", ["book"])],
        ),
        (
            "Папка позади наушников, ручка под ними",
            ["folder", "headphones", "pen"],
            [("folder", "behind", ["headphones"]), ("pen", "below", ["folder", "headphones"])],
        ),
    ],
)
@pytest.mark.parametrize("format", FORMATS)
@pytest.mark.parametrize("detail", ["S", "L"])
def test_adversarial_group_contacts_and_pronouns(prompt, families, expected, format, detail):
    from app.layout import parse_layout_intent

    intent = parse_layout_intent(prompt, families)
    assert {(r.subject, r.relation, tuple(r.targets)) for r in intent.relations} == {
        (s, r, tuple(t)) for s, r, t in expected
    }
    request = ComposeRequest(
        prompt=prompt, mode="components", palette=PALETTES[0], format=format, detail=detail
    )
    allowed = {
        frozenset((subject, target))
        for subject, kind, targets in expected
        if kind in {"on", "behind", "in_front_of"}
        for target in targets
    }
    for scene in compose_variants(families, request):
        for relation in expected:
            assert_relation(scene, relation)
        b = boxes(scene)
        for family, (x, y, w, h) in b.items():
            assert 0 <= x <= x + w <= scene.size[0] + 0.001
            assert 0 <= y <= y + h <= scene.size[1] + 0.001
            for other, (ox, oy, ow, oh) in b.items():
                if other == family or frozenset((family, other)) in allowed:
                    continue
                assert x + w <= ox or ox + ow <= x or y + h <= oy or oy + oh <= y
        if families == ["puzzle", "coin", "book"]:
            puzzle, coin = b["puzzle"], b["coin"]
            assert puzzle[0] + puzzle[2] < coin[0] or coin[0] + coin[2] < puzzle[0]


def test_color_adjective_does_not_add_flowers_to_explicit_objects():
    from app.layout import mentions

    for text in ("Цветная книга слева от монеты", "Книга цвета монеты", "Книга с цветом монеты"):
        assert [m.lastgroup for m in mentions(text)] == ["book", "coin"]
    assert [m.lastgroup for m in mentions("цветы, цветов, цветами, цветок")] == ["flowers"] * 4


def test_ai_relations_for_other_targets_survive_literal_subject_override():
    from app.layout import LayoutIntent, LayoutRelation, resolve_intent

    model = LayoutIntent(
        relations=[
            LayoutRelation(subject="book", relation="left_of", targets=["coin"]),
            LayoutRelation(subject="book", relation="above", targets=["phone"]),
            LayoutRelation(subject="book", relation="right_of", targets=["coin"]),
            LayoutRelation(subject="coin", relation="left_of", targets=["book"]),
        ]
    )
    actual = resolve_intent(
        "book left of coin and higher than phone", ["book", "coin", "phone"], model
    )
    assert {(r.subject, r.relation, tuple(r.targets)) for r in actual.relations} == {
        ("book", "left_of", ("coin",)),
        ("book", "above", ("phone",)),
    }


def test_one_subject_stays_centered_on_its_support():
    request = ComposeRequest(prompt="пазл на монете", mode="components", palette=PALETTES[0])
    for scene in compose_variants(["puzzle", "coin"], request):
        b = boxes(scene)
        assert abs(b["puzzle"][0] + b["puzzle"][2] / 2 - b["coin"][0] - b["coin"][2] / 2) < 0.001
