import { expect, test, type Page } from "@playwright/test";
import { enterExperiment } from "./helpers/experimental";
import { readFileSync } from "node:fs";
const shadowMetadata = JSON.parse(
  readFileSync("../assets/shadow-map.json", "utf8"),
);

test.beforeEach(async ({ page, context }) => {
  await context.addCookies([
    { name: "ochen_welcome_seen", value: "1", url: "http://127.0.0.1:5178" },
  ]);
  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        assets: data.assets.map((asset: { id: string }) => ({
          ...asset,
          shadow: shadowMetadata[asset.id],
        })),
      },
    });
  });
  await page.goto("/");
  await expect(
    page.getByTestId("artboard").locator('[data-family="lamp"] path').first(),
  ).toBeAttached();
});

// Find a truly painted point from the vector shadow, including its body occlusion mask.
async function castPixel(page: Page) {
  return page
    .getByTestId("artboard")
    .locator("[data-custom-shadow]")
    .evaluate(async (node, bbox) => {
      const ns = "http://www.w3.org/2000/svg",
        svg = document.createElementNS(ns, "svg");
      const layer = node as SVGGElement,
        matrix = layer.transform.baseVal.getItem(0).matrix;
      const [x, y, w, h] = bbox;
      const points = [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
      const minX = Math.floor(Math.min(...points.map((p) => p.x))) - 5,
        minY = Math.floor(Math.min(...points.map((p) => p.y))) - 5;
      const width = Math.ceil(Math.max(...points.map((p) => p.x)) - minX) + 5,
        height = Math.ceil(Math.max(...points.map((p) => p.y)) - minY) + 5;
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      svg.setAttribute("viewBox", `${minX} ${minY} ${width} ${height}`);
      const container =
        layer.closest("[data-shadow-owner-id]") ??
        layer.closest("[data-element-id]")!;
      for (const defs of container.querySelectorAll("defs"))
        svg.append(defs.cloneNode(true));
      svg.append(layer.cloneNode(true));
      const image = new Image();
      image.src =
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(new XMLSerializer().serializeToString(svg));
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, width, height).data;
      let longest = 0,
        picked = { x: 0, y: 0 };
      for (let y = 3; y < height - 3; y += 3) {
        let start = 0;
        for (let x = 0; x <= width; x++) {
          if (x < width && pixels[(y * width + x) * 4 + 3] > 245) continue;
          if (x - start > longest) {
            longest = x - start;
            picked = { x: minX + (x + start) / 2, y: minY + y };
          }
          start = x + 1;
        }
      }
      if (longest < 10) throw new Error("No visible silhouette ink to select");
      const parent = layer.parentElement as unknown as SVGGraphicsElement;
      const screen = new DOMPoint(picked.x, picked.y).matrixTransform(
        parent.getScreenCTM()!,
      );
      return { x: screen.x, y: screen.y };
    }, shadowMetadata["l-main-lamp"].projection.body_bbox as number[]);
}

