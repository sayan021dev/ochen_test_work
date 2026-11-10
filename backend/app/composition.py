"""Semantic selection is separate from deterministic, size-aware layout."""

import re

from app.catalog import CATALOG, FAMILIES, asset_for
from app.layout import REL_RE, LayoutIntent, mentions, pack, resolve_intent
from app.models import ComposeRequest, Element, Scene

NOUNS = {
    "book": ("книга", "книги", "книгу", "book", "books"),
    "phone": ("телефон", "телефоны", "phone"),
    "puzzle": ("пазл", "пазлы", "пазлов", "puzzle"),
    "coin": ("монета", "монеты", "монету", "coin"),
    "headphones": ("наушники", "headphones"),
    "lamp": ("лампа", "лампу", "лампы", "lamp"),
    "flowers": ("цветы", "букет", "ваза", "flowers"),
    "wallet": ("кошелек", "кошельки", "wallet"),
    "folder": ("папка", "папку", "папки", "folder"),
    "pen": ("ручка", "ручку", "ручки", "pen"),
}
METAPHORS = [
    (
        ("знан", "учеб", "учит", "систем"),
        ["book", "puzzle", "pen"],
        "Знания складываются в систему: книга, пазлы и ручка.",
    ),
    (
        ("финанс", "бюджет", "деньг", "сбереж"),
        ["wallet", "coin", "folder"],
        "Кошелёк и монета связывают идею с финансами, папка добавляет порядок.",
    ),
    (
        ("фокус", "сосред", "работ", "отвлек"),
        ["lamp", "headphones", "book"],
        "Свет, наушники и книга создают образ сосредоточенной работы.",
    ),
    (
        ("команд", "связ", "общен"),
        ["phone", "puzzle", "flowers"],
        "Телефон и пазлы передают общение и совместную работу.",
    ),
    (
        ("рост", "забот", "вдохнов", "творч"),
        ["flowers", "lamp", "pen"],
        "Цветы символизируют рост, лампа и ручка поддерживают идею творчества.",
    ),
]


def select_components(prompt: str) -> tuple[list[str], list[str]]:
    text = prompt.lower().replace("ё", "е")
    found = list(dict.fromkeys(m.lastgroup for m in mentions(text)))
    remainder = text
    for match in reversed(mentions(text)):
        remainder = remainder[: match.start()] + " " + remainder[match.end() :]
    remainder = REL_RE.sub(" ", remainder)
    remainder = re.sub(
        r"\b(?:и|а|от|and|the|to|of|ними|них|ней|ним|него|нее|them|both|it|"
        r"не|not|без|наложений|пересечений|друг|друга|всеми|всех)\b",
        " ",
        remainder,
    )
    unknown = [part.strip() for part in re.split(r"[,;\n]+", remainder) if part.strip()]
    return found, unknown


def select_offline_metaphor(prompt: str) -> tuple[list[str], str]:
    text = prompt.lower().replace("ё", "е")
    for cues, families, explanation in METAPHORS:
        if any(cue in text for cue in cues):
            return families, explanation
    families, unknown = select_components(prompt)
    if families and not unknown:
        return families, "Подобраны названные предметы из исходной библиотеки."
    raise ValueError("Словарь пока не знает эту метафору. Включите AI или назовите предметы.")


def compose_variants(
    families: list[str], request: ComposeRequest, layout: LayoutIntent | None = None
) -> list[Scene]:
    if not families or len(families) > 6 or any(f not in FAMILIES for f in families):
        raise ValueError("Выберите от одного до шести предметов библиотеки")
    families = list(dict.fromkeys(families))
    named = {m.lastgroup for m in mentions(request.prompt)}
    roles = {
        f: "background" if request.backgrounds and i >= 2 and f not in named else "main"
        for i, f in enumerate(families)
    }
    dimensions = [asset_for(f, request.detail, roles[f]) for f in families]
    intent = resolve_intent(request.prompt, families, layout)
    scenes = []
    for variant in range(3):
        scene = Scene(
            title=request.prompt[:120],
            format=request.format,
            detail=request.detail,
            palette=request.palette,
        )
        width, height = scene.size
        design = (variant + request.seed) % 3
        boxes, order = pack(dimensions, families, intent, width / height, design)
        left, top = min(b.x for b in boxes), min(b.y for b in boxes)
        total_width = max(b.x + b.width for b in boxes) - left
        total_height = max(b.y + b.height for b in boxes) - top
        # Fit the complete scene once. Never clamp or resize individual instances.
        margin = min(width, height) * (0.085 + design * 0.015)
        scene.scale = min(
            4 if request.detail == "L" else 8,
            (width - 2 * margin) / total_width,
            (height - 2 * margin) / total_height,
        )
        origin_x = (width - total_width * scene.scale) / 2
        origin_y = (height - total_height * scene.scale) / 2
        by_family = {}
        for index, (family, box) in enumerate(zip(families, boxes, strict=True)):
            by_family[family] = Element(
                id=f"item-{index + 1}",
                family=family,
                role=roles[family],
                x=round(origin_x + (box.x - left) * scene.scale, 4),
                y=round(origin_y + (box.y - top) * scene.scale, 4),
            )
        # Backgrounds first unless an explicit front/back/on relation determines the order.
        if not any(r.relation in {"on", "behind", "in_front_of"} for r in intent.relations):
            order.sort(key=lambda f: roles[f] != "background")
        scene.elements = [by_family[f] for f in order]
        scenes.append(scene)
    return scenes


def semantic_catalog() -> list[dict]:
    return [
        {
            "id": family,
            "name": next(a["name"] for a in CATALOG if a["family"] == family),
            "meanings": next(a["tags"] for a in CATALOG if a["family"] == family),
        }
        for family in FAMILIES
    ]
