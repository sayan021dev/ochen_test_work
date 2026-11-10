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

test("folder and earphone contact bridges render filled continuous fields in every source variant", async ({
  page,
}) => {
  await page.addScriptTag({ content: helper });
  const results = [];
  for (const asset of assets.filter((a: { family: string }) =>
    ["folder", "headphones", "lamp", "phone"].includes(a.family),
  )) {
    for (const settings of [
      { angle: 0, length: 1, opacity: 1, x: 90, y: 60 },
      { angle: 65, length: 1, opacity: 1 },
      { angle: 0, length: 1, opacity: 1, scale_x: 1.8, scale_y: 0.4 },
    ]) {
      const result = await page.evaluate(
        async ({ source, asset, metadata, settings }) => {
          const doc = new DOMParser().parseFromString(source, "image/svg+xml");
          // The production DOM helper is loaded above; no server or AI call is used.
          // @ts-expect-error injected production function
          applyCustomShadow(doc, {
            metadata,
            settings,
            role: asset.role,
            width: asset.width,
            height: asset.height,
          });
          const root = doc.documentElement;
          // @ts-expect-error injected production function
          const [a, b, c, d, e, f] = shadowMatrix(metadata, settings)
            .slice(7, -1)
            .split(" ")
            .map(Number);
          const polygons = metadata.attachment_edges.map(
            (edge: number[], index: number) => {
              const [x1, y1, x2, y2] = edge,
                [cx1, cy1, cx2, cy2] = metadata.attachment_cast_edges[index];
              return [
                [x1, y1],
                [x2, y2],
                [a * cx2 + c * cy2 + e, b * cx2 + d * cy2 + f],
                [a * cx1 + c * cy1 + e, b * cx1 + d * cy1 + f],
              ];
            },
          );
          root.querySelector("[data-shadow-body]")!.remove();
          const pad = 700,
            width = Math.ceil(asset.width + pad * 2),
            height = Math.ceil(asset.height + pad * 2);
          root.setAttribute("width", String(width));
          root.setAttribute("height", String(height));
          root.setAttribute("viewBox", `${-pad} ${-pad} ${width} ${height}`);
          const bodyRoot = root.cloneNode(true) as SVGSVGElement;
          bodyRoot.querySelector("[data-custom-shadow]")!.remove();
          const body = doc.createElementNS(
            "http://www.w3.org/2000/svg",
            "rect",
          );
          for (const [key, value] of Object.entries({
            x: -pad,
            y: -pad,
            width,
            height,
            fill: "white",
            mask: "url(#custom-body-mask)",
          }))
            body.setAttribute(key, String(value));
          bodyRoot.append(body);
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d")!;
          const raster = async (svg: Element) => {
            const image = new Image();
            image.src =
              "data:image/svg+xml," +
              encodeURIComponent(new XMLSerializer().serializeToString(svg));
            await image.decode();
            context.clearRect(0, 0, width, height);
            context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, width, height).data;
          };
          const cast = await raster(root),
            matte = await raster(bodyRoot);
          let checked = 0,
            missing = 0;
          for (const polygon of polygons) {
            const [p, q, r, s] = polygon;
            // Do not demand coverage of sub-pixel or folded degenerate cells.
            const contactLength = Math.hypot(q[0] - p[0], q[1] - p[1]);
            if (contactLength < 3) continue;
            for (const edgeT of [0.25, 0.5, 0.75])
              for (const sweepT of [0.2, 0.5, 0.8]) {
                const x =
                  (p[0] * (1 - edgeT) + q[0] * edgeT) * (1 - sweepT) +
                  (s[0] * (1 - edgeT) + r[0] * edgeT) * sweepT;
                const y =
                  (p[1] * (1 - edgeT) + q[1] * edgeT) * (1 - sweepT) +
                  (s[1] * (1 - edgeT) + r[1] * edgeT) * sweepT;
                const index =
                  (Math.floor(y + pad) * width + Math.floor(x + pad)) * 4 + 3;
                if (matte[index] > 16) continue; // the real subject correctly occludes these samples
                checked++;
                if (cast[index] < 8) missing++;
              }
          }
          let seamPixels = 0;
          const seamExamples: number[][] = [];
          for (let y = 1; y < height - 1; y++)
            for (let x = 1; x < width - 1; x++) {
              const index = (y * width + x) * 4 + 3;
              if (matte[index] > 0 || cast[index] >= 245) continue;
              const left = cast[index - 4],
                right = cast[index + 4],
                up = cast[index - width * 4],
                down = cast[index + width * 4];
              if ((left >= 250 && right >= 250) || (up >= 250 && down >= 250)) {
                seamPixels++;
                if (seamExamples.length < 8)
                  seamExamples.push([x - pad, y - pad, cast[index]]);
              }
            }
          return { checked, missing, seamPixels, seamExamples };
        },
        {
          source: readFileSync(`../assets/${asset.file}`, "utf8"),
          asset,
          metadata: metadata[asset.id],
          settings,
        },
      );
      results.push({ id: asset.id, settings, ...result });
    }
  }
  for (const result of results) {
    expect(result.seamPixels, JSON.stringify(result)).toBeLessThan(10);
    expect(result.checked, JSON.stringify(result)).toBeGreaterThan(0);
    expect(
      result.missing / result.checked,
      JSON.stringify(result),
    ).toBeLessThan(0.025);
  }
});

