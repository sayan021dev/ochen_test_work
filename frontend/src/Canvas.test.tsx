import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { Illustration } from "./Canvas";
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
