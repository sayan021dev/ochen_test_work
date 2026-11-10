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
import { FORMATS, type Scene, type Asset, type Element } from "./types";
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

it.each(["close", "bleed"] as const)(
  "%s format changes preserve viewport zoom and intentional cropping",
  (framing) => {
    const source: Scene = {
      ...scene,
      framing,
      format: "square",
      scale: 2,
      elements: [{ ...item, x: -100, y: -100 }],
    };
    const next = centerForFormat(source, "portrait", assets);
    expect(next.framing).toBe(framing);
    expect(next.scale).toBeLessThanOrEqual(1.6);
    const bounds = sceneBounds(next, assets)!;
    if (framing === "bleed")
      expect(
        bounds.left < 0 ||
          bounds.right > 800 ||
          bounds.top < 0 ||
          bounds.bottom > 1200,
      ).toBe(true);
    expect(bounds.right).toBeGreaterThan(0);
    expect(bounds.top).toBeLessThan(1200);
    expect(bounds.bottom).toBeGreaterThan(0);
  },
);

it("artistic format changes apply one common transform to hidden objects and light", () => {
  const shadow = { angle: 125, length: 1.4, opacity: 0.7, x: 10, y: -20 };
  const source: Scene = {
    ...scene,
    framing: "bleed",
    scale: 1,
    elements: [
      { ...item, x: -100, y: 50, angle: 15, scale_x: 1.7, shadow },
      { ...item, id: "hidden", x: 800, y: 200, hidden: true, locked: true },
    ],
    light: { enabled: true, x: 300, y: -80, height: 200, opacity: 0.4 },
  };
  const next = centerForFormat(source, "square", assets);
  const factor = next.scale / source.scale;
  const tx = next.elements[0].x - source.elements[0].x * factor;
  const ty = next.elements[0].y - source.elements[0].y * factor;
  for (let i = 0; i < source.elements.length; i++) {
    const before = source.elements[i],
      after = next.elements[i];
    expect(after.x).toBeCloseTo(tx + before.x * factor, 3);
    expect(after.y).toBeCloseTo(ty + before.y * factor, 3);
    expect(after.angle).toBe(before.angle);
    expect(after.scale_x).toBe(before.scale_x);
    expect(after.shadow).toEqual(before.shadow);
    expect(after.hidden).toBe(before.hidden);
    expect(after.locked).toBe(before.locked);
  }
  expect(next.light!.x).toBeCloseTo(tx + 300 * factor, 3);
  expect(next.light!.y).toBeCloseTo(ty - 80 * factor, 3);
  expect(next.light!.height).toBeCloseTo(200 * factor);
  expect(next.light!.opacity).toBe(source.light!.opacity);
});

it("close framing keeps objects visible and leaves the same format unchanged", () => {
  const source: Scene = {
    ...scene,
    framing: "close",
    elements: [{ ...item, x: -120, y: 30 }],
  };
  expect(centerForFormat(source, source.format, assets)).toEqual(source);
  const next = centerForFormat(source, "square", assets);
  const restored = centerForFormat(next, source.format, assets);
  for (const result of [next, restored]) {
    const bounds = sceneBounds(result, assets)!;
    expect(bounds.right).toBeGreaterThan(0);
    expect(bounds.left).toBeLessThan(FORMATS[result.format][0]);
    expect(bounds.bottom).toBeGreaterThan(0);
    expect(bounds.top).toBeLessThan(FORMATS[result.format][1]);
  }
});

it.each(["L", "S"] as const)(
  "artistic resizing keeps %s scale and coordinates within scene validation limits",
  (detail) => {
    const source: Scene = {
      ...scene,
      detail,
      framing: "bleed",
      format: "standard",
      scale: detail === "L" ? 4 : 8,
      elements: [{ ...item, x: -5000, y: 5000 }],
    };
    const next = centerForFormat(source, "fullhd", assets);
    expect(next.scale).toBeLessThanOrEqual(detail === "L" ? 4 : 8);
    expect(next.scale).toBeGreaterThanOrEqual(0.03);
    for (const element of next.elements) {
      expect(Math.abs(element.x)).toBeLessThanOrEqual(5000);
      expect(Math.abs(element.y)).toBeLessThanOrEqual(5000);
    }
    expect(FORMATS[next.format]).toEqual([1920, 1080]);
  },
);

const cameraAssets = [
  {
    family: "folder",
    role: "background",
    detail: "L",
    width: 1240.61865234375,
    height: 658.5882568359375,
  },
  {
    family: "flowers",
    role: "main",
    detail: "L",
    width: 590.5732421875,
    height: 747.106506,
  },
  {
    family: "headphones",
    role: "main",
    detail: "L",
    width: 888.14990234375,
    height: 691.54150390625,
  },
] as Asset[];

function visibleFraction(
  result: Scene,
  element: Element,
  list: Asset[],
): number {
  const asset = list.find(
    (a) => a.family === element.family && a.role === element.role,
  )!;
  const w = asset.width * result.scale,
    h = asset.height * result.scale;
  const [width, height] = FORMATS[result.format];
  return (
    (Math.max(0, Math.min(width, element.x + w) - Math.max(0, element.x)) *
      Math.max(0, Math.min(height, element.y + h) - Math.max(0, element.y))) /
    (w * h)
  );
}

