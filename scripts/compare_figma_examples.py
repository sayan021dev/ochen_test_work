"""Compare all Figma examples with the real compositor, without provider calls.

The coordinate replay is a renderer diagnostic, never an algorithm result.
Run: .venv/bin/python scripts/compare_figma_examples.py --render
"""

import argparse
import collections
import copy
import hashlib
import html
import json
import math
import re
import statistics
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.catalog import CATALOG, PALETTES  # noqa: E402
from app.composition import compose_variants, select_components  # noqa: E402
from app.models import ComposeRequest, Element, Scene  # noqa: E402
from app.svg import render_scene  # noqa: E402

NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)
TOKEN = re.compile(r"[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?")
FORMATS = {(1000, 1000): "square", (1200, 630): "landscape", (800, 1200): "portrait"}
BRIEFS = [
    ("phone-puzzle", ["phone", "puzzle"], "телефон, пазлы"),
    ("book-phone", ["book", "phone"], "книга, телефон"),
    ("folder-wallet-coin", ["folder", "wallet", "coin"], "папка, кошелек, монета"),
    ("flowers-headphones", ["flowers", "headphones"], "цветы, наушники"),
    ("lamp-wallet-coin", ["lamp", "wallet", "coin"], "лампа, кошелек, монета"),
    ("book-puzzle-pen", ["book", "puzzle", "pen"], "книга, пазлы, ручка"),
]


def path_data(value):
    axes, values, signature = [], [], []
    command, index = "", 0
    for token in TOKEN.findall(value):
        if token.isalpha():
            command, index = token, 0
            if command not in "MCLHVZ":
                raise ValueError(f"Unsupported reference path command: {command}")
            signature.append(command)
        else:
            axes.append(0 if command == "H" else 1 if command == "V" else index % 2)
            values.append(float(token))
            index += 1
    return "".join(signature), axes, values


def translation(value):
    match = re.fullmatch(r"translate\(([-\d.]+)[ ,]+([-\d.]+)\)", value)
    if not match:
        raise ValueError(f"Expected translation, got {value}")
    return tuple(map(float, match.groups()))


def fit(source, target, axes):
    means = [
        [
            statistics.mean(v for v, axis in zip(values, axes, strict=True) if axis == k)
            for k in (0, 1)
        ]
        for values in (source, target)
    ]
    denominator = sum((v - means[0][a]) ** 2 for v, a in zip(source, axes, strict=True))
    if denominator < 1e-6:
        return None
    scale = (
        sum(
            (v - means[0][a]) * (w - means[1][a])
            for v, w, a in zip(source, target, axes, strict=True)
        )
        / denominator
    )
    offsets = [means[1][a] - scale * means[0][a] for a in (0, 1)]
    error = math.sqrt(
        sum((w - scale * v - offsets[a]) ** 2 for v, w, a in zip(source, target, axes, strict=True))
        / len(source)
    )
    return scale, offsets, error


def candidates():
    index = collections.defaultdict(list)
    for asset in CATALOG:
        if asset["detail"] != "L":
            continue
        root = ET.parse(ROOT / "assets" / asset["file"]).getroot()
        origin = translation(root[0].get("transform"))
        for number, node in enumerate(root.iter()):
            if not node.get("d"):
                continue
            signature, axes, values = path_data(node.get("d"))
            if len(values) >= 100:
                index[signature, len(values)].append((asset, axes, values, origin, number, node))
    return index


def paint(node):
    aliases = {"white": "#FFFFFF", "black": "#000000"}
    return tuple(
        aliases.get(node.get(key, ""), node.get(key, "")).upper() for key in ("fill", "stroke")
    )


