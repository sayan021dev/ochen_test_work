"""Semantic art direction, independent of scene coordinates and source geometry.

Only catalog families and a small vocabulary cross the AI boundary. Literal
instructions take precedence over inferred choices, independently for each family.
"""

import re
from typing import Literal

from pydantic import Field, model_validator

from app.models import Family, Model

ColorName = Literal[
    "yellow", "pink", "blue", "green", "orange", "purple", "red", "white", "black", "gray"
]


class RoleDirective(Model):
    family: Family
    role: Literal["main", "background"]


class ColorDirective(Model):
    family: Family
    color: ColorName


class CropDirective(Model):
    family: Family
    horizontal: Literal["left", "center", "right"] = "center"
    vertical: Literal["top", "center", "bottom"] = "center"


class ArtDirection(Model):
    framing: Literal["fit", "close", "bleed"] | None = None
    focus: Family | None = None
    roles: list[RoleDirective] = Field(default_factory=list, max_length=6)
    colors: list[ColorDirective] = Field(default_factory=list, max_length=6)
    crop: CropDirective | None = None

    @model_validator(mode="after")
    def unique_family_directives(self):
        for name in ("roles", "colors"):
            unique = {directive.family: directive for directive in getattr(self, name)}
            object.__setattr__(self, name, list(unique.values()))
        return self


# Shared with the spatial parser; no example composition or asset-specific layout.
NOUN_PATTERNS = {
    "book": r"книг[а-я]*|books?",
    "phone": r"телефон[а-я]*|phones?",
    "puzzle": r"пазл[а-я]*|puzzles?",
    "coin": r"монет[а-я]*|coins?",
    "headphones": r"наушник[а-я]*|headphones?",
    "lamp": r"ламп[а-я]*|lamps?",
    "flowers": r"цвет(?:ы|ов|ам|ами|ах|ок|ка|ку|ком|ке)|букет[а-я]*|ваз[а-я]*|flowers?",
    "wallet": r"кошел[еь]к[а-я]*|кошельк[а-я]*|wallets?",
    "folder": r"папк[а-я]*|folders?",
    "pen": r"ручк[а-я]*|pens?",
}
NOUN_RE = re.compile(
    r"\b(?:" + "|".join(f"(?P<{f}>{p})" for f, p in NOUN_PATTERNS.items()) + r")\b"
)


def mentions(prompt: str):
    return list(NOUN_RE.finditer(prompt.lower().replace("ё", "е")))


COLOR_PATTERNS = {
    "yellow": r"желт[а-я]*|yellow",
    "pink": r"розов[а-я]*|pink",
    "blue": r"син(?:ий|яя|ее|ие|его|юю|ем|им|ей|их|ими)|голуб[а-я]*|blue",
    "green": r"зелен[а-я]*|green",
    "orange": r"оранжев[а-я]*|orange",
    "purple": r"фиолетов[а-я]*|purple|violet",
    "red": r"красн[а-я]*|red",
    "white": r"бел(?:ый|ая|ое|ые|ого|ую|ом|ым|ой|ых|ыми)|white",
    "black": r"черн[а-я]*|black",
    "gray": r"сер(?:ый|ая|ое|ые|ого|ую|ом|ым|ой|ых|ыми)|gr[ae]y",
}
COLOR_RE = re.compile(
    r"\b(?:" + "|".join(f"(?P<{c}>{p})" for c, p in COLOR_PATTERNS.items()) + r")\b"
)
ROLE_RE = re.compile(
    r"\b(?:(?P<background>фонов[а-я]*|на\s+заднем\s+плане|background|in\s+the\s+background)"
    r"|(?P<main>главн[а-я]*|основн[а-я]*|цветн[а-я]*|на\s+переднем\s+плане|main|foreground))\b"
)
FIT_RE = re.compile(
    r"\b(?:без\s+(?:обрезки|кадрирования)|не\s+обрезать|целиком|полностью\s+в\s+кадре|"
    r"no\s+cropping|without\s+cropping|uncropped|fit\s+in\s+frame)\b"
)
CLOSE_RE = re.compile(
    r"\b(?:крупно|крупн(?:ый|ым|ого)\s+план(?:ом|а)?|крупн(?:ая|ое|ые|ый)|"
    r"во\s+весь\s+кадр|close[ -]?up|large)\b"
)
BLEED_RE = re.compile(
    r"\b(?:(?:выход[а-я]*|выйти)\s+)?за\s+(?:лев[а-я]*|прав[а-я]*|верхн[а-я]*|"
    r"нижн[а-я]*)\s+(?:край|границ[а-я]*)\b|"
    r"\b(?:с\s+обрезкой|с\s+кадрированием|навылет|bleed|cropped\s+at\s+the\s+"
    r"(?:left|right|top|bottom)\s+edge)\b"
)
ANCHOR_RE = re.compile(
    r"\b(?:слева(?!\s+от\b)|справа(?!\s+от\b)|сверху|снизу|"
    r"в\s+(?:(?:левом|правом)\s+)?(?:(?:верхнем|нижнем)\s+)?углу)\b"
)
NEGATION_RE = re.compile(r"\b(?:не|not)\s*$")


