import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Item = {
  id: string;
  family: string;
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
  scene: { elements: Item[]; scale: number };
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
    inferred?: boolean;
  } | null;
};
let fixtures: Fixture[] = [];
test.beforeAll(() => {
  const path = resolve(`../tmp/receiver-native-fixtures-${process.pid}.json`);
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
      blocked: fixture.samples!.inferred ? 255 : 0,
      outside: 0,
    });
  }
});

test("supported original casts never paint empty air outside their receivers", async ({
  page,
}) => {
  test.setTimeout(60000);
  const results = [];
  for (const fixture of fixtures.filter((f) => f.name.endsWith("-source"))) {
    const result = await page.evaluate(async (fixture) => {
      const NS = "http://www.w3.org/2000/svg";
      const raster = async (source: string) => {
        const image = new Image();
        image.src = "data:image/svg+xml," + encodeURIComponent(source);
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const failures = [];
      for (const caster of fixture.scene.elements.filter(
        (e) => e.support_ids.length,
      )) {
        const doc = new DOMParser().parseFromString(
            fixture.preview,
            "image/svg+xml",
          ),
          root = doc.documentElement;
        const ground = root.querySelector(
          `[data-shadow-owner-id="${caster.id}"]`,
        )!;
        const groundPaint = ground.closest("defs")
          ? null
          : (ground.closest("[data-ground-shadow-cut]") ?? ground);
        const contact = root.querySelector(
          `[data-contact-shadow-owner="${caster.id}"]`,
        )!;
        const templates = doc.createElementNS(NS, "defs");
        for (const child of [...root.children])
          if (child.localName !== "defs") templates.append(child);
        root.append(templates);
        if (groundPaint) root.append(groundPaint);
        root.append(contact);
        const paint = await raster(new XMLSerializer().serializeToString(root));
        groundPaint?.remove();
        contact.remove();
        const receiverMask = doc.createElementNS(NS, "rect");
        receiverMask.setAttribute("width", root.getAttribute("width")!);
        receiverMask.setAttribute("height", root.getAttribute("height")!);
        receiverMask.setAttribute("fill", "white");
        receiverMask.setAttribute("mask", contact.getAttribute("mask")!);
        root.append(receiverMask);
        const receivers = await raster(
          new XMLSerializer().serializeToString(root),
        );
        receiverMask.remove();
        const body = root.querySelector(`[data-element-id="${caster.id}"]`)!;
        const cleanMask = body.querySelector(
          "[data-mask-part='body']",
        )!.parentElement!;
        const matte = doc.createElementNS(NS, "g");
        matte.setAttribute("transform", body.getAttribute("transform")!);
        const area = doc.createElementNS(NS, "rect");
        for (const key of ["x", "y", "width", "height"])
          area.setAttribute(key, cleanMask.getAttribute(key)!);
        area.setAttribute("fill", "white");
        const assetWidth = Number(cleanMask.getAttribute("width")) / 7;
        if (caster.family === "lamp") {
          // Empty source-floor region to the right of the actual lamp base.
          // Keep the separate black self-shadow on the base itself intact.
          const unit = assetWidth / 945.9432373046875;
          for (const [key, value] of Object.entries({
            x: 650,
            y: 800,
            width: 200,
            height: 240,
          }))
            area.setAttribute(key, String(value * unit));
        } else area.setAttribute("mask", `url(#${cleanMask.id})`);
        matte.append(area);
        root.append(matte);
        const bodyShape = await raster(
          new XMLSerializer().serializeToString(root),
        );
        matte.remove();
        root.append(body);
        const bodyPaint = await raster(
          new XMLSerializer().serializeToString(root),
        );
        let maxRegionalEdgeAlpha = 0,
          regionalEdgePixels = 0;
        let airPixels = 0,
          receiverPixels = 0,
          bodyAirPixels = 0;
        for (let i = 3; i < paint.length; i += 4) {
          if (paint[i] > 16 && receivers[i] === 0) airPixels++;
          if (paint[i] > 16 && receivers[i] > 16) receiverPixels++;
          const outsideBody =
            caster.family === "lamp"
              ? bodyShape[i] === 255
              : bodyShape[i] === 0;
          if (outsideBody && caster.family === "lamp") {
            maxRegionalEdgeAlpha = Math.max(maxRegionalEdgeAlpha, bodyPaint[i]);
            if (bodyPaint[i] > 0) regionalEdgePixels++;
          }
          // Regional clip edges retain tiny antialias samples; an air stripe
          // exceeds 16/255 alpha. Pen matte remains stricter at 2/255.
          if (outsideBody && bodyPaint[i] > (caster.family === "lamp" ? 16 : 2))
            bodyAirPixels++;
        }
        let baseSelfShadow: number[] | null = null;
        if (caster.family === "lamp") {
          const unit = assetWidth / 945.9432373046875;
          const angle = (caster.angle * Math.PI) / 180;
          const x = 330 * unit * fixture.scene.scale * caster.scale_x;
          const y = 810 * unit * fixture.scene.scale * caster.scale_y;
          const px = Math.floor(
            caster.x + x * Math.cos(angle) - y * Math.sin(angle),
          );
          const py = Math.floor(
            caster.y + x * Math.sin(angle) + y * Math.cos(angle),
          );
          const offset = (py * Number(root.getAttribute("width")) + px) * 4;
          baseSelfShadow = [...bodyPaint.slice(offset, offset + 4)];
        }
        failures.push({
          caster: caster.id,
          baseSelfShadow,
          maxRegionalEdgeAlpha,
          regionalEdgePixels,
          airPixels,
          receiverPixels,
          bodyAirPixels,
        });
      }
      return failures;
    }, fixture);
    results.push({ fixture: fixture.name, result });
  }
  for (const { fixture, result } of results)
    for (const sample of result) {
      expect(sample.airPixels, JSON.stringify({ fixture, ...sample })).toBe(0);
      if (sample.baseSelfShadow)
        expect(
          sample.baseSelfShadow,
          JSON.stringify({ fixture, ...sample }),
        ).toEqual([24, 24, 23, 255]);
      expect(sample.bodyAirPixels, JSON.stringify({ fixture, ...sample })).toBe(
        0,
      );
      expect(
        sample.receiverPixels,
        JSON.stringify({ fixture, ...sample }),
      ).toBeGreaterThan(0);
    }
  console.log("Source casts restricted to receivers", JSON.stringify(results));
});

test("ordinary upper-layer casts shade lower ink while retaining floor casts, holes and foreground occlusion", async ({
  page,
}) => {
  test.setTimeout(60000);
  const results = [];
  for (const fixture of fixtures.filter((f) => f.name.startsWith("natural-"))) {
    const result = await page.evaluate(async (fixture) => {
      const raster = async (source: string) => {
        const image = new Image();
        image.src = "data:image/svg+xml," + encodeURIComponent(source);
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return {
          width: canvas.width,
          pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      };
      const doc = new DOMParser().parseFromString(
        fixture.preview,
        "image/svg+xml",
      );
      // Removing only receiver overlays leaves the same floor casts and bodies.
      // It is an independent baseline for visible surface darkening.
      const overlays = [...doc.querySelectorAll("[data-contact-shadow-owner]")];
      for (const overlay of overlays) overlay.remove();
      const base = await raster(new XMLSerializer().serializeToString(doc));
      const preview = await raster(fixture.preview),
        exported = await raster(fixture.exported);
      let darkenedPixels = 0,
        exportDifferences = 0;
      for (let i = 0; i < preview.pixels.length; i += 4) {
        if (base.pixels[i + 3] > 250 && preview.pixels[i] + 8 < base.pixels[i])
          darkenedPixels++;
        if (
          [0, 1, 2, 3].some(
            (channel) =>
              Math.abs(
                preview.pixels[i + channel] - exported.pixels[i + channel],
              ) > 2,
          )
        )
          exportDifferences++;
      }
      const unchangedSamples = fixture.samples
        ? [
            // Ring hole stays the same ground shadow, with no second overlay.
            [
              fixture.scene.elements.find((e) => e.id === "receiver")!,
              fixture.samples.hole,
            ],
            // A body above the caster occludes its shadow, even though lower layers receive it.
            [
              fixture.scene.elements.find((e) => e.id === "foreground")!,
              fixture.samples.blocked,
            ],
          ].map(([item, point]) => {
            const element = item as Item,
              local = point as number[];
            const angle = (element.angle * Math.PI) / 180;
            const px = local[0] * element.scale_x * fixture.scene.scale;
            const py = local[1] * element.scale_y * fixture.scene.scale;
            const x = Math.floor(
              element.x + px * Math.cos(angle) - py * Math.sin(angle),
            );
            const y = Math.floor(
              element.y + px * Math.sin(angle) + py * Math.cos(angle),
            );
            const index = (y * preview.width + x) * 4;
            return [0, 1, 2, 3].every(
              (channel) =>
                preview.pixels[index + channel] ===
                base.pixels[index + channel],
            );
          })
        : [];
      return {
        name: fixture.name,
        darkenedPixels,
        exportDifferences,
        unchangedSamples,
        noSupportRewrites: fixture.scene.elements.every(
          (e) => !e.support_ids.length,
        ),
        noElevatedSources: !doc.querySelector("[data-supported-shadow-source]"),
        groundCastCount: doc.querySelectorAll(
          "[data-scene-shadows] > [data-shadow-owner-id]",
        ).length,
      };
    }, fixture);
    results.push(result);
    expect(result.darkenedPixels, fixture.name).toBeGreaterThan(0);
    expect(result.exportDifferences, fixture.name).toBe(0);
    expect(result.unchangedSamples.every(Boolean), fixture.name).toBe(true);
    expect(result.noSupportRewrites, fixture.name).toBe(true);
    expect(result.noElevatedSources, fixture.name).toBe(true);
    expect(result.groundCastCount, fixture.name).toBe(
      fixture.scene.elements.length,
    );
  }
  console.log("Ordinary layer shadow pixels", JSON.stringify(results));
  const actual = fixtures.filter((f) => /^natural-[SL]-source$/.test(f.name));
  await page.setContent(
    `<body style="margin:20px;background:#1d1d20;color:white;font:16px sans-serif">${actual.map((fixture) => `<section><h2>${fixture.name}</h2><img style="width:600px;max-width:100%" src="data:image/svg+xml,${encodeURIComponent(fixture.preview)}"></section>`).join("")}</body>`,
  );
  await page
    .locator("img")
    .evaluateAll((images) =>
      Promise.all(images.map((image) => (image as HTMLImageElement).decode())),
    );
  await page.screenshot({
    path: test.info().outputPath("ordinary-shadow-surfaces.png"),
    fullPage: true,
  });
});
