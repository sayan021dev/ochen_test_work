import asyncio
import json

import httpx
import pytest
from app.ai import AIError, OpenAISelector, build_client
from app.config import Settings
from app.prompts import PromptOutOfScope


def settings(**kw):
    return Settings(_env_file=None, openai_api_key="test-only-key", http_proxy="", **kw)


def response_payload(selection=None):
    selection = dict(
        selection
        or {
            "accepted": True,
            "families": ["book", "lamp"],
            "explanation": "Книга и свет помогают учиться.",
        }
    )
    selection.setdefault("layout", {"relations": []})
    return {
        "status": "completed",
        "output": [
            {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": json.dumps(
                            selection
                            or {
                                "accepted": True,
                                "families": ["book", "lamp"],
                                "explanation": "Книга и свет помогают учиться.",
                            }
                        ),
                    }
                ],
            }
        ],
    }


def test_model_receives_only_catalog_and_returns_validated_ids():
    def serve(request):
        payload = json.loads(request.content)
        assert payload["model"] == "gpt-6-luna"
        assert payload["store"] is False
        assert payload["text"]["format"]["strict"] is True
        assert "accepted" in payload["text"]["format"]["schema"]["required"]
        assert "tools" not in payload
        assert "<svg" not in request.content.decode()
        assert request.headers["authorization"] == "Bearer test-only-key"
        return httpx.Response(200, json=response_payload())

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(serve)) as client:
            return await OpenAISelector(settings(), client).select("Свет знаний")

    ids, explanation, layout = asyncio.run(run())
    assert ids == ["book", "lamp"]
    assert "учиться" in explanation


@pytest.mark.parametrize(
    "response",
    [
        None,
        [],
        {"status": "completed", "output": [None]},
        {"status": "completed", "output": [{"type": "message", "content": [None]}]},
        {"status": "completed", "output": [{"type": "message", "content": None}]},
        response_payload({"accepted": True, "families": ["dragon"], "explanation": "bad"}),
        response_payload({"families": ["book"], "explanation": "missing decision"}),
        response_payload({"accepted": "true", "families": ["book"], "explanation": "bad"}),
        response_payload({"accepted": True, "families": [], "explanation": "bad"}),
        response_payload({"accepted": False, "families": ["book"], "explanation": "bad"}),
        response_payload({"accepted": False, "families": [], "explanation": "x" * 501}),
        {
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": {"families": ["book"]}}],
                }
            ],
        },
        {"status": "incomplete", "output": []},
        {
            "status": "completed",
            "output": [{"type": "message", "content": [{"type": "refusal", "refusal": "No"}]}],
        },
        {
            "status": "completed",
            "output": [
                {"type": "message", "content": [{"type": "output_text", "text": "not json"}]}
            ],
        },
    ],
)
def test_invalid_ai_output_never_reaches_scene(response):
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json=response))
        ) as client:
            await OpenAISelector(settings(), client).select("тест")

    with pytest.raises(AIError):
        asyncio.run(run())


def test_timeout_is_safe_and_does_not_echo_credentials():
    def timeout(_):
        raise httpx.ConnectTimeout("private proxy URL")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(timeout)) as client:
            await OpenAISelector(settings(), client).select("тест")

    with pytest.raises(AIError) as exc:
        asyncio.run(run())
    assert "private" not in str(exc.value)


def test_semantic_rejection_does_not_forward_model_response():
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(
                    200,
                    json=response_payload(
                        {"accepted": False, "families": [], "explanation": "private model answer"}
                    ),
                )
            )
        ) as client:
            await OpenAISelector(settings(), client).select("Составь договор аренды квартиры")

    with pytest.raises(PromptOutOfScope) as exc:
        asyncio.run(run())
    assert "иллюстрац" in str(exc.value)
    assert "private" not in str(exc.value)


def test_obvious_unrelated_task_does_not_call_provider():
    def serve(_):
        pytest.fail("Unrelated requests must not reach OpenAI")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(serve)) as client:
            await OpenAISelector(settings(), client).select("Напиши скрипт на Python")

    with pytest.raises(PromptOutOfScope):
        asyncio.run(run())


def test_http_proxy_is_explicitly_used_for_https_openai(monkeypatch):
    received = {}

    def capture(**kwargs):
        received.update(kwargs)
        return object()

    monkeypatch.setattr(httpx, "AsyncClient", capture)
    configured = settings()
    configured.http_proxy = "http://proxy.invalid:8888"
    build_client(configured)
    assert received["proxy"] == "http://proxy.invalid:8888"
    assert received["trust_env"] is False


def test_ai_spatial_intent_survives_validated_selection():
    selection = {
        "accepted": True,
        "families": ["book", "coin"],
        "explanation": "Опора",
        "layout": {"relations": [{"subject": "coin", "relation": "on", "targets": ["book"]}]},
    }

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json=response_payload(selection))
            )
        ) as client:
            return await OpenAISelector(settings(), client).select("Монета на книге")

    ids, explanation, layout = asyncio.run(run())
    assert ids == ["coin", "book"]
    assert layout.relations[0].subject == "coin"
    assert layout.relations[0].relation == "on"


@pytest.mark.parametrize(
    "layout",
    [
        {"relations": [{"subject": "coin", "relation": "on", "targets": ["book"]}]},
        {"relations": [{"subject": "book", "relation": "left_of", "targets": ["coin"]}]},
        {"relations": [{"subject": "book", "relation": "above", "targets": ["book"]}]},
        {"relations": [{"subject": "book", "relation": "around", "targets": ["lamp"]}]},
        {"relations": [{"subject": "book", "relation": "left_of", "targets": []}]},
    ],
)
def test_bad_layout_never_reaches_scene(layout):
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(
                    200,
                    json=response_payload(
                        {
                            "accepted": True,
                            "families": ["book", "lamp"],
                            "explanation": "Идея",
                            "layout": layout,
                        }
                    ),
                )
            )
        ) as client:
            await OpenAISelector(settings(), client).select("Идея")

    with pytest.raises(AIError):
        asyncio.run(run())


def test_missing_ai_layout_is_rejected():
    payload = response_payload()
    payload["output"][0]["content"][0]["text"] = json.dumps(
        {"accepted": True, "families": ["book"], "explanation": "Идея"}
    )

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload))
        ) as client:
            await OpenAISelector(settings(), client).select("Идея")

    with pytest.raises(AIError):
        asyncio.run(run())


def test_explicit_spatial_subjects_are_not_dropped_or_invented_by_ai():
    selection = {
        "accepted": True,
        "families": ["puzzle", "book", "phone"],
        "explanation": "Идея",
        "layout": {"relations": []},
    }

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json=response_payload(selection))
            )
        ) as client:
            return await OpenAISelector(settings(), client).select(
                "пазл на монете а под ними книга"
            )

    families, _, intent = asyncio.run(run())
    assert families == ["puzzle", "coin", "book"]
    assert {(r.subject, r.relation, tuple(r.targets)) for r in intent.relations} == {
        ("puzzle", "on", ("coin",)),
        ("book", "below", ("puzzle", "coin")),
    }


def test_colored_adjective_does_not_inject_an_unasked_flower():
    selection = {
        "accepted": True,
        "families": ["book", "coin", "flowers"],
        "explanation": "Идея",
        "layout": {"relations": []},
    }

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json=response_payload(selection))
            )
        ) as client:
            return await OpenAISelector(settings(), client).select("Цветная книга слева от монеты")

    families, _, _ = asyncio.run(run())
    assert families == ["book", "coin"]
