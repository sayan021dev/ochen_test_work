import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { Illustration } from "./Canvas";
import { elementCorners } from "./geometry";
import { Inspector } from "./Inspector";
import { createEditorStore, defaultScene } from "./state";
import * as svg from "./svg";
import type { Asset, Palette } from "./types";
const manifest = JSON.parse(readFileSync("../assets/catalog.json", "utf8"));
const map = JSON.parse(readFileSync("../assets/shadow-map.json", "utf8"));
const palette: Palette = manifest.palettes[0];
const asset: Asset = {
  ...manifest.assets.find((a: Asset) => a.id === "l-main-lamp"),
  url: "/assets/library/l-main-lamp.svg",
  shadow: map["l-main-lamp"],
};
const source = readFileSync("../assets/library/l-main-lamp.svg", "utf8");
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("moving an object reuses compiled artwork when shadow settings are unchanged", () => {
  const scene = defaultScene(palette);
  scene.elements = scene.elements
    .filter((e) => e.family === "lamp")
    .map((e) => ({ ...e, shadow: { angle: 35, length: 1, opacity: 0.35 } }));
  const spy = vi.spyOn(svg, "prepareAsset");
  const view = render(
    <svg>
      <Illustration
        scene={scene}
        assets={[asset]}
        sources={{ [asset.id]: source }}
      />
    </svg>,
  );
  expect(spy).toHaveBeenCalledTimes(1);
  view.rerender(
    <svg>
      <Illustration
        scene={{
          ...scene,
          elements: scene.elements.map((e) => ({ ...e, x: e.x + 20 })),
        }}
        assets={[asset]}
        sources={{ [asset.id]: source }}
      />
    </svg>,
  );
  expect(spy).toHaveBeenCalledTimes(1);
});
it("overlapping objects paint all source shadows below both subject bodies", () => {
  const scene = defaultScene(palette);
  scene.elements = [
    { ...scene.elements[2], x: 100, y: 100 },
    { ...scene.elements[2], id: "other-lamp", x: 120, y: 130 },
  ];
  const { container } = render(
    <svg>
      <Illustration
        scene={scene}
        assets={[asset]}
        sources={{ [asset.id]: source }}
      />
    </svg>,
  );
  const shadows = container.querySelector("[data-scene-shadows]")!;
  expect(shadows).not.toBeNull();
  expect(shadows.querySelectorAll("[data-source-shadow]")).toHaveLength(2);
  const bodies = [...container.querySelectorAll("[data-element-id]")];
  expect(bodies).toHaveLength(2);
  expect(
    bodies.every(
      (node) =>
        !node.querySelector("[data-custom-shadow]") &&
        node.querySelector("[data-shadow-body]"),
    ),
  ).toBe(true);
  const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
});
it("clamped shadow input displays the actual stored percentage even when already at the limit", () => {
  const initial = defaultScene(palette);
  initial.elements = initial.elements.filter((e) => e.family === "lamp");
  const store = createEditorStore(initial);
  const lamp = store
    .getState()
    .scene.elements.find((e) => e.family === "lamp")!;
  store
    .getState()
    .patchElement(lamp.id, { shadow: { angle: 35, length: 2, opacity: 0.35 } });
  store.getState().select(lamp.id);
  const view = render(
    <Inspector
      store={store}
      assets={[asset]}
      palettes={[palette]}
      onImportPalette={() => {}}
      onClose={() => {}}
    />,
  );
  const input = view.getByLabelText("Длина тени") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "250" } });
  fireEvent.blur(input);
  expect(input.value).toBe("200");
  expect(
    store.getState().scene.elements.find((e) => e.id === lamp.id)?.shadow
      ?.length,
  ).toBe(2);
});
it("holding the angle stepper repeats and records one undo action", () => {
  vi.useFakeTimers();
  const scene = defaultScene(palette);
  scene.elements = scene.elements.filter((e) => e.family === "lamp");
  const store = createEditorStore(scene);
  const lamp = scene.elements.find((e) => e.family === "lamp")!;
  store.getState().select(lamp.id);
  const view = render(
    <Inspector
      store={store}
      assets={[asset]}
      palettes={[palette]}
      onImportPalette={() => {}}
      onClose={() => {}}
    />,
  );
  const up = view.getByRole("button", { name: "Увеличить угол поворота" });
  fireEvent.pointerDown(up, { button: 0, pointerId: 1 });
  act(() => vi.advanceTimersByTime(600));
  fireEvent.pointerUp(up, { pointerId: 1 });
  expect(
    store.getState().scene.elements.find((e) => e.id === lamp.id)!.angle,
  ).toBeGreaterThan(2);
  expect(store.getState().past).toHaveLength(1);
  const after = store.getState().scene.elements.find((e) => e.id === lamp.id)!;
  const beforeCorners = elementCorners(
    lamp,
    scene.scale,
    asset.width,
    asset.height,
  );
  const afterCorners = elementCorners(
    after,
    scene.scale,
    asset.width,
    asset.height,
  );
  for (const axis of ["x", "y"] as const)
    expect((afterCorners[0][axis] + afterCorners[2][axis]) / 2).toBeCloseTo(
      (beforeCorners[0][axis] + beforeCorners[2][axis]) / 2,
      3,
    );
  store.getState().undo();
  expect(store.getState().scene).toEqual(scene);
  vi.useRealTimers();
});
