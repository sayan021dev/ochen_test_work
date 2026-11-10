import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const assets = JSON.parse(
  readFileSync("../assets/catalog.json", "utf8"),
).assets;
const metadata = JSON.parse(readFileSync("../assets/shadow-map.json", "utf8"));
const helper = ts
  .transpileModule(readFileSync("src/shadow.ts", "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  })
  .outputText.replace(/^export /gm, "");

test("all forty silhouettes project the body, retain openings and occlude below opaque bases", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.addScriptTag({ content: helper });
  const results = [];
  for (const asset of assets)
    for (const angle of [45, 90, 135, 225]) {
      const result = await page.evaluate(
        async ({ source, asset, metadata, angle }) => {
          const doc = new DOMParser().parseFromString(source, "image/svg+xml");
          const settings = { angle, length: 1, opacity: 1 };
          // @ts-expect-error injected production helper
          applyCustomShadow(doc, {
            metadata,
            settings,
            role: asset.role,
            width: asset.width,
            height: asset.height,
          });
          // @ts-expect-error injected production helper
          const [a, b, c, d, e, f] = shadowMatrix(metadata, settings)
            .slice(7, -1)
            .split(" ")
            .map(Number);
          const corners = [
            [0, 0],
            [asset.width, 0],
            [0, asset.height],
            [asset.width, asset.height],
          ];
          const points = [
            ...corners,
            ...corners.map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]),
          ];
          const left = Math.floor(Math.min(...points.map((p) => p[0]))) - 8,
            top = Math.floor(Math.min(...points.map((p) => p[1]))) - 8;
          const width =
              Math.ceil(Math.max(...points.map((p) => p[0]))) - left + 8,
            height = Math.ceil(Math.max(...points.map((p) => p[1]))) - top + 8;
          const root = doc.documentElement;
          root.setAttribute("width", String(width));
          root.setAttribute("height", String(height));
          root.setAttribute("viewBox", `${left} ${top} ${width} ${height}`);
          const bodyRoot = root.cloneNode(true) as SVGSVGElement;
          bodyRoot.querySelector("[data-custom-shadow]")!.remove();
          root.querySelector("[data-shadow-body]")!.remove();
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d")!;
          const raster = async (svg: Element) => {
            const image = new Image();
            image.src =
              "data:image/svg+xml," +
              encodeURIComponent(new XMLSerializer().serializeToString(svg));
            await image.decode();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(image, 0, 0);
            return {
              image,
              pixels: ctx.getImageData(0, 0, width, height).data,
            };
          };
          const actual = await raster(root),
            body = await raster(bodyRoot);
          // Independent raster reference is test-only. Product/exports remain SVG:
          // project the visible body alpha, then subtract its fixed opaque body.
          ctx.clearRect(0, 0, width, height);
          ctx.setTransform(
            a,
            b,
            c,
            d,
            a * left + c * top + e - left,
            b * left + d * top + f - top,
          );
          ctx.drawImage(body.image, 0, 0);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalCompositeOperation = "destination-out";
          ctx.drawImage(body.image, 0, 0);
          ctx.globalCompositeOperation = "source-over";
          const expected = ctx.getImageData(0, 0, width, height).data;
          let interiors = 0,
            missing = 0,
            exteriorInk = 0,
            coveredBaseInk = 0,
            coloredInk = 0,
            referenceInk = 0,
            actualInk = 0;
          const missingExamples: number[][] = [];
          const stable = (
            data: Uint8ClampedArray,
            index: number,
            value: number,
          ) =>
            (value === 0 ? [-3, 0, 3] : [-3, -2, -1, 0, 1, 2, 3]).every((dy) =>
              (value === 0 ? [-3, 0, 3] : [-3, -2, -1, 0, 1, 2, 3]).every(
                (dx) =>
                  value === 0
                    ? data[index + (dy * width + dx) * 4] === 0
                    : data[index + (dy * width + dx) * 4] >= 250,
              ),
            );
          for (let y = 4; y < height - 4; y += 3)
            for (let x = 4; x < width - 4; x += 3) {
              const index = (y * width + x) * 4 + 3;
              if (expected[index] > 16) referenceInk++;
              if (actual.pixels[index] > 16) actualInk++;
              if (stable(expected, index, 255)) {
                interiors++;
                if (actual.pixels[index] < 245) {
                  missing++;
                  if (missingExamples.length < 5)
                    missingExamples.push([
                      x + left,
                      y + top,
                      actual.pixels[index],
                      expected[index],
                    ]);
                }
              }
              if (stable(expected, index, 0) && actual.pixels[index] > 16)
                exteriorInk++;
              if (stable(body.pixels, index, 255) && actual.pixels[index] > 8)
                coveredBaseInk++;
              if (
                actual.pixels[index] >= 250 &&
                [1, 2, 3].some((offset) => actual.pixels[index - offset] > 25)
              )
                coloredInk++;
            }
          return {
            interiors,
            referenceInk,
            actualInk,
            missingExamples,
            missing,
            exteriorInk,
            coveredBaseInk,
            coloredInk,
            mesh: root.querySelectorAll(
              "[data-shadow-mesh],[data-shadow-bridge]",
            ).length,
            source: root
              .querySelector("[data-custom-shadow]")!
              .getAttribute("data-shadow-source"),
          };
        },
        {
          source: readFileSync(`../assets/${asset.file}`, "utf8"),
          asset,
          metadata: metadata[asset.id],
          angle,
        },
      );
      results.push({ id: asset.id, angle, ...result });
    }
  for (const result of results) {
    expect(result.source, JSON.stringify(result)).toBe("body-silhouette");
    expect(result.mesh, JSON.stringify(result)).toBe(0);
    // Thin/fully occluded projections may contain no 7px-wide opaque interior.
    if (result.referenceInk > 0)
      expect(result.actualInk, JSON.stringify(result)).toBeGreaterThan(0);
    expect(result.missing, JSON.stringify(result)).toBe(0);
    expect(result.exteriorInk, JSON.stringify(result)).toBe(0);
    expect(result.coveredBaseInk, JSON.stringify(result)).toBe(0);
    expect(result.coloredInk, JSON.stringify(result)).toBe(0);
  }
});

