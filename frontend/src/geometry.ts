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

type CameraBox = {
  element: Element;
  left: number;
  right: number;
  top: number;
  bottom: number;
};
type Camera = { factor: number; tx: number; ty: number };

function artisticFormatCamera(
  scene: Scene,
  format: Format,
  assets: Asset[],
): Camera {
  const [width, height] = FORMATS[format];
  const [oldWidth, oldHeight] = FORMATS[scene.format];
  const maximum = (scene.detail === "L" ? 4 : 8) / scene.scale;
  const minimum = 0.03 / scene.scale;
  const initial = clamp(
    Math.min(width, height) / Math.min(oldWidth, oldHeight),
    minimum,
    maximum,
  );
  const boxes: CameraBox[] = scene.elements
    .filter((e) => !e.hidden)
    .flatMap((element) => {
      const asset = assets.find(
        (a) =>
          a.family === element.family &&
          a.detail === scene.detail &&
          a.role === element.role,
      );
      if (!asset) return [];
      const corners = elementCorners(
        element,
        scene.scale,
        asset.width,
        asset.height,
      );
      return [
        {
          element,
          left: Math.min(...corners.map((p) => p.x)),
          right: Math.max(...corners.map((p) => p.x)),
          top: Math.min(...corners.map((p) => p.y)),
          bottom: Math.max(...corners.map((p) => p.y)),
        },
      ];
    });
  let crop = scene.crop;
  if (
    (!crop || (crop.horizontal === "center" && crop.vertical === "center")) &&
    scene.framing === "bleed"
  ) {
    // Older scenes have no semantic crop metadata. Recover the strongest visible
    // clipped object and its edge(s), without relying on any catalogue family.
    const clipped = boxes
      .filter(
        (b) =>
          (!crop || b.element.family === crop.family) &&
          b.right > 0 &&
          b.left < oldWidth &&
          b.bottom > 0 &&
          b.top < oldHeight,
      )
      .map((box) => {
        const w = box.right - box.left,
          h = box.bottom - box.top;
        const left = Math.max(0, -box.left / w),
          right = Math.max(0, (box.right - oldWidth) / w);
        const top = Math.max(0, -box.top / h),
          bottom = Math.max(0, (box.bottom - oldHeight) / h);
        return {
          box,
          left,
          right,
          top,
          bottom,
          amount: Math.max(left, right, top, bottom),
        };
      })
      .filter((c) => c.amount > 1e-6)
      .sort((a, b) => b.amount - a.amount);
    if (clipped.length) {
      const c = clipped[0];
      crop = {
        family: c.box.element.family,
        horizontal:
          Math.max(c.left, c.right) > 1e-6
            ? c.left >= c.right
              ? "left"
              : "right"
            : "center",
        vertical:
          Math.max(c.top, c.bottom) > 1e-6
            ? c.top >= c.bottom
              ? "top"
              : "bottom"
            : "center",
      };
    }
  }
  const target = crop && boxes.find((b) => b.element.family === crop.family);
  function camera(factor: number): Camera {
    let tx = width / 2 - (oldWidth * factor) / 2;
    let ty = height / 2 - (oldHeight * factor) / 2;
    if (crop && target) {
      const w = target.right - target.left,
        h = target.bottom - target.top;
      if (crop.horizontal === "left") {
        const fraction = clamp(-target.left / w, 0.04, 0.95);
        tx = -(fraction * w + target.left) * factor;
      } else if (crop.horizontal === "right") {
        const fraction = clamp((target.right - oldWidth) / w, 0.04, 0.95);
        tx = width - (target.right - fraction * w) * factor;
      }
      if (crop.vertical === "top") {
        const fraction = clamp(-target.top / h, 0.04, 0.95);
        ty = -(fraction * h + target.top) * factor;
      } else if (crop.vertical === "bottom") {
        const fraction = clamp((target.bottom - oldHeight) / h, 0.04, 0.95);
        ty = height - (target.bottom - fraction * h) * factor;
      }
    }
    return { factor, tx, ty };
  }
  const area = (b: CameraBox) => (b.right - b.left) * (b.bottom - b.top);
  const main = boxes.filter((b) => b.element.role === "main");
  const largest = Math.max(0, ...boxes.map(area));
  function visibleFraction(box: CameraBox, c: Camera): number {
    const left = c.tx + box.left * c.factor,
      right = c.tx + box.right * c.factor;
    const top = c.ty + box.top * c.factor,
      bottom = c.ty + box.bottom * c.factor;
    return (
      (Math.max(0, Math.min(width, right) - Math.max(0, left)) *
        Math.max(0, Math.min(height, bottom) - Math.max(0, top))) /
      ((right - left) * (bottom - top))
    );
  }
  function safe(c: Camera): boolean {
    if (
      !boxes.every(
        (b) =>
          visibleFraction(b, c) >=
          (b.element.role === "background"
            ? 0.28
            : area(b) <= largest * 0.22
              ? 0.98
              : 0.55) -
            1e-8,
      )
    )
      return false;
    if (
      main.length &&
      !main.some((b) => {
        const x = c.tx + ((b.left + b.right) * c.factor) / 2;
        const y = c.ty + ((b.top + b.bottom) * c.factor) / 2;
        return x >= 0 && x <= width && y >= 0 && y <= height;
      })
    )
      return false;
    // Keep every existing support contact in view using the same conservative
    // bbox-intersection criterion as the server camera guard.
    return boxes.every((owner) =>
      (owner.element.support_ids ?? []).every((id) => {
        const support = boxes.find((b) => b.element.id === id);
        if (!support) return true;
        const contact = {
          ...owner,
          left: Math.max(owner.left, support.left),
          right: Math.min(owner.right, support.right),
          top: Math.max(owner.top, support.top),
          bottom: Math.min(owner.bottom, support.bottom),
        };
        return (
          contact.right <= contact.left ||
          contact.bottom <= contact.top ||
          visibleFraction(contact, c) >= 0.25
        );
      }),
    );
  }
  for (let step = 0; step <= 80; step++) {
    const factor = Math.max(minimum, initial * Math.pow(0.94, step));
    const candidate = camera(factor);
    if (safe(candidate)) return candidate;
    if (factor === minimum) break;
  }
  if (!boxes.length) return camera(initial);
  // Impossible crop directives yield a readable complete composition rather
  // than silently dropping objects. This changes only the shared camera.
  const left = Math.min(...boxes.map((b) => b.left)),
    right = Math.max(...boxes.map((b) => b.right));
  const top = Math.min(...boxes.map((b) => b.top)),
    bottom = Math.max(...boxes.map((b) => b.bottom));
  const factor = clamp(
    Math.min(
      initial,
      (width * 0.86) / (right - left),
      (height * 0.86) / (bottom - top),
    ),
    minimum,
    maximum,
  );
  return {
    factor,
    tx: width / 2 - ((left + right) * factor) / 2,
    ty: height / 2 - ((top + bottom) * factor) / 2,
  };
}