def _owner(text, match, nouns):
    """Attach prefix adjectives to the next noun, suffix cues to the previous one."""
    start = max(text.rfind(mark, 0, match.start()) for mark in (",", ";", "\n")) + 1
    stops = [text.find(mark, match.end()) for mark in (",", ";", "\n")]
    end = min((stop for stop in stops if stop >= 0), default=len(text))
    following = next((n for n in nouns if match.end() <= n.start() < end), None)
    if following:
        gap = text[match.end() : following.start()]
        for pattern in (COLOR_RE, ROLE_RE, CLOSE_RE):
            gap = pattern.sub(" ", gap)
        if re.fullmatch(r"\s*(?:[-—:]\s*)?", gap):
            return following.lastgroup
    preceding = [n for n in nouns if start <= n.end() <= match.start()]
    return preceding[-1].lastgroup if preceding else None


def _negated(text, match):
    return bool(NEGATION_RE.search(text[: match.start()]))


def _anchor(family, text):
    horizontal = "left" if re.search(r"лев|left", text) else "center"
    if re.search(r"прав|right", text):
        horizontal = "right"
    vertical = "top" if re.search(r"верх|сверху|top", text) else "center"
    if re.search(r"ниж|снизу|bottom", text):
        vertical = "bottom"
    return CropDirective(family=family, horizontal=horizontal, vertical=vertical)


def parse_art_direction(prompt: str, families: list[str]) -> ArtDirection:
    text = prompt.lower().replace("ё", "е")
    nouns = [noun for noun in mentions(text) if noun.lastgroup in families]
    roles, colors = {}, {}
    for pattern, directives, cls, field in (
        (ROLE_RE, roles, RoleDirective, "role"),
        (COLOR_RE, colors, ColorDirective, "color"),
    ):
        for match in pattern.finditer(text):
            family = _owner(text, match, nouns)
            if family and not _negated(text, match):
                directives[family] = cls(family=family, **{field: match.lastgroup})
    framing, focus, crop = None, None, None
    framing_cues = [(m.start(), "close", m) for m in CLOSE_RE.finditer(text)]
    framing_cues += [(m.start(), "bleed", m) for m in BLEED_RE.finditer(text)]
    for _, mode, match in sorted(framing_cues):
        if _negated(text, match):
            continue
        owner = _owner(text, match, nouns)
        if owner is None and re.fullmatch(r"крупн(?:ая|ое|ые|ый)|large", match.group()):
            continue
        framing = mode
        focus = owner or (families[0] if families else None)
        if focus:
            crop = _anchor(focus, match.group()) if mode == "bleed" else None
            anchors = [a for a in ANCHOR_RE.finditer(text) if _owner(text, a, nouns) == focus]
            if anchors:
                crop = _anchor(focus, " ".join(a.group() for a in anchors))
    if FIT_RE.search(text):
        framing, crop = "fit", None
    return ArtDirection(
        framing=framing,
        focus=focus,
        roles=list(roles.values())[:6],
        colors=list(colors.values())[:6],
        crop=crop,
    )


def resolve_art_direction(
    prompt: str, families: list[str], proposed: ArtDirection | None
) -> ArtDirection:
    literal = parse_art_direction(prompt, families)
    inferred = proposed or ArtDirection()
    text = prompt.lower().replace("ё", "е")
    nouns = [noun for noun in mentions(text) if noun.lastgroup in families]
    merged = {}
    for name, pattern, field in (("roles", ROLE_RE, "role"), ("colors", COLOR_RE, "color")):
        directives = {d.family: d for d in getattr(inferred, name) if d.family in families}
        for match in pattern.finditer(text):
            family = _owner(text, match, nouns)
            if (
                _negated(text, match)
                and family in directives
                and getattr(directives[family], field) == match.lastgroup
            ):
                del directives[family]
        directives.update({d.family: d for d in getattr(literal, name)})
        merged[name] = list(directives.values())[:6]
    focus = literal.focus or (inferred.focus if inferred.focus in families else None)
    crop = literal.crop or (
        inferred.crop if inferred.crop and inferred.crop.family in families else None
    )
    framing = literal.framing or inferred.framing
    if literal.framing == "fit" or (crop and focus and crop.family != focus):
        crop = None
    return ArtDirection(framing=framing, focus=focus, crop=crop, **merged)


def strip_art_directives(prompt: str) -> str:
    """Remove only recognized art vocabulary; preserve nouns and spatial relations."""
    text = prompt.lower().replace("ё", "е")
    nouns = mentions(text)
    ranges = []
    for pattern in (FIT_RE, CLOSE_RE, BLEED_RE, ROLE_RE, COLOR_RE):
        ranges.extend((match.start(), match.end()) for match in pattern.finditer(text))
    framing_families = {
        _owner(text, match, nouns)
        for pattern in (CLOSE_RE, BLEED_RE)
        for match in pattern.finditer(text)
    }
    ranges.extend(
        (match.start(), match.end())
        for match in ANCHOR_RE.finditer(text)
        if _owner(text, match, nouns) in framing_families
    )
    chars = list(text)
    for start, end in ranges:
        chars[start:end] = " " * (end - start)
    return "".join(chars)
