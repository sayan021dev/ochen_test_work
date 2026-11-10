// Build-time only: original files are read, never rewritten. Review the contact sheet after changes.
import { chromium } from "../frontend/node_modules/@playwright/test/index.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import ts from "../frontend/node_modules/typescript/lib/typescript.js";
// Use the production SVG helper for mask-aware selection bounds. Raster samples
// are build-time metadata only; no bitmap enters the library or exported SVG.
const shadowHelper = ts
  .transpileModule(readFileSync("frontend/src/shadow.ts", "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  })
  .outputText.replace(/^export /gm, "");
const catalog = JSON.parse(readFileSync("assets/catalog.json", "utf8")).assets;
// Reviewed source path indices: silhouette underpaint can contain both outline and cast shadow.
const exclusions = {
  book: [1, 2],
  phone: [0, 94],
  puzzle: [0, 2, 11, 18],
  coin: [81, 82, 135],
  headphones: [0, 1],
  lamp: [0, 1],
  flowers: [0, 2],
  wallet: [0, 1],
  folder: [0, 1, 16],
  pen: [0],
};
// Reviewed original ground-shadow paths in L/main. Fused silhouettes are
// additionally restricted to local ground regions, never the complete outline.
const castIndices = {
  book: [2],
  phone: [94],
  puzzle: [2, 11, 18],
  coin: [81, 135],
  headphones: [0, 1],
  lamp: [1],
  flowers: [2],
  wallet: [1],
  folder: [16],
  pen: [0],
};
const castRegions = {
  // The fused lamp underpaint includes the stem and left base outline. Only
  // the reviewed right-hand floor polygon is an original ground shadow.
  lamp: [
    [
      [0.4, 0.69],
      [0.54, 0.65],
      [0.92, 0.83],
      [0.92, 0.89],
      [0.67, 1.02],
      [0.37, 1.02],
      [0.37, 0.985],
      [0.64, 0.875],
      [0.645, 0.795],
      [0.445, 0.705],
    ],
  ],
  headphones: [
    [
      [-0.01, 0.46],
      [0.4, 0.34],
      [0.41, 0.7],
      [-0.01, 0.73],
    ],
    [
      [0.43, 0.79],
      [0.88, 0.69],
      [0.91, 1.02],
      [0.43, 1.02],
    ],
  ],
  pen: [
    [
      [0, -0.15],
      [1.05, 0.9],
      [1.05, 1.05],
      [0, 0],
    ],
  ],
  wallet: [
    [
      [0.34, 0.98],
      [0.96, 0.43],
      [1.05, 0.5],
      [1.05, 1.1],
      [0.34, 1.1],
    ],
  ],
};
const browser = await chromium.launch({
  headless: true,
  channel: process.env.CI ? undefined : "chrome",
});
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: shadowHelper });
  const measured = [];
  for (const asset of catalog) {
    await page.setContent(readFileSync(`assets/${asset.file}`, "utf8"));
    measured.push(
      await page.evaluate((asset) => {
        const svg = document.querySelector("svg");
        const matrix =
          svg.firstElementChild.transform.baseVal.consolidate().matrix;
        return {
          ...asset,
          paths: [...svg.querySelectorAll("path")].map((p, index) => {
            const box = p.getBBox(),
              total = p.getTotalLength();
            return {
              id: p.id,
              index,
              fill: p.getAttribute("fill"),
              box: [box.x + matrix.e, box.y + matrix.f, box.width, box.height],
              points: Array.from({ length: 65 }, (_, i) => {
                const point = p.getPointAtLength((total * i) / 64);
                return [point.x + matrix.e, point.y + matrix.f];
              }),
            };
          }),
        };
      }, asset),
    );
  }
  const result = {};
  for (const asset of measured) {
    const baseline = measured.find(
      (a) => a.family === asset.family && a.detail === "L" && a.role === "main",
    );
    const excluded = new Set(
      exclusions[asset.family].map((index) => {
        const target = baseline.paths[index].box.map(
          (n, i) => n / (i % 2 ? baseline.height : baseline.width),
        );
        return asset.paths
          .map((p) => ({
            id: p.id,
            score: p.box.reduce(
              (sum, n, i) =>
                sum +
                (n / (i % 2 ? asset.height : asset.width) - target[i]) ** 2,
              0,
            ),
          }))
          .sort((a, b) => a.score - b.score)[0].id;
      }),
    );
    const castIds = new Set(
      castIndices[asset.family].map((index) => {
        const target = baseline.paths[index].box.map(
          (n, i) => n / (i % 2 ? baseline.height : baseline.width),
        );
        return asset.paths
          .filter((p) => ["#181817", "#7864D7"].includes(p.fill))
          .map((p) => ({
            id: p.id,
            score: p.box.reduce(
              (sum, n, i) =>
                sum +
                (n / (i % 2 ? asset.height : asset.width) - target[i]) ** 2,
              0,
            ),
          }))
          .sort((a, b) => a.score - b.score)[0].id;
      }),
    );
    for (const id of castIds) excluded.add(id);
    const body = asset.paths.filter(
      (p) =>
        !excluded.has(p.id) &&
        (asset.family !== "headphones" ||
          (!["#181817", "#7864D7"].includes(p.fill) &&
            p.box[2] * p.box[3] > asset.width * asset.height * 0.001)),
    );
    const x = Math.min(...body.map((p) => p.box[0])),
      y = Math.min(...body.map((p) => p.box[1]));
    const right = Math.max(...body.map((p) => p.box[0] + p.box[2])),
      bottom = Math.max(...body.map((p) => p.box[1] + p.box[3]));
    const entry = {
      source_sha256: asset.sha256,
      body_path_ids: body.map((p) => p.id),
      cast_path_ids: asset.paths
        .filter((p) => castIds.has(p.id))
        .map((p) => p.id),
      anchor: [(x + right) / 2, bottom],
      width: right - x,
      height: bottom - y,
      outline: asset.detail === "L" ? 4 : 2,
    };
    if (castRegions[asset.family])
      entry.cast_regions = castRegions[asset.family].map((polygon) =>
        polygon.map(([x, y]) => [x * asset.width, y * asset.height]),
      );
    if (asset.family === "flowers" || asset.family === "lamp")
      entry.preserve_above =
        asset.height * (asset.family === "flowers" ? 0.7 : 0.5);
    if (asset.family === "flowers")
      entry.erase_path_ids = [
        asset.paths.find((p) => p.id === [...excluded][1]).id,
      ];
    if (["pen", "coin", "wallet", "folder"].includes(asset.family)) {
      const outline =
        asset.family === "coin"
          ? asset.paths.filter(
              (p) => p.id.startsWith("Subtract") || p.index === 1,
            )
          : asset.family === "headphones"
            ? body.filter((p) => p.fill !== "#181817" && p.fill !== "#7864D7")
            : body;
      const points = outline
        .flatMap((p) => p.points)
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cross = (o, a, b) =>
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const half = (ps) => {
        const h = [];
        for (const p of ps) {
          while (h.length > 1 && cross(h.at(-2), h.at(-1), p) <= 0) h.pop();
          h.push(p);
        }
        return h.slice(0, -1);
      };
      entry.hull = [...half(points), ...half([...points].reverse())].map((p) =>
        p.map((n) => Math.round(n * 1000) / 1000),
      );
    }
    if (asset.family === "headphones") {
      // These three original white pieces outline the headband. Keeping their
      // hull retains the rear band's black depth without a hull across the cups.
      const band = [18, 19, 21].map((index) => {
        const target = baseline.paths[index].box.map(
          (n, i) => n / (i % 2 ? baseline.height : baseline.width),
        );
        return [...asset.paths].sort((a, b) => {
          const score = (p) =>
            p.box.reduce(
              (sum, n, i) =>
                sum +
                (n / (i % 2 ? asset.height : asset.width) - target[i]) ** 2,
              0,
            );
          return score(a) - score(b);
        })[0];
      });
      const points = band
        .flatMap((p) => p.points)
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cross = (o, a, b) =>
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const half = (ps) => {
        const h = [];
        for (const p of ps) {
          while (h.length > 1 && cross(h.at(-2), h.at(-1), p) <= 0) h.pop();
          h.push(p);
        }
        return h.slice(0, -1);
      };
      entry.keep_polygons = [[...half(points), ...half([...points].reverse())]];
    }
    if (asset.family === "coin") {
      const top = asset.paths[1].box,
        edge = asset.paths.find((p) => p.id.startsWith("Subtract")).box;
      const depth = edge[1] + edge[3] - top[1] - top[3];
      entry.sidewall = [
        top[0] + top[2] / 2,
        top[1] + top[3] / 2,
        top[2] / 2,
        top[3] / 2,
        depth,
      ];
      const [cx, cy, rx, ry] = entry.sidewall;
      entry.hull = Array.from({ length: 96 }, (_, i) => {
        const angle = (i * Math.PI * 2) / 96;
        return [
          cx + rx * Math.cos(angle),
          cy + ry * Math.sin(angle) + (Math.sin(angle) > 0 ? depth : 0),
        ];
      });
    }
    if (entry.hull) {
      const bottomPoint = entry.hull.reduce((a, b) => (b[1] > a[1] ? b : a));
      entry.anchor = bottomPoint;
      entry.width =
        Math.max(...entry.hull.map((p) => p[0])) -
        Math.min(...entry.hull.map((p) => p[0]));
      entry.height =
        Math.max(...entry.hull.map((p) => p[1])) -
        Math.min(...entry.hull.map((p) => p[1]));
    } else {
      const contactPaths =
        asset.family === "headphones"
          ? body.filter(
              (p) =>
                p.fill !== "#181817" &&
                p.fill !== "#7864D7" &&
                p.box[2] * p.box[3] > asset.width * asset.height * 0.01,
            )
          : body;
      const contact = contactPaths
        .flatMap((p) => p.points)
        .reduce((a, b) => (b[1] > a[1] ? b : a));
      entry.anchor = contact;
    }
    if (asset.family === "phone")
      entry.body_exclude_path_ids = [...entry.cast_path_ids];
    const measurement = await page.evaluate(
      async ({ source, asset, entry }) => {
        const doc = new DOMParser().parseFromString(source, "image/svg+xml");
        applyCustomShadow(doc, {
          metadata: entry,
          preserveSource: true,
          separateLayers: true,
          settings: { angle: 0, length: 1, opacity: 0.999 },
          role: asset.role,
          width: asset.width,
          height: asset.height,
        });
        const root = doc.documentElement;
        root.querySelector("[data-custom-shadow]").setAttribute("opacity", "1");
        const cleanBodyRoot = root.cloneNode(true);
        cleanBodyRoot.querySelector("[data-custom-shadow]").remove();
        cleanBodyRoot
          .querySelector("[data-shadow-body]")
          .setAttribute("mask", "url(#custom-body-mask)");
        for (const node of cleanBodyRoot
          .querySelector("[data-shadow-body]")
          .querySelectorAll("path"))
          if ((entry.body_exclude_path_ids ?? []).includes(node.id))
            node.remove();
        const bodyRoot = root.cloneNode(true);
        bodyRoot.querySelector("[data-custom-shadow]").remove();
        bodyRoot.lastElementChild.remove();
        const matteRect = doc.createElementNS(
          "http://www.w3.org/2000/svg",
          "rect",
        );
        for (const [key, value] of Object.entries({
          x: 0,
          y: 0,
          width: asset.width,
          height: asset.height,
          fill: "white",
          mask: "url(#custom-body-mask)",
        }))
          matteRect.setAttribute(key, String(value));
        bodyRoot.append(matteRect);
        root.lastElementChild.remove(); // isolate the real cast, including both masks/clip
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(asset.width);
        canvas.height = Math.ceil(asset.height);
        const context = canvas.getContext("2d");
        const raster = async (svg) => {
          const image = new Image();
          image.src =
            "data:image/svg+xml;charset=utf-8," +
            encodeURIComponent(new XMLSerializer().serializeToString(svg));
          await image.decode();
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          return context.getImageData(0, 0, canvas.width, canvas.height).data;
        };
        const pixels = await raster(root),
          bodyPixels = await raster(bodyRoot),
          cleanBodyPixels = await raster(cleanBodyRoot);
        let left = canvas.width,
          top = canvas.height,
          right = -1,
          bottom = -1;
        for (let y = 0; y < canvas.height; y++)
          for (let x = 0; x < canvas.width; x++) {
            if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
          }
        if (right < left || bottom < top)
          throw new Error("Empty original cast: " + asset.id);
        const sx = asset.width / canvas.width,
          sy = asset.height / canvas.height;
        // Ground projection is derived from body alpha, never the old cast.
        // The measured clean-body alpha bounds seed a reviewed support edge.
        let bodyLeft = canvas.width,
          bodyTop = canvas.height,
          bodyRight = -1,
          bodyBottom = -1;
        for (let y = 0; y < canvas.height; y++)
          for (let x = 0; x < canvas.width; x++) {
            if (cleanBodyPixels[(y * canvas.width + x) * 4 + 3] < 128) continue;
            bodyLeft = Math.min(bodyLeft, x);
            bodyRight = Math.max(bodyRight, x);
            bodyTop = Math.min(bodyTop, y);
            bodyBottom = Math.max(bodyBottom, y);
          }
        if (bodyRight < bodyLeft)
          throw new Error("Empty projection body: " + asset.id);
        const bodyBox = [
          bodyLeft * sx,
          bodyTop * sy,
          (bodyRight - bodyLeft + 1) * sx,
          (bodyBottom - bodyTop + 1) * sy,
        ];
        // Use the visible lower support edge, not a tangent at one lowest pixel:
        // the tangent makes flat isometric objects appear to float above the cast.
        let ground;
        if (["coin", "flowers"].includes(asset.family)) {
          // A round footprint has no straight front edge. Use a line within its
          // lower support area; actual body occlusion hides the concealed part.
          const fraction = asset.family === "coin" ? 0.8 : 0.93;
          const supportY = Math.round(
            bodyTop + (bodyBottom - bodyTop) * fraction,
          );
          let supportLeft = canvas.width,
            supportRight = -1;
          for (let x = bodyLeft; x <= bodyRight; x++) {
            if (cleanBodyPixels[(supportY * canvas.width + x) * 4 + 3] < 128)
              continue;
            supportLeft = Math.min(supportLeft, x);
            supportRight = Math.max(supportRight, x);
          }
          ground = [
            supportLeft * sx,
            (supportY + 0.5) * sy,
            (supportRight + 1) * sx,
            (supportY + 0.5) * sy,
          ];
        } else {
          const lower = [];
          const cross = (a, b, c) =>
            (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
          for (let x = bodyLeft; x <= bodyRight; x++) {
            let y = bodyBottom;
            while (
              y >= bodyTop &&
              cleanBodyPixels[(y * canvas.width + x) * 4 + 3] < 128
            )
              y--;
            if (y < bodyTop) continue;
            const point = [(x + 0.5) * sx, (y + 0.5) * sy];
            while (
              lower.length > 1 &&
              cross(lower.at(-2), lower.at(-1), point) >= 0
            )
              lower.pop();
            lower.push(point);
          }
          const simplifySupport = (points) => {
            if (points.length <= 2) return points;
            const first = points[0],
              last = points.at(-1);
            const span = Math.hypot(last[0] - first[0], last[1] - first[1]);
            let farthest = 0,
              at = 0;
            for (let i = 1; i < points.length - 1; i++) {
              const distance =
                Math.abs(cross(first, last, points[i])) / Math.max(span, 1e-9);
              if (distance > farthest) {
                farthest = distance;
                at = i;
              }
            }
            if (farthest <= entry.outline * 2) return [first, last];
            return [
              ...simplifySupport(points.slice(0, at + 1)).slice(0, -1),
              ...simplifySupport(points.slice(at)),
            ];
          };
          const support = simplifySupport(lower);
          const candidates = support
            .slice(1)
            .map((point, i) => [...support[i], ...point])
            .filter(
              ([x1, y1, x2, y2]) =>
                x2 - x1 > bodyBox[2] * 0.12 &&
                y2 >= y1 &&
                (y1 + y2) / 2 >= bodyBox[1] + bodyBox[3] * 0.55,
            )
            .sort((a, b) => b[2] - b[0] - (a[2] - a[0]));
          ground = candidates[0] ?? [
            bodyBox[0],
            (bodyBottom + 0.5) * sy,
            bodyBox[0] + bodyBox[2],
            (bodyBottom + 0.5) * sy,
          ];
        }
        const depthRatio = ["lamp", "flowers"].includes(asset.family)
          ? 0.65
          : asset.family === "headphones"
            ? 0.45
            : 0.18;
        const projection = {
          ground,
          depth: bodyBox[3] * depthRatio,
          body_bbox: bodyBox,
        };
        // Measure only the local boundary between the original cast and body.
        // Edges are kept separate across gaps and concavities (earphone cups,
        // puzzle pieces): no object-wide hull or invented hidden silhouette.
        const alpha = (data, x, y) =>
          x < 0 || y < 0 || x >= canvas.width || y >= canvas.height
            ? 0
            : data[(y * canvas.width + x) * 4 + 3];
        const horizontal = new Map(),
          vertical = new Map();
        const add = (map, key, start) => {
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(start);
        };
        for (let y = top; y <= bottom; y++)
          for (let x = left; x <= right; x++) {
            if (alpha(pixels, x, y) < 128) continue;
            for (const [dx, dy] of [
              [0, -1],
              [1, 0],
              [0, 1],
              [-1, 0],
            ]) {
              if (alpha(pixels, x + dx, y + dy) >= 128) continue;
              // Some reviewed casts start just outside the visible outline (the
              // folder's lower edge is ~10 L pixels away). Keep the search local
              // to that outline width, then anchor on the nearest body perimeter.
              const reach = Math.ceil(entry.outline * 5);
              let touchesBody = false;
              for (let oy = -reach; oy <= reach && !touchesBody; oy++)
                for (let ox = -reach; ox <= reach; ox++)
                  if (
                    ox * ox + oy * oy <= reach * reach &&
                    alpha(bodyPixels, x + dx + ox, y + dy + oy) >= 128
                  ) {
                    touchesBody = true;
                    break;
                  }
              if (!touchesBody) continue;
              if (dy) add(horizontal, y + (dy > 0 ? 1 : 0), x);
              else add(vertical, x + (dx > 0 ? 1 : 0), y);
            }
          }
        const edges = [];
        const merge = (map, horizontal) => {
          for (const [fixed, values] of [...map].sort((a, b) => a[0] - b[0])) {
            const sorted = [...new Set(values)].sort((a, b) => a - b);
            for (let index = 0; index < sorted.length;) {
              const start = sorted[index];
              let end = start + 1;
              while (++index < sorted.length && sorted[index] === end) end++;
              edges.push(
                horizontal
                  ? [start, fixed, end, fixed]
                  : [fixed, start, fixed, end],
              );
            }
          }
        };
        merge(horizontal, true);
        merge(vertical, false);
        // Trace connected contact runs, then remove raster stair steps within
        // one sample pixel. Each run stays local; disconnected contacts never
        // get joined by simplification. Original SVG path data is untouched.
        const neighbors = new Map(),
          key = (p) => p.join(",");
        edges.forEach((edge, index) => {
          for (const point of [edge.slice(0, 2), edge.slice(2)]) {
            if (!neighbors.has(key(point))) neighbors.set(key(point), []);
            neighbors.get(key(point)).push(index);
          }
        });
        const simplify = (points) => {
          if (points.length < 3) return points;
          const first = points[0],
            last = points.at(-1),
            dx = last[0] - first[0],
            dy = last[1] - first[1],
            squared = dx * dx + dy * dy;
          let distance = 0,
            split = 0;
          for (let index = 1; index < points.length - 1; index++) {
            const point = points[index],
              t = squared
                ? Math.max(
                    0,
                    Math.min(
                      1,
                      ((point[0] - first[0]) * dx +
                        (point[1] - first[1]) * dy) /
                        squared,
                    ),
                  )
                : 0,
              error = Math.hypot(
                point[0] - first[0] - t * dx,
                point[1] - first[1] - t * dy,
              );
            if (error > distance) {
              distance = error;
              split = index;
            }
          }
          return distance <= 0.7
            ? [first, last]
            : [
                ...simplify(points.slice(0, split + 1)).slice(0, -1),
                ...simplify(points.slice(split)),
              ];
        };
        const visited = new Set(),
          simplified = [];
        const trace = (firstIndex, start) => {
          const points = [start];
          let index = firstIndex,
            current = start;
          while (!visited.has(index)) {
            visited.add(index);
            const edge = edges[index],
              next =
                key(edge.slice(0, 2)) === key(current)
                  ? edge.slice(2)
                  : edge.slice(0, 2);
            points.push(next);
            const adjacent = neighbors.get(key(next));
            if (adjacent.length !== 2) break;
            const candidate = adjacent.find((n) => !visited.has(n));
            if (candidate === undefined) break;
            current = next;
            index = candidate;
          }
          const run = simplify(points);
          for (let i = 1; i < run.length; i++)
            simplified.push([...run[i - 1], ...run[i]]);
        };
        edges.forEach((edge, index) => {
          if (visited.has(index)) return;
          for (const point of [edge.slice(0, 2), edge.slice(2)])
            if (neighbors.get(key(point)).length !== 2) {
              trace(index, point);
              break;
            }
        });
        edges.forEach((edge, index) => {
          if (!visited.has(index)) trace(index, edge.slice(0, 2));
        });
        if (!simplified.length)
          throw new Error("No original attachment contact: " + asset.id);
        const nearestBody = ([x, y]) => {
          const reach = Math.ceil(entry.outline * 5);
          let best = Infinity,
            nearest = [x, y];
          for (let oy = -reach; oy <= reach; oy++)
            for (let ox = -reach; ox <= reach; ox++) {
              const px = Math.round(x) + ox,
                py = Math.round(y) + oy;
              if (alpha(bodyPixels, px, py) < 128) continue;
              const distance = (px + 0.5 - x) ** 2 + (py + 0.5 - y) ** 2;
              if (distance < best) {
                best = distance;
                nearest = [px + 0.5, py + 0.5];
              }
            }
          return nearest;
        };
        const roundEdge = (edge) =>
          edge.map((n, i) => Math.round(n * (i % 2 ? sy : sx) * 1e6) / 1e6);
        const paired = simplified.map((edge) => ({
          cast: edge,
          body: [
            ...nearestBody(edge.slice(0, 2)),
            ...nearestBody(edge.slice(2)),
          ],
        }));
        return {
          projection,
          cast_bbox: [
            left * sx,
            top * sy,
            (right - left + 1) * sx,
            (bottom - top + 1) * sy,
          ],
          attachment_edges: paired.map((pair) => roundEdge(pair.body)),
          attachment_cast_edges: paired.map((pair) => roundEdge(pair.cast)),
          attachment_overlap: Math.max(sx, sy) * 3,
        };
      },
      { source: readFileSync(`assets/${asset.file}`, "utf8"), asset, entry },
    );
    Object.assign(entry, measurement);
    result[asset.id] = entry;
  }
  // Review one support feature per family, then map it into each measured body
  // bbox. Raster hull simplification must not choose a different base edge when
  // detail/role changes (the two headphone cups are especially sensitive).
  for (const asset of measured) {
    const baseline = measured.find(
      (a) => a.family === asset.family && a.detail === "L" && a.role === "main",
    );
    const reference = result[baseline.id].projection;
    const projection = result[asset.id].projection;
    const [rx, ry, rw, rh] = reference.body_bbox;
    const [x, y, w, h] = projection.body_bbox;
    projection.ground = reference.ground.map((value, index) =>
      index % 2 ? y + ((value - ry) / rh) * h : x + ((value - rx) / rw) * w,
    );
  }
  writeFileSync(
    "assets/shadow-map.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    `Prepared ${Object.keys(result).length} opt-in body masks; original SVG files unchanged`,
  );
} finally {
  await browser.close();
}
