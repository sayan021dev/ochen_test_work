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
        assert sum(e.role == "main" for e in s.elements) == 3
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


def test_every_size_preset_supports_small_coin_in_both_detail_sets():
    from app.catalog import PALETTES
    from app.composition import compose_variants
    from app.models import FORMATS, ComposeRequest

    for format in FORMATS:
        for detail in ("S", "L"):
            request = ComposeRequest(
                prompt="монета",
                mode="components",
                format=format,
                detail=detail,
                palette=PALETTES[0],
            )
            result = compose_variants(["coin"], request)
            assert len(result) == 3
            assert all(
                scene.format == format and scene.scale <= (4 if detail == "L" else 8)
                for scene in result
            )


@pytest.mark.parametrize("detail", ["S", "L"])
@pytest.mark.parametrize(
    "format",
    ["square", "landscape", "portrait", "standard", "hd", "fullhd", "post", "story", "wide"],
)
def test_composed_receiver_chain_persists_instance_ids_in_all_variants(detail, format):
    prompt = "лампа стоит на телефоне и на лампе лежит ручка"
    found, unknown = select_components(prompt)
    assert found == ["lamp", "phone", "pen"]
    assert not unknown
    request = ComposeRequest(
        prompt=prompt, mode="components", palette=PALETTES[0], detail=detail, format=format
    )
    for scene in compose_variants(found, request):
        by_family = {e.family: e for e in scene.elements}
        assert by_family["lamp"].support_ids == [by_family["phone"].id]
        assert by_family["pen"].support_ids == [by_family["lamp"].id]
        assert by_family["phone"].support_ids == []
        assert [e.family for e in scene.elements] == ["phone", "lamp", "pen"]


@pytest.mark.parametrize("detail", ["S", "L"])
@pytest.mark.parametrize(
    "format",
    ["square", "landscape", "portrait", "standard", "hd", "fullhd", "post", "story", "wide"],
)
def test_all_on_targets_are_persisted_without_turning_behind_into_a_support(detail, format):
    request = ComposeRequest(
        prompt="монета на книге и папке",
        mode="components",
        palette=PALETTES[0],
        detail=detail,
        format=format,
    )
    for scene in compose_variants(["coin", "book", "folder"], request):
        by_family = {e.family: e for e in scene.elements}
        assert by_family["coin"].support_ids == [by_family["book"].id, by_family["folder"].id]
        from app.catalog import asset_for

        bounds = {}
        for family, item in by_family.items():
            asset = asset_for(family, detail, item.role)
            bounds[family] = (
                item.x,
                item.y,
                asset["width"] * scene.scale,
                asset["height"] * scene.scale,
            )
        for x, y, w, h in bounds.values():
            assert 0 <= x < x + w <= scene.size[0] + 0.001
            assert 0 <= y < y + h <= scene.size[1] + 0.001
        cx, cy, cw, ch = bounds["coin"]
        for support in ("book", "folder"):
            x, y, w, h = bounds[support]
            assert min(cx + cw, x + w) > max(cx, x)
            assert min(cy + ch, y + h) > max(cy, y)
        bx, by, bw, bh = bounds["book"]
        fx, fy, fw, fh = bounds["folder"]
        assert bx + bw <= fx or fx + fw <= bx or by + bh <= fy or fy + fh <= by
    request = ComposeRequest(prompt="телефон позади книги", mode="components", palette=PALETTES[0])
    assert all(
        not e.support_ids
        for scene in compose_variants(["phone", "book"], request)
        for e in scene.elements
    )


@pytest.mark.parametrize("explicit_light", [True, False])
def test_scene_light_is_preserved_in_three_fresh_variants(explicit_light):
    from app.models import SceneLight

    light = SceneLight(enabled=True, x=200, y=350, height=1200, opacity=0.4)
    request = ComposeRequest(prompt="монета", palette=PALETTES[0], light=light)
    scenes = compose_variants(["coin"], request, **({"light": light} if explicit_light else {}))
    assert len(scenes) == 3
    assert all(s.light.model_dump() == light.model_dump() for s in scenes)
    scenes[0].light.x = 999
    assert scenes[1].light.x == light.x == 200
