import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { enterExperiment } from "./helpers/experimental";
import type { Scene } from "../src/types";

const catalog = JSON.parse(readFileSync("../assets/catalog.json", "utf8"));
const metadata = JSON.parse(readFileSync("../assets/shadow-map.json", "utf8"));
const lamp = metadata["l-main-lamp"];
const fixture: Scene = {
  version: 1,
  title: "Проекция — проверка управления",
  format: "landscape",
  detail: "L",
  scale: 0.25,
  palette: catalog.palettes[0],
  transparent: false,
  elements: [
    {
      id: "projection-lamp",
      family: "lamp",
      role: "main",
      x: 400,
      y: 60,
      angle: 22,
      scale_x: 1.2,
      scale_y: 0.8,
      hidden: false,
      locked: false,
      shadow: { angle: 45, length: 1, opacity: 1 },
    },
  ],
};
const cast = (page: Page) =>
  page.getByTestId("artboard").locator("[data-custom-shadow]");
const owner = (page: Page) =>
  page.getByTestId("artboard").locator('[data-element-id="projection-lamp"]');

async function fixedContact(page: Page) {
  const points = await cast(page).evaluate((node, ground) => {
    const m = (node as SVGGElement).transform.baseVal.getItem(0).matrix;
    return [
      new DOMPoint(ground[0], ground[1]),
      new DOMPoint(ground[2], ground[3]),
    ].map((p) => ({
      before: [p.x, p.y],
      after: [p.matrixTransform(m).x, p.matrixTransform(m).y],
    }));
  }, lamp.projection.ground as number[]);
  for (const p of points) {
    expect(p.after[0]).toBeCloseTo(p.before[0], 2);
    expect(p.after[1]).toBeCloseTo(p.before[1], 2);
  }
}
async function drag(
  page: Page,
  target: ReturnType<Page["locator"]>,
  dx: number,
  dy: number,
) {
  const rect = await target.boundingBox();
  expect(rect).not.toBeNull();
  const x = rect!.x + rect!.width / 2,
    y = rect!.y + rect!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
}

// Find a truly painted point from the vector shadow, including its body occlusion mask.
async function shadowInk(page: Page, part: "shadow" | "body" = "shadow") {
  const target =
    part === "shadow" ? cast(page) : owner(page).locator("[data-shadow-body]");
  return target.evaluate(async (node, bbox) => {
    const ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    const layer = node as SVGGElement,
      matrix = layer.transform.baseVal.numberOfItems
        ? layer.transform.baseVal.getItem(0).matrix
        : new DOMMatrix();
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
  }, lamp.projection.body_bbox as number[]);
}

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
          shadow: metadata[asset.id],
        })),
      },
    });
  });
  let scene = structuredClone(fixture),
    revision = 1;
  await page.route(
    "**/api/projects/projection-controls-fixture",
    async (route) => {
      if (route.request().method() === "PUT") {
        scene = route.request().postDataJSON().scene;
        revision++;
      }
      await route.fulfill({
        json: {
          id: "projection-controls-fixture",
          scene,
          revision,
          updated_at: "2026-11-10T00:00:00Z",
        },
      });
    },
  );
  await page.goto("/?project=projection-controls-fixture");
  await expect(owner(page)).toBeVisible();
  await enterExperiment(page);
  await expect(cast(page)).toHaveAttribute(
    "data-shadow-source",
    "body-silhouette",
  );
  await page.getByRole("button", { name: "Слой Лампа", exact: true }).click();
  await page
    .getByRole("button", { name: "Выделить тень на холсте", exact: true })
    .click();
});

