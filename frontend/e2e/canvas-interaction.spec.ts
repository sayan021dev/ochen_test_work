import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page, context }) => {
  await context.addCookies([
    { name: "ochen_welcome_seen", value: "1", url: "http://127.0.0.1:5178" },
  ]);
  await page.goto("/");
  await expect(
    page.getByTestId("artboard").locator('[data-family="lamp"] path').first(),
  ).toBeAttached();
});

// Use the visible ink from the source cast so this also covers identity mode,
// where the renderer coalesces both layers for lossless display.
async function castPixel(page: Page) {
  return page
    .getByTestId("artboard")
    .locator('[data-family="lamp"]')
    .evaluate(async (node) => {
      const shadowOwner =
        node.ownerSVGElement!.querySelector(
          `[data-shadow-owner-id="${(node as SVGGElement).dataset.elementId}"]`,
        ) ?? node;
      const source = shadowOwner.querySelector<SVGGElement>(
        "[data-custom-shadow]",
      )!;
      const layer = source.cloneNode(true) as SVGGElement;
      layer.removeAttribute("display");
      layer.removeAttribute("transform");
      const ns = "http://www.w3.org/2000/svg",
        svg = document.createElementNS(ns, "svg");
      svg.setAttribute("width", "946");
      svg.setAttribute("height", "1129");
      svg.setAttribute("fill", "none");
      svg.append(shadowOwner.querySelector("defs")!.cloneNode(true), layer);
      const img = new Image();
      img.src =
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(new XMLSerializer().serializeToString(svg));
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 946;
      canvas.height = 1129;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const ink = ctx.getImageData(0, 0, 946, 1129).data;
      let longest = 0,
        picked = { x: 0, y: 0 };
      for (let y = 5; y < 1124; y += 5) {
        let start = 0;
        for (let x = 0; x <= 946; x++) {
          if (x < 946 && ink[(y * 946 + x) * 4 + 3] > 235) continue;
          if (x - start > longest) {
            longest = x - start;
            picked = { x: (x + start) / 2, y };
          }
          start = x + 1;
        }
      }
      if (longest < 10) throw new Error("Lamp cast has no selectable area");
      const pos = new DOMPoint(picked.x, picked.y)
        .matrixTransform(source.transform.baseVal.getItem(0).matrix)
        .matrixTransform((node as SVGGElement).getScreenCTM()!);
      return { x: pos.x, y: pos.y };
    });
}

test("clicking source shadow ink, dragging, stretching and rotating preserve its owner", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Слой Лампа", exact: true }).click();
  await page.getByLabel("Своя тень", { exact: true }).check();
  const board = page.getByTestId("artboard"),
    owner = board.locator('[data-family="lamp"]'),
    cast = board.locator("[data-custom-shadow]");
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
  const moved = await cast.getAttribute("transform");
  const side = await board
    .getByRole("button", { name: "Размер тени: e", exact: true })
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
  const stretched = await cast.getAttribute("transform");
  const rotate = await board
    .getByRole("button", { name: "Повернуть тень", exact: true })
    .boundingBox();
  await page.mouse.move(rotate!.x + 5, rotate!.y + 5);
  await page.mouse.down();
  await page.mouse.move(rotate!.x + 35, rotate!.y + 15, { steps: 4 });
  await page.mouse.up();
  await expect(cast).not.toHaveAttribute("transform", stretched!);
  await expect(owner).toHaveAttribute("transform", ownerMatrix!);
  for (const matrix of [stretched, moved, initial]) {
    await page.getByRole("button", { name: "Отменить", exact: true }).click();
    await expect(cast).toHaveAttribute("transform", matrix!);
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
