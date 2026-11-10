"""Semantic selection is separate from deterministic, size-aware layout."""

import re
from itertools import product
from math import exp

from app.art_direction import ArtDirection, parse_art_direction, strip_art_directives
from app.catalog import CATALOG, FAMILIES, asset_for
from app.color_direction import color_map_for
from app.framing import frame_candidates
from app.layout import REL_RE, LayoutIntent, mentions, pack, resolve_intent
from app.models import ComposeRequest, Element, Scene, SceneLight

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
    remainder = strip_art_directives(text)
    for match in reversed(mentions(text)):
        remainder = remainder[: match.start()] + " " + remainder[match.end() :]
    remainder = REL_RE.sub(" ", remainder)
    remainder = re.sub(
        r"\b(?:и|а|от|and|the|to|of|ними|них|ней|ним|него|нее|them|both|it|"
        r"не|not|без|наложений|пересечений|друг|друга|всеми|всех|"
        r"стоит|стоят|лежит|лежат|sits?|stands?|lies?|rests?)\b",
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
    families: list[str],
    request: ComposeRequest,
    layout: LayoutIntent | None = None,
    light: SceneLight | None = None,
) -> list[Scene]:
    if not families or len(families) > 6 or any(f not in FAMILIES for f in families):
        raise ValueError("Выберите от одного до шести предметов библиотеки")
    families = list(dict.fromkeys(families))
    intent = resolve_intent(request.prompt, families, layout)
    art = intent.art or ArtDirection()
    named = {m.lastgroup for m in mentions(request.prompt)}
    roles = {
        f: "background" if request.backgrounds and i >= 2 and f not in named else "main"
        for i, f in enumerate(families)
    }
    explicit_roles = {d.family for d in parse_art_direction(request.prompt, families).roles}
    roles.update(
        {
            d.family: d.role
            for d in art.roles
            if d.role == "main" or request.backgrounds or d.family in explicit_roles
        }
    )
    dimensions = [asset_for(f, request.detail, roles[f]) for f in families]
    colors = {d.family: d.color for d in art.colors}
    scenes = []
    previous = []
    effective_light = light if light is not None else request.light
    for variant in range(3):
        scene = Scene(
            title=request.prompt[:120],
            format=request.format,
            detail=request.detail,
            palette=request.palette,
            light=effective_light.model_copy(deep=True) if effective_light else None,
            framing=art.framing or "fit",
            crop=art.crop.model_dump() if art.crop else None,
        )
        width, height = scene.size
        design = (variant + request.seed) % 3
        boxes, order, frame = _choose_layout(
            dimensions,
            families,
            intent,
            roles,
            width,
            height,
            design,
            4 if request.detail == "L" else 8,
            previous,
        )
        scene.scale = frame.scale
        previous.append(_signature(boxes, frame, width, height))
        by_family = {}
        for index, (family, box) in enumerate(zip(families, boxes, strict=True)):
            by_family[family] = Element(
                id=f"item-{index + 1}",
                family=family,
                role=roles[family],
                x=round(frame.tx + box.x * scene.scale, 4),
                y=round(frame.ty + box.y * scene.scale, 4),
                color_map=color_map_for(family, roles[family], colors[family], request.palette)
                if family in colors
                else {},
            )
        # Keep instance receiver references in the saved scene, not only transient
        # semantic IDs. Every explicit on target is retained, including chains.
        for relation in intent.relations:
            if relation.relation == "on":
                owner = by_family[relation.subject]
                owner.support_ids = list(
                    dict.fromkeys(
                        owner.support_ids + [by_family[target].id for target in relation.targets]
                    )
                )
        order = _layer_order(order, roles, intent)
        scene.elements = [by_family[f] for f in order]
        scenes.append(scene)
    return scenes


def _layer_order(order, roles, intent):
    """Background priority applies only among layers unconstrained by the request."""
    edges = []
    for relation in intent.relations:
        if relation.relation in {"on", "behind", "in_front_of"}:
            for target in relation.targets:
                edges.append(
                    (relation.subject, target)
                    if relation.relation == "behind"
                    else (target, relation.subject)
                )
    result = []
    while len(result) < len(order):
        ready = [
            f for f in order if f not in result and all(a in result for a, b in edges if b == f)
        ]
        if not ready:
            raise ValueError("Противоречивый порядок слоев")
        result.append(min(ready, key=lambda f: (roles[f] != "background", order.index(f))))
    return result