test("projection endpoint, rotation, keyboard, undo and reload keep the support fixed", async ({
  page,
}, testInfo) => {
  const unchangedOwner = await owner(page).getAttribute("transform");
  const initial = await cast(page).getAttribute("transform");
  const endpoint = page.getByRole("button", {
    name: "Направление и длина тени",
    exact: true,
  });
  await expect(endpoint).toBeVisible();
  await expect(
    page.getByTestId("artboard").locator("[data-resize-handle]"),
  ).toHaveCount(1);
  await fixedContact(page);
  // Cancellation restores the baseline and creates no committed history entry.
  const start = await endpoint.boundingBox();
  await page.mouse.move(
    start!.x + start!.width / 2,
    start!.y + start!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    start!.x + start!.width / 2 + 28,
    start!.y + start!.height / 2 + 12,
  );
  await expect(cast(page)).not.toHaveAttribute("transform", initial!);
  await page
    .getByTestId("artboard")
    .dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  await expect(cast(page)).toHaveAttribute("transform", initial!);
  await expect(
    page.getByRole("button", { name: "Отменить", exact: true }),
  ).toBeDisabled();
  await drag(page, endpoint, 35, 12);
  await expect(cast(page)).not.toHaveAttribute("transform", initial!);
  const stretched = await cast(page).getAttribute("transform");
  await fixedContact(page);
  await drag(
    page,
    page.getByRole("button", { name: "Повернуть тень", exact: true }),
    -18,
    28,
  );
  await expect(cast(page)).not.toHaveAttribute("transform", stretched!);
  await fixedContact(page);
  const rotated = await cast(page).getAttribute("transform");
  await page.getByTestId("artboard").focus();
  await page.keyboard.press("ArrowRight");
  await expect(cast(page)).not.toHaveAttribute("transform", rotated!);
  await fixedContact(page);
  await expect(owner(page)).toHaveAttribute("transform", unchangedOwner!);
  for (const matrix of [rotated, stretched, initial]) {
    await page.getByRole("button", { name: "Отменить", exact: true }).click();
    await expect(cast(page)).toHaveAttribute("transform", matrix!);
    await fixedContact(page);
  }
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(cast(page)).toHaveAttribute("transform", stretched!);
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  await page.reload();
  await enterExperiment(page);
  await expect(cast(page)).toHaveAttribute("transform", stretched!);
  await fixedContact(page);
  await page.screenshot({
    path: testInfo.outputPath("silhouette-controls.png"),
  });
});

test("visible projected silhouette is selected and dragged without translating its contact", async ({
  page,
}) => {
  const initial = await cast(page).getAttribute("transform");
  // Remove controls so the hit can only come from the visible silhouette.
  await page
    .getByRole("button", { name: "Снять выделение", exact: true })
    .click();
  const p = await shadowInk(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 22, p.y - 16, { steps: 5 });
  await page.mouse.up();
  await expect(
    page.getByTestId("artboard").locator("[data-selected-part]"),
  ).toHaveAttribute("data-selected-part", "shadow");
  await expect(cast(page)).not.toHaveAttribute("transform", initial!);
  await fixedContact(page);
});

test("reset uses the standard projection; disabling restores the ordinary source", async ({
  page,
}) => {
  const input = page.getByLabel("Направление тени", { exact: true });
  await input.fill("125");
  await input.blur();
  await page
    .getByRole("button", { name: "Сбросить проекцию тени", exact: true })
    .click();
  await expect(input).toHaveValue("90");
  await expect(page.getByLabel("Длина тени", { exact: true })).toHaveValue(
    "100",
  );
  await fixedContact(page);
  await page
    .getByRole("button", { name: "Отключить свою тень", exact: true })
    .click();
  await expect(cast(page)).toHaveCount(0);
  await expect(page.getByLabel("Своя тень", { exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(cast(page)).toHaveCount(1);
  await fixedContact(page);
  await page
    .getByRole("button", { name: "Зафиксировать Лампа", exact: true })
    .click();
  const locked = await cast(page).getAttribute("transform");
  const point = await shadowInk(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 20, point.y + 10, { steps: 3 });
  await page.mouse.up();
  await expect(cast(page)).toHaveAttribute("transform", locked!);
  await expect(
    page
      .getByTestId("artboard")
      .locator("[data-resize-handle],[data-rotate-handle]"),
  ).toHaveCount(0);
});

test("visible body wins over its projection and legacy offset projections remain selectable at zero length", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Снять выделение", exact: true })
    .click();
  const body = await shadowInk(page, "body");
  await page.mouse.click(body.x, body.y);
  await expect(
    page.getByTestId("artboard").locator("[data-selected-part]"),
  ).toHaveAttribute("data-selected-part", "object");
  const legacy = structuredClone(fixture);
  legacy.elements[0].shadow = {
    angle: 45,
    length: 0,
    opacity: 1,
    x: 300,
    y: 300,
  };
  await page.route("**/api/projects/projection-controls-fixture", (route) =>
    route.fulfill({
      json: {
        id: "projection-controls-fixture",
        scene: legacy,
        revision: 1,
        updated_at: "2026-11-10T00:00:00Z",
      },
    }),
  );
  await page.reload();
  await enterExperiment(page);
  await expect(cast(page)).toBeVisible();
  const point = await shadowInk(page);
  await page.mouse.click(point.x, point.y);
  await expect(
    page.getByTestId("artboard").locator("[data-selected-part]"),
  ).toHaveAttribute("data-selected-part", "shadow");
  await fixedContact(page);
});
