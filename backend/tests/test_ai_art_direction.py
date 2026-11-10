import asyncio
import json

import httpx
import pytest
from app.ai import AIError, OpenAISelector, Selection
from app.art_direction import ArtDirection, ColorDirective, RoleDirective
from app.config import Settings
from app.layout import LayoutIntent, parse_layout_intent, resolve_intent


def select(prompt, art=None, families=None, inspect=None):
    selection = {
        "accepted": True,
        "families": families or ["book", "phone"],
        "explanation": "Предметы поддерживают тему.",
        "layout": {"relations": [], "art": art},
    }

    def serve(request):
        if inspect:
            inspect(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": json.dumps(selection)}],
                    }
                ],
            },
        )

    async def run():
        settings = Settings(_env_file=None, openai_api_key="test-only-key", http_proxy="")
        async with httpx.AsyncClient(transport=httpx.MockTransport(serve)) as client:
            return await OpenAISelector(settings, client).select(prompt)

    return asyncio.run(run())


def test_literal_layout_combines_art_and_exact_support_without_false_background_relation():
    prompt = "книга крупно, телефон на книге; книга фоновая, телефон розовый"
    intent = parse_layout_intent(prompt, ["book", "phone"])
    assert [(r.subject, r.relation, r.targets) for r in intent.relations] == [
        ("phone", "on", ["book"])
    ]
    assert intent.art.framing == "close"
    assert intent.art.focus == "book"
    assert intent.art.roles == [RoleDirective(family="book", role="background")]
    assert intent.art.colors == [ColorDirective(family="phone", color="pink")]


def test_crop_and_background_words_do_not_add_spatial_relations():
    intent = parse_layout_intent(
        "книга выходит за левый край, телефон на заднем плане", ["book", "phone"]
    )
    assert intent.relations == []
    assert intent.art.framing == "bleed"
    assert intent.art.crop.horizontal == "left"
    assert intent.art.roles == [RoleDirective(family="phone", role="background")]


def test_resolver_keeps_inferred_art_but_literal_per_object_preferences_win():
    proposed = LayoutIntent.model_validate(
        {
            "relations": [],
            "art": {
                "framing": "bleed",
                "focus": "phone",
                "colors": [
                    {"family": "phone", "color": "blue"},
                    {"family": "book", "color": "yellow"},
                ],
            },
        }
    )
    intent = resolve_intent("телефон розовый, книга; без обрезки", ["phone", "book"], proposed)
    assert intent.art.framing == "fit"
    assert intent.art.focus == "phone"
    assert {d.family: d.color for d in intent.art.colors} == {"phone": "pink", "book": "yellow"}


def test_provider_schema_is_strict_recursively_and_optional_art_is_nullable():
    def inspect(payload):
        def assert_strict(value):
            if isinstance(value, dict):
                assert "default" not in value
                if value.get("type") == "object":
                    assert value["additionalProperties"] is False
                    assert set(value["required"]) == set(value["properties"])
                for child in value.values():
                    assert_strict(child)
            elif isinstance(value, list):
                for child in value:
                    assert_strict(child)

        schema = payload["text"]["format"]["schema"]
        assert_strict(schema)
        layout_schema = schema["$defs"]["LayoutIntent"]
        assert "art" in layout_schema["required"]
        assert {"type": "null"} in layout_schema["properties"]["art"]["anyOf"]
        assert "layout.art" in payload["instructions"]
        assert payload["max_output_tokens"] >= 2200

    families, _, intent = select("Обучение", inspect=inspect)
    assert families == ["book", "phone"]
    assert intent.art is None
    assert "art" not in Selection.model_json_schema()["$defs"]["LayoutIntent"]["required"]


def test_validated_ai_art_reaches_layout_without_any_coordinates():
    art = {
        "framing": "close",
        "focus": "phone",
        "roles": [{"family": "book", "role": "background"}],
        "colors": [{"family": "phone", "color": "pink"}],
        "crop": {"family": "phone", "horizontal": "right", "vertical": "bottom"},
    }
    _, _, intent = select("Новая связь", art)
    assert intent.art == ArtDirection.model_validate(art)