test("clicking silhouette ink, dragging its vector and rotating preserve its owner and support", async ({
  page,
}) => {
  await enterExperiment(page);
  // Isolate the gesture target; other bodies correctly take priority over scene shadows.
  await page.getByRole("button", { name: "Скрыть Книга", exact: true }).click();
  await page
    .getByRole("button", { name: "Скрыть Наушники", exact: true })
    .click();
  await page.getByRole("button", { name: "Слой Лампа", exact: true }).click();
  await page.getByLabel("Положение X", { exact: true }).fill("300");
  await page.getByLabel("Положение X", { exact: true }).blur();
  await page.getByLabel("Положение Y", { exact: true }).fill("0");
  await page.getByLabel("Положение Y", { exact: true }).blur();
  await page.getByLabel("Своя тень", { exact: true }).check();
  const board = page.getByTestId("artboard"),
    owner = board.locator('[data-family="lamp"]'),
    cast = board.locator("[data-custom-shadow]");
  const fixedSupport = async () => {
    const points = await cast.evaluate((node, ground) => {
      const matrix = (node as SVGGElement).transform.baseVal.getItem(0).matrix;
      return [
        new DOMPoint(ground[0], ground[1]),
        new DOMPoint(ground[2], ground[3]),
      ].map((p) => ({
        before: [p.x, p.y],
        after: [p.matrixTransform(matrix).x, p.matrixTransform(matrix).y],
      }));
    }, shadowMetadata["l-main-lamp"].projection.ground as number[]);
    for (const point of points) {
      expect(point.after[0]).toBeCloseTo(point.before[0], 2);
      expect(point.after[1]).toBeCloseTo(point.before[1], 2);
    }
  };
  await fixedSupport();
  const ownerMatrix = await owner.getAttribute("transform"),
    initial = await cast.getAttribute("transform");
  const from = await castPixel(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 32, from.y - 22, { steps: 5 });
  await page.mouse.up();
  await expect(board.locator("[data-selected-part]")).toHaveAttribute(
    "data-selected-part",
    "shadow",
  );
  await expect(cast).not.toHaveAttribute("transform", initial!);
  await fixedSupport();
  const moved = await cast.getAttribute("transform");
  const side = await board
    .getByRole("button", { name: "Направление и длина тени", exact: true })
    .boundingBox();
  await page.mouse.move(side!.x + side!.width / 2, side!.y + side!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    side!.x + side!.width / 2 + 12,
    side!.y + side!.height / 2,
    { steps: 3 },
  );
  await page.mouse.up();
  await expect(cast).not.toHaveAttribute("transform", moved!);
  await fixedSupport();
  const stretched = await cast.getAttribute("transform");
  const rotate = await board
    .getByRole("button", { name: "Повернуть тень", exact: true })
    .boundingBox();
  await page.mouse.move(rotate!.x + 5, rotate!.y + 5);
  await page.mouse.down();
  await page.mouse.move(rotate!.x + 35, rotate!.y + 15, { steps: 4 });
  await page.mouse.up();
  await expect(cast).not.toHaveAttribute("transform", stretched!);
  await fixedSupport();
  await expect(owner).toHaveAttribute("transform", ownerMatrix!);
  for (const matrix of [stretched, moved, initial]) {
    await page.getByRole("button", { name: "Отменить", exact: true }).click();
    await expect(cast).toHaveAttribute("transform", matrix!);
    await fixedSupport();
  }
});

test("zoom preserves the viewed center after native wheel panning and exposes both scrollbars", async ({
  page,
}) => {
  await page.getByLabel("Размер холста").selectOption("square");
  const pane = page.getByTestId("canvas-scroll"),
    zoom = page.getByRole("button", { name: "Увеличить масштаб просмотра" });
  const center = () =>
    pane.evaluate((n) => {
      const b = n.getBoundingClientRect(),
        p = new DOMPoint(
          b.left + n.clientWidth / 2,
          b.top + n.clientHeight / 2,
        ).matrixTransform(n.querySelector("svg")!.getScreenCTM()!.inverse());
      return {
        x: p.x,
        y: p.y,
        sx: n.scrollLeft,
        sy: n.scrollTop,
        overflowX: n.scrollWidth > n.clientWidth,
        overflowY: n.scrollHeight > n.clientHeight,
      };
    });
  const initial = await center();
  for (let i = 0; i < 8; i++) await zoom.click();
  const enlarged = await center();
  expect(enlarged.overflowX && enlarged.overflowY).toBe(true);
  expect(Math.abs(enlarged.x - initial.x)).toBeLessThan(4);
  expect(Math.abs(enlarged.y - initial.y)).toBeLessThan(4);
  await pane.hover();
  await page.mouse.wheel(60, 45);
  await expect
    .poll(async () => (await center()).sy)
    .toBeGreaterThan(enlarged.sy);
  const panned = await center();
  expect(panned.sx).toBeGreaterThan(enlarged.sx);
  await zoom.click();
  const next = await center();
  expect(Math.abs(next.x - panned.x)).toBeLessThan(4);
  expect(Math.abs(next.y - panned.y)).toBeLessThan(4);
});
