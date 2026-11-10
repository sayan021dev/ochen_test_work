"""Optional vector-only effect. Original artwork and the default renderer stay intact."""

import copy
import math
from xml.etree import ElementTree as ET

from app.models import Shadow

NS = "http://www.w3.org/2000/svg"


def shadow_matrix(metadata: dict, shadow: Shadow) -> str:
    angle = math.radians(shadow.angle)
    x, y = metadata["anchor"]
    length = max(metadata["width"], metadata["height"]) * 0.65 * shadow.length
    a, b = -math.sin(angle) * 0.45, math.cos(angle) * 0.45
    c, d = (
        -math.cos(angle) * length / metadata["height"],
        -math.sin(angle) * length / metadata["height"],
    )
    values = [a, b, c, d, x - a * x - c * y, y - b * x - d * y]
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
    cast = copy.deepcopy(body)
    for node in cast.iter():
        node.attrib.pop("id", None)
        if node.tag == f"{{{NS}}}path":
            node.set("fill", "#181817" if asset["role"] == "main" else "#7864D7")
            if node.get("stroke"):
                node.set("stroke", "#181817" if asset["role"] == "main" else "#7864D7")
    result = ET.Element(root.tag, root.attrib)
    result.append(defs)
    layer = ET.SubElement(
        result,
        f"{{{NS}}}g",
        {
            "data-custom-shadow": "true",
            "pointer-events": "none",
            "opacity": str(shadow.opacity),
            "transform": shadow_matrix(meta, shadow),
        },
    )
    layer.append(cast)
    result.append(body)
    return result
