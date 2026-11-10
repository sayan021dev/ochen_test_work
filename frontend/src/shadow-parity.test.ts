import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { prepareAsset, prepareAssetLayer } from "./svg";
import type { Asset, Palette } from "./types";

const canonical = (root: Element): unknown => {
  const ids = new Map(
    [...root.querySelectorAll("[id]")].map((n, i) => [n.id, `id${i}`]),
  );
  const visit = (node: Element): unknown => [
    node.localName,
    [...node.attributes]
      .filter(
        (a) =>
          a.name !== "id" &&
          !a.name.startsWith("data-") &&
          !a.name.startsWith("xmlns"),
      )
      .map((a) => [
        a.name,
        // Python and JS serialize scalar IEEE-754 tails differently. Compare
        // scalars to one millionth of a source unit; path data stays verbatim.
        (/^-?\d+(?:\.\d+)?$/.test(a.value)
          ? String(Math.round(Number(a.value) * 1e6) / 1e6)
          : a.value
        )
          .replace(/(?<![\d.])-0\.(0+)(?![\d.])/g, "0.$1")
          .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${ids.get(id)})`),
      ])
      .sort((a, b) => a[0].localeCompare(b[0])),
    [...node.children].map(visit),
  ];
  return [...root.children].map(visit);
};
const parse = (text: string) =>
  new DOMParser().parseFromString(text, "image/svg+xml");

it("all 40 custom shadows match the Python export after silhouette projection, occlusion and palette mapping", () => {
  const manifest = JSON.parse(readFileSync("../assets/catalog.json", "utf8"));
  const metadata = JSON.parse(
    readFileSync("../assets/shadow-map.json", "utf8"),
  );
  const exported = JSON.parse(
    execFileSync(
      ".venv/bin/python",
      [
        "-c",
        `
import json
from app.catalog import CATALOG,PALETTES
from app.models import Scene
from app.svg import render_scene
print(json.dumps({a['id']:render_scene(Scene.model_validate({'detail':a['detail'],'palette':PALETTES[1],'elements':[{'id':'a','family':a['family'],'role':a['role'],'x':0,'y':0,'shadow':{'angle':247,'length':1.4,'opacity':0.49}}]})) for a in CATALOG}))
`,
      ],
      {
        cwd: "..",
        env: { ...process.env, PYTHONPATH: "backend" },
        maxBuffer: 32 * 1024 * 1024,
      },
    ).toString(),
  );
  for (const asset of manifest.assets as Asset[]) {
    const source = readFileSync(
      `../assets/${(asset as Asset & { file: string }).file}`,
      "utf8",
    );
    const markup = prepareAsset(
      source,
      manifest.palettes[1] as Palette,
      "test",
      {
        settings: { angle: 247, length: 1.4, opacity: 0.49 },
        metadata: metadata[asset.id],
        role: asset.role,
        width: asset.width,
        height: asset.height,
      },
    );
    const preview = parse(
      `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    ).documentElement;
    const backend = parse(exported[asset.id]).querySelector(
      "[data-element-id]",
    )!;
    expect(canonical(preview), asset.id).toEqual(canonical(backend));
  }
}, 20000);

it("overlapping ordinary and custom source layers match Python in all 40 variants", () => {
  const manifest = JSON.parse(readFileSync("../assets/catalog.json", "utf8"));
  const metadata = JSON.parse(
    readFileSync("../assets/shadow-map.json", "utf8"),
  );
  const exported = JSON.parse(
    execFileSync(
      ".venv/bin/python",
      [
        "-c",
        `
import json
from app.catalog import CATALOG,PALETTES
from app.models import Scene
from app.svg import render_scene
print(json.dumps({a['id']:render_scene(Scene.model_validate({'detail':a['detail'],'palette':PALETTES[1],'elements':[{'id':'a','family':a['family'],'role':a['role'],'x':0,'y':0},{'id':'b','family':a['family'],'role':a['role'],'x':10,'y':10,'shadow':{'angle':73,'length':1.2,'opacity':0.6,'x':90,'y':60}}]})) for a in CATALOG}))
`,
      ],
      {
        cwd: "..",
        env: { ...process.env, PYTHONPATH: "backend" },
        maxBuffer: 128 * 1024 * 1024,
      },
    ).toString(),
  );
  for (const asset of manifest.assets as (Asset & { file: string })[]) {
    const source = readFileSync(`../assets/${asset.file}`, "utf8");
    const backend = parse(exported[asset.id]);
    for (const id of ["a", "b"])
      for (const layer of ["body", "shadow"] as const) {
        const custom = id === "b";
        const markup = prepareAssetLayer(
          source,
          manifest.palettes[1],
          "test-" + id + "-" + layer,
          {
            settings: custom
              ? { angle: 73, length: 1.2, opacity: 0.6, x: 90, y: 60 }
              : { angle: 0, length: 1, opacity: 1 },
            metadata: metadata[asset.id],
            role: asset.role,
            width: asset.width,
            height: asset.height,
          },
          layer,
          custom,
        );
        const preview = parse(
          `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
        ).documentElement;
        const group = backend.querySelector(
          `[${layer === "body" ? "data-element-id" : "data-shadow-owner-id"}="${id}"]`,
        )!;
        expect(canonical(preview), asset.id + "/" + id + "/" + layer).toEqual(
          canonical(group),
        );
      }
  }
}, 30000);
