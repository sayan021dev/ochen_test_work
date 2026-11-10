"""Lossless geometry composition with explicit palette roles and local SVG IDs."""

import copy
import re
from xml.etree import ElementTree as ET

from defusedxml import ElementTree as SafeET
from defusedxml.common import DefusedXmlException

from app.catalog import PALETTES, asset_for
from app.layers import needs_shadow_pass
from app.models import Scene, Shadow
from app.shadow import with_custom_shadow

NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)
ALLOWED = {
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "defs",
    "clipPath",
    "mask",
    "linearGradient",
    "radialGradient",
    "stop",
    "title",
    "desc",
    "use",
}
URL = re.compile(r"url\(\s*['\"]?#([^)'\"\s]+)['\"]?\s*\)")
ALIASES = {"white": "#FFFFFF", "black": "#000000"}


def parse_safe_svg(content: str) -> ET.Element:
    if len(content.encode()) > 1_000_000:
        raise ValueError("SVG слишком большой")
    try:
        root = SafeET.fromstring(content, forbid_dtd=True, forbid_entities=True)
    except (ET.ParseError, DefusedXmlException) as exc:
        raise ValueError("Некорректный или небезопасный SVG") from exc
    if root.tag != f"{{{NS}}}svg":
        raise ValueError("Ожидался SVG")
    count = 0

    def visit(node, depth=0):
        nonlocal count
        count += 1
        if count > 10000 or depth > 32 or node.tag.removeprefix(f"{{{NS}}}") not in ALLOWED:
            raise ValueError("Недопустимая структура SVG")
        for attribute, value in node.attrib.items():
            key = attribute.split("}")[-1].lower()
            if key.startswith("on") or key == "style":
                raise ValueError("Активное содержимое SVG запрещено")
            if key == "href" and not value.startswith("#"):
                raise ValueError("Внешние ресурсы запрещены")
            if "url(" in value.lower() and URL.sub("", value).strip():
                raise ValueError("Внешние ресурсы запрещены")
        for child in node:
            visit(child, depth + 1)

    visit(root)
    return root


def recolor_and_namespace(root: ET.Element, palette: dict, prefix: str) -> ET.Element:
    result = copy.deepcopy(root)
    ids = {n.get("id"): f"{prefix}_{i}" for i, n in enumerate(result.iter()) if n.get("id")}
    colors = {
        color: (role, i)
        for role in ("background", "object")
        for i, color in enumerate(PALETTES[0][role])
    }
    neutral = {
        child
        for node in result.iter()
        if node.tag in {f"{{{NS}}}mask", f"{{{NS}}}clipPath"}
        for child in node.iter()
    }
    for node in result.iter():
        for key, value in list(node.attrib.items()):
            if key == "id":
                node.set(key, ids[value])
            elif key.split("}")[-1] == "href" and value.startswith("#"):
                if value[1:] not in ids:
                    raise ValueError("Неизвестная ссылка SVG")
                node.set(key, "#" + ids[value[1:]])
            elif "url(" in value:

                def reference(match):
                    if match[1] not in ids:
                        raise ValueError("Неизвестная ссылка SVG")
                    return f"url(#{ids[match[1]]})"

                node.set(key, URL.sub(reference, value))
            elif key in ("fill", "stroke", "stop-color") and node not in neutral:
                normalized = ALIASES.get(value.lower(), value.upper())
                if normalized in colors:
                    role, index = colors[normalized]
                    node.set(key, palette[role][index].upper())
                    node.set(f"data-{key}-role", f"{role}-{index}")
    return result


def render_scene(scene: Scene) -> str:
    width, height = scene.size
    root = ET.Element(
        f"{{{NS}}}svg",
        {
            "width": str(width),
            "height": str(height),
            "viewBox": f"0 0 {width} {height}",
            "fill": "none",
            "data-scene-version": "1",
        },
    )
    ET.SubElement(root, f"{{{NS}}}title").text = scene.title
    if not scene.transparent:
        ET.SubElement(
            root,
            f"{{{NS}}}rect",
            {
                "width": str(width),
                "height": str(height),
                "fill": scene.palette.background[0].upper(),
                "data-background": "true",
            },
        )
    definitions = ET.SubElement(root, f"{{{NS}}}defs")
    clip = ET.SubElement(definitions, f"{{{NS}}}clipPath", {"id": "scene-clip"})
    ET.SubElement(clip, f"{{{NS}}}rect", {"width": str(width), "height": str(height)})
    artwork = ET.SubElement(root, f"{{{NS}}}g", {"clip-path": "url(#scene-clip)"})
    split = needs_shadow_pass(scene)
    passes = ["shadow", "body"] if split else ["all"]
    shadow_pass = (
        ET.SubElement(artwork, f"{{{NS}}}g", {"data-scene-shadows": "true"}) if split else None
    )
    for paint_pass in passes:
        for element in scene.elements:
            if element.hidden:
                continue
            asset = asset_for(element.family, scene.detail, element.role)
            original = parse_safe_svg(asset["svg"])
            if split or element.shadow is not None:
                original = with_custom_shadow(
                    original,
                    asset,
                    element.shadow or Shadow(),
                    separate_layers=split,
                    preserve_source=element.shadow is None,
                )
            source = recolor_and_namespace(
                original,
                scene.palette.model_dump(),
                "i_" + element.id + ("_cast" if paint_pass == "shadow" else ""),
            )
            if split and element.shadow is None:
                for node in source:
                    if node.get("data-custom-shadow") is not None:
                        del node.attrib["data-custom-shadow"]
                        node.set("data-source-shadow", "true")
            sx, sy = scene.scale * element.scale_x, scene.scale * element.scale_y
            scale = str(sx) if sx == sy else f"{sx} {sy}"
            group = ET.SubElement(
                shadow_pass if paint_pass == "shadow" else artwork,
                f"{{{NS}}}g",
                {
                    **(
                        {"data-shadow-owner-id": element.id}
                        if paint_pass == "shadow"
                        else {
                            "data-element-id": element.id,
                            "data-family": element.family,
                            "data-source-node": asset["source_node_id"],
                            "data-role": element.role,
                        }
                    ),
                    "transform": (
                        f"translate({element.x} {element.y}) rotate({element.angle}) scale({scale})"
                    ),
                },
            )
            group.extend(
                node
                for node in source
                if paint_pass == "all"
                or node.tag == f"{{{NS}}}defs"
                or (paint_pass == "shadow" and node.get("data-source-shadow") is not None)
                or node.get("data-custom-shadow" if paint_pass == "shadow" else "data-shadow-body")
                is not None
            )
    return ET.tostring(root, encoding="unicode")
