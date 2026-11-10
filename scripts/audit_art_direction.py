"""Qualitative composition audit: literal briefs, source images and held-out inputs.

The existing Figma audit remains immutable. This audit supplies no reference
coordinates to generation and makes no claim of pixel-perfect reconstruction.
It never enables AI, loads environment files or contacts a provider.
"""

from dataclasses import dataclass, field
from itertools import combinations


@dataclass(frozen=True)
class Brief:
    id: str
    prompt: str
    families: tuple[str, ...]
    framing: str
    relations: tuple[tuple[str, str, str], ...] = ()
    backgrounds: tuple[str, ...] = ()
    colors: dict[str, str] = field(default_factory=dict)
    crop: tuple[str, str] | None = None


# These are qualitative review briefs, not runtime composition templates.
# Every coordinate, scale and arrangement is chosen by the product algorithm.
REFERENCE_BRIEFS = (
    Brief(
        "phone-puzzle",
        "пазлы над телефоном, крупный план",
        ("phone", "puzzle"),
        "close",
        (("puzzle", "above", "phone"),),
    ),
    Brief(
        "book-phone",
        "телефон на книге, книга выходит за левый край",
        ("book", "phone"),
        "bleed",
        (("phone", "on", "book"),),
        crop=("book", "left"),
    ),
    Brief(
        "folder-wallet-coin",
        "желтая папка выше кошелька и монеты, кошелек слева от монеты, "
        "папка выходит за правый край",
        ("folder", "wallet", "coin"),
        "bleed",
        (("folder", "above", "wallet"), ("folder", "above", "coin"), ("wallet", "left_of", "coin")),
        colors={"folder": "yellow"},
        crop=("folder", "right"),
    ),
    Brief(
        "flowers-headphones",
        "фоновые цветы позади наушников, цветы выходят за верхний край",
        ("flowers", "headphones"),
        "bleed",
        (("flowers", "behind", "headphones"),),
        ("flowers",),
        crop=("flowers", "top"),
    ),
    Brief(
        "lamp-wallet-coin",
        "фоновая лампа позади желтого кошелька и монеты, кошелек ниже монеты, "
        "лампа выходит за верхний край",
        ("lamp", "wallet", "coin"),
        "bleed",
        (("lamp", "behind", "wallet"), ("lamp", "behind", "coin"), ("wallet", "below", "coin")),
        ("lamp",),
        {"wallet": "yellow"},
        ("lamp", "top"),
    ),
    Brief(
        "book-puzzle-pen",
        "пазлы на фоновой книге, ручка под книгой, книга выходит за правый край",
        ("book", "puzzle", "pen"),
        "bleed",
        (("puzzle", "on", "book"), ("pen", "below", "book")),
        ("book",),
        crop=("book", "right"),
    ),
)


