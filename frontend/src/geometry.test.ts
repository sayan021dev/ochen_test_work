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

it("the cast frame stretches under a nonuniformly scaled and rotated owner without moving its opposite edge", () => {
  const owner: Element = {
    ...item,
    angle: 65,
    scale_x: 1.7,
    scale_y: 0.6,
    shadow: {
      angle: 31,
      length: 1.4,
      opacity: 0.75,
      x: 25,
      y: -12,
      scale_x: 1.2,
      scale_y: 0.8,
    },
  };
  const asset = {
    ...assets[0],
    shadow: { anchor: [100, 220], cast_bbox: [30, 50, 200, 80] },
  } as Asset;
  const frame = selectionFrame(owner, asset, 0.5, "shadow");
  const corners = frameCorners(frame),
    side = elementPoint(frame.element, frame.scale, { x: 300, y: 40 });
  const screen = elementPoint(owner, frame.sceneScale, side);
  const updated = resizeElement(
    frame.element,
    frame.scale,
    frame.width,
    frame.height,
    "e",
    framePoint(frame, screen),
    false,
  );
  const patch = framePatch(frame, updated);
  expect(Object.keys(patch)).toEqual(["shadow"]);
  expect(patch.shadow?.scale_x).toBeCloseTo(1.8);
  expect(patch.shadow?.scale_y).toBeCloseTo(0.8);
  const changed = frameCorners(
    selectionFrame({ ...owner, ...patch }, asset, 0.5, "shadow"),
  );
  for (const i of [0, 3]) {
    expect(changed[i].x).toBeCloseTo(corners[i].x, 3);
    expect(changed[i].y).toBeCloseTo(corners[i].y, 3);
  }
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
    shadow: { anchor: [100, 100], cast_bbox: [0, 50, 200, 100] },
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
  expect(invisible).toEqual(sceneBounds(scene, [asset]));
});
