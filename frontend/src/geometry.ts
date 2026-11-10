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
export function sceneBounds(scene: Scene, assets: Asset[]) {
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
      const corners = elementCorners(e, scene.scale, a.width, a.height);
      if (
        e.shadow &&
        e.shadow.opacity > 0 &&
        e.shadow.length > 0 &&
        a.shadow?.cast_bbox
      )
        corners.push(
          ...frameCorners(selectionFrame(e, a, scene.scale, "shadow")),
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

export function needsShadowPass(scene: Scene, assets: Asset[]): boolean {
  const boxes = scene.elements
    .filter((e) => !e.hidden)
    .flatMap((e) => {
      const bounds = sceneBounds({ ...scene, elements: [e] }, assets);
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
): Scene {
  const b = sceneBounds(scene, assets);
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

// Object frames use scene coordinates. A cast frame uses the local coordinates of
// its owner, so even a stretched, rotated parent can be edited without introducing shear.
export function selectionFrame(
  e: Element,
  asset: Asset,
  sceneScale: number,
  part: "object" | "shadow",
) {
  const box = asset.shadow?.cast_bbox,
    shadow = e.shadow;
  if (part !== "shadow" || !shadow || !box) {
    return {
      element: e,
      scale: sceneScale,
      width: asset.width,
      height: asset.height,
      owner: null,
      offset: null,
      sceneScale,
    };
  }
  const [ax, ay] = asset.shadow.anchor;
  const offset = { x: box[0] - ax, y: box[1] - ay };
  const pose = {
    ...e,
    x: ax + (shadow.x ?? 0),
    y: ay + (shadow.y ?? 0),
    angle: shadow.angle,
    scale_x: shadow.scale_x ?? 1,
    scale_y: shadow.scale_y ?? 1,
  };
  const start = elementPoint(pose, shadow.length, offset);
  return {
    element: { ...pose, ...start },
    scale: shadow.length,
    width: box[2],
    height: box[3],
    owner: e,
    offset,
    sceneScale,
  };
}

export type SelectionFrame = ReturnType<typeof selectionFrame>;

export function frameCorners(frame: SelectionFrame) {
  const points = elementCorners(
    frame.element,
    frame.scale,
    frame.width,
    frame.height,
  );
  return frame.owner
    ? points.map((p) => elementPoint(frame.owner!, frame.sceneScale, p))
    : points;
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
  if (!frame.owner || !frame.offset) return next;
  const shadow = frame.owner.shadow!;
  const oldOffset = elementPoint(
    { ...frame.element, x: 0, y: 0 },
    frame.scale,
    frame.offset,
  );
  const newOffset = elementPoint(
    { ...next, x: 0, y: 0 },
    frame.scale,
    frame.offset,
  );
  return {
    shadow: {
      ...shadow,
      x: rounded(
        clamp(
          (shadow.x ?? 0) +
            next.x -
            frame.element.x +
            oldOffset.x -
            newOffset.x,
          -5000,
          5000,
        ),
      ),
      y: rounded(
        clamp(
          (shadow.y ?? 0) +
            next.y -
            frame.element.y +
            oldOffset.y -
            newOffset.y,
          -5000,
          5000,
        ),
      ),
      angle: ((next.angle % 360) + 360) % 360,
      scale_x: next.scale_x ?? 1,
      scale_y: next.scale_y ?? 1,
    },
  };
}
