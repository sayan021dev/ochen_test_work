import { effectiveShadow } from "./lighting";
import { shadowMatrix } from "./shadow";
import {
  FORMATS,
  type Asset,
  type Element,
  type Format,
  type Scene,
} from "./types";
export type Point = { x: number; y: number };
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const rotate = (p: Point, angle: number): Point => {
  const r = (angle * Math.PI) / 180;
  return {
    x: p.x * Math.cos(r) - p.y * Math.sin(r),
    y: p.x * Math.sin(r) + p.y * Math.cos(r),
  };
};
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
const rounded = (n: number) => Math.round(n * 10000) / 10000;
const boundedPosition = (n: number, limit: boolean) =>
  rounded(limit ? clamp(n, -5000, 5000) : n);
export function elementTransform(scene: Scene, e: Element): string {
  const sx = scene.scale * (e.scale_x ?? 1),
    sy = scene.scale * (e.scale_y ?? 1);
  return `translate(${e.x} ${e.y}) rotate(${e.angle}) scale(${sx === sy ? sx : `${sx} ${sy}`})`;
}
export function elementCorners(
  e: Element,
  scale: number,
  width: number,
  height: number,
): Point[] {
  return [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([x, y]) => {
    const p = rotate(
      { x: x * scale * (e.scale_x ?? 1), y: y * scale * (e.scale_y ?? 1) },
      e.angle,
    );
    return { x: e.x + p.x, y: e.y + p.y };
  });
}
export function sceneBounds(
  scene: Scene,
  assets: Asset[],
  customShadowsEnabled = true,
) {
  const pts = scene.elements
    .filter((e) => !e.hidden)
    .flatMap((e) => {
      const a = assets.find(
        (a) =>
          a.family === e.family &&
          a.detail === scene.detail &&
          a.role === e.role,
      );
      if (!a) return [];
      const shadow = effectiveShadow(scene, e, a, customShadowsEnabled);
      const body = shadow && a.shadow?.projection?.body_bbox;
      const corners = body
        ? [
            [body[0], body[1]],
            [body[0] + body[2], body[1]],
            [body[0] + body[2], body[1] + body[3]],
            [body[0], body[1] + body[3]],
          ].map(([x, y]) => elementPoint(e, scene.scale, { x, y }))
        : elementCorners(e, scene.scale, a.width, a.height);
      if (
        shadow &&
        shadow.opacity > 0 &&
        (shadow.length > 0 ||
          Math.abs(shadow.x ?? 0) + Math.abs(shadow.y ?? 0) > 1e-9) &&
        a.shadow?.projection
      )
        corners.push(
          ...frameCorners(
            selectionFrame({ ...e, shadow }, a, scene.scale, "shadow"),
          ),
        );
      return corners;
    });
  if (!pts.length) return null;
  return {
    left: Math.min(...pts.map((p) => p.x)),
    right: Math.max(...pts.map((p) => p.x)),
    top: Math.min(...pts.map((p) => p.y)),
    bottom: Math.max(...pts.map((p) => p.y)),
  };
}