test("a real vector opening stays open; the old cast disappears and the base covers the projection", async ({
  page,
}) => {
  await page.addScriptTag({ content: helper });
  const result = await page.evaluate(async () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260" viewBox="-40 -40 260 260" fill="none"><g transform="translate(0 0)"><path id="body" d="M10 10H90V90H10Z M40 40H60V60H40Z" fill="white" fill-rule="evenodd"/><path id="cast" d="M90 90H120V105H90Z" fill="#181817"/></g></svg>';
    const metadata = {
      body_path_ids: ["body"],
      cast_path_ids: ["cast"],
      outline: 0,
      anchor: [50, 90],
      width: 80,
      height: 80,
      projection: {
        ground: [10, 90, 90, 90],
        depth: 80,
        body_bbox: [10, 10, 80, 80],
      },
    };
    const render = async (angle: number, length: number, x = 0, y = 0) => {
      const doc = new DOMParser().parseFromString(source, "image/svg+xml");
      // @ts-expect-error injected production helper
      applyCustomShadow(doc, {
        metadata,
        settings: { angle, length, opacity: 1, x, y },
        role: "main",
        width: 220,
        height: 220,
      });
      doc.querySelector("[data-shadow-body]")!.remove();
      const image = new Image();
      image.src =
        "data:image/svg+xml," +
        encodeURIComponent(
          new XMLSerializer().serializeToString(doc.documentElement),
        );
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 260;
      canvas.height = 260;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const alpha = (x: number, y: number) =>
        context.getImageData(Math.floor(x + 40), Math.floor(y + 40), 1, 1)
          .data[3];
      return {
        alpha,
        source: doc
          .querySelector("[data-custom-shadow]")!
          .getAttribute("data-shadow-source"),
      };
    };
    const down = await render(45, 2),
      up = await render(225, 1),
      zero = await render(45, 0);
    return {
      hole: down.alpha(106.5, 146.5),
      solid: down.alpha(135, 146.5),
      oldCast: down.alpha(115, 97),
      underBase: up.alpha(38, 65),
      zero: zero.alpha(135, 146.5),
      source: down.source,
    };
  });
  expect(result).toEqual({
    hole: 0,
    solid: 255,
    oldCast: 0,
    underBase: 0,
    zero: 0,
    source: "body-silhouette",
  });
});
test("legacy offsets move the projection vector while keeping small-coin support fixed", async ({
  page,
}) => {
  await page.addScriptTag({ content: helper });
  for (const asset of assets.filter((asset: { id: string }) =>
    ["s-main-coin", "s-background-coin"].includes(asset.id),
  )) {
    for (const [x, y] of [
      [5000, 0],
      [-5000, 0],
      [0, 5000],
      [0, -5000],
    ]) {
      const result = await page.evaluate(
        async ({ source, asset, metadata, x, y }) => {
          const settings = {
            angle: 130,
            length: 1,
            opacity: 1,
            x,
            y,
            scale_x: 6,
            scale_y: 0.1,
          };
          const doc = new DOMParser().parseFromString(source, "image/svg+xml");
          // @ts-expect-error injected production helper
          applyCustomShadow(doc, {
            metadata,
            settings,
            role: asset.role,
            width: asset.width,
            height: asset.height,
          });
          // @ts-expect-error injected production helper
          const [a, b, c, d, e, f] = shadowMatrix(metadata, settings)
            .slice(7, -1)
            .split(" ")
            .map(Number);
          const [bx, by, bw, bh] = metadata.projection.body_bbox;
          const cx = bx + bw / 2,
            cy = by + bh / 2,
            target = [a * cx + c * cy + e, b * cx + d * cy + f];
          const root = doc.documentElement;
          root.querySelector("[data-shadow-body]")!.remove();
          root.setAttribute("width", "1024");
          root.setAttribute("height", "1024");
          root.setAttribute(
            "viewBox",
            `${target[0] - 16} ${target[1] - 16} 32 32`,
          );
          const image = new Image();
          image.src =
            "data:image/svg+xml," +
            encodeURIComponent(new XMLSerializer().serializeToString(root));
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 1024;
          canvas.height = 1024;
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0);
          const [x1, y1, x2, y2] = metadata.projection.ground;
          return {
            // Extreme shears can place the centroid between destination pixels.
            // Keep the opaque-coverage threshold, sampling its central patch.
            alpha: Math.max(
              ...Array.from(context.getImageData(510, 510, 5, 5).data).filter(
                (_, index) => index % 4 === 3,
              ),
            ),
            ground: [
              [a * x1 + c * y1 + e, b * x1 + d * y1 + f],
              [a * x2 + c * y2 + e, b * x2 + d * y2 + f],
            ],
            expected: [
              [x1, y1],
              [x2, y2],
            ],
          };
        },
        {
          source: readFileSync(`../assets/${asset.file}`, "utf8"),
          asset,
          metadata: metadata[asset.id],
          x,
          y,
        },
      );
      expect(
        result.alpha,
        JSON.stringify({ id: asset.id, x, y, ...result }),
      ).toBeGreaterThan(245);
      for (let point = 0; point < 2; point++)
        for (let axis = 0; axis < 2; axis++)
          expect(result.ground[point][axis]).toBeCloseTo(
            result.expected[point][axis],
            2,
          );
    }
  }
});