it.each([true, false])(
  "format switching retains a cropped background and both main objects (metadata=%s)",
  (metadata) => {
    // A real previously generated unseen request. The old viewport-centred
    // transform places the entire folder outside the square after this switch.
    const source: Scene = {
      ...scene,
      format: "landscape",
      framing: "bleed",
      scale: 0.6176762837409738,
      ...(metadata
        ? {
            crop: {
              family: "folder" as const,
              horizontal: "right" as const,
              vertical: "center" as const,
            },
          }
        : {}),
      elements: [
        {
          ...item,
          id: "folder",
          family: "folder",
          role: "background",
          x: 938.7213,
          y: 111.6028,
        },
        { ...item, id: "flowers", family: "flowers", x: 539.4547, y: 84.265 },
        {
          ...item,
          id: "headphones",
          family: "headphones",
          x: -43.618,
          y: 101.4256,
        },
      ],
    };
    const next = centerForFormat(source, "square", cameraAssets);
    const folder = next.elements[0];
    const beforeOutside =
      (source.elements[0].x + cameraAssets[0].width * source.scale - 1200) /
      (cameraAssets[0].width * source.scale);
    const afterOutside =
      (folder.x + cameraAssets[0].width * next.scale - 1000) /
      (cameraAssets[0].width * next.scale);
    expect(afterOutside).toBeCloseTo(beforeOutside, 3);
    expect(visibleFraction(next, folder, cameraAssets)).toBeGreaterThanOrEqual(
      0.28 - 1e-6,
    );
    for (const element of next.elements.slice(1))
      expect(
        visibleFraction(next, element, cameraAssets),
      ).toBeGreaterThanOrEqual(0.55 - 1e-6);
  },
);

const formatPairs = (["square", "landscape", "portrait"] as const).flatMap(
  (from) =>
    (["square", "landscape", "portrait"] as const)
      .filter((to) => to !== from)
      .flatMap((to) =>
        (["left", "right", "top", "bottom"] as const).map((edge) => ({
          from,
          to,
          edge,
        })),
      ),
);
it.each(formatPairs)(
  "preserves $edge crop fraction from $from to $to",
  ({ from, to, edge }) => {
    const [w, h] = FORMATS[from];
    const crop = {
      family: "lamp" as const,
      horizontal:
        edge === "left" || edge === "right" ? edge : ("center" as const),
      vertical:
        edge === "top" || edge === "bottom" ? edge : ("center" as const),
    };
    const source: Scene = {
      ...scene,
      format: from,
      framing: "bleed",
      crop,
      scale: 1,
      elements: [
        {
          ...item,
          x: edge === "left" ? -60 : edge === "right" ? w - 240 : (w - 300) / 2,
          y: edge === "top" ? -40 : edge === "bottom" ? h - 160 : (h - 200) / 2,
        },
      ],
    };
    const list = [{ ...assets[0], width: 300, height: 200 }];
    const next = centerForFormat(source, to, list);
    const [nw, nh] = FORMATS[to],
      element = next.elements[0];
    const outside = {
      left: -element.x / (300 * next.scale),
      right: (element.x + 300 * next.scale - nw) / (300 * next.scale),
      top: -element.y / (200 * next.scale),
      bottom: (element.y + 200 * next.scale - nh) / (200 * next.scale),
    }[edge];
    expect(outside).toBeCloseTo(0.2, 3);
    expect(visibleFraction(next, element, list)).toBeGreaterThanOrEqual(0.55);
  },
);

it("an impossible crop restores a small foreground object instead of dropping it", () => {
  const list = [
    { ...assets[0], family: "book", width: 1000, height: 700 },
    { ...assets[0], family: "coin", width: 40, height: 30 },
  ] as Asset[];
  const source: Scene = {
    ...scene,
    format: "square",
    framing: "bleed",
    scale: 1,
    crop: { family: "book", horizontal: "left", vertical: "center" },
    elements: [
      { ...item, id: "book", family: "book", x: -200, y: 100 },
      { ...item, id: "coin", family: "coin", x: -240, y: 300 },
    ],
  };
  const next = centerForFormat(source, "landscape", list);
  expect(visibleFraction(next, next.elements[1], list)).toBeGreaterThanOrEqual(
    0.9,
  );
  expect(visibleFraction(next, next.elements[0], list)).toBeGreaterThanOrEqual(
    0.55,
  );
  expect(next.elements[1].x - next.elements[0].x).toBeCloseTo(
    -40 * next.scale,
    3,
  );
});

it("infers the chosen edge for an unspecified center/center bleed crop", () => {
  const source: Scene = {
    ...scene,
    format: "square",
    framing: "bleed",
    scale: 1,
    crop: { family: "lamp", horizontal: "center", vertical: "center" },
    elements: [{ ...item, x: -60, y: 100 }],
  };
  const list = [{ ...assets[0], width: 300, height: 200 }];
  const next = centerForFormat(source, "landscape", list);
  expect(next.elements[0].x).toBeLessThan(0);
  expect(-next.elements[0].x / (300 * next.scale)).toBeCloseTo(0.2, 3);
});
