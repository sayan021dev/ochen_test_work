import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyCustomShadow, shadowMatrix } from "./shadow";
import type { Shadow, ShadowMetadata } from "./types";

const directory = resolve(process.cwd(), "../assets");
const catalog: {
  id: string;
  file: string;
  role: "main" | "background";
  width: number;
  height: number;
}[] = JSON.parse(readFileSync(`${directory}/catalog.json`, "utf8")).assets;
const metadata = JSON.parse(
  readFileSync(`${directory}/shadow-map.json`, "utf8"),
);
const settings: Shadow = {
  angle: 37,
  length: 1.2,
  opacity: 0.6,
  x: 80,
  y: -35,
  scale_x: 1.7,
  scale_y: 0.5,
};

it.each(catalog)(
  "keeps measured attachment fixed and joins it to the transformed cast: $id",
  (asset) => {
    const document = new DOMParser().parseFromString(
      readFileSync(`${directory}/${asset.file}`, "utf8"),
      "image/svg+xml",
    );
    const original = [...document.querySelectorAll("path")].map((p) =>
      p.getAttribute("d"),
    );
    const meta: ShadowMetadata = metadata[asset.id];
    applyCustomShadow(document, {
      metadata: meta,
      settings,
      role: asset.role,
      width: asset.width,
      height: asset.height,
    });
    const bridge = document.querySelector("[data-shadow-bridge]")!;
    expect(bridge.getAttribute("mask")).toBe("url(#custom-bridge-mask)");
    const mesh = bridge.querySelector("path[data-shadow-mesh]")!;
    expect(mesh.getAttribute("fill-rule")).toBe("nonzero");
    expect(mesh.getAttribute("fill")).toBe(
      asset.role === "main" ? "#181817" : "#7864D7",
    );
    const [a, b, c, d, e, f] = shadowMatrix(meta, settings)
      .slice(7, -1)
      .split(" ")
      .map(Number);
    const allowed = new Set<string>();
    for (const [index, edge] of meta.attachment_edges!.entries()) {
      for (const [x, y] of [edge.slice(0, 2), edge.slice(2)])
        allowed.add(`${x.toFixed(6)},${y.toFixed(6)}`);
      const target = meta.attachment_cast_edges![index];
      for (const [x, y] of [target.slice(0, 2), target.slice(2)])
        allowed.add(
          `${(a * x + c * y + e).toFixed(6)},${(b * x + d * y + f).toFixed(6)}`,
        );
    }
    const points = mesh
      .getAttribute("d")!
      .replace(/[MLZ]/g, "")
      .trim()
      .split(/\s+/);
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((point) => allowed.has(point))).toBe(true);
    const body = document.querySelector(
      "[data-shadow-body] > [data-shadow-subject]",
    )!;
    expect(
      [...body.querySelectorAll("path")].map((p) => p.getAttribute("d")),
    ).toEqual(original);
    expect(bridge.querySelector("image,filter,use")).toBeNull();
  },
);

it("exposes identity layers for a scene pass and keeps a zero-length shadow empty", () => {
  const asset = catalog.find((a: { id: string }) => a.id === "l-main-folder")!;
  for (const length of [0, 1]) {
    const document = new DOMParser().parseFromString(
      readFileSync(`${directory}/${asset.file}`, "utf8"),
      "image/svg+xml",
    );
    applyCustomShadow(document, {
      metadata: metadata[asset.id],
      settings: { angle: 0, length, opacity: 1 },
      role: asset.role,
      width: asset.width,
      height: asset.height,
      separateLayers: true,
    });
    expect(
      document.querySelector("[data-custom-shadow]")!.getAttribute("display"),
    ).toBeNull();
    expect(
      document.querySelector("[data-shadow-body]")!.getAttribute("mask"),
    ).toBe(
      length === 1 ? "url(#custom-source-body-mask)" : "url(#custom-body-mask)",
    );
    if (!length)
      expect(document.querySelector("[data-shadow-bridge]")).toBeNull();
  }
});