def identify(nodes, index, expected):
    """Recover asset pose from many matching original control-point sequences."""
    matches = collections.defaultdict(list)
    for order, node in enumerate(n for item in nodes for n in item.iter()):
        if not node.get("d"):
            continue
        signature, axes, values = path_data(node.get("d"))
        for asset, source_axes, source, origin, number, original in index[signature, len(values)]:
            if asset["family"] not in expected:
                continue
            result = fit(source, values, source_axes)
            if not result:
                continue
            scale, offset, error = result
            if not 0.1 < scale < 5 or error > 0.035:
                continue
            x, y = (offset[a] - scale * origin[a] for a in (0, 1))
            matches[asset["id"]].append(
                {
                    "x": x,
                    "y": y,
                    "scale": scale,
                    "error": error,
                    "path": number,
                    "paint": paint(node) == paint(original),
                    "order": order,
                }
            )
    output = []
    for family in expected:
        options = [a for a in CATALOG if a["detail"] == "L" and a["family"] == family]
        chosen = max(
            options,
            key=lambda a: (sum(m["paint"] for m in matches[a["id"]]), len(matches[a["id"]])),
        )
        group = matches[chosen["id"]]
        if not group:
            raise ValueError(f"No reliable control-point match for {family}")
        # One instance per family in the reference examples; retain subpixel pose.
        pose = {k: statistics.median(m[k] for m in group) for k in ("x", "y", "scale")}
        stable = [
            m for m in group if abs(m["x"] - pose["x"]) < 0.15 and abs(m["y"] - pose["y"]) < 0.15
        ]
        if len(stable) != len(group):
            raise ValueError(f"Ambiguous instance matches for {chosen['id']}")
        output.append(
            {
                "asset": chosen["id"],
                "family": family,
                "role": chosen["role"],
                **pose,
                "matched_long_paths": len({m["path"] for m in group}),
                "matching_paint_paths": sum(m["paint"] for m in group),
                "max_control_point_rms": max(m["error"] for m in group),
                "order": min(m["order"] for m in group),
            }
        )
    return sorted(output, key=lambda a: a["order"])


