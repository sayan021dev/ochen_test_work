"""Cheap rejection of clear task requests before spending the AI request quota.

This deliberately recognizes instructions, not subject words: technical topics
are legitimate illustration ideas. Ambiguous headlines are allowed.
"""

import re
import unicodedata

OUT_OF_SCOPE_MESSAGE = (
    "Этот конструктор собирает только иллюстрации из библиотеки. "
    "Опишите тему, метафору или предметы для иллюстрации."
)


class PromptOutOfScope(ValueError):
    def __init__(self):
        super().__init__(OUT_OF_SCOPE_MESSAGE)


# Only commands at the start of a clause are tasks. For example, 'How to write
# code' is a possible headline, whereas 'Write Python code' is a direct task.
_COMMAND = r"(?:^|[.!?;,\n])\s*(?:(?:пожалуйста|please|затем|then)\b[,\s]*)?"

_UNRELATED_INSTRUCTIONS = tuple(
    re.compile(pattern)
    for pattern in (
        # Explicit rule changes and instruction extraction remain blocked.
        _COMMAND
        + r"(?:ignore|disregard|forget|bypass)\b.{0,90}\b(?:instructions?|rules?|system|prompt)\b",
        _COMMAND
        + r"(?:игнорируй|забудь|отмени|обойди)\b.{0,90}\b(?:инструкци\w*|правил\w*|промпт\w*)",
        _COMMAND + r"(?![^\n.!?]*\b(?:illustration|picture|scene)\b)"
        r"(?:act as|pretend (?:that )?you|you are now)\b"
        r"(?:(?!illustration|art director|artist).){0,40}"
        r"\b(?:developer|programmer|translator|unrestricted assistant)\b",
        _COMMAND + r"(?![^\n.!?]*(?:иллюстраци|нарисуй|композици))"
        r"(?:представь[, ]+(?:себе[, ]+)?что ты|ты теперь|веди себя как)\b"
        r"(?:(?!иллюстраци|художник|арт-директор).){0,40}"
        r"\b(?:разработчик\w*|программист\w*|переводчик\w*|помощник по программированию)\b",
        r"\b(?:reveal|show|print|repeat|extract|output|return|display|tell me)\b"
        r".{0,60}\b(?:system|developer|hidden)\b.{0,30}\b(?:prompt|instructions?)\b",
        r"\b(?:покажи|раскрой|выведи|повтори|извлеки|напиши|пришли|расскажи|верни|выдай)\b"
        r".{0,60}\b(?:системн\w*|скрыт\w*|внутренн\w*)\s+(?:промпт\w*|инструкци\w*)",
        r"(?:^|\n)\s*(?:system|developer|assistant)\s*:",
        r"<\|(?:im_start|system|assistant|developer)\|>",
        # Explicit output tasks. Nouns like 'programming' alone must stay valid.
        _COMMAND + r"(?:write|generate|implement|execute|run|debug)\b"
        r"(?:(?!illustration|picture|scene).){0,70}"
        r"\b(?:code|script|program|function|sql|email|essay|poem)\b",
        _COMMAND + r"(?:напиши|создай|сгенерируй|выполни|запусти|исправь)\b"
        r"(?:(?!иллюстраци|рисунок|композици).){0,70}"
        r"\b(?:код\w*|скрипт\w*|программу|программы|функцию|sql|письмо|эссе|стихотворени\w*)\b",
        _COMMAND + r"(?![^\n.!?]*(?:иллюстраци|illustration|picture|scene))"
        r"(?:переведи|translate)\b.{0,100}"
        r"\b(?:текст\w*|фраз\w*|предложени\w*|английск\w*|русск\w*|немецк\w*|французск\w*|into|to|text|sentence)\b",
        _COMMAND + r"(?:посчитай|вычисли|calculate|compute)\s+\d",
    )
)


def validate_illustration_prompt(prompt: str) -> None:
    normalized = unicodedata.normalize("NFKC", prompt).casefold().replace("ё", "е")
    if any(pattern.search(normalized) for pattern in _UNRELATED_INSTRUCTIONS):
        raise PromptOutOfScope()
