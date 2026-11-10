import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Item = {
  id: string;
  x: number;
  y: number;
  angle: number;
  scale_x: number;
  scale_y: number;
  hidden: boolean;
  support_ids: string[];
};
type Fixture = {
  name: string;
  scene: { elements: Item[] };
  enabled: boolean;
  preview: string;
  exported: string;
  samples?: {
    owner: string;
    receiver: string;
    solid: number[];
    hole: number[];
    blocked: number[];
    outside: number[];
  } | null;
};
let fixtures: Fixture[] = [];
test.beforeAll(() => {
  const path = resolve("../tmp/receiver-native-fixtures.json");
  execFileSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "src/receiver-renderer.test.tsx"],
    {
      env: { ...process.env, RECEIVER_FIXTURE_PATH: path },
      stdio: "pipe",
      timeout: 45000,
    },
  );
  fixtures = JSON.parse(readFileSync(path, "utf8"));
});

test("actual composed S/L chains put visible original casts on both supports and match exported pixels", async ({
  page,
}) => {
  test.setTimeout(60000);
  const results = [];
  for (const fixture of fixtures.filter((f) => f.name.startsWith("chain-"))) {
    for (const caster of fixture.scene.elements.filter(
      (e) => e.support_ids.length,
    )) {
      const result = await page.evaluate(
        async ({ fixture, caster }) => {
          const NS = "http://www.w3.org/2000/svg";
          const isolated = (svg: string) => {
            const doc = new DOMParser().parseFromString(svg, "image/svg+xml"),
              root = doc.documentElement;
            const contact = root.querySelector(
              `[data-contact-shadow-owner="${caster.id}"]`,
            )!;
            const overlay = contact.cloneNode(true);
            const masks = doc.createElementNS(NS, "defs");
            const hidden = doc.createElementNS(NS, "mask");
            hidden.setAttribute("id", "native-caster-occlusion");
            hidden.setAttribute("maskUnits", "userSpaceOnUse");
            hidden.setAttribute("mask-type", "luminance");
            hidden.setAttribute("x", "0");
            hidden.setAttribute("y", "0");
            hidden.setAttribute("width", root.getAttribute("width")!);
            hidden.setAttribute("height", root.getAttribute("height")!);
            const white = doc.createElementNS(NS, "rect");
            white.setAttribute("width", root.getAttribute("width")!);
            white.setAttribute("height", root.getAttribute("height")!);
            white.setAttribute("fill", "white");
            hidden.append(white);
            const visible = fixture.scene.elements.filter((e) => !e.hidden),
              index = visible.findIndex((e) => e.id === caster.id);
            for (const occluder of visible.slice(index)) {
              const body = root.querySelector(
                  `[data-element-id="${occluder.id}"]`,
                )!,
                alpha = root.querySelector(
                  `[data-body-alpha="${occluder.id}"]`,
                )!;
              const g = doc.createElementNS(NS, "g");
              g.setAttribute("transform", body.getAttribute("transform")!);
              const rect = doc.createElementNS(NS, "rect");
              for (const key of ["x", "y", "width", "height"])
                rect.setAttribute(key, alpha.getAttribute(key)!);
              rect.setAttribute("fill", "black");
              rect.setAttribute("mask", `url(#${alpha.id})`);
              g.append(rect);
              hidden.append(g);
            }
            masks.append(hidden);
            for (const node of [...root.children])
              if (node.localName !== "defs") masks.append(node);
            root.append(masks);
            const final = doc.createElementNS(NS, "g");
            final.setAttribute("mask", "url(#native-caster-occlusion)");
            final.append(overlay);
            root.append(final);
            return new XMLSerializer().serializeToString(root);
          };
          const raster = async (source: string) => {
            const image = new Image();
            image.src = "data:image/svg+xml," + encodeURIComponent(source);
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(image, 0, 0);
            return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          };
          const preview = await raster(isolated(fixture.preview)),
            exported = await raster(isolated(fixture.exported));
          let visiblePixels = 0,
            maxAlphaDelta = 0,
            alphaDifferences = 0;
          for (let index = 3; index < preview.length; index += 4) {
            if (preview[index] > 16) visiblePixels++;
            const delta = Math.abs(preview[index] - exported[index]);
            maxAlphaDelta = Math.max(maxAlphaDelta, delta);
            if (delta > 2) alphaDifferences++;
          }
          return { visiblePixels, maxAlphaDelta, alphaDifferences };
        },
        { fixture, caster },
      );
      results.push({ fixture: fixture.name, caster: caster.id, ...result });
    }
  }
  for (const result of results) {
    expect(result.alphaDifferences, JSON.stringify(result)).toBe(0);
    if (result.fixture.endsWith("-source"))
      expect(result.visiblePixels, JSON.stringify(result)).toBeGreaterThan(0);
  }
  console.log("Visible support-shadow cohort", JSON.stringify(results));
});

test("actual receiver alpha keeps vector holes and unrelated foreground surfaces clear under transforms", async ({
  page,
}) => {
  for (const fixture of fixtures.filter((f) => f.samples)) {
    const result = await page.evaluate(async (fixture) => {
      const NS = "http://www.w3.org/2000/svg",
        doc = new DOMParser().parseFromString(fixture.preview, "image/svg+xml"),
        root = doc.documentElement;
      const overlay = root
        .querySelector(
          `[data-contact-shadow-owner="${fixture.samples!.owner}"]`,
        )!
        .cloneNode(true);
      const templates = doc.createElementNS(NS, "defs");
      for (const node of [...root.children])
        if (node.localName !== "defs") templates.append(node);
      root.append(templates, overlay);
      const image = new Image();
      image.src =
        "data:image/svg+xml," +
        encodeURIComponent(new XMLSerializer().serializeToString(root));
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const receiver = fixture.scene.elements.find(
        (e) => e.id === fixture.samples!.receiver,
      )!;
      const alpha = (point: number[]) => {
        const angle = (receiver.angle * Math.PI) / 180,
          px = point[0] * receiver.scale_x,
          py = point[1] * receiver.scale_y;
        const x = receiver.x + px * Math.cos(angle) - py * Math.sin(angle),
          y = receiver.y + px * Math.sin(angle) + py * Math.cos(angle);
        return ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3];
      };
      return {
        solid: alpha(fixture.samples!.solid),
        hole: alpha(fixture.samples!.hole),
        blocked: alpha(fixture.samples!.blocked),
        outside: alpha(fixture.samples!.outside),
      };
    }, fixture);
    expect(result, fixture.name).toEqual({
      solid: 255,
      hole: 0,
      blocked: 0,
      outside: 0,
    });
  }
});
