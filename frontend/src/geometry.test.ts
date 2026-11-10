import { expect, it } from "vitest";
import {
  centerForFormat,
  elementPoint,
  frameCorners,
  framePatch,
  framePoint,
  selectionFrame,
  sceneBounds,
  resizeElement,
  rotateElement,
} from "./geometry";
import type { Scene, Asset, Element } from "./types";
const item: Element = {
  id: "a",
  family: "lamp",
  role: "main",
  x: 700,
  y: 100,
  angle: 0,
  hidden: false,
  locked: false,
};
const assets = [
  { family: "lamp", detail: "L", role: "main", width: 600, height: 900 },
] as Asset[];
const scene = {
  format: "landscape",
  detail: "L",
  scale: 0.5,
  elements: [item],
} as Scene;
it("format switch fits and centers the entire visible composition", () => {
  const next = centerForFormat(scene, "portrait", assets),
    box = sceneBounds(next, assets)!;
  expect((box.left + box.right) / 2).toBeCloseTo(400);
  expect((box.top + box.bottom) / 2).toBeCloseTo(600);
  expect(box.right).toBeLessThanOrEqual(800);
  expect(box.left).toBeGreaterThanOrEqual(0);
});
it("corner resize preserves the opposite anchor and aspect ratio", () => {
  const next = resizeElement(item, 0.5, 600, 900, "se", { x: 1300, y: 1000 });
  expect(next.x).toBeCloseTo(700);
  expect(next.y).toBeCloseTo(100);
  expect(next.scale_x).toBeCloseTo(next.scale_y!);
  expect(next.scale_x).toBeGreaterThan(1);
});
it("side resize changes one axis and rotation keeps the object center fixed", () => {
  const next = resizeElement(item, 0.5, 600, 900, "e", { x: 1300, y: 325 });
  expect(next.scale_x).toBeCloseTo(2);
  expect(next.scale_y ?? 1).toBeCloseTo(1);
  const turned = rotateElement(item, 0.5, 600, 900, 90);
  expect(turned.x).toBeCloseTo(1075);
  expect(turned.y).toBeCloseTo(175);
});

