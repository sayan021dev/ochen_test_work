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
const metadata: Record<string, ShadowMetadata> = JSON.parse(
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
const parse = (file: string) =>
  new DOMParser().parseFromString(
    readFileSync(`${directory}/${file}`, "utf8"),
    "image/svg+xml",
  );

it.each(catalog)(
  "projects the complete black body from a fixed support: $id",
  (asset) => {
    const document = parse(asset.file),
      meta = metadata[asset.id];
    const paths = [...document.querySelectorAll("path")]
      .filter((p) => !meta.body_exclude_path_ids?.includes(p.id))
      .map((p) => p.getAttribute("d"));
    applyCustomShadow(document, {
      metadata: meta,
      settings,
      role: asset.role,
      width: asset.width,
      height: asset.height,
    });
    const layer = document.querySelector("[data-custom-shadow]")!;
    expect(layer.getAttribute("data-shadow-source")).toBe("body-silhouette");
    expect(layer.getAttribute("mask")).toBe(
      "url(#custom-projection-occlusion)",
    );
    const body = layer.querySelector("[data-shadow-subject]")!;
    const projected = [...body.querySelectorAll("path")];
    expect(
      projected.slice(0, paths.length).map((p) => p.getAttribute("d")),
    ).toEqual(paths);
    expect(
      projected.every(
        (p) =>
          p.getAttribute("fill") === "#181817" ||
          p.getAttribute("fill") === "none",
      ),
    ).toBe(true);
    expect(
      document.querySelector(
        "[data-shadow-bridge],[data-shadow-mesh],image,filter",
      ),
    ).toBeNull();
    const [a, b, c, d, e, f] = shadowMatrix(meta, settings)
      .slice(7, -1)
      .split(" ")
      .map(Number);
    const [x1, y1, x2, y2] = meta.projection!.ground;
    for (const [x, y] of [
      [x1, y1],
      [x2, y2],
      [(x1 + x2) / 2, (y1 + y2) / 2],
    ]) {
      expect(a * x + c * y + e).toBeCloseTo(x, 2);
      expect(b * x + d * y + f).toBeCloseTo(y, 2);
    }
    expect(shadowMatrix(meta, settings)).toBe(
      shadowMatrix(meta, { ...settings, scale_x: 1, scale_y: 1 }),
    );
  },
);

it.each(catalog)(
  "keeps ordinary source splitting explicit and unchanged: $id",
  (asset) => {
    const document = parse(asset.file),
      original = [...document.querySelectorAll("path")].map((p) => [
        p.getAttribute("d"),
        p.getAttribute("fill"),
      ]);
    applyCustomShadow(document, {
      metadata: metadata[asset.id],
      settings: { angle: 45, length: 1, opacity: 1 },
      role: asset.role,
      width: asset.width,
      height: asset.height,
      separateLayers: true,
      preserveSource: true,
    });
    const layer = document.querySelector("[data-custom-shadow]")!;
    expect(layer.getAttribute("data-shadow-source")).toBe("original-footprint");
    expect(layer.getAttribute("transform")).toBe(
      "matrix(1.000000 0.000000 -0.000000 1.000000 0.000000 0.000000)",
    );
    const body = document.querySelector(
      "[data-shadow-body] [data-shadow-subject]",
    )!;
    expect(body.getAttribute("mask")).toBe("url(#custom-source-body-mask)");
    expect(
      [...body.querySelectorAll("path")].map((p) => [
        p.getAttribute("d"),
        p.getAttribute("fill"),
      ]),
    ).toEqual(original);
    expect(
      document.querySelector(
        "[data-shadow-body-repair],[data-shadow-occluder],[data-shadow-mesh]",
      ),
    ).toBeNull();
  },
);

it("collapses an edge-on/zero-length projection without inventing thickness", () => {
  const asset = catalog.find((a) => a.id === "l-main-folder")!;
  const [x1, y1, x2, y2] = metadata[asset.id].projection!.ground;
  const parallel = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  for (const settings of [
    { angle: parallel, length: 1, opacity: 1 },
    { angle: 45, length: 0, opacity: 1 },
  ]) {
    const document = parse(asset.file);
    applyCustomShadow(document, {
      metadata: metadata[asset.id],
      settings,
      role: asset.role,
      width: asset.width,
      height: asset.height,
    });
    expect(
      document.querySelector("[data-custom-shadow]")!.getAttribute("display"),
    ).toBe("none");
    expect(document.querySelector("[data-shadow-body]")).not.toBeNull();
  }
});