test("small coin remains attached through offsets of five thousand units and sixfold rotation/scale", async ({
  page,
}) => {
  await page.addScriptTag({ content: helper });
  for (const asset of assets.filter(
    (a: { id: string }) =>
      a.id === "s-main-coin" || a.id === "s-background-coin",
  )) {
    for (const [x, y] of [
      [5000, 0],
      [-5000, 0],
      [0, 5000],
      [0, -5000],
    ]) {
      const result = await page.evaluate(
        async ({ source, asset, metadata, x, y }) => {
          const doc = new DOMParser().parseFromString(source, "image/svg+xml");
          // @ts-expect-error injected production function
          applyCustomShadow(doc, {
            metadata,
            settings: {
              angle: 130,
              length: 1,
              opacity: 1,
              scale_x: 6,
              scale_y: 6,
              x,
              y,
            },
            role: asset.role,
            width: asset.width,
            height: asset.height,
          });
          const root = doc.documentElement;
          root.querySelector("[data-shadow-body]")!.remove();
          // @ts-expect-error injected production function
          const [a, b, c, d, e, f] = shadowMatrix(metadata, {
            angle: 130,
            length: 1,
            opacity: 1,
            scale_x: 6,
            scale_y: 6,
            x,
            y,
          })
            .slice(7, -1)
            .split(" ")
            .map(Number);
          const polygons = metadata.attachment_edges.map(
            (edge: number[], index: number) => {
              const [x1, y1, x2, y2] = edge,
                [cx1, cy1, cx2, cy2] = metadata.attachment_cast_edges[index];
              return [
                [x1, y1],
                [x2, y2],
                [a * cx2 + c * cy2 + e, b * cx2 + d * cy2 + f],
                [a * cx1 + c * cy1 + e, b * cx1 + d * cy1 + f],
              ];
            },
          );
          const polygon = polygons.sort(
            (a, b) =>
              Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1]) -
              Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]),
          )[0];
          const [p, q, r, s] = polygon;
          const canvas = document.createElement("canvas");
          canvas.width = 64;
          canvas.height = 64;
          const ctx = canvas.getContext("2d")!;
          const values = [];
          for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
            const sx = ((p[0] + q[0]) / 2) * (1 - t) + ((r[0] + s[0]) / 2) * t;
            const sy = ((p[1] + q[1]) / 2) * (1 - t) + ((r[1] + s[1]) / 2) * t;
            root.setAttribute("width", "64");
            root.setAttribute("height", "64");
            root.setAttribute("viewBox", `${sx - 16} ${sy - 16} 32 32`);
            const image = new Image();
            image.src =
              "data:image/svg+xml," +
              encodeURIComponent(new XMLSerializer().serializeToString(root));
            await image.decode();
            ctx.clearRect(0, 0, 64, 64);
            ctx.drawImage(image, 0, 0);
            values.push(ctx.getImageData(32, 32, 1, 1).data[3]);
          }
          return values;
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
        Math.min(...result),
        JSON.stringify({ id: asset.id, x, y, result }),
      ).toBeGreaterThan(245);
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