def _signature(boxes, frame, width, height):
    return tuple(
        (
            (frame.tx + (b.x + b.width / 2) * frame.scale) / width,
            (frame.ty + (b.y + b.height / 2) * frame.scale) / height,
            b.width * frame.scale / width,
        )
        for b in boxes
    )


def _contact_visible(boxes, families, intent, frame, width, height):
    """A crop must leave each explicit physical contact visible in the viewport."""
    lookup = dict(zip(families, boxes, strict=True))
    for relation in intent.relations:
        if relation.relation != "on":
            continue
        for target in relation.targets:
            a, b = lookup[relation.subject], lookup[target]
            left, top = max(a.x, b.x), max(a.y, b.y)
            right, bottom = min(a.x + a.width, b.x + b.width), min(a.y + a.height, b.y + b.height)
            full = max(0, right - left) * max(0, bottom - top) * frame.scale**2
            visible = max(
                0,
                min(width, frame.tx + right * frame.scale) - max(0, frame.tx + left * frame.scale),
            ) * max(
                0,
                min(height, frame.ty + bottom * frame.scale) - max(0, frame.ty + top * frame.scale),
            )
            if visible < full * 0.25:
                return False
    return True


def _choose_layout(dimensions, families, intent, roles, width, height, design, max_scale, previous):
    art = intent.art or ArtDirection()
    if art.framing in {None, "fit"}:
        boxes, order = pack(dimensions, families, intent, width / height, design)
        frame = frame_candidates(
            boxes, families, roles, width, height, variant=design, max_scale=max_scale
        )[0]
        return boxes, order, frame
    candidates, last_error, fallback = [], None, None
    # Search generic packing orientations and aspect preferences. No catalogue-family
    # positions or example coordinates enter this search; all hard relations survive.
    for reverse in (False, True):
        indices = list(range(len(families)))[:: -1 if reverse else 1]
        names = [families[i] for i in indices]
        for aspect_factor, tie in product((0.6, 1.0, 1.6), range(3)):
            try:
                packed, order = pack(
                    [dimensions[i] for i in indices],
                    names,
                    intent,
                    width / height * aspect_factor,
                    (design + tie) % 3,
                )
            except ValueError as exc:
                last_error = exc
                continue
            by_family = dict(zip(names, packed, strict=True))
            boxes = [by_family[f] for f in families]
            if fallback is None:
                fallback = boxes, order
            cameras = (
                frame
                for camera in range(3)
                for frame in frame_candidates(
                    boxes,
                    families,
                    roles,
                    width,
                    height,
                    mode=art.framing,
                    focus=art.focus,
                    crop=art.crop,
                    variant=camera,
                    max_scale=max_scale,
                )
            )
            for frame in cameras:
                if not _contact_visible(boxes, families, intent, frame, width, height):
                    continue
                signature = _signature(boxes, frame, width, height)
                # Nearby cameras do not count as meaningful alternatives. A soft
                # penalty chooses a different feasible arrangement whenever possible.
                similarity = sum(
                    exp(
                        -sum(
                            (a - b) ** 2
                            for p, q in zip(signature, old, strict=True)
                            for a, b in zip(p, q, strict=True)
                        )
                        / 0.035
                    )
                    for old in previous
                )
                candidates.append((frame.score + 0.16 * similarity, boxes, order, frame))
    if not candidates:
        if fallback is None:
            raise last_error or ValueError("Не удалось разместить предметы")
        boxes, order = fallback
        return (
            boxes,
            order,
            frame_candidates(
                boxes, families, roles, width, height, variant=design, max_scale=max_scale
            )[0],
        )
    _, boxes, order, frame = min(candidates, key=lambda item: item[0])
    return boxes, order, frame


def semantic_catalog() -> list[dict]:
    return [
        {
            "id": family,
            "name": next(a["name"] for a in CATALOG if a["family"] == family),
            "meanings": next(a["tags"] for a in CATALOG if a["family"] == family),
        }
        for family in FAMILIES
    ]