const projectionAsset = {
  ...assets[0],
  width: 180,
  height: 160,
  shadow: {
    anchor: [50, 100],
    cast_bbox: [0, 100, 180, 60],
    projection: {
      ground: [0, 100, 100, 100],
      depth: 100,
      body_bbox: [0, 0, 100, 100],
    },
  },
} as Asset;
const projectionOwner: Element = {
  ...item,
  angle: 65,
  scale_x: 1.7,
  scale_y: 0.6,
  shadow: { angle: 45, length: 1, opacity: 0.75, scale_x: 5, scale_y: 0.2 },
};
it("a silhouette frame projects the body bbox and ignores historical lateral stretch", () => {
  const frame = selectionFrame(projectionOwner, projectionAsset, 0.5, "shadow");
  const points = frameCorners(frame);
  const expected = [
    { x: Math.SQRT1_2 * 100, y: 100 + Math.SQRT1_2 * 100 },
    { x: 100 + Math.SQRT1_2 * 100, y: 100 + Math.SQRT1_2 * 100 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ].map((p) => elementPoint(projectionOwner, 0.5, p));
  for (let i = 0; i < 4; i++) {
    expect(points[i].x).toBeCloseTo(expected[i].x, 3);
    expect(points[i].y).toBeCloseTo(expected[i].y, 3);
  }
});
it("dragging the projection changes its endpoint while both ground contacts stay fixed", () => {
  const frame = selectionFrame(projectionOwner, projectionAsset, 0.5, "shadow");
  const patch = framePatch(frame, {
    ...frame.element,
    x: frame.element.x + 20,
    y: frame.element.y - 10,
  });
  expect(Object.keys(patch)).toEqual(["shadow"]);
  expect(patch.shadow!.angle).not.toBe(projectionOwner.shadow!.angle);
  expect(patch.shadow!.length).not.toBe(1);
  expect(patch.shadow!.x ?? 0).toBe(0);
  expect(patch.shadow!.y ?? 0).toBe(0);
  expect(patch.shadow!.scale_x ?? 1).toBe(1);
  expect(patch.shadow!.scale_y ?? 1).toBe(1);
  const next = frameCorners(
    selectionFrame(
      { ...projectionOwner, ...patch },
      projectionAsset,
      0.5,
      "shadow",
    ),
  );
  const before = frameCorners(frame);
  for (const i of [2, 3]) {
    expect(next[i].x).toBeCloseTo(before[i].x, 3);
    expect(next[i].y).toBeCloseTo(before[i].y, 3);
  }
});
it("rotation is about the fixed ground anchor and never changes contact width", () => {
  const frame = selectionFrame(projectionOwner, projectionAsset, 0.5, "shadow");
  const patch = framePatch(frame, { ...frame.element, angle: 135 });
  expect(patch.shadow!.angle).toBeCloseTo(135);
  expect(patch.shadow!.length).toBeCloseTo(1);
  const next = frameCorners(
    selectionFrame(
      { ...projectionOwner, ...patch },
      projectionAsset,
      0.5,
      "shadow",
    ),
  );
  const before = frameCorners(frame);
  for (const i of [2, 3]) {
    expect(next[i].x).toBeCloseTo(before[i].x, 3);
    expect(next[i].y).toBeCloseTo(before[i].y, 3);
  }
  const pointer = elementPoint(projectionOwner, 0.5, { x: 50, y: 200 });
  expect(framePoint(frame, pointer).x).toBeCloseTo(50);
  expect(framePoint(frame, pointer).y).toBeCloseTo(200);
});
it("length editing preserves the contact span and adapts legacy offsets into the endpoint", () => {
  const owner = {
    ...projectionOwner,
    shadow: { angle: 0, length: 1, opacity: 1, x: -100, y: 100 },
  };
  const frame = selectionFrame(owner, projectionAsset, 1, "shadow");
  expect(frame.element.x).toBeCloseTo(50);
  expect(frame.element.y).toBeCloseTo(200);
  const patch = framePatch(frame, { ...frame.element, x: 50, y: 250 });
  expect(patch.shadow!.angle).toBeCloseTo(90);
  expect(patch.shadow!.length).toBeCloseTo(1.5);
});

it("a corner at a scale limit preserves an already stretched aspect ratio", () => {
  const wide = { ...item, scale_x: 6, scale_y: 2 };
  const larger = resizeElement(wide, 1, 100, 100, "se", {
    x: item.x + 720,
    y: item.y + 240,
  });
  expect([larger.scale_x, larger.scale_y]).toEqual([6, 2]);
  const small = resizeElement(wide, 1, 100, 100, "se", {
    x: item.x + 1,
    y: item.y + 1,
  });
  expect(small.scale_x! / small.scale_y!).toBeCloseTo(3);
});
it("format centering leaves hidden distant anchors valid", () => {
  const hidden = { ...item, id: "hidden", hidden: true, x: 4500 };
  const next = centerForFormat(
    { ...scene, elements: [{ ...item, x: -4200 }, hidden] },
    "standard",
    assets,
  );
  expect(next.elements[1]).toEqual(hidden);
});
it("format centering includes rotated and translated visible casts", () => {
  const asset = {
    ...assets[0],
    shadow: projectionAsset.shadow,
  } as Asset;
  const shadow = { angle: 90, length: 1, opacity: 1, x: 1500, y: 750 };
  const source = { ...scene, elements: [{ ...item, shadow }] };
  const bounds = sceneBounds(source, [asset])!;
  expect(bounds.right).toBeGreaterThan(item.x + asset.width * scene.scale);
  const next = centerForFormat(source, "portrait", [asset]),
    fit = sceneBounds(next, [asset])!;
  expect(fit.left).toBeGreaterThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(800);
  expect((fit.left + fit.right) / 2).toBeCloseTo(400);
  const invisible = sceneBounds(
    { ...scene, elements: [{ ...item, shadow: { ...shadow, opacity: 0 } }] },
    [asset],
  );
  expect(invisible).toEqual({ left: 700, top: 100, right: 750, bottom: 150 });
});

it("new endpoint drags cap at 200% and clear historical projection offsets", () => {
  const owner = {
    ...projectionOwner,
    shadow: { angle: 0, length: 1, opacity: 1, x: 2000, y: 300 },
  };
  const frame = selectionFrame(owner, projectionAsset, 1, "shadow");
  const patch = framePatch(frame, { ...frame.element, x: frame.element.x + 1 });
  expect(patch.shadow!.length).toBe(2);
  expect([
    patch.shadow!.x,
    patch.shadow!.y,
    patch.shadow!.scale_x,
    patch.shadow!.scale_y,
  ]).toEqual([0, 0, 1, 1]);
});

it("legacy zero length with offsets still contributes visible projection bounds", () => {
  const owner = {
    ...item,
    shadow: { angle: 45, length: 0, opacity: 1, x: 100, y: 100 },
  };
  const box = sceneBounds({ ...scene, elements: [owner] }, [projectionAsset])!;
  expect(box.right).toBeCloseTo(800);
  expect(box.bottom).toBeCloseTo(200);
});