@pytest.mark.parametrize(
    "art",
    [
        {"focus": "coin"},
        {"roles": [{"family": "coin", "role": "background"}]},
        {"colors": [{"family": "coin", "color": "yellow"}]},
        {"crop": {"family": "coin"}},
        {"framing": "close", "x": 600},
        {"colors": [{"family": "phone", "color": "#FF0000"}]},
    ],
)
def test_ai_art_with_unselected_references_or_untrusted_fields_is_rejected(art):
    with pytest.raises(AIError):
        select("Обучение", art)


@pytest.mark.parametrize(
    "prompt,expected",
    [
        ("желтый кошелек, телефон на заднем плане", ["wallet", "phone"]),
        ("книга крупно, телефон", ["book", "phone"]),
        ("книга выходит за левый край, кошелек", ["book", "wallet"]),
        ("книга, кошелек; без обрезки", ["book", "wallet"]),
    ],
)
def test_literal_art_directives_preserve_all_named_subjects(prompt, expected):
    families, _, _ = select(prompt, families=["book", "lamp"])
    assert families == expected


def test_older_provider_fake_layout_without_art_remains_accepted():
    result = Selection.model_validate(
        {
            "accepted": True,
            "families": ["book"],
            "explanation": "Знания",
            "layout": {"relations": []},
        }
    )
    assert result.layout.art is None


@pytest.mark.parametrize(
    "prompt,expected",
    [
        ("телефон на книге, фоновая лампа", {("phone", "on", ("book",))}),
        ("телефон на книге, лампа фоновая", {("phone", "on", ("book",))}),
        ("телефон на книге, желтая лампа", {("phone", "on", ("book",))}),
        ("телефон на книге, лампа желтая", {("phone", "on", ("book",))}),
        ("книга справа от телефона, монета крупно", {("book", "right_of", ("phone",))}),
        ("книга справа от телефона, крупная монета", {("book", "right_of", ("phone",))}),
        ("книга справа от телефона, монета без обрезки", {("book", "right_of", ("phone",))}),
        ("фоновая лампа, телефон на книге", {("phone", "on", ("book",))}),
        ("лампа желтая, телефон на книге", {("phone", "on", ("book",))}),
        ("монета крупно, книга справа от телефона", {("book", "right_of", ("phone",))}),
        ("phone on book, background lamp", {("phone", "on", ("book",))}),
        ("phone on book, lamp yellow", {("phone", "on", ("book",))}),
    ],
)
def test_independent_art_clauses_do_not_expand_spatial_subject_or_target_groups(prompt, expected):
    from app.layout import mentions

    families = list(dict.fromkeys(noun.lastgroup for noun in mentions(prompt)))
    intent = parse_layout_intent(prompt, families)
    assert {(r.subject, r.relation, tuple(r.targets)) for r in intent.relations} == expected


@pytest.mark.parametrize(
    "prompt,expected",
    [
        ("телефон на книге, лампе", {("phone", "on", ("book", "lamp"))}),
        ("телефон на книге, фоновой лампе", {("phone", "on", ("book", "lamp"))}),
        ("телефон на книге, лампе желтой", {("phone", "on", ("book", "lamp"))}),
        ("телефон на книге и желтой лампе", {("phone", "on", ("book", "lamp"))}),
        ("телефон на книге, и желтой лампе", {("phone", "on", ("book", "lamp"))}),
        (
            "фоновая лампа и телефон на книге",
            {("lamp", "on", ("book",)), ("phone", "on", ("book",))},
        ),
        ("phone on book and yellow lamp", {("phone", "on", ("book", "lamp"))}),
    ],
)
def test_genuine_art_adorned_object_groups_still_preserve_every_member(prompt, expected):
    from app.layout import mentions

    families = list(dict.fromkeys(noun.lastgroup for noun in mentions(prompt)))
    intent = parse_layout_intent(prompt, families)
    assert {(r.subject, r.relation, tuple(r.targets)) for r in intent.relations} == expected


def test_background_clause_does_not_become_a_false_contact_support():
    from app.catalog import PALETTES
    from app.composition import compose_variants
    from app.models import ComposeRequest

    request = ComposeRequest(
        prompt="телефон на книге, фоновая лампа", mode="components", palette=PALETTES[0]
    )
    for scene in compose_variants(["phone", "book", "lamp"], request):
        by_family = {element.family: element for element in scene.elements}
        assert by_family["phone"].support_ids == [by_family["book"].id]
        assert by_family["lamp"].support_ids == []
