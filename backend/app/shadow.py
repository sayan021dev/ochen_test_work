"""Optional vector-only effect. Original artwork and the default renderer stay intact."""

import copy
import math
from xml.etree import ElementTree as ET

from app.models import Shadow

NS = "http://www.w3.org/2000/svg"


def _projection_values(metadata: dict, shadow: Shadow) -> list[float]:
    """Project the body from a fixed support line; never translate the support."""
    projection = metadata.get("projection")
    if projection is None:
        x, y = metadata["anchor"]
        width, height = metadata.get("width", 1), metadata.get("height", 1)
        projection = {
            "ground": [x - width / 2, y, x + width / 2, y],
            "depth": height * 0.65,
            "body_bbox": [x - width / 2, y - height, width, height],
        }
    x, y, end_x, end_y = projection["ground"]
    span = math.hypot(end_x - x, end_y - y)
    tx, ty = ((end_x - x) / span, (end_y - y) / span) if span > 1e-9 else (1, 0)
    nx, ny = ty, -tx
    height = max(projection["body_bbox"][3], 1e-9)
    angle = math.radians(shadow.angle)
    depth = projection["depth"] * shadow.length
    vx = (math.cos(angle) * depth + getattr(shadow, "x", 0)) / height
    vy = (math.sin(angle) * depth + getattr(shadow, "y", 0)) / height
    a, b = tx * tx + vx * nx, ty * tx + vy * nx
    c, d = tx * ty + vx * ny, ty * ty + vy * ny
    values = [a, b, c, d, x - a * x - c * y, y - b * x - d * y]
    return values


def shadow_matrix(metadata: dict, shadow: Shadow) -> str:
    return (
        "matrix(" + " ".join(f"{value:.6f}" for value in _projection_values(metadata, shadow)) + ")"
    )


def _black_copy(node: ET.Element, color: str) -> ET.Element:
    result = copy.deepcopy(node)
    for child in result.iter():
        child.attrib.pop("id", None)
        child.attrib.pop("data-shadow-body", None)
        for attribute in ("fill", "stroke"):
            if child.get(attribute) not in (None, "none"):
                child.set(attribute, color)
    return result


def with_custom_shadow(
    root: ET.Element,
    asset: dict,
    shadow: Shadow,
    *,
    separate_layers: bool = False,
    preserve_source: bool = False,
    receiver_only_body: bool = False,
) -> ET.Element:
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
    # Elevated source bodies use the reviewed matte, except assets whose
    # regional cast cut protects fused internal self-shading (the lamp base).
    # Those keep that regional boundary and cover the cast antialias fringe
    # in the subtraction copy. No original body paths or fills are changed.
    regional_source = preserve_source and "cast_regions" in meta and "preserve_above" in meta
    source_subtraction = preserve_source and (not receiver_only_body or regional_source)
    body = ET.Element(f"{{{NS}}}g", {"data-shadow-body": "true"})
    subject = ET.SubElement(
        body,
        f"{{{NS}}}g",
        {
            "data-shadow-subject": "true",
            "mask": "url(#custom-source-body-mask)"
            if source_subtraction
            else "url(#custom-body-mask)",
        },
    )
    subject.extend(list(original))
    if not preserve_source:
        excluded = set(meta.get("body_exclude_path_ids", []))
        for parent in subject.iter():
            for child in list(parent):
                if child.tag == f"{{{NS}}}path" and child.get("id") in excluded:
                    parent.remove(child)
    if source_subtraction:
        source_mask = ET.SubElement(
            defs,
            f"{{{NS}}}mask",
            {
                **mask.attrib,
                "id": "custom-source-body-mask",
                "data-source-body-mask": "true",
            },
        )
        ET.SubElement(
            source_mask,
            f"{{{NS}}}rect",
            {
                **{key: mask.get(key) for key in ("x", "y", "width", "height")},
                "fill": "white",
                "data-mask-allow": "true",
            },
        )
        subtraction = _black_copy(cast, "black")
        subtraction.set("data-mask-cut", "true")
        if receiver_only_body:
            for node in subtraction.iter(f"{{{NS}}}path"):
                node.set("stroke", "black")
                node.set("stroke-width", str(meta["outline"]))
        source_mask.append(subtraction)
    if "sidewall" in meta and not preserve_source:
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
            "data-shadow-source": "original-footprint" if preserve_source else "body-silhouette",
            "pointer-events": "none",
            "opacity": str(shadow.opacity),
            "transform": "matrix(1.000000 0.000000 -0.000000 1.000000 0.000000 0.000000)"
            if preserve_source
            else shadow_matrix(meta, shadow),
        },
    )
    if preserve_source:
        layer.append(cast)
    else:
        silhouette = _black_copy(body, "#181817")
        silhouette.set("data-shadow-subject", "true")
        layer.append(silhouette)
        a, b, c, d, e, f = map(float, shadow_matrix(meta, shadow)[7:-1].split())
        determinant = a * d - b * c
        raw = _projection_values(meta, shadow)
        if abs(raw[0] * raw[3] - raw[1] * raw[2]) <= 1e-12 or abs(determinant) <= 1e-12:
            # A support-parallel projection has no area. Do not invent thickness.
            layer.set("display", "none")
        else:
            inverse = [
                d / determinant,
                -b / determinant,
                -c / determinant,
                a / determinant,
                (c * f - d * e) / determinant,
                (b * e - a * f) / determinant,
            ]
            corners = [
                (0, 0),
                (asset["width"], 0),
                (0, asset["height"]),
                (asset["width"], asset["height"]),
            ]
            ia, ib, ic, id_, ie, if_ = inverse
            covered = corners + [(ia * x + ic * y + ie, ib * x + id_ * y + if_) for x, y in corners]
            margin = max(meta["outline"], 1) * 3
            left = min(x for x, y in covered) - margin
            top = min(y for x, y in covered) - margin
            bounds = {
                "x": str(left),
                "y": str(top),
                "width": str(max(x for x, y in covered) - left + margin),
                "height": str(max(y for x, y in covered) - top + margin),
            }
            occlusion = ET.SubElement(
                defs,
                f"{{{NS}}}mask",
                {
                    **bounds,
                    "id": "custom-projection-occlusion",
                    "maskUnits": "userSpaceOnUse",
                    "mask-type": "luminance",
                },
            )
            ET.SubElement(occlusion, f"{{{NS}}}rect", {**bounds, "fill": "white"})
            fixed = ET.SubElement(
                occlusion,
                f"{{{NS}}}g",
                {
                    "data-shadow-occluder": "true",
                    "transform": "matrix(" + " ".join(f"{n:.9f}" for n in inverse) + ")",
                },
            )
            opaque_body = _black_copy(body, "black")
            opaque_body.set("data-shadow-occluder-body", "true")
            fixed.append(opaque_body)
            layer.set("mask", "url(#custom-projection-occlusion)")
    result.append(body)
    return result
