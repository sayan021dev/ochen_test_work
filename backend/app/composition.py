"""Semantic selection is separate from deterministic, size-aware layout."""

import re

from app.catalog import CATALOG, FAMILIES, asset_for
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
    chunks = re.split(r"[,;\n]+|\s+(?:и|and)\s+", prompt.lower().replace("ё", "е"))
    found, unknown = [], []
    for chunk in chunks:
        text = chunk.strip()
        if not text:
            continue
        family = next((f for f, aliases in NOUNS.items() if text in aliases), None)
        if family:
            if family not in found:
                found.append(family)
        else:
            unknown.append(text)
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


def compose_variants(families: list[str], request: ComposeRequest) -> list[Scene]:
    if not families or len(families) > 6 or any(f not in FAMILIES for f in families):
        raise ValueError("Выберите от одного до шести предметов библиотеки")
    dimensions = [asset_for(f, request.detail, "main") for f in families]
    layouts = [
        [(0.47, 0.50), (0.75, 0.58), (0.22, 0.43), (0.72, 0.22), (0.27, 0.79), (0.85, 0.80)],
        [(0.66, 0.55), (0.32, 0.57), (0.82, 0.24), (0.18, 0.28), (0.46, 0.82), (0.85, 0.85)],
        [(0.30, 0.62), (0.65, 0.39), (0.80, 0.76), (0.22, 0.20), (0.53, 0.83), (0.85, 0.18)],
    ]
    scenes = []
    for variant in range(3):
        scene = Scene(
            title=request.prompt[:120],
            format=request.format,
            detail=request.detail,
            palette=request.palette,
            scale=0.4,
        )
        width, height = scene.size
        scene.scale = min(
            width / (max(a["width"] for a in dimensions) * 1.6),
            height / (max(a["height"] for a in dimensions) * 1.4),
        )
        foreground, background = [], []
        for index, (family, asset) in enumerate(zip(families, dimensions, strict=True)):
            cx, cy = layouts[(variant + request.seed) % 3][index]
            object_width, object_height = (
                asset["width"] * scene.scale,
                asset["height"] * scene.scale,
            )
            element = Element(
                id=f"item-{index + 1}",
                family=family,
                role="background" if request.backgrounds and index >= 2 else "main",
                x=round(max(0, min(width - object_width, cx * width - object_width / 2)), 2),
                y=round(max(0, min(height - object_height, cy * height - object_height / 2)), 2),
            )
            (background if element.role == "background" else foreground).append(element)
        scene.elements = background + foreground
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