test("separated ordinary artwork preserves all forty source interiors without repairs or bridges", async ({
  page,
}) => {
  await page.addScriptTag({ content: helper });
  const report = [];
  for (const asset of assets) {
    const result = await page.evaluate(
      async ({ source, asset, metadata }) => {
        const original = new DOMParser().parseFromString(
          source,
          "image/svg+xml",
        );
        const separated = new DOMParser().parseFromString(
          source,
          "image/svg+xml",
        );
        // @ts-expect-error injected production function
        applyCustomShadow(separated, {
          metadata,
          settings: { angle: 0, length: 1, opacity: 1 },
          role: asset.role,
          width: asset.width,
          height: asset.height,
          separateLayers: true,
          preserveSource: true,
        });
        const identityControl = new DOMParser().parseFromString(
          source,
          "image/svg+xml",
        );
        // @ts-expect-error injected production function
        applyCustomShadow(identityControl, {
          metadata,
          settings: { angle: 0, length: 1, opacity: 1 },
          role: asset.role,
          width: asset.width,
          height: asset.height,
          preserveSource: true,
          separateLayers: true,
        });
        const castRoot = separated.documentElement.cloneNode(
          true,
        ) as SVGSVGElement;
        castRoot.querySelector("[data-shadow-body]")!.remove();
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(asset.width);
        canvas.height = Math.ceil(asset.height);
        const context = canvas.getContext("2d")!;
        const raster = async (root: Element) => {
          const image = new Image();
          image.src =
            "data:image/svg+xml," +
            encodeURIComponent(new XMLSerializer().serializeToString(root));
          await image.decode();
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          return context.getImageData(0, 0, canvas.width, canvas.height).data;
        };
        const before = await raster(original.documentElement),
          after = await raster(separated.documentElement),
          cast = await raster(castRoot),
          control = await raster(identityControl.documentElement);
        let identityPixelDifferences = 0;
        for (let i = 0; i < before.length; i++)
          if (before[i] !== control[i]) identityPixelDifferences++;
        const sourceTransform = (
          original.documentElement
            .firstElementChild as unknown as SVGGraphicsElement
        ).transform.baseVal
          .consolidate()!
          .matrix.inverse();
        const sourcePaths = [
          ...original.querySelectorAll("path"),
        ] as unknown as SVGGeometryElement[];
        for (const path of sourcePaths) {
          path.setAttribute("stroke", "black");
          path.setAttribute("stroke-width", "6");
        }
        const connectedSource = original.documentElement;
        connectedSource.setAttribute(
          "style",
          "position:absolute;left:-10000px;top:-10000px",
        );
        document.body.append(connectedSource);
        const onSourceContour = (px: number, py: number) => {
          const point = new DOMPoint(
            ((px + 0.5) * asset.width) / canvas.width,
            ((py + 0.5) * asset.height) / canvas.height,
          ).matrixTransform(sourceTransform);
          return sourcePaths.some((path) => path.isPointInStroke(point));
        };
        let missingInterior = 0,
          addedInk = 0,
          antialiasDifferences = 0,
          changedOpaqueColors = 0;
        let identityInteriorDifferences = 0;
        let maxColorDelta = 0;
        const colorExamples: number[][] = [];
        for (let index = 3; index < before.length; index += 4) {
          const pixel = (index - 3) / 4,
            px = pixel % canvas.width,
            py = Math.floor(pixel / canvas.width);
          let sourceInterior = true,
            sourceExterior = true,
            uniformColor = true,
            nearCast = false;
          for (let oy = -1; oy <= 1; oy++)
            for (let ox = -1; ox <= 1; ox++) {
              if (
                px + ox < 0 ||
                px + ox >= canvas.width ||
                py + oy < 0 ||
                py + oy >= canvas.height
              ) {
                sourceInterior = false;
                uniformColor = false;
                continue;
              }
              const neighbor = index + (oy * canvas.width + ox) * 4;
              if (before[neighbor] !== 255) sourceInterior = false;
              if (before[neighbor] !== 0) sourceExterior = false;
              if (cast[neighbor] > 0) nearCast = true;
              if (
                [1, 2, 3].some(
                  (offset) =>
                    before[neighbor - offset] !== before[index - offset],
                )
              )
                uniformColor = false;
            }
          if (
            sourceInterior &&
            uniformColor &&
            !nearCast &&
            [0, 1, 2, 3].some(
              (offset) =>
                Math.abs(before[index - offset] - control[index - offset]) > 1,
            ) &&
            !onSourceContour(px, py)
          )
            identityInteriorDifferences++;
          if (before[index] === 255 && after[index] < 250) {
            if (
              (cast[index] > 0 && cast[index] < 255 && after[index] >= 190) ||
              !sourceInterior ||
              onSourceContour(px, py)
            )
              antialiasDifferences++;
            else missingInterior++;
          }
          if (sourceExterior && before[index] === 0 && after[index] > 16)
            addedInk++;
          if (
            sourceInterior &&
            uniformColor &&
            after[index] === 255 &&
            !nearCast
          )
            if (
              [1, 2, 3].some(
                (offset) =>
                  Math.abs(before[index - offset] - after[index - offset]) > 1,
              )
            ) {
              if (onSourceContour(px, py)) continue;
              changedOpaqueColors++;
              const delta = Math.max(
                ...[1, 2, 3].map((offset) =>
                  Math.abs(before[index - offset] - after[index - offset]),
                ),
              );
              maxColorDelta = Math.max(maxColorDelta, delta);
              if (colorExamples.length < 5) colorExamples.push([px, py, delta]);
            }
        }
        connectedSource.remove();
        return {
          identityPixelDifferences,
          identityInteriorDifferences,
          missingInterior,
          addedInk,
          antialiasDifferences,
          changedOpaqueColors,
          maxColorDelta,
          colorExamples,
          bridges: separated.querySelectorAll(
            "[data-shadow-bridge],[data-shadow-body-repair]",
          ).length,
        };
      },
      {
        source: readFileSync(`../assets/${asset.file}`, "utf8"),
        asset,
        metadata: metadata[asset.id],
      },
    );
    report.push({ id: asset.id, ...result });
  }
  console.log("Source preservation AA boundary counts", JSON.stringify(report));
  for (const result of report) {
    expect(result.identityInteriorDifferences, JSON.stringify(result)).toBe(0);
    expect(result.missingInterior, JSON.stringify(result)).toBe(0);
    expect(result.addedInk, JSON.stringify(result)).toBe(0);
    expect(result.changedOpaqueColors, JSON.stringify(result)).toBe(0);
    expect(result.bridges).toBe(0);
  }
});