# Frozen before running the new implementation. None of these family sets is a
# reference family set. They cover 2-6 items, four crop edges and all relation kinds.
HELD_OUT_BRIEFS = (
    Brief(
        "two-fit",
        "монета слева от ручки, целиком",
        ("coin", "pen"),
        "fit",
        (("coin", "left_of", "pen"),),
    ),
    Brief(
        "two-close",
        "наушники справа от папки, крупный план",
        ("headphones", "folder"),
        "close",
        (("headphones", "right_of", "folder"),),
    ),
    Brief(
        "support-left",
        "лампа на книге, книга выходит за левый край",
        ("lamp", "book"),
        "bleed",
        (("lamp", "on", "book"),),
        crop=("book", "left"),
    ),
    Brief(
        "background-right",
        "фоновая папка справа от цветов, наушники слева от цветов, папка выходит за правый край",
        ("folder", "flowers", "headphones"),
        "bleed",
        (("folder", "right_of", "flowers"), ("headphones", "left_of", "flowers")),
        ("folder",),
        crop=("folder", "right"),
    ),
    Brief(
        "background-top",
        "фоновые цветы позади телефона, монета ниже телефона, цветы выходят за верхний край",
        ("flowers", "phone", "coin"),
        "bleed",
        (("flowers", "behind", "phone"), ("coin", "below", "phone")),
        ("flowers",),
        crop=("flowers", "top"),
    ),
    Brief(
        "foreground-bottom",
        "телефон над книгой, ручка справа от телефона, книга выходит за нижний край",
        ("phone", "book", "pen"),
        "bleed",
        (("phone", "above", "book"), ("pen", "right_of", "phone")),
        crop=("book", "bottom"),
    ),
    Brief(
        "four-fit",
        "монета, телефон, книга, наушники, целиком",
        ("coin", "phone", "book", "headphones"),
        "fit",
    ),
    Brief(
        "four-close",
        "фоновая книга позади кошелька, ручка справа от кошелька, "
        "цветы слева от кошелька, крупный план",
        ("book", "wallet", "pen", "flowers"),
        "close",
        (
            ("book", "behind", "wallet"),
            ("pen", "right_of", "wallet"),
            ("flowers", "left_of", "wallet"),
        ),
        ("book",),
    ),
    Brief(
        "five-fit",
        "пазлы, папка, монета, лампа, наушники, целиком",
        ("puzzle", "folder", "coin", "lamp", "headphones"),
        "fit",
    ),
    Brief(
        "six-fit",
        "книга, телефон, пазлы, кошелек, монета, ручка, целиком",
        ("book", "phone", "puzzle", "wallet", "coin", "pen"),
        "fit",
    ),
    Brief(
        "compound-behind",
        "папка позади наушников и ручки, ручка ниже наушников, крупный план",
        ("folder", "headphones", "pen"),
        "close",
        (
            ("folder", "behind", "headphones"),
            ("folder", "behind", "pen"),
            ("pen", "below", "headphones"),
        ),
    ),
    Brief(
        "named-colors",
        "желтый телефон справа от розового кошелька, монета ниже телефона, крупный план",
        ("phone", "wallet", "coin"),
        "close",
        (("phone", "right_of", "wallet"), ("coin", "below", "phone")),
        colors={"phone": "yellow", "wallet": "pink"},
    ),
)


def assess_scene(scene, brief: Brief, intent) -> dict:
    """Measure auditable invariants separately from subjective visual similarity."""
    from app.catalog import asset_for

    from scripts.compare_figma_examples import assess_relations, relation_triples

    width, height = scene.size
    bounds, visibility = {}, {}
    for element in scene.elements:
        asset = asset_for(element.family, scene.detail, element.role)
        w, h = asset["width"] * scene.scale, asset["height"] * scene.scale
        x, y = element.x, element.y
        bounds[element.family] = (x, y, x + w, y + h)
        visibility[element.family] = (
            max(0, min(width, x + w) - max(0, x)) * max(0, min(height, y + h) - max(0, y)) / (w * h)
        )
    relations = intent.model_dump()["relations"]
    allowed = {
        frozenset((a, b))
        for a, kind, b in brief.relations
        if kind in {"on", "behind", "in_front_of"}
    }
    intersections = []
    for a, b in combinations(bounds, 2):
        x1, y1, x2, y2 = bounds[a]
        x3, y3, x4, y4 = bounds[b]
        if (
            min(x2, x4) > max(x1, x3) + 0.001
            and min(y2, y4) > max(y1, y3) + 0.001
            and frozenset((a, b)) not in allowed
        ):
            intersections.append([a, b])
    expected_roles = {f: "background" if f in brief.backgrounds else "main" for f in brief.families}
    actual_roles = {element.family: element.role for element in scene.elements}
    crop_satisfied = None
    if brief.crop:
        family, edge = brief.crop
        x1, y1, x2, y2 = bounds[family]
        crop_satisfied = {
            "left": x1 < -0.01,
            "right": x2 > width + 0.01,
            "top": y1 < -0.01,
            "bottom": y2 > height + 0.01,
        }[edge]
    order = {element.family: i for i, element in enumerate(scene.elements)}
    backgrounds_first = all(
        order[background] < order[foreground]
        for background in brief.backgrounds
        for foreground in brief.families
        if foreground not in brief.backgrounds
    )
    return {
        "families_match": set(actual_roles) == set(brief.families),
        "roles": actual_roles,
        "roles_match": actual_roles == expected_roles,
        "parsed_relations_match": relation_triples(relations) == set(brief.relations),
        "relation_checks": assess_relations(scene, relations),
        "unlinked_intersections": intersections,
        "backgrounds_first": backgrounds_first,
        "framing": scene.framing,
        "framing_matches": scene.framing == brief.framing,
        "crop_satisfied": crop_satisfied,
        "bbox_visibility": visibility,
        "common_scale": scene.scale,
        "source_proportions_preserved": all(
            e.scale_x == e.scale_y == 1 and e.angle == 0 for e in scene.elements
        ),
        "color_maps": {e.family: e.color_map for e in scene.elements},
        "parsed_colors": {c.family: c.color for c in intent.art.colors} if intent.art else {},
    }


