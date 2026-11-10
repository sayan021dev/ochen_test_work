import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("supported lamp regional subtraction removes fractional fringes and preserves opaque body interiors", async ({
  page,
}) => {
  test.setTimeout(60000);
  const path = `../tmp/receiver-fringe-fixtures-${process.pid}.json`;
  execFileSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "src/receiver-renderer.test.tsx"],
    {
      env: { ...process.env, RECEIVER_FIXTURE_PATH: path },
      stdio: "pipe",
      timeout: 45000,
    },
  );
  const fixtures = JSON.parse(readFileSync(path, "utf8"));
  const results = [];
  for (const fixture of fixtures.filter(
    (f: { name: string }) =>
      f.name.startsWith("chain-") && f.name.endsWith("-source"),
  )) {
    const samples = await page.evaluate(async (fixture) => {
      const NS = "http://www.w3.org/2000/svg";
      const doc = new DOMParser().parseFromString(
          fixture.preview,
          "image/svg+xml",
        ),
        root = doc.documentElement;
      const caster = fixture.scene.elements.find(
        (e: { family: string }) => e.family === "lamp",
      );
      const body = root.querySelector(`[data-element-id="${caster.id}"]`)!;
      const cleanMask = body.querySelector(
        "[data-mask-part='body']",
      )!.parentElement!;
      const cut = body.querySelector(
        "[data-source-body-mask] [data-mask-cut]",
      )!;
      const originalCut = [...cut.children].map((child) =>
        child.cloneNode(true),
      );
      // Reconstruct the prior paint-based subtraction from the unchanged cast.
      // Keep exactly the same clip and inverse body matte in both variants.
      const priorPaint = root
        .querySelector(
          `[data-shadow-owner-id="${caster.id}"] [data-shadow-subject]`,
        )!
        .cloneNode(true) as Element;
      const unit =
        Number(cleanMask.getAttribute("width")) / 7 / 945.9432373046875;
      for (const node of [priorPaint, ...priorPaint.querySelectorAll("*")]) {
        node.removeAttribute("id");
        for (const key of ["fill", "stroke"])
          if (node.hasAttribute(key) && node.getAttribute(key) !== "none")
            node.setAttribute(key, "black");
        if (node.localName === "path") {
          node.setAttribute("stroke", "black");
          node.setAttribute("stroke-width", String(unit * 4));
        }
      }
      const templates = doc.createElementNS(NS, "defs");
      for (const node of [...root.children])
        if (node.localName !== "defs") templates.append(node);
      root.append(templates);
      const matte = doc.createElementNS(NS, "g"),
        area = doc.createElementNS(NS, "rect");
      for (const [key, value] of Object.entries({
        x: 650,
        y: 800,
        width: 200,
        height: 240,
      }))
        area.setAttribute(key, String(value * unit));
      area.setAttribute("fill", "white");
      matte.append(area);
      const interior = doc.createElementNS(NS, "g"),
        interiorArea = doc.createElementNS(NS, "rect");
      for (const key of ["x", "y", "width", "height"])
        interiorArea.setAttribute(key, cleanMask.getAttribute(key)!);
      interiorArea.setAttribute("fill", "white");
      interiorArea.setAttribute("mask", `url(#${cleanMask.id})`);
      interior.append(interiorArea);
      const raster = async (node: Element, dx: number, dy: number) => {
        // Body definitions must remain present while rendering either matte.
        templates.append(body);
        root.append(node);
        const image = new Image();
        image.src =
          "data:image/svg+xml," +
          encodeURIComponent(new XMLSerializer().serializeToString(root));
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.translate(dx, dy);
        ctx.drawImage(image, 0, 0);
        node.remove();
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const samples = [];
      const scales =
        fixture.name === "chain-L-2-source"
          ? [fixture.scene.scale * unit, 0.12, 0.25, 0.5, 1]
          : [fixture.scene.scale * unit];
      for (const scale of scales) {
        // A complete source-space viewport also exercises the small and large
        // transforms without clipping away the floor region under examination.
        root.setAttribute("width", "1400");
        root.setAttribute("height", "1400");
        root.setAttribute("viewBox", "0 0 1400 1400");
        const transform = `translate(30 20) scale(${scale / unit})`;
        for (const node of [body, matte, interior])
          node.setAttribute("transform", transform);
        for (const [dx, dy] of [
          [0, 0],
          [0.875, 0],
          [0.125, 0.75],
          [0.375, 0.25],
        ]) {
          cut.replaceChildren(priorPaint.cloneNode(true));
          const before = await raster(body, dx, dy);
          cut.replaceChildren(
            ...originalCut.map((child) => child.cloneNode(true)),
          );
          const paint = await raster(body, dx, dy);
          const shape = await raster(matte, dx, dy),
            bodyShape = await raster(interior, dx, dy);
          let maxAirAlpha = 0,
            airPixels = 0,
            opaqueInteriorPixels = 0,
            changedInteriorPixels = 0;
          for (let i = 0; i < paint.length; i += 4) {
            if (shape[i + 3] === 255) {
              maxAirAlpha = Math.max(maxAirAlpha, paint[i + 3]);
              if (paint[i + 3] > 16) airPixels++;
            }
            // Exclude only the reviewed body's antialiased contour, not black
            // or white interior details: all four RGBA channels must be exact.
            if (
              before[i + 3] === 255 &&
              [-1401, -1400, -1399, -1, 0, 1, 1399, 1400, 1401].every(
                (offset) => bodyShape[i + offset * 4 + 3] === 255,
              )
            ) {
              opaqueInteriorPixels++;
              if (
                [0, 1, 2, 3].some(
                  (channel) => before[i + channel] !== paint[i + channel],
                )
              )
                changedInteriorPixels++;
            }
          }
          const px = Math.floor(30 + 330 * scale + dx),
            py = Math.floor(20 + 810 * scale + dy),
            offset = (py * 1400 + px) * 4;
          const baseUnchanged = [0, 1, 2, 3].every(
            (channel) => before[offset + channel] === paint[offset + channel],
          );
          samples.push({
            scale,
            dx,
            dy,
            maxAirAlpha,
            airPixels,
            opaqueInteriorPixels,
            changedInteriorPixels,
            baseUnchanged,
          });
        }
      }
      return samples;
    }, fixture);
    for (const sample of samples) {
      const diagnostic = JSON.stringify({ fixture: fixture.name, ...sample });
      expect(sample.airPixels, diagnostic).toBe(0);
      expect(sample.opaqueInteriorPixels, diagnostic).toBeGreaterThan(0);
      expect(sample.changedInteriorPixels, diagnostic).toBe(0);
      expect(sample.baseUnchanged, diagnostic).toBe(true);
    }
    results.push({ fixture: fixture.name, samples });
  }
  console.log(
    "Regional subtraction fractional and opaque-interior cohort",
    JSON.stringify(results),
  );
});
