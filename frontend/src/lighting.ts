import type { Asset, Element, Scene, Shadow } from "./types";

/** Bounded 2D point-light approximation; original object highlights stay intact. */
export function effectiveShadow(
  scene: Scene,
  element: Element,
  asset: Asset,
  customShadowsEnabled = true,
): Shadow | null {
  if (!customShadowsEnabled) return null;
  const light = scene.light;
  if (!light?.enabled) return element.shadow ?? null;
  const projection = asset.shadow.projection!;
  const [x1, y1, x2, y2] = projection.ground,
    [x, y] = [(x1 + x2) / 2, (y1 + y2) / 2];
  const radians = (element.angle * Math.PI) / 180,
    cos = Math.cos(radians),
    sin = Math.sin(radians);
  const sx = scene.scale * (element.scale_x ?? 1),
    sy = scene.scale * (element.scale_y ?? 1);
  const anchorX = element.x + x * sx * cos - y * sy * sin,
    anchorY = element.y + x * sx * sin + y * sy * cos;
  const height = projection.depth * sy,
    ratio = height / Math.max(light.height - height, 20);
  const dx = (anchorX - light.x) * ratio,
    dy = (anchorY - light.y) * ratio;
  const localX = (dx * cos + dy * sin) / sx,
    localY = (-dx * sin + dy * cos) / sy;
  return {
    angle: ((Math.atan2(localY, localX) * 180) / Math.PI + 360) % 360,
    length: Math.min(
      2,
      Math.hypot(localX, localY) / Math.max(projection.depth, 1e-9),
    ),
    opacity: light.opacity,
    x: 0,
    y: 0,
    scale_x: 1,
    scale_y: 1,
  };
}
