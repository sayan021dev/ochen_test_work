import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { prepareAsset } from "./svg";
import type { Asset, Palette } from "./types";

it("all 40 custom shadows match the Python export after masking, projection and palette mapping", () => {
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
          a.value.replace(
            /url\(#([^)]+)\)/g,
            (_, id) => `url(#${ids.get(id)})`,
          ),
        ])
        .sort((a, b) => a[0].localeCompare(b[0])),
      [...node.children].map(visit),
    ];
    return [...root.children].map(visit);
  };
  const parse = (text: string) =>
    new DOMParser().parseFromString(text, "image/svg+xml");
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
