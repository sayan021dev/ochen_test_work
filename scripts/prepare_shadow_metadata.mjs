// Build-time only: original files are read, never rewritten. Review the contact sheet after changes.
import { chromium } from "../frontend/node_modules/@playwright/test/index.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const catalog = JSON.parse(readFileSync("assets/catalog.json", "utf8")).assets;
// Reviewed source path indices: silhouette underpaint can contain both outline and cast shadow.
const exclusions = {
  book: [1, 2],
  phone: [0, 94],
  puzzle: [0, 11],
  coin: [81, 82, 135],
  headphones: [0, 1],
  lamp: [0, 1],
  flowers: [0, 2],
  wallet: [0, 1],
  folder: [0, 1, 16],
  pen: [0],
};
const browser = await chromium.launch({
  headless: true,
  channel: process.env.CI ? undefined : "chrome",
});
try {
  const page = await browser.newPage();
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
    const body = asset.paths.filter((p) => !excluded.has(p.id));
    const x = Math.min(...body.map((p) => p.box[0])),
      y = Math.min(...body.map((p) => p.box[1]));
    const right = Math.max(...body.map((p) => p.box[0] + p.box[2])),
      bottom = Math.max(...body.map((p) => p.box[1] + p.box[3]));
    const entry = {
      source_sha256: asset.sha256,
      body_path_ids: body.map((p) => p.id),
      anchor: [(x + right) / 2, bottom],
      width: right - x,
      height: bottom - y,
      outline: asset.detail === "L" ? 4 : 2,
    };
    if (asset.family === "flowers" || asset.family === "lamp")
      entry.preserve_above =
        asset.height * (asset.family === "flowers" ? 0.7 : 0.5);
    if (asset.family === "flowers")
      entry.erase_path_ids = [
        asset.paths.find((p) => p.id === [...excluded][1]).id,
      ];
    if (
      ["pen", "coin", "wallet", "folder", "headphones"].includes(asset.family)
    ) {
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
      const contact = body
        .flatMap((p) => p.points)
        .reduce((a, b) => (b[1] > a[1] ? b : a));
      entry.anchor = contact;
    }
    result[asset.id] = entry;
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
