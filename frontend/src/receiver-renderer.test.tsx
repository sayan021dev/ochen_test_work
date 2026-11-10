import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Illustration } from "./Illustration";
import { ShadowFeaturesProvider } from "./features";
import { FORMATS, type Asset, type Scene } from "./types";

type Fixture = {
  name: string;
  scene: Scene;
  enabled: boolean;
  assets: Asset[];
  sources: Record<string, string>;
  exported: string;
  preview?: string;
  samples?: unknown;
};
const parse = (source: string) =>
  new DOMParser().parseFromString(source, "image/svg+xml");
const canonical = (root: Element) => {
  const ids = new Map(
    [...root.querySelectorAll("[id]")].map((node, index) => [
      node.id,
      `id${index}`,
    ]),
  );
  const number = (value: string) =>
    String(Math.round(Number(value) * 1e6) / 1e6);
  const visit = (node: Element): unknown[] => {
    const attrs = [...node.attributes].filter(
      (a) =>
        a.name !== "id" &&
        !a.name.startsWith("data-") &&
        !a.name.startsWith("xmlns"),
    );
    const children = [...node.children].flatMap(visit);
    if (
      node.localName === "g" &&
      !node.hasAttribute("id") &&
      attrs.every((a) => a.name === "fill" && a.value === "none")
    )
      return children;
    return [
      [
        node.localName,
        attrs
          .map((a) => [
            a.name,
            a.name === "d"
              ? a.value
              : a.value
                  .replace(
                    /url\(#([^)]*)\)/g,
                    (_, id) => `url(#${ids.get(id)})`,
                  )
                  .replace(/^#(.+)$/, (_, id) =>
                    ids.has(id) ? `#${ids.get(id)}` : `#${id}`,
                  )
                  .replace(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (value) =>
                    number(value),
                  ),
          ])
          .sort((a, b) => a[0].localeCompare(b[0])),
        children,
      ],
    ];
  };
  return [...root.children]
    .filter((node) => node.localName !== "title")
    .flatMap(visit);
};
it("receiver masks and active lighting match Python export for actual S/L chains, flag-off and transformed holes", () => {
  const fixtures: Fixture[] = JSON.parse(
    execFileSync(".venv/bin/python", ["backend/tests/receiver_fixtures.py"], {
      cwd: "..",
      env: { ...process.env, PYTHONPATH: "backend" },
      maxBuffer: 128 * 1024 * 1024,
    }).toString(),
  );
  for (const fixture of fixtures) {
    const [width, height] = FORMATS[fixture.scene.format];
    fixture.preview = renderToStaticMarkup(
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        fill="none"
      >
        <ShadowFeaturesProvider enabled={fixture.enabled}>
          <Illustration
            scene={fixture.scene}
            assets={fixture.assets}
            sources={fixture.sources}
            prefix="scene"
          />
        </ShadowFeaturesProvider>
      </svg>,
    );
    const preview = parse(fixture.preview),
      exported = parse(fixture.exported);
    expect(canonical(preview.documentElement), fixture.name).toEqual(
      canonical(exported.documentElement),
    );
    const overlays = [
      ...preview.querySelectorAll("[data-contact-shadow-owner]"),
    ];
    expect(overlays.length, fixture.name).toBeGreaterThan(0);
    for (const overlay of overlays)
      expect(overlay.querySelectorAll("use").length).toBe(1);
    const ids = [...preview.querySelectorAll("[id]")].map((node) => node.id);
    expect(new Set(ids).size, fixture.name).toBe(ids.length);
    for (const use of preview.querySelectorAll("use"))
      expect(
        ids.includes(use.getAttribute("href")!.slice(1)),
        fixture.name,
      ).toBe(true);
    if (!fixture.enabled)
      expect(preview.querySelector("[data-custom-shadow]")).toBeNull();
  }
  const path = process.env.RECEIVER_FIXTURE_PATH;
  if (path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(fixtures));
  }
}, 30000);