export function needsShadowPass(
  scene: Scene,
  assets: Asset[],
  customShadowsEnabled = true,
): boolean {
  const visibleIds = new Set(
    scene.elements.filter((e) => !e.hidden).map((e) => e.id),
  );
  if (
    scene.elements.some(
      (e) =>
        !e.hidden && (e.support_ids ?? []).some((id) => visibleIds.has(id)),
    )
  )
    return true;
  const boxes = scene.elements
    .filter((e) => !e.hidden)
    .flatMap((e) => {
      const bounds = sceneBounds(
        { ...scene, elements: [e] },
        assets,
        customShadowsEnabled,
      );
      return bounds ? [bounds] : [];
    });
  return boxes.some((a, i) =>
    boxes
      .slice(i + 1)
      .some(
        (b) =>
          a.left < b.right + 2 &&
          a.right + 2 > b.left &&
          a.top < b.bottom + 2 &&
          a.bottom + 2 > b.top,
      ),
  );
}
export function centerForFormat(
  scene: Scene,
  format: Format,
  assets: Asset[],
  customShadowsEnabled = true,
): Scene {
  const b = sceneBounds(scene, assets, customShadowsEnabled);
  if (!b) return { ...scene, format };
  const [w, h] = FORMATS[format],
    cx = (b.left + b.right) / 2,
    cy = (b.top + b.bottom) / 2;
  const factor = Math.min(
    1,
    (w * 0.86) / Math.max(1, b.right - b.left),
    (h * 0.86) / Math.max(1, b.bottom - b.top),
  );
  const scale = Math.max(0.03, scene.scale * factor),
    actual = scale / scene.scale;
  return {
    ...scene,
    format,
    scale,
    ...(scene.light
      ? {
          light: {
            ...scene.light,
            x: boundedPosition(w / 2 + (scene.light.x - cx) * actual, true),
            y: boundedPosition(h / 2 + (scene.light.y - cy) * actual, true),
            height: clamp(scene.light.height * actual, 50, 5000),
          },
        }
      : {}),
    elements: scene.elements.map((e) =>
      e.hidden
        ? e
        : {
            ...e,
            x: boundedPosition(w / 2 + (e.x - cx) * actual, true),
            y: boundedPosition(h / 2 + (e.y - cy) * actual, true),
          },
    ),
  };
}
export function resizeElement(
  e: Element,
  scale: number,
  w: number,
  h: number,
  handle: Handle,
  pointer: Point,
  limitPosition = true,
): Element {
  const startX = e.scale_x ?? 1,
    startY = e.scale_y ?? 1;
  const local = rotate({ x: pointer.x - e.x, y: pointer.y - e.y }, -e.angle);
  const p = { x: local.x / (scale * startX), y: local.y / (scale * startY) };
  const ax = handle.includes("w") ? w : handle.includes("e") ? 0 : w / 2;
  const ay = handle.includes("n") ? h : handle.includes("s") ? 0 : h / 2;
  let rx = handle.includes("w")
    ? (w - p.x) / w
    : handle.includes("e")
      ? p.x / w
      : 1;
  let ry = handle.includes("n")
    ? (h - p.y) / h
    : handle.includes("s")
      ? p.y / h
      : 1;
  if (handle.length === 2) {
    const r = clamp(
      Math.max(rx, ry),
      Math.max(0.05 / startX, 0.05 / startY),
      Math.min(6 / startX, 6 / startY),
    );
    rx = r;
    ry = r;
  }
  const nx = clamp(startX * rx, 0.05, 6),
    ny = clamp(startY * ry, 0.05, 6);
  const before = rotate(
      { x: ax * scale * startX, y: ay * scale * startY },
      e.angle,
    ),
    after = rotate({ x: ax * scale * nx, y: ay * scale * ny }, e.angle);
  return {
    ...e,
    x: boundedPosition(e.x + before.x - after.x, limitPosition),
    y: boundedPosition(e.y + before.y - after.y, limitPosition),
    scale_x: rounded(nx),
    scale_y: rounded(ny),
  };
}
export function rotateElement(
  e: Element,
  scale: number,
  w: number,
  h: number,
  angle: number,
  limitPosition = true,
): Element {
  const center = {
    x: (w * scale * (e.scale_x ?? 1)) / 2,
    y: (h * scale * (e.scale_y ?? 1)) / 2,
  };
  const before = rotate(center, e.angle),
    after = rotate(center, angle);
  return {
    ...e,
    angle: rounded(((angle + 540) % 360) - 180),
    x: boundedPosition(e.x + before.x - after.x, limitPosition),
    y: boundedPosition(e.y + before.y - after.y, limitPosition),
  };
}

export function elementPoint(e: Element, scale: number, p: Point): Point {
  const local = rotate(
    { x: p.x * scale * (e.scale_x ?? 1), y: p.y * scale * (e.scale_y ?? 1) },
    e.angle,
  );
  return { x: e.x + local.x, y: e.y + local.y };
}

