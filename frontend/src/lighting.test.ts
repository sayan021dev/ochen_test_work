import { expect, it } from "vitest";
import { effectiveShadow } from "./lighting";
import type { Asset, Scene } from "./types";
const asset = {
  shadow: {
    projection: {
      ground: [0, 100, 200, 100],
      depth: 100,
      body_bbox: [0, 0, 200, 100],
    },
  },
} as Asset;
const scene = {
  scale: 0.5,
  elements: [
    {
      id: "owner",
      family: "lamp",
      role: "main",
      x: 500,
      y: 300,
      angle: 90,
      scale_x: 3,
      scale_y: 2,
      hidden: false,
      locked: false,
      shadow: { angle: 77, length: 0.4, opacity: 1 },
    },
  ],
} as Scene;
it("master-off preserves but ignores all saved custom lighting", () => {
  const value = {
    ...scene,
    light: { enabled: true, x: 200, y: 450, height: 1000, opacity: 0.35 },
  };
  const before = JSON.stringify(value);
  expect(effectiveShadow(value, value.elements[0], asset, false)).toBeNull();
  expect(JSON.stringify(value)).toBe(before);
});
it("global light overrides per-owner settings in world coordinates under rotation and stretch", () => {
  const value = {
    ...scene,
    light: { enabled: true, x: 200, y: 450, height: 1000, opacity: 0.35 },
  };
  const result = effectiveShadow(value, value.elements[0], asset)!;
  expect(result.angle).toBeCloseTo(270);
  expect(result.length).toBeCloseTo(2 / 9);
  expect(result.opacity).toBe(0.35);
  expect(result.x).toBe(0);
  expect(result.scale_x).toBe(1);
  expect(value.elements[0].shadow!.angle).toBe(77);
});
it("disabled global lighting restores the saved per-owner shadow", () => {
  const value = {
    ...scene,
    light: { enabled: false, x: 200, y: 450, height: 1000, opacity: 0.35 },
  };
  expect(effectiveShadow(value, value.elements[0], asset)).toBe(
    value.elements[0].shadow,
  );
});
it("zero-direction and low-height lights stay finite and within the two-hundred-percent limit", () => {
  const centered = {
    ...scene,
    light: { enabled: true, x: 400, y: 450, height: 1000, opacity: 0.35 },
  };
  expect(effectiveShadow(centered, centered.elements[0], asset)!.length).toBe(
    0,
  );
  const low = {
    ...scene,
    light: { enabled: true, x: -5000, y: -5000, height: 50, opacity: 0.35 },
  };
  expect(effectiveShadow(low, low.elements[0], asset)!.length).toBe(2);
});

it("format fitting moves light and height with the body without changing the resolved local projection", async () => {
  const { centerForFormat } = await import("./geometry");
  const actualAsset = {
    ...asset,
    id: "fixture",
    family: "lamp",
    detail: "L",
    role: "main",
    width: 2000,
    height: 1000,
    shadow: {
      ...asset.shadow,
      projection: {
        ground: [0, 1000, 2000, 1000],
        depth: 1000,
        body_bbox: [0, 0, 2000, 1000],
      },
    },
  } as Asset;
  const value = {
    ...scene,
    format: "fullhd",
    detail: "L",
    light: { enabled: true, x: 200, y: 450, height: 5000, opacity: 0.35 },
  } as Scene;
  const before = effectiveShadow(value, value.elements[0], actualAsset)!;
  const fitted = centerForFormat(value, "standard", [actualAsset]);
  const after = effectiveShadow(fitted, fitted.elements[0], actualAsset)!;
  expect(after.angle).toBeCloseTo(before.angle, 4);
  expect(after.length).toBeCloseTo(before.length, 6);
  expect(fitted.light!.x).not.toBe(value.light!.x);
  expect(value.light!.x).toBe(200);
  expect(fitted.scale).toBeLessThan(value.scale);
  expect(fitted.light!.height).toBeCloseTo(
    (value.light!.height * fitted.scale) / value.scale,
  );
});
