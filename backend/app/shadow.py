"""Optional vector-only effect. Original artwork and the default renderer stay intact."""

import copy
import math
from xml.etree import ElementTree as ET

from app.models import Shadow

NS = "http://www.w3.org/2000/svg"


def shadow_matrix(metadata: dict, shadow: Shadow) -> str:
    angle = math.radians(shadow.angle)
    x, y = metadata["anchor"]
    # Transform the existing ground footprint, rather than projecting the object.
    scale_x = shadow.length * getattr(shadow, "scale_x", 1)
    scale_y = shadow.length * getattr(shadow, "scale_y", 1)
    a = math.cos(angle) * scale_x
    b = math.sin(angle) * scale_x
    c = -math.sin(angle) * scale_y
    d = math.cos(angle) * scale_y
    values = [
        a,
        b,
        c,
        d,
        x + getattr(shadow, "x", 0) - a * x - c * y,
        y + getattr(shadow, "y", 0) - b * x - d * y,
    ]
    return "matrix(" + " ".join(f"{n:.6f}" for n in values) + ")"


def with_custom_shadow(root: ET.Element, asset: dict, shadow: Shadow) -> ET.Element:
    meta = asset["shadow"]
    original = copy.deepcopy(root)
    paths = {n.get("id"): n for n in original.iter() if n.tag == f"{{{NS}}}path"}
    defs = ET.Element(f"{{{NS}}}defs")
    mask = ET.SubElement(
        defs,
        f"{{{NS}}}mask",
        {
            "id": "custom-body-mask",
            "maskUnits": "userSpaceOnUse",
            "mask-type": "luminance",
            "x": str(-asset["width"] * 3),
            "y": str(-asset["height"] * 3),
            "width": str(asset["width"] * 7),
            "height": str(asset["height"] * 7),
        },
    )
    matte = ET.SubElement(
        mask,
        f"{{{NS}}}g",
        {
            "data-mask-part": "body",
            "fill": "white",
            "stroke": "white",
            "stroke-width": str(meta["outline"]),
            "stroke-linejoin": "round",
        },
    )
    if "hull" in meta:
        ET.SubElement(
            matte, f"{{{NS}}}polygon", {"points": " ".join(f"{x},{y}" for x, y in meta["hull"])}
        )
    else:
        source_matte = ET.SubElement(
            matte, f"{{{NS}}}g", {"transform": original[0].get("transform", "")}
        )
        for identifier in meta["body_path_ids"]:
            node = copy.deepcopy(paths[identifier])
            node.attrib.pop("id", None)
            node.set("fill", "white")
            node.set("stroke", "white")
            source_matte.append(node)
    for polygon in meta.get("keep_polygons", []):
        ET.SubElement(
            matte, f"{{{NS}}}polygon", {"points": " ".join(f"{x},{y}" for x, y in polygon)}
        )
    if "preserve_above" in meta:
        ET.SubElement(
            matte,
            f"{{{NS}}}rect",
            {
                "x": "-10",
                "y": "-10",
                "width": str(asset["width"] + 20),
                "height": str(meta["preserve_above"] + 10),
            },
        )
    if "erase_path_ids" in meta:
        erase = ET.SubElement(mask, f"{{{NS}}}g", {"transform": original[0].get("transform", "")})
        for identifier in meta["erase_path_ids"]:
            node = copy.deepcopy(paths[identifier])
            node.attrib.pop("id", None)
            node.set("fill", "black")
            node.set("stroke", "black")
            node.set("stroke-width", str(meta["outline"]))
            erase.append(node)
    # Complement the exact same matte, including erase regions. Both layers keep
    # the source fills; only their visibility differs, so the cast cannot become
    # a monochrome copy of the whole subject.
    inverse = copy.deepcopy(mask)
    inverse.set("id", "custom-cast-mask")
    inverse.insert(
        0,
        ET.Element(
            f"{{{NS}}}rect",
            {
                "x": mask.get("x"),
                "y": mask.get("y"),
                "width": mask.get("width"),
                "height": mask.get("height"),
                "fill": "white",
            },
        ),
    )
    for node in list(inverse)[1:]:
        for child in node.iter():
            for key in ("fill", "stroke"):
                if child.get(key) in {"black", "white"}:
                    child.set(key, "black" if child.get(key) == "white" else "white")
    defs.append(inverse)
    cast = ET.Element(f"{{{NS}}}g", {"mask": "url(#custom-cast-mask)"})
    cast_source = ET.SubElement(cast, f"{{{NS}}}g", {"data-shadow-subject": "true"})
    cast_source.extend(copy.deepcopy(list(original)))
    cast_ids = set(meta["cast_path_ids"])
    for parent in cast_source.iter():
        for node in list(parent):
            if node.tag == f"{{{NS}}}path" and node.get("id") not in cast_ids:
                parent.remove(node)
    if "cast_regions" in meta:
        regions = ET.SubElement(
            defs,
            f"{{{NS}}}clipPath",
            {
                "id": "custom-cast-region",
                "clipPathUnits": "userSpaceOnUse",
            },
        )
        for polygon in meta["cast_regions"]:
            ET.SubElement(
                regions,
                f"{{{NS}}}polygon",
                {
                    "points": " ".join(f"{x},{y}" for x, y in polygon),
                },
            )
        cast.set("clip-path", "url(#custom-cast-region)")
    for node in cast_source.iter():
        node.attrib.pop("id", None)
    body = ET.Element(f"{{{NS}}}g", {"mask": "url(#custom-body-mask)"})
    subject = ET.SubElement(body, f"{{{NS}}}g", {"data-shadow-subject": "true"})
    subject.extend(list(original))
    if "sidewall" in meta:
        cx, cy, rx, ry, depth = meta["sidewall"]

        # The original coin wall is fused with the cast shadow. Reclose its lower arc
        # only in this optional effect; all original source paths remain intact.
        def fmt(n):
            return f"{n:.6f}"

        path = (
            f"M{fmt(cx - rx)} {fmt(cy + depth)} A{fmt(rx)} {fmt(ry)} 0 0 0 "
            f"{fmt(cx + rx)} {fmt(cy + depth)} "
            f"L{fmt(cx + rx)} {fmt(cy)} A{fmt(rx)} {fmt(ry)} 0 0 1 {fmt(cx - rx)} {fmt(cy)} Z"
        )
        repair = ET.SubElement(body, f"{{{NS}}}g", {"data-shadow-body-repair": "true"})
        ET.SubElement(
            repair,
            f"{{{NS}}}path",
            {
                "d": path,
                "fill": "white" if asset["role"] == "main" else "#D7CDF5",
                "stroke": "#181817" if asset["role"] == "main" else "#7864D7",
                "stroke-width": str(meta["outline"] / 3),
            },
        )
    result = ET.Element(root.tag, root.attrib)
    result.append(defs)
    layer = ET.SubElement(
        result,
        f"{{{NS}}}g",
        {
            "data-custom-shadow": "true",
            "data-shadow-source": "original-footprint",
            "pointer-events": "none",
            "opacity": str(shadow.opacity),
            "transform": shadow_matrix(meta, shadow),
        },
    )
    layer.append(cast)
    if (
        shadow.angle % 360 == 0
        and shadow.length == 1
        and shadow.opacity == 1
        and getattr(shadow, "x", 0) == getattr(shadow, "y", 0) == 0
        and getattr(shadow, "scale_x", 1) == getattr(shadow, "scale_y", 1) == 1
    ):
        # The identity control renders the original exactly once. This avoids
        # mask-edge antialias seams and keeps the original transparent coin wall.
        layer.set("display", "none")
        body.set("mask", "none")
        for repair in body.findall(f"{{{NS}}}g[@data-shadow-body-repair]"):
            repair.set("display", "none")
    result.append(body)
    return result