export function inverseElementPoint(
  e: Element,
  scale: number,
  p: Point,
): Point {
  const local = rotate({ x: p.x - e.x, y: p.y - e.y }, -e.angle);
  return {
    x: local.x / (scale * (e.scale_x ?? 1)),
    y: local.y / (scale * (e.scale_y ?? 1)),
  };
}

// Projection frames remain in owner coordinates. Their virtual element is the
// direction/length endpoint; its position never moves the fixed ground anchor.
export function selectionFrame(
  e: Element,
  asset: Asset,
  sceneScale: number,
  part: "object" | "shadow",
) {
  const projection = asset.shadow?.projection;
  const shadow = e.shadow;
  if (part !== "shadow" || !shadow || !projection) {
    return {
      element: e,
      scale: sceneScale,
      width: asset.width,
      height: asset.height,
      owner: null,
      offset: null,
      projection: null,
      sceneScale,
    };
  }
  const [x1, y1, x2, y2] = projection.ground;
  const anchor = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  const radians = (shadow.angle * Math.PI) / 180;
  const vector = {
    x: Math.cos(radians) * projection.depth * shadow.length + (shadow.x ?? 0),
    y: Math.sin(radians) * projection.depth * shadow.length + (shadow.y ?? 0),
  };
  return {
    element: {
      ...e,
      x: anchor.x + vector.x,
      y: anchor.y + vector.y,
      angle:
        Math.hypot(vector.x, vector.y) > 1e-10
          ? ((Math.atan2(vector.y, vector.x) * 180) / Math.PI + 360) % 360
          : shadow.angle,
      scale_x: 1,
      scale_y: 1,
    },
    scale: 1,
    width: projection.body_bbox[2],
    height: projection.body_bbox[3],
    owner: e,
    offset: anchor,
    projection: {
      ...projection,
      anchor,
      vector,
      matrix: shadowMatrix(asset.shadow, shadow)
        .slice(7, -1)
        .trim()
        .split(/[ ,]+/)
        .map(Number),
    },
    sceneScale,
  };
}

export type SelectionFrame = ReturnType<typeof selectionFrame>;

export function frameCorners(frame: SelectionFrame) {
  if (frame.projection && frame.owner) {
    const [x, y, w, h] = frame.projection.body_bbox;
    const [a, b, c, d, tx, ty] = frame.projection.matrix;
    return [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ].map(([px, py]) =>
      elementPoint(frame.owner!, frame.sceneScale, {
        x: a * px + c * py + tx,
        y: b * px + d * py + ty,
      }),
    );
  }
  return elementCorners(frame.element, frame.scale, frame.width, frame.height);
}

export function framePoint(frame: SelectionFrame, scenePoint: Point) {
  return frame.owner
    ? inverseElementPoint(frame.owner, frame.sceneScale, scenePoint)
    : scenePoint;
}

export function framePatch(
  frame: SelectionFrame,
  next: Element,
): Partial<Element> {
  if (!frame.owner || !frame.projection) return next;
  const { anchor, vector, depth } = frame.projection;
  const turned = Math.abs(next.angle - frame.element.angle) > 1e-8;
  const radians = (next.angle * Math.PI) / 180;
  const length = Math.hypot(vector.x, vector.y);
  const target = turned
    ? { x: Math.cos(radians) * length, y: Math.sin(radians) * length }
    : { x: next.x - anchor.x, y: next.y - anchor.y };
  const magnitude = Math.hypot(target.x, target.y);
  return {
    shadow: {
      ...frame.owner.shadow!,
      angle: rounded(
        magnitude > 1e-8
          ? ((Math.atan2(target.y, target.x) * 180) / Math.PI + 360) % 360
          : next.angle,
      ),
      length: rounded(clamp(magnitude / depth, 0, 2)),
      x: 0,
      y: 0,
      scale_x: 1,
      scale_y: 1,
    },
  };
}