def frames(root):
    children, output = list(root), []
    definitions = next(n for n in root if n.tag == f"{{{NS}}}defs")
    for i, node in enumerate(children):
        first = node[0] if node.tag == f"{{{NS}}}g" else node
        dimensions = (float(first.get("width", 0)), float(first.get("height", 0)))
        if first.tag != f"{{{NS}}}rect" or dimensions not in FORMATS:
            continue
        x, y = translation(first.get("transform"))
        width, height = dimensions
        if node is first:
            end = next(
                (
                    j
                    for j in range(i + 1, len(children))
                    if children[j].tag in {f"{{{NS}}}g", f"{{{NS}}}rect", f"{{{NS}}}defs"}
                ),
                len(children),
            )
            contents = children[i:end]
        else:
            contents = [node]
        svg = ET.Element(
            f"{{{NS}}}svg",
            {
                "width": str(int(width)),
                "height": str(int(height)),
                "viewBox": f"{x} {y} {width} {height}",
                "fill": "none",
            },
        )
        svg.extend(copy.deepcopy(contents))
        svg.append(copy.deepcopy(definitions))
        output.append(
            {
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "format": FORMATS[dimensions],
                "nodes": contents,
                "svg": svg,
            }
        )
    return sorted(output, key=lambda frame: (frame["y"], frame["x"]))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--reference", type=Path, default=ROOT / "examples/figma-reference/source.svg"
    )
    parser.add_argument("--output", type=Path, default=ROOT / "examples/figma-reference")
    parser.add_argument("--render", action="store_true", help="Measure native Chrome SVG pixels")
    args = parser.parse_args()
    target = args.output
    target.mkdir(parents=True, exist_ok=True)
    source = args.reference.read_bytes()
    root = ET.fromstring(source)
    examples = frames(root)
    if len(examples) != 18:
        raise ValueError(f"Expected 18 examples, found {len(examples)}")
    index, manifest = candidates(), []
    for number, frame in enumerate(examples):
        brief_id, families, prompt = BRIEFS[number % 6]
        identifier = f"{frame['format']}-{brief_id}"
        reference_path = f"{identifier}-reference.svg"
        ET.ElementTree(frame["svg"]).write(target / reference_path, encoding="utf-8")
        poses = identify(frame["nodes"], index, families)
        replay = Scene(
            title=f"Диагностика координат: {prompt}",
            format=frame["format"],
            detail="L",
            scale=1,
            palette=PALETTES[0],
            elements=[
                Element(
                    id=f"reference-{i}",
                    family=p["family"],
                    role=p["role"],
                    x=p["x"] - frame["x"],
                    y=p["y"] - frame["y"],
                    scale_x=p["scale"],
                    scale_y=p["scale"],
                )
                for i, p in enumerate(poses)
            ],
        )
        replay_name = f"{identifier}-replay"
        write_json(target / f"{replay_name}.json", replay.model_dump())
        (target / f"{replay_name}.svg").write_text(
            render_scene(replay, custom_shadows_enabled=False)
        )
        variants = {}
        for detail in ("L", "S"):
            request = ComposeRequest(
                prompt=prompt,
                mode="components",
                detail=detail,
                format=frame["format"],
                palette=PALETTES[0],
                use_ai=False,
                backgrounds=True,
            )
            selected, unknown = select_components(prompt)
            if selected != families or unknown:
                raise ValueError(f"Unexpected component parser result: {selected}, {unknown}")
            scenes = compose_variants(selected, request)
            files = []
            for variant, scene in enumerate(scenes, 1):
                stem = f"{identifier}-{detail}-{variant}"
                write_json(target / f"{stem}.json", scene.model_dump())
                (target / f"{stem}.svg").write_text(
                    render_scene(scene, custom_shadows_enabled=False)
                )
                files.append(f"{stem}.svg")
            variants[detail] = files
        manifest.append(
            {
                "id": identifier,
                "prompt": prompt,
                "format": frame["format"],
                "size": [frame["width"], frame["height"]],
                "families": families,
                "source_bounds": [frame[k] for k in ("x", "y", "width", "height")],
                "reference": reference_path,
                "replay": f"{replay_name}.svg",
                "poses": poses,
                "variants": variants,
            }
        )
    write_json(
        target / "manifest.json",
        {
            "source_file": "dnuDZosHkN6ajkhiVfavRw",
            "source_page": "21:2",
            "source_section": "25:11069",
            "source_sha256": hashlib.sha256(source).hexdigest(),
            "provider_calls": 0,
            "examples": manifest,
            "replay_is_generation": False,
        },
    )
    cards = []
    for example in manifest:
        images = [
            ("Figma — исходник", example["reference"]),
            ("Renderer — координаты эталона", example["replay"]),
        ]
        images += [
            (f"Алгоритм L · {i}", path) for i, path in enumerate(example["variants"]["L"], 1)
        ]
        cards.append(
            f"<section><h2>{html.escape(example['id'])}</h2><p>"
            f'Ввод: {html.escape(example["prompt"])}</p><div class="row">'
            + "".join(
                f'<figure><img src="{path}"><figcaption>{label}</figcaption></figure>'
                for label, path in images
            )
            + "</div></section>"
        )
    (target / "index.html").write_text(
        """<!doctype html><html lang="ru"><meta charset="utf-8">
<title>Figma: 18 эталонов и наш алгоритм</title><style>
body{font:16px/1.5 system-ui;margin:32px;background:#202024;color:#f3f3f5}
h1{font-size:30px}h2{font-size:20px;margin-top:36px}.row{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px}
figure{margin:0;background:#303036;padding:12px;border-radius:12px}img{width:100%;height:240px;object-fit:contain}
figcaption{font-size:14px;margin-top:12px}a{color:#ff8db8}.note{max-width:1000px;color:#c7c5cd}
@media(max-width:900px){.row{grid-template-columns:repeat(2,minmax(0,1fr))}}</style>
<h1>18 примеров Figma: проверка без подмены результата</h1>
<p class="note">Первый столбец — исходный пример. Второй — диагностический перенос
найденных координат в нашу Scene и настоящий renderer, а не результат генерации.
Последние три — настоящий compose_variants с вводом названий предметов,
без LLM и без координат эталона. Обрезка, декор и точные позиции
в генератор не передавались.</p>
<p><a href="REPORT.md">Выводы и ограничения</a> ·
<a href="metrics.json">Измерения L/S и всех вариантов</a></p>"""
        + "".join(cards)
        + "</html>\n"
    )
    if args.render:
        subprocess.run(
            ["node", str(ROOT / "scripts/measure_figma_examples.mjs"), str(target)],
            cwd=ROOT,
            check=True,
        )
    print(f"Prepared {len(manifest)} references, 18 coordinate replays, 108 real algorithm scenes.")


if __name__ == "__main__":
    main()
