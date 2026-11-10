"""Conservative paint bounds decide when separate scene shadow/body passes are needed."""

import math

from app.catalog import asset_for
from app.lighting import effective_shadow
from app.models import Scene
from app.shadow import shadow_matrix


def needs_shadow_pass(scene: Scene, custom_shadows_enabled: bool = True) -> bool:
    visible_ids = {element.id for element in scene.elements if not element.hidden}
    if any(
        not element.hidden and set(element.support_ids) & visible_ids for element in scene.elements
    ):
        return True
    boxes = []
    for element in scene.elements:
        if element.hidden:
            continue
        asset = asset_for(element.family, scene.detail, element.role)
        shadow = effective_shadow(scene, element, asset, custom_shadows_enabled)
        points = [
            (0, 0),
            (asset["width"], 0),
            (asset["width"], asset["height"]),
            (0, asset["height"]),
        ]
        if shadow and (shadow.length > 0 or shadow.x or shadow.y) and shadow.opacity > 0:
            x, y, w, h = asset["shadow"]["projection"]["body_bbox"]
            matrix = shadow_matrix(asset["shadow"], shadow)
            a, b, c, d, tx, ty = map(float, matrix[7:-1].split())
            points += [
                (a * px + c * py + tx, b * px + d * py + ty)
                for px, py in [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
            ]
        angle = math.radians(element.angle)
        cos, sin = math.cos(angle), math.sin(angle)
        transformed = []
        for x, y in points:
            x *= scene.scale * element.scale_x
            y *= scene.scale * element.scale_y
            transformed.append((element.x + x * cos - y * sin, element.y + x * sin + y * cos))
        boxes.append(
            (
                min(p[0] for p in transformed),
                min(p[1] for p in transformed),
                max(p[0] for p in transformed),
                max(p[1] for p in transformed),
            )
        )
    return any(
        a[0] < b[2] + 2 and a[2] + 2 > b[0] and a[1] < b[3] + 2 and a[3] + 2 > b[1]
        for i, a in enumerate(boxes)
        for b in boxes[i + 1 :]
    )