export function centerForFormat(
  scene: Scene,
  format: Format,
  assets: Asset[],
  customShadowsEnabled = true,
): Scene {
  const artistic = scene.framing === "close" || scene.framing === "bleed";
  if (artistic && scene.format === format) return scene;
  const b = artistic ? null : sceneBounds(scene, assets, customShadowsEnabled);
  if (!artistic && !b) return { ...scene, format };
  const [w, h] = FORMATS[format],
    [oldWidth, oldHeight] = FORMATS[scene.format],
    cx = artistic ? oldWidth / 2 : (b!.left + b!.right) / 2,
    cy = artistic ? oldHeight / 2 : (b!.top + b!.bottom) / 2;
  const camera = artistic ? artisticFormatCamera(scene, format, assets) : null;
  const factor = camera
    ? camera.factor
    : Math.min(
        1,
        (w * 0.86) / Math.max(1, b!.right - b!.left),
        (h * 0.86) / Math.max(1, b!.bottom - b!.top),
      );
  const scale = clamp(scene.scale * factor, 0.03, scene.detail === "L" ? 4 : 8),
    actual = scale / scene.scale;
  const tx = camera ? camera.tx : w / 2 - cx * actual;
  const ty = camera ? camera.ty : h / 2 - cy * actual;
  return {
    ...scene,
    format,
    scale,
    ...(scene.light
      ? {
          light: {
            ...scene.light,
            x: boundedPosition(tx + scene.light.x * actual, true),
            y: boundedPosition(ty + scene.light.y * actual, true),
            height: clamp(scene.light.height * actual, 50, 5000),
          },
        }
      : {}),
    elements: scene.elements.map((e) =>
      e.hidden && !artistic
        ? e
        : {
            ...e,
            x: boundedPosition(tx + e.x * actual, true),
            y: boundedPosition(ty + e.y * actual, true),
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
