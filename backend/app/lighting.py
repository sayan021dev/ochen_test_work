"""A bounded 2D light approximation; source illustration shading is unchanged."""

import math

from app.models import Element, Scene, Shadow


def effective_shadow(
    scene: Scene, element: Element, asset: dict, custom_shadows_enabled: bool = True
) -> Shadow | None:
    if not custom_shadows_enabled:
        return None
    light = scene.light
    if light is None or not light.enabled:
        return element.shadow
    projection = asset["shadow"]["projection"]
    x1, y1, x2, y2 = projection["ground"]
    x, y = (x1 + x2) / 2, (y1 + y2) / 2
    angle = math.radians(element.angle)
    cos, sin = math.cos(angle), math.sin(angle)
    sx, sy = scene.scale * element.scale_x, scene.scale * element.scale_y
    anchor_x = element.x + x * sx * cos - y * sy * sin
    anchor_y = element.y + x * sx * sin + y * sy * cos
    depth = projection["depth"]
    height = depth * sy
    ratio = height / max(light.height - height, 20)
    dx, dy = (anchor_x - light.x) * ratio, (anchor_y - light.y) * ratio
    local_x = (dx * cos + dy * sin) / sx
    local_y = (-dx * sin + dy * cos) / sy
    return Shadow(
        angle=math.degrees(math.atan2(local_y, local_x)) % 360,
        length=min(2, math.hypot(local_x, local_y) / max(depth, 1e-9)),
        opacity=light.opacity,
    )