def run_audit(output, run_id):
    """Keep every audit run, including failures, instead of replacing evidence."""
    import hashlib
    import html
    import json
    import os
    from dataclasses import asdict
    from pathlib import Path

    from app.catalog import PALETTES
    from app.composition import compose_variants, select_components
    from app.layout import resolve_intent
    from app.models import ComposeRequest
    from app.svg import render_scene

    root = Path(__file__).resolve().parents[1]
    source = root / "examples/figma-reference"
    target = output / "runs" / run_id
    target.mkdir(parents=True, exist_ok=False)
    cases, rows = [], []
    reference_manifest = json.loads((source / "manifest.json").read_text())
    source_by_id = {item["id"]: item for item in reference_manifest["examples"]}

    def write_json(path, value):
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")

    def image_cell(path, label):
        relative = os.path.relpath(path, target)
        return (
            f'<figure><img loading="lazy" src="{html.escape(relative)}" '
            f'alt="{html.escape(label)}"><figcaption>{html.escape(label)}</figcaption></figure>'
        )

    for cohort, briefs in (("reference", REFERENCE_BRIEFS), ("held-out", HELD_OUT_BRIEFS)):
        for index, brief in enumerate(briefs):
            for format_name in ("square", "landscape", "portrait"):
                for detail in ("L", "S"):
                    identifier = f"{cohort}-{format_name}-{brief.id}-{detail}"
                    case = {
                        "id": identifier,
                        "cohort": cohort,
                        "brief": asdict(brief),
                        "format": format_name,
                        "detail": detail,
                        "provider_calls": 0,
                        "variants": [],
                    }
                    cases.append(case)
                    selected, unknown = select_components(brief.prompt)
                    intent = resolve_intent(brief.prompt, selected, None)
                    case.update(
                        selected_families=selected, unknown=unknown, intent=intent.model_dump()
                    )
                    show = detail == "L" and (
                        cohort == "reference"
                        or (format_name == ("square", "landscape", "portrait")[index % 3])
                    )
                    try:
                        if unknown:
                            raise ValueError(f"Unknown components: {unknown}")
                        scenes = compose_variants(
                            selected,
                            ComposeRequest(
                                prompt=brief.prompt,
                                mode="components",
                                format=format_name,
                                detail=detail,
                                palette=PALETTES[0],
                                use_ai=False,
                            ),
                        )
                        for number, scene in enumerate(scenes, 1):
                            stem = f"{identifier}-{number}"
                            write_json(target / f"{stem}.json", scene.model_dump())
                            measured = assess_scene(scene, brief, intent)
                            measured.update(variant=number, scene=f"{stem}.json")
                            measured["passed"] = (
                                all(
                                    measured[key]
                                    for key in (
                                        "families_match",
                                        "roles_match",
                                        "parsed_relations_match",
                                        "backgrounds_first",
                                        "framing_matches",
                                        "source_proportions_preserved",
                                    )
                                )
                                and all(c["satisfied"] for c in measured["relation_checks"])
                                and not measured["unlinked_intersections"]
                                and measured["crop_satisfied"] is not False
                                and measured["parsed_colors"] == brief.colors
                                and all(measured["color_maps"][family] for family in brief.colors)
                            )
                            if show:
                                (target / f"{stem}.svg").write_text(
                                    render_scene(scene, custom_shadows_enabled=False)
                                )
                                measured["svg"] = f"{stem}.svg"
                            case["variants"].append(measured)
                    except ValueError as exc:
                        case["generation_error"] = str(exc)
                    if show:
                        cells = []
                        if cohort == "reference":
                            example = source_by_id[f"{format_name}-{brief.id}"]
                            cells.append(
                                image_cell(source / example["reference"], "Figma — исходник")
                            )
                            baseline = source / example["spatial"]["best"]
                            cells.append(
                                image_cell(baseline, "Прежний алгоритм — сохранённый лучший")
                            )
                        for item in case["variants"]:
                            cells.append(
                                image_cell(target / item["svg"], f"Новый вариант {item['variant']}")
                            )
                        status = (
                            "PASS"
                            if case["variants"] and all(v["passed"] for v in case["variants"])
                            else "FAIL"
                        )
                        rows.append(
                            f"<section><h2>{html.escape(identifier)} <span>{status}</span></h2>"
                            f'<p>{html.escape(brief.prompt)}</p><div class="grid {cohort}">'
                            + "".join(cells)
                            + "</div>"
                            + '<p class="failure">'
                            + html.escape(case.get("generation_error", ""))
                            + "</p>"
                            + "</section>"
                        )
    measurements = [variant for case in cases for variant in case["variants"]]
    manifest = {
        "run_id": run_id,
        "provider_calls": 0,
        "coordinate_replay_used": False,
        "reference_source_sha256": hashlib.sha256((source / "source.svg").read_bytes()).hexdigest(),
        "comparison_kind": "qualitative constraints; not pixel-perfect similarity",
        "reference_cases": 36,
        "reference_scenes": 108,
        "held_out_cases": 72,
        "held_out_scenes": 216,
        "actual_scenes": len(measurements),
        "passed_scenes": sum(m["passed"] for m in measurements),
        "failed_cases": [
            case["id"]
            for case in cases
            if case.get("generation_error") or not all(item["passed"] for item in case["variants"])
        ],
        "cases": cases,
    }
    write_json(target / "metrics.json", manifest)
    style = """body{margin:0;padding:26px;background:#202023;color:#eee;font:15px system-ui}
    h1{font-size:25px}h2{font-size:17px}p{line-height:1.5;max-width:1100px}a{color:#ff9ac2}
    section{margin:32px 0}.grid{display:grid;gap:12px}
    .reference{grid-template-columns:repeat(5,1fr)}
    .held-out{grid-template-columns:repeat(3,1fr)}figure{margin:0;padding:10px;background:#303035;
    border-radius:10px}img{width:100%;height:240px;object-fit:contain;background:#252528}
    figcaption{font-size:12px;margin-top:12px}span{font-size:12px;color:#ff9ac2}.failure{color:#ff9ac2}
    @media(max-width:900px){.reference,.held-out{grid-template-columns:repeat(2,1fr)}}"""
    page = (
        '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Арт-дирекция: проверка</title>'
        f"<style>{style}</style><h1>Арт-дирекция: исходник, прежний алгоритм и новые варианты</h1>"
        "<p>18 исходных примеров × S/L × три варианта: 108 сцен; "
        "12 заранее записанных новых запросов × три формата × S/L × три варианта: 216 сцен. "
        "Показаны 18 исходных строк L и 12 новых строк L с чередованием форматов. "
        "Все 324 Scene JSON сохранены; SVG — для 90 показанных вариантов.</p>"
        "<p>Генератор получает только буквальный текст, формат, размер и палитру. Координаты Figma "
        "и сохранённого результата не передаются. Это качественная проверка ролей, связей, "
        "крупности, кадрирования и цвета; пиксельное совпадение не обещается. Базовый столбец — "
        "ранее сохранённый лучший вариант по прежнему пространственному описанию, "
        "а не повторный запуск. "
        "Новые описания содержат дополнительные явно заданные роли, цвета и кадрирование.</p>"
        f'<p><a href="metrics.json">Измерения и входы всех сцен</a> · '
        f'<a href="{os.path.relpath(source / "REPORT.md", target)}">'
        "Исходный отчёт и неуспешные когорты</a></p>" + "".join(rows) + "</html>\n"
    )
    (target / "index.html").write_text(page)
    # Only the landing link changes; timestamped runs and older failed cohorts stay intact.
    (output / "index.html").write_text(
        '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Проверки арт-дирекции</title>'
        f'<meta http-equiv="refresh" content="0;url=runs/{run_id}/index.html">'
        f'<a href="runs/{run_id}/index.html">Последняя проверка: {run_id}</a></html>\n'
    )
    print(
        f"Saved {len(measurements)} scenes; {manifest['passed_scenes']} passed; "
        f"{len(manifest['failed_cases'])} failed cases: {target}"
    )
    return manifest


def main():
    import argparse
    import sys
    from datetime import UTC, datetime
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root / "backend"))
    sys.path.insert(0, str(root))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=root / "examples/art-direction")
    parser.add_argument("--run-id", default=datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ"))
    args = parser.parse_args()
    if not args.run_id.replace("-", "").replace("_", "").isalnum():
        parser.error("--run-id may contain letters, numbers, underscores and hyphens")
    run_audit(args.output, args.run_id)


if __name__ == "__main__":
    main()
