import pytest
from app.catalog import PALETTES
from app.composition import compose_variants, select_components, select_offline_metaphor
from app.models import ComposeRequest


@pytest.mark.parametrize(
    ("prompt", "wanted"),
    [
        ("книга, лампа и наушники", ["book", "lamp", "headphones"]),
        ("КНИГА, книга, телефон", ["book", "phone"]),
        ("кошелёк; монета", ["wallet", "coin"]),
        ("phone and book", ["phone", "book"]),
    ],
)
def test_component_names_are_resolved_without_llm(prompt, wanted):
    ids, unknown = select_components(prompt)
    assert ids == wanted
    assert not unknown


def test_unknown_component_is_not_silently_substituted():
    assert select_components("лампа, дракон") == (["lamp"], ["дракон"])


def test_offline_metaphor_has_explicit_supported_meaning():
    ids, _ = select_offline_metaphor("Собрать знания в систему")
    assert ids == ["book", "puzzle", "pen"]
    with pytest.raises(ValueError):
        select_offline_metaphor("межгалактическая дипломатия")


@pytest.mark.parametrize("detail", ["L", "S"])
@pytest.mark.parametrize("format", ["square", "landscape", "portrait"])
def test_layouts_are_repeatable_and_keep_shared_scale(detail, format):
    request = ComposeRequest(
        prompt="книга, лампа, монета",
        mode="components",
        palette=PALETTES[0],
        detail=detail,
        format=format,
    )
    first = compose_variants(["book", "lamp", "coin"], request)
    second = compose_variants(["book", "lamp", "coin"], request)
    assert [s.model_dump() for s in first] == [s.model_dump() for s in second]
    assert len(first) == 3
    assert len({tuple((e.x, e.y) for e in s.elements) for s in first}) == 3
    for s in first:
        assert {e.family for e in s.elements} == {"book", "lamp", "coin"}
        assert sum(e.role == "main" for e in s.elements) == 2
        assert all(0 <= e.x < s.size[0] and 0 <= e.y < s.size[1] for e in s.elements)


@pytest.mark.parametrize(
    "family",
    ["book", "phone", "puzzle", "coin", "headphones", "lamp", "flowers", "wallet", "folder", "pen"],
)
@pytest.mark.parametrize("detail", ["L", "S"])
def test_single_subject_layout_works_for_every_original_size(family, detail):
    request = ComposeRequest(prompt=family, mode="components", palette=PALETTES[0], detail=detail)
    scenes = compose_variants([family], request)
    assert len(scenes) == 3
    assert scenes[0].elements[0].family == family
