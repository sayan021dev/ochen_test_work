import asyncio
import json

import httpx
import pytest
from app.ai import AIError, OpenAISelector, build_client
from app.config import Settings


def settings(**kw):
    return Settings(_env_file=None, openai_api_key="test-only-key", http_proxy="", **kw)


def response_payload(selection=None):
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
        assert "tools" not in payload
        assert "<svg" not in request.content.decode()
        assert request.headers["authorization"] == "Bearer test-only-key"
        return httpx.Response(200, json=response_payload())

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(serve)) as client:
            return await OpenAISelector(settings(), client).select("Свет знаний")

    ids, explanation = asyncio.run(run())
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
        response_payload({"families": ["dragon"], "explanation": "bad"}),
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
